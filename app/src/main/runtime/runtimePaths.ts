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
export const CORE_LAYER = 'qec-core'

interface UvAsset {
  file: string
  sha256: string
}

/** The release assets for UV_VERSION, with the SHA-256 sums astral-sh publishes beside them. */
const UV_ASSETS: Record<string, UvAsset> = {
  'darwin-arm64': { file: 'uv-aarch64-apple-darwin.tar.gz', sha256: 'ed336d0ba49db8ef89b2b41fffa372ce63bd032f22a56f001c265891aec32829' },
  'darwin-x64': { file: 'uv-x86_64-apple-darwin.tar.gz', sha256: '77f5ca26c0de20e992a3677a174fe1121ee25c36f9b1434a863f75bf077a05eb' },
  'linux-x64': { file: 'uv-x86_64-unknown-linux-gnu.tar.gz', sha256: 'aab924fd522efd06f1c5f3b93a243864fc453132c94b2dc49f1371b528a4b967' },
  'linux-arm64': { file: 'uv-aarch64-unknown-linux-gnu.tar.gz', sha256: '4d4fa08d95b06642e5800df6a22bd71455f23f988269e18da2847971d8c0bf31' },
  'win32-x64': { file: 'uv-x86_64-pc-windows-msvc.zip', sha256: 'acfde570451cfdb8689fa159a138ee805ba4e241c466432750302c86254b0984' },
  'win32-arm64': { file: 'uv-aarch64-pc-windows-msvc.zip', sha256: 'a7427ea0440bb826b6716d1837ff3d173b8e7d496cb09ee8f456b4e023a2fdcd' },
}

export function uvAssetFor(platform: NodeJS.Platform, arch: string): (UvAsset & { url: string }) | null {
  const a = UV_ASSETS[`${platform}-${arch}`]
  if (!a) return null
  return { ...a, url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${a.file}` }
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
