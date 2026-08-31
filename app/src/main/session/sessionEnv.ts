/** Environment for every spawned `claude` session child (dual-mode auth,
 * shared doctrine with Observatory's `spawnEnv.ts`).
 *
 *  - `subscription` — the app is "a local tool orchestrating the Claude
 *    Code binary you already installed and pay for": the CLI authenticates
 *    from its own stored login, and any stray
 *    `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` exported in the user's
 *    shell is stripped so it can never silently flip tutoring onto
 *    pay-per-token billing.
 *  - `apiKey` — same binary, billed against the key from the encrypted
 *    store. Selecting the mode without a stored key throws (a session
 *    should fail to START with an actionable message, not run on whatever
 *    billing happened to be ambient).
 *
 * `ENGRAM_ROOT` is the skills' engine-locator bootstrap — see the spawn
 * site's comment in `SessionManager.ts`. */

import { delimiter } from 'node:path'
import type { AuthMode } from '../../shared/types'

const AUTH_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

export function buildSessionEnv(
  base: NodeJS.ProcessEnv,
  engramRoot: string,
  mode: AuthMode = 'subscription',
  apiKey: string | null = null,
  localBaseUrl: string | null = null,
  /** Prepended to PATH. Windows only in practice: the directory holding the
   * `python3` shim, without which every `python3 "$ENGRAM" …` line in the
   * plugin's own skills fails on that platform. See engramCli/pythonShim.ts
   * for why the fix lives in the environment rather than in the plugin. */
  pathPrefixDir: string | null = null,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ENGRAM_ROOT: engramRoot }
  for (const v of AUTH_VARS) delete env[v]
  // BASE_URL is stripped unconditionally too, for the same reason the auth
  // vars are: a shell that exports it (a proxy experiment, another tool's
  // launcher) would otherwise silently redirect tutoring to an endpoint the
  // learner never chose. Only `local` mode below puts one back, from the
  // app's own setting.
  delete env.ANTHROPIC_BASE_URL
  if (mode === 'apiKey') {
    if (apiKey === null || apiKey.trim() === '') {
      throw new Error('API-key mode is selected but no key is stored — add one in Settings → Authentication, or switch back to subscription mode.')
    }
    env.ANTHROPIC_API_KEY = apiKey
  }
  if (mode === 'local') {
    if (localBaseUrl === null || localBaseUrl.trim() === '') {
      throw new Error('Local-model mode is selected but no server address is set — add one in Settings → Authentication, or switch back to subscription mode.')
    }
    env.ANTHROPIC_BASE_URL = localBaseUrl.trim().replace(/\/+$/, '')
    // Claude Code refuses to start unauthenticated even when the endpoint
    // ignores credentials, and a local runtime has no notion of a key. A
    // fixed non-secret placeholder satisfies the CLI without inventing the
    // impression that something here is authenticated — it is not, and the
    // endpoint is on loopback.
    env.ANTHROPIC_AUTH_TOKEN = 'local-no-auth'
  }
  if (pathPrefixDir) {
    // Windows environment-variable names are case-insensitive but the object
    // Node hands back is not always normalised, so find whichever spelling
    // this process actually has rather than blindly writing `PATH` and
    // leaving an existing `Path` to win.
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
    env[key] = env[key] ? `${pathPrefixDir}${delimiter}${env[key]}` : pathPrefixDir
  }
  return env
}
