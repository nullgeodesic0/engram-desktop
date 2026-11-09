import { createHash } from 'node:crypto'
import { join } from 'node:path'

/**
 * Where the code runtime lives, and which uv build it uses.
 *
 * Everything sits under one root in app userData (`<userData>/runtime`):
 *
 *     runtime/
 *       uv/<version>/uv[.exe]        the pinned uv binary, checksum-verified
 *       python/                      uv-managed CPython builds
 *       cache/                       uv's wheel cache
 *       envs/<layer>-<lockhash>/     one venv per lockfile; a new lock builds beside the old
 *       state.json                   what is installed, and the cell time limit
 *
 * None of it is learning state, and nothing here is derived from the learning
 * home. Pure functions only: no Electron, no filesystem, so they are tested
 * directly.
 */

export const UV_VERSION = '0.11.32'
export const PYTHON_VERSION = '3.12'
/** The layer every workbench runs on; content packs add their own beside it. */
export const BASE_LAYER = 'base'
/** The app's optional speech layer: on-device transcription for oral exams. */
export const SPEECH_LAYER = 'speech'

interface UvAsset {
  file: string
  sha256: string
}

/** The release assets for UV_VERSION, with the SHA-256 sums astral-sh publishes beside them. */
const UV_ASSETS: Record<string, UvAsset> = {
  'darwin-arm64': {
    file: 'uv-aarch64-apple-darwin.tar.gz',
    sha256: 'ed336d0ba49db8ef89b2b41fffa372ce63bd032f22a56f001c265891aec32829',
  },
  'darwin-x64': {
    file: 'uv-x86_64-apple-darwin.tar.gz',
    sha256: '77f5ca26c0de20e992a3677a174fe1121ee25c36f9b1434a863f75bf077a05eb',
  },
  'linux-x64': {
    file: 'uv-x86_64-unknown-linux-gnu.tar.gz',
    sha256: 'aab924fd522efd06f1c5f3b93a243864fc453132c94b2dc49f1371b528a4b967',
  },
  'win32-x64': {
    file: 'uv-x86_64-pc-windows-msvc.zip',
    sha256: 'acfde570451cfdb8689fa159a138ee805ba4e241c466432750302c86254b0984',
  },
}

/**
 * Which uv build and which Python to use on this machine, or null where the
 * runtime does not install. Scientific packages publish wheels most reliably
 * for macOS (arm64, x64), Linux x64 and Windows x64, so:
 * - Windows on ARM runs the x64 uv and an x64 Python under the system's
 *   emulation, which picks up the win_amd64 wheels every pack can count on.
 * - Linux on ARM is refused up front rather than failing a source build
 *   after a large download.
 */
export function runtimeTarget(platform: NodeJS.Platform, arch: string): { uvKey: string; python: string } | null {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64'))
    return { uvKey: `darwin-${arch}`, python: PYTHON_VERSION }
  if (platform === 'linux' && arch === 'x64') return { uvKey: 'linux-x64', python: PYTHON_VERSION }
  if (platform === 'win32' && arch === 'x64') return { uvKey: 'win32-x64', python: PYTHON_VERSION }
  if (platform === 'win32' && arch === 'arm64')
    return {
      uvKey: 'win32-x64',
      python: `cpython-${PYTHON_VERSION}-windows-x86_64-none`,
    }
  return null
}

export function uvAssetFor(platform: NodeJS.Platform, arch: string): (UvAsset & { url: string }) | null {
  const target = runtimeTarget(platform, arch)
  const a = target ? UV_ASSETS[target.uvKey] : undefined
  if (!a) return null
  return {
    ...a,
    url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${a.file}`,
  }
}

/** Variables a kernel or build never inherits: AI credentials (so learner code
 * cannot call a model behind a mastery gate) and anything that would point
 * Python at a different install. */
const SCRUBBED_PREFIXES = [
  'ANTHROPIC_',
  'OPENAI_',
  'CLAUDE_',
  'CLAUDECODE',
  'CODEX_',
  'OPENCODE_',
  'CURSOR_',
  'GEMINI_',
  'GOOGLE_API',
  'MISTRAL_',
  'COHERE_',
  'GROQ_',
  'OPENROUTER_',
  'HF_TOKEN',
  'HUGGING',
]
const SCRUBBED_EXACT = new Set([
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONSTARTUP',
  'PYTHONUSERBASE',
  'VIRTUAL_ENV',
  'CONDA_PREFIX',
  'CONDA_DEFAULT_ENV',
])

export function scrubbedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) {
    const up = k.toUpperCase()
    if (SCRUBBED_EXACT.has(up)) continue
    if (SCRUBBED_PREFIXES.some((p) => up.startsWith(p))) continue
    if (/_API_KEY$|_AUTH_TOKEN$|^AWS_SECRET|^AWS_SESSION_TOKEN$/.test(up)) continue
    out[k] = v
  }
  return out
}

/** First 12 hex of the lockfile's SHA-256: names the env, so a changed lock never reuses a stale one. */
export function lockHash(lockText: string): string {
  return createHash('sha256').update(lockText.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12)
}

export interface RuntimeLayout {
  root: string
  uvDir: string
  uvBin: string
  pythonDir: string
  cacheDir: string
  envsDir: string
  stateFile: string
}

export function runtimeLayout(root: string, platform: NodeJS.Platform): RuntimeLayout {
  const uvDir = join(root, 'uv', UV_VERSION)
  return {
    root,
    uvDir,
    uvBin: join(uvDir, platform === 'win32' ? 'uv.exe' : 'uv'),
    pythonDir: join(root, 'python'),
    cacheDir: join(root, 'cache'),
    envsDir: join(root, 'envs'),
    stateFile: join(root, 'state.json'),
  }
}

export function envDirFor(layout: RuntimeLayout, layer: string, hash: string): string {
  return join(layout.envsDir, `${layer}-${hash}`)
}

/** The interpreter inside a venv. */
export function envInterpreter(envDir: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? join(envDir, 'Scripts', 'python.exe') : join(envDir, 'bin', 'python')
}

/**
 * One human line from uv's progress output, or null for noise. uv writes
 * plain lines like "Downloading numpy (15.7MiB)" or "Installed 31 packages in
 * 2.1s" to stderr when it is not attached to a terminal.
 */
export function progressLine(raw: string): string | null {
  const line = raw.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim()
  if (!line) return null
  if (/^(Downloading|Downloaded|Installed|Installing|Prepared|Resolved|Audited|Using|Creating|Activate)/.test(line)) {
    return line.length > 120 ? line.slice(0, 117) + '…' : line
  }
  return null
}
