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

export function kernelFilePath(): string {
  return join(resourceDir(), 'engram_kernel.py')
}

function layout(): RuntimeLayout {
  return runtimeLayout(join(app.getPath('userData'), 'runtime'), process.platform)
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
  if (!core) return null
  const hash = await currentLockHash(LAYERS[0].lockFile).catch(() => null)
  if (!hash || core.lockHash !== hash) return null
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
  return {
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
    installing = doInstall(onProgress)
      .catch((err: unknown) => {
        lastError = err instanceof Error ? err.message : String(err)
        onProgress({ phase: 'failed', message: lastError, fraction: null })
        throw err
      })
      .finally(() => {
        installing = null
      })
  }
  return installing
}

/** Deletes the whole runtime root. The caller stops every kernel first. */
export async function removeRuntime(): Promise<void> {
  if (installing) throw new Error('The runtime is being installed; wait for it to finish first.')
  const l = layout()
  await rm(l.root, { recursive: true, force: true })
  lastError = null
}

function uvEnv(l: RuntimeLayout): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Nothing from the learner's own Python setup may leak into the build.
  for (const k of Object.keys(env)) {
    if (k.startsWith('UV_') || k === 'PYTHONPATH' || k === 'PYTHONHOME' || k === 'VIRTUAL_ENV' || k === 'CONDA_PREFIX') delete env[k]
  }
  return {
    ...env,
    UV_CACHE_DIR: l.cacheDir,
    UV_PYTHON_INSTALL_DIR: l.pythonDir,
    UV_PYTHON_PREFERENCE: 'only-managed',
    UV_NO_CONFIG: '1',
    UV_NO_PROGRESS: '1',
    NO_COLOR: '1',
  }
}

/** Runs the pinned uv, forwarding its progress lines. */
function runUv(l: RuntimeLayout, args: string[], phase: RuntimeProgress['phase'], onProgress: (p: RuntimeProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnCli(l.uvBin, args, { env: uvEnv(l), stdio: ['ignore', 'pipe', 'pipe'] })
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

async function ensureUv(l: RuntimeLayout, onProgress: (p: RuntimeProgress) => void): Promise<void> {
  if (await exists(l.uvBin)) return
  const asset = uvAssetFor(process.platform, process.arch)
  if (!asset) throw new Error(`The code runtime does not support ${process.platform}-${process.arch} yet.`)
  onProgress({ phase: 'uv', message: `Downloading uv ${UV_VERSION}`, fraction: 0 })
  const res = await net.fetch(asset.url)
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
  await execCli('tar', ['-xf', archive, '-C', staging], { timeout: 60_000 })
  const binName = isWindows ? 'uv.exe' : 'uv'
  const found = await findFile(staging, binName)
  if (!found) throw new Error('The uv archive did not contain a uv binary.')
  await mkdir(l.uvDir, { recursive: true })
  await rename(found, l.uvBin)
  if (!isWindows) await chmod(l.uvBin, 0o755)
  await rm(staging, { recursive: true, force: true })
}

async function doInstall(onProgress: (p: RuntimeProgress) => void): Promise<void> {
  const l = layout()
  await mkdir(l.root, { recursive: true })
  await ensureUv(l, onProgress)

  const def = LAYERS[0]
  const lockPath = join(resourceDir(), def.lockFile)
  const hash = await currentLockHash(def.lockFile)
  const envDir = envDirFor(l, def.id, hash)

  onProgress({ phase: 'python', message: `Getting Python ${PYTHON_VERSION}`, fraction: null })
  await runUv(l, ['python', 'install', PYTHON_VERSION], 'python', onProgress)

  if (!(await exists(join(envDir, COMPLETE_MARKER)))) {
    // A half-built env from an interrupted install is rebuilt from scratch.
    await rm(envDir, { recursive: true, force: true })
    onProgress({ phase: 'venv', message: 'Creating the environment', fraction: null })
    await runUv(l, ['venv', '--quiet', '--python', PYTHON_VERSION, envDir], 'venv', onProgress)
  }

  const interp = envInterpreter(envDir, process.platform)
  onProgress({ phase: 'packages', message: 'Installing packages from the lockfile', fraction: null })
  await runUv(l, ['pip', 'sync', '--require-hashes', '--python', interp, lockPath], 'packages', onProgress)

  // Not "import" before a quoted string here: electron-vite's CommonJS-shim
  // scanner mistakes that for an import statement and splits the bundle.
  onProgress({ phase: 'verify', message: 'Checking the packages load', fraction: null })
  const { stdout } = await execCli(interp, ['-I', join(resourceDir(), 'verify_env.py')], { timeout: 120_000, env: uvEnv(l) })
  const report = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { python?: string; packages?: Record<string, string> }
  await writeFile(join(envDir, COMPLETE_MARKER), new Date().toISOString(), 'utf-8')

  const s = await readState(l)
  const previous = s.layers[def.id]
  s.layers[def.id] = {
    lockHash: hash,
    envDir,
    pythonVersion: report.python ?? PYTHON_VERSION,
    packages: report.packages ?? {},
    installedAt: new Date().toISOString(),
  }
  await writeState(l, s)
  // An env built from an older lock is no longer referenced; drop it.
  // The path comes from state.json, so it is checked to sit under envs/ before anything is removed.
  if (previous && previous.envDir !== envDir && isInside(l.envsDir, previous.envDir)) {
    await rm(previous.envDir, { recursive: true, force: true }).catch(() => {})
  }
  onProgress({ phase: 'done', message: `Ready: Python ${report.python ?? PYTHON_VERSION}`, fraction: 1 })
}
