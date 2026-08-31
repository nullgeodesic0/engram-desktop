import { existsSync } from 'node:fs'
import { join, win32 as winPath } from 'node:path'
import { app } from 'electron'
import { resolveCliBinary, clearCliBinaryCache, windowsVariants } from './cliResolver'

/**
 * Resolve an absolute path to the `opencode` CLI — same packaged-app PATH
 * problem as `claudeResolver.ts`, same four-tier search in `cliResolver.ts`.
 * The only OpenCode-specific location is its own installer's `~/.opencode/bin`.
 *
 * NOTE for callers: on Windows this may be a `.cmd` shim — launch it through
 * `spawnCli`/`execCli` from `platform.ts`.
 */
export async function resolveOpencodeBinary(): Promise<string> {
  return resolveCliBinary({
    name: 'opencode',
    posix: (home) => [join(home, '.opencode', 'bin', 'opencode')],
    windows: (home) => windowsVariants(winPath.join(home, '.opencode', 'bin'), 'opencode'),
  })
}

export function clearOpencodeBinaryCache(): void {
  clearCliBinaryCache('opencode')
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
