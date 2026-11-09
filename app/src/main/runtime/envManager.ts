import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { access, chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { execCli, isWindows, spawnCli } from '../platform'
import type { RuntimeLayerInfo, RuntimeProgress, RuntimeStatus } from '../../shared/runtime'
import { CELL_LIMIT_CHOICES, DEFAULT_CELL_LIMIT_S } from '../../shared/runtime'
import {
  CORE_LAYER,
  PYTHON_VERSION,
  UV_VERSION,
  envDirFor,
  envInterpreter,
  lockHash,
  progressLine,
  runtimeLayout,
  runtimeTarget,
  scrubbedEnv,
  uvAssetFor,
  type RuntimeLayout,
} from './runtimePaths'

/**
 * The code runtime's installer: a pinned uv, a uv-managed CPython, and one
 * venv per lockfile, all under app userData. See docs/code-runtime.md.
 *
 * Doctrine: this is a subprocess door (D1) and a writer (D2), and it is
 * pinned as both. Every command it runs is the pinned uv binary, `tar` to
 * unpack that binary, or the env's own interpreter asked for package
 * versions. It never runs the engine, never names the learning home, and
 * never touches a system Python: uv is told to use only interpreters it
 * manages itself, under this root.
 */

const LAYERS: { id: string; label: string; description: string; lockFile: string }[] = [
  {
    id: CORE_LAYER,
    label: 'QEC core',
    description: 'Stim, sinter, PyMatching, ldpc, NumPy, SciPy, Matplotlib, QuTiP and pytest.',
    lockFile: 'qec-core.lock',
  },
]


interface LayerState {
  lockHash: string
  envDir: string
  pythonVersion: string
  packages: Record<string, string>
  installedAt: string
}

interface StateFile {
  layers: Record<string, LayerState>
  cellLimitS: number
}

const COMPLETE_MARKER = '.engram-complete'

function resourceDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'runtime') : join(__dirname, '../../resources/runtime')
}

/** Matplotlib's font cache, kept under the runtime rather than the learner's home folder. */
export function mplConfigDir(): string {
  return join(layout().root, 'mplconfig')
}

export function kernelFilePath(): string {
  return join(resourceDir(), 'engram_kernel.py')
}

function layout(): RuntimeLayout {
  return runtimeLayout(join(app.getPath('userData'), 'runtime'), process.platform)
}

