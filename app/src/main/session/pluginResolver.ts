import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'

export interface ResolvedPlugin {
  version: string
  root: string
  scriptPath: string
}

const CLAUDE_PLUGIN_CACHE_ROOT = join(homedir(), '.claude', 'plugins', 'cache', 'engram', 'engram')
const CODEX_PLUGIN_CACHE_ROOT = join(homedir(), '.codex', 'plugins', 'cache', 'engram', 'engram')

/** Compare two "x.y.z" version strings; higher wins. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

let cached: ResolvedPlugin | null = null

function directRootVersion(root: string): string {
  for (const file of ['package.json', 'plugin.json']) {
    try {
      const parsed = JSON.parse(readFileSync(join(root, file), 'utf-8')) as { version?: unknown }
      if (typeof parsed.version === 'string' && parsed.version) return parsed.version
    } catch {
      // A direct root without package metadata is still a usable engine.
    }
  }
  return '0.0.0'
}

/** Searches both provider caches plus direct roots such as the copy bundled
 * with Engram Desktop. Exported for filesystem-level resolution tests. */
export function resolveEngramPluginFromRoots(roots: string[]): ResolvedPlugin | null {
  const candidates: ResolvedPlugin[] = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    if (existsSync(join(root, 'scripts', 'engram.py'))) {
      candidates.push({ version: directRootVersion(root), root, scriptPath: join(root, 'scripts', 'engram.py') })
      continue
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidateRoot = join(root, entry.name)
      const scriptPath = join(candidateRoot, 'scripts', 'engram.py')
      if (existsSync(scriptPath)) candidates.push({ version: entry.name, root: candidateRoot, scriptPath })
    }
  }
  candidates.sort((a, b) => compareVersions(a.version, b.version))
  return candidates.at(-1) ?? null
}

/** Locate the installed Engram plugin's engram.py by scanning the plugin cache for the highest version. */
export function resolveEngramPlugin(): ResolvedPlugin {
  if (cached) return cached
  const bundledRoot = app.isPackaged
    ? join(process.resourcesPath, 'engram-plugin')
    : join(app.getAppPath(), '..', 'vendor', 'engram')
  cached = resolveEngramPluginFromRoots([CLAUDE_PLUGIN_CACHE_ROOT, CODEX_PLUGIN_CACHE_ROOT, bundledRoot])
  if (!cached) {
    throw new Error('Engram learning engine not found in the Claude cache, Codex cache, or app bundle.')
  }
  return cached
}
