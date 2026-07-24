import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface ResolvedPlugin {
  version: string
  root: string
  scriptPath: string
}

const PLUGIN_CACHE_ROOT = join(homedir(), '.claude', 'plugins', 'cache', 'engram', 'engram')

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

/** Locate the installed Engram plugin's engram.py by scanning the plugin cache for the highest version. */
export function resolveEngramPlugin(): ResolvedPlugin {
  if (cached) return cached
  if (!existsSync(PLUGIN_CACHE_ROOT)) {
    throw new Error(`Engram plugin not found at ${PLUGIN_CACHE_ROOT} — is the plugin installed?`)
  }
  const versions = readdirSync(PLUGIN_CACHE_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(PLUGIN_CACHE_ROOT, name, 'scripts', 'engram.py')))

  if (versions.length === 0) {
    throw new Error(`No usable Engram plugin version found under ${PLUGIN_CACHE_ROOT}`)
  }

  versions.sort(compareVersions)
  const version = versions[versions.length - 1]
  const root = join(PLUGIN_CACHE_ROOT, version)
  cached = { version, root, scriptPath: join(root, 'scripts', 'engram.py') }
  return cached
}