/** Removes envs that are neither the one in use nor the one being built. */
async function pruneEnvs(l: RuntimeLayout, building: string): Promise<void> {
  const inUse = (await readState(l)).layers[CORE_LAYER]?.envDir
  let names: string[] = []
  try {
    names = await readdir(l.envsDir)
  } catch {
    return
  }
  for (const name of names) {
    const dir = join(l.envsDir, name)
    if (dir === building || dir === inUse || !isInside(l.envsDir, dir)) continue
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function readState(l: RuntimeLayout): Promise<StateFile> {
  try {
    const raw = JSON.parse(await readFile(l.stateFile, 'utf-8')) as Partial<StateFile>
    const cellLimitS = (CELL_LIMIT_CHOICES as readonly number[]).includes(raw.cellLimitS as number)
      ? (raw.cellLimitS as number)
      : DEFAULT_CELL_LIMIT_S
    return { layers: raw.layers && typeof raw.layers === 'object' ? raw.layers : {}, cellLimitS }
  } catch {
    return { layers: {}, cellLimitS: DEFAULT_CELL_LIMIT_S }
  }
}

async function writeState(l: RuntimeLayout, s: StateFile): Promise<void> {
  await mkdir(l.root, { recursive: true })
  const tmp = `${l.stateFile}.tmp`
  await writeFile(tmp, JSON.stringify(s, null, 2), 'utf-8')
  await rename(tmp, l.stateFile)
}

async function currentLockHash(lockFile: string): Promise<string> {
  return lockHash(await readFile(join(resourceDir(), lockFile), 'utf-8'))
}

/** The interpreter of the installed core env, or null if it is not ready. */
export async function readyInterpreter(): Promise<string | null> {
  const l = layout()
  const s = await readState(l)
  const core = s.layers[CORE_LAYER]
  // Any complete env serves, even one built from an older lock: a pack
  // update must never strand a half-finished lab (see updateAvailable).
  if (!core) return null
  if (!(await exists(join(core.envDir, COMPLETE_MARKER)))) return null
  const interp = envInterpreter(core.envDir, process.platform)
  return (await exists(interp)) ? interp : null
}

export async function getCellLimitS(): Promise<number> {
  return (await readState(layout())).cellLimitS
}

export async function setCellLimitS(seconds: number): Promise<number> {
  if (!(CELL_LIMIT_CHOICES as readonly number[]).includes(seconds)) throw new Error('Unsupported cell time limit')
  const l = layout()
  const s = await readState(l)
  s.cellLimitS = seconds
  await writeState(l, s)
  return seconds
}

let installing: Promise<void> | null = null
let lastError: string | null = null
/** Aborts the install in progress: the download, or the uv child running now. */
let cancelInstall: (() => void) | null = null
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const l = layout()
  const s = await readState(l)
  const layers: RuntimeLayerInfo[] = []
  for (const def of LAYERS) {
    const hash = await currentLockHash(def.lockFile).catch(() => '')
    const st = s.layers[def.id]
    const installed = !!st && st.lockHash === hash && (await exists(join(st.envDir, COMPLETE_MARKER)))
    layers.push({ id: def.id, label: def.label, description: def.description, lockHash: hash, installed })
  }
  const core = s.layers[CORE_LAYER]
  const interp = await readyInterpreter()
  const uvPresent = await exists(l.uvBin)
  const supported = runtimeTarget(process.platform, process.arch) !== null
  return {
    supported,
    updateAvailable: !!interp && !!core && core.lockHash !== layers[0]?.lockHash,
    state: installing ? 'installing' : interp ? 'ready' : lastError ? 'failed' : 'missing',
    uvPath: uvPresent ? l.uvBin : null,
    uvVersion: uvPresent ? UV_VERSION : null,
    pythonPath: interp,
    pythonVersion: interp ? (core?.pythonVersion ?? null) : null,
    envDir: interp ? (core?.envDir ?? null) : null,
    layers,
    packages: interp ? (core?.packages ?? {}) : {},
    error: installing ? null : lastError,
  }
}

/** Builds (or repairs) the core env. Concurrent callers share one install. */
export function installRuntime(onProgress: (p: RuntimeProgress) => void): Promise<void> {
  if (!installing) {
    lastError = null
    let cancelled = false
    const abort = new AbortController()
    let killChild: (() => void) | null = null
    cancelInstall = () => {
      cancelled = true
      abort.abort()
      killChild?.()
    }
    installing = doInstall(onProgress, abort.signal, (kill) => {
      killChild = kill
    })
      .catch((err: unknown) => {
        lastError = cancelled ? 'Install cancelled.' : err instanceof Error ? err.message : String(err)
        onProgress({ phase: 'failed', message: lastError, fraction: null })
        throw err
      })
      .finally(() => {
        installing = null
        cancelInstall = null
      })
  }
  return installing
}

/** Stops an install in progress. The partial env is rebuilt on the next try. */
export function cancelRuntimeInstall(): void {
  cancelInstall?.()
}

/** Deletes the whole runtime root. The caller stops every kernel first. */
export async function removeRuntime(): Promise<void> {
  if (installing) throw new Error('The runtime is being installed; wait for it to finish first.')
  const l = layout()
  await rm(l.root, { recursive: true, force: true })
  lastError = null
}

function uvEnv(l: RuntimeLayout): NodeJS.ProcessEnv {
  // Nothing from the learner's own Python setup, and no AI credential, reaches the build.
  const env = scrubbedEnv(process.env)
  for (const k of Object.keys(env)) if (k.startsWith('UV_')) delete env[k]
  return {
    ...env,
    UV_CACHE_DIR: l.cacheDir,
    UV_PYTHON_INSTALL_DIR: l.pythonDir,
    UV_PYTHON_PREFERENCE: 'only-managed',
    UV_NO_CONFIG: '1',
    UV_NO_PROGRESS: '1',
    NO_COLOR: '1',
    MPLCONFIGDIR: join(l.root, 'mplconfig'),
  }
}

/** Runs the pinned uv, forwarding its progress lines. */
type OnChild = (kill: (() => void) | null) => void

function runUv(
  l: RuntimeLayout,
  args: string[],
  phase: RuntimeProgress['phase'],
  onProgress: (p: RuntimeProgress) => void,
  onChild: OnChild,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnCli(l.uvBin, args, { env: uvEnv(l), stdio: ['ignore', 'pipe', 'pipe'] })
    onChild(() => child.kill())
    let tail = ''
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      tail = (tail + text).slice(-4000)
      for (const raw of text.split(/\r?\n/)) {
        const line = progressLine(raw)
        if (line) onProgress({ phase, message: line, fraction: null })
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', reject)
    child.on('close', (code) => {
      onChild(null)
      if (code === 0) resolve()
      else reject(new Error(`uv ${args[0]} failed (exit ${code}). ${tail.trim().split('\n').slice(-3).join(' ')}`))
    })
  })
}

async function findFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return p
    if (entry.isDirectory()) {
      const hit = await findFile(p, name)
      if (hit) return hit
    }
  }
  return null
}

