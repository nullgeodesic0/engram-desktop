import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'

const execAsync = promisify(exec)

const COMMON_LOCATIONS = [
  join(homedir(), '.opencode', 'bin', 'opencode'),
  '/opt/homebrew/bin/opencode',
  '/usr/local/bin/opencode',
]

let cached: string | null = null

/**
 * Resolve an absolute path to the `opencode` CLI. Same Finder/Dock PATH
 * problem as `claudeResolver.ts` — packaged launches don't inherit a login
 * shell's PATH, so we check common installs then ask the login shell once.
 */
export async function resolveOpencodeBinary(): Promise<string> {
  if (cached) return cached

  for (const loc of COMMON_LOCATIONS) {
    if (existsSync(loc)) {
      cached = loc
      return cached
    }
  }

  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const { stdout } = await execAsync(`${shell} -lic 'command -v opencode'`, { timeout: 10_000 })
    const resolved = stdout.trim().split('\n').pop()?.trim()
    if (resolved && existsSync(resolved)) {
      cached = resolved
      return cached
    }
  } catch {
    // Fall through to bare-name fallback.
  }

  cached = 'opencode'
  return cached
}

export function clearOpencodeBinaryCache(): void {
  cached = null
}

/**
 * Absolute path to the `opencode-engram-learning` plugin — vendored (not a
 * dependency of the app's own `package.json`) because its dependency tree
 * pulls in `effect`, `@opencode-ai/plugin`, and a private `zod@4` that would
 * collide with the app's own `zod@3` (used by `mcpBridgeWorker.mjs`) if
 * hoisted into the same `node_modules`. `app/vendor/opencode-plugin/` is an
 * isolated install root for exactly this one package and its own tree —
 * `npm install` there, never in `app/` itself.
 *
 * In dev, that vendor install IS the resolved path. In a packaged app,
 * `extraResources` copies `vendor/opencode-plugin/node_modules` to
 * `Resources/opencode-plugin` (see package.json's `build.extraResources`
 * and the `bundle:opencode-plugin` script) — same dev/packaged split as
 * `resolveBridgeWorkerPath()` in permissionConfig.ts.
 *
 * Treated as sacred, like `resolveEngramPlugin()` treats the Claude-side
 * plugin: verified present, never auto-installed. A learning-engine plugin
 * silently fetched or upgraded out from under the app is exactly the kind
 * of drift PRODUCT.md's plugin-overlay doctrine exists to prevent on the
 * Claude side; the same caution applies here even though the mechanism
 * (an isolated vendor tree instead of a Claude plugin-cache scan) differs.
 */
export function resolveOpencodePluginPath(): string {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'opencode-plugin')
    : join(app.getAppPath(), 'vendor', 'opencode-plugin', 'node_modules')
  const pluginDir = join(root, 'opencode-engram-learning')
  if (!existsSync(pluginDir)) {
    throw new Error(
      `opencode-engram-learning plugin not found at ${pluginDir} — run "npm install" inside app/vendor/opencode-plugin (or, in a packaged build, reinstall the app).`,
    )
  }
  return pluginDir
}
