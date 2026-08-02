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

import type { AuthMode } from '../../shared/types'

const AUTH_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

export function buildSessionEnv(
  base: NodeJS.ProcessEnv,
  engramRoot: string,
  mode: AuthMode = 'subscription',
  apiKey: string | null = null,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ENGRAM_ROOT: engramRoot }
  for (const v of AUTH_VARS) delete env[v]
  if (mode === 'apiKey') {
    if (apiKey === null || apiKey.trim() === '') {
      throw new Error('API-key mode is selected but no key is stored — add one in Settings → Authentication, or switch back to subscription mode.')
    }
    env.ANTHROPIC_API_KEY = apiKey
  }
  return env
}