async function ensureUv(l: RuntimeLayout, onProgress: (p: RuntimeProgress) => void, signal: AbortSignal): Promise<void> {
  if (await exists(l.uvBin)) return
  const asset = uvAssetFor(process.platform, process.arch)
  if (!asset) throw new Error(unsupportedMessage())
  onProgress({ phase: 'uv', message: `Downloading uv ${UV_VERSION}`, fraction: 0 })
  const res = await net.fetch(asset.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]) })
  if (!res.ok) throw new Error(`Could not download uv (${res.status} ${res.statusText}).`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== asset.sha256) throw new Error('The uv download did not match its published checksum, so it was discarded.')
  onProgress({ phase: 'uv', message: `Unpacking uv ${UV_VERSION}`, fraction: 1 })
  const staging = `${l.uvDir}.partial`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  const archive = join(staging, asset.file)
  await writeFile(archive, bytes)
  // bsdtar (macOS, Windows 10+) and GNU tar both unpack .tar.gz; bsdtar also unpacks .zip.
  // On Windows, name the system bsdtar: a Git-for-Windows GNU tar earlier on
  // PATH cannot unpack a .zip and reads "C:" as a remote host.
  const tar = isWindows ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  await execCli(tar, ['-xf', archive, '-C', staging], { timeout: 60_000 })
  const binName = isWindows ? 'uv.exe' : 'uv'
  const found = await findFile(staging, binName)
  if (!found) throw new Error('The uv archive did not contain a uv binary.')
  await mkdir(l.uvDir, { recursive: true })
  await rename(found, l.uvBin)
  if (!isWindows) await chmod(l.uvBin, 0o755)
  await rm(staging, { recursive: true, force: true })
}

function unsupportedMessage(): string {
  return process.platform === 'linux' && process.arch === 'arm64'
    ? 'Stim and PyMatching publish no Linux ARM builds, so the code runtime cannot install on this machine yet.'
    : `The code runtime does not support ${process.platform}-${process.arch} yet.`
}

async function doInstall(onProgress: (p: RuntimeProgress) => void, signal: AbortSignal, onChild: OnChild): Promise<void> {
  const target = runtimeTarget(process.platform, process.arch)
  if (!target) throw new Error(unsupportedMessage())
  const l = layout()
  await mkdir(l.root, { recursive: true })
  await ensureUv(l, onProgress, signal)
  const checkCancelled = () => {
    if (signal.aborted) throw new Error('Install cancelled.')
  }

  const def = LAYERS[0]
  const lockPath = join(resourceDir(), def.lockFile)
  const hash = await currentLockHash(def.lockFile)
  const envDir = envDirFor(l, def.id, hash)

  onProgress({ phase: 'python', message: `Getting Python ${PYTHON_VERSION}`, fraction: null })
  checkCancelled()
  await runUv(l, ['python', 'install', target.python], 'python', onProgress, onChild)
  checkCancelled()
  await pruneEnvs(l, envDir)

  if (!(await exists(join(envDir, COMPLETE_MARKER)))) {
    // A half-built env from an interrupted install is rebuilt from scratch.
    await rm(envDir, { recursive: true, force: true })
    onProgress({ phase: 'venv', message: 'Creating the environment', fraction: null })
    await runUv(l, ['venv', '--quiet', '--python', target.python, envDir], 'venv', onProgress, onChild)
  }

  const interp = envInterpreter(envDir, process.platform)
  onProgress({ phase: 'packages', message: 'Installing packages from the lockfile', fraction: null })
  checkCancelled()
  await runUv(l, ['pip', 'sync', '--require-hashes', '--python', interp, lockPath], 'packages', onProgress, onChild)
  checkCancelled()

  // Not "import" before a quoted string here: electron-vite's CommonJS-shim
  // scanner mistakes that for an import statement and splits the bundle.
  onProgress({ phase: 'verify', message: 'Checking the packages load', fraction: null })
  const { stdout } = await execCli(interp, ['-I', join(resourceDir(), 'verify_env.py')], { timeout: 120_000, env: uvEnv(l) })
  const report = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { python?: string; packages?: Record<string, string> }
  await writeFile(join(envDir, COMPLETE_MARKER), new Date().toISOString(), 'utf-8')

  const s = await readState(l)
  s.layers[def.id] = {
    lockHash: hash,
    envDir,
    pythonVersion: report.python ?? PYTHON_VERSION,
    packages: report.packages ?? {},
    installedAt: new Date().toISOString(),
  }
  await writeState(l, s)
  // The env this replaces stays on disk until the next install (pruneEnvs),
  // so a kernel still running on it is not pulled out from under the learner.
  onProgress({ phase: 'done', message: `Ready: Python ${report.python ?? PYTHON_VERSION}`, fraction: 1 })
}
