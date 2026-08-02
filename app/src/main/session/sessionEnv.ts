/** Environment for every spawned `claude` session child.
 *
 * Billing safety (dual-mode auth groundwork, shared doctrine with
 * Observatory's `spawnEnv.ts`): the app's contract is "a local tool
 * orchestrating the Claude Code binary you already installed and pay for" —
 * the CLI authenticates from its own stored login. A stray
 * `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` exported in the user's shell
 * would silently flip every tutoring session onto pay-per-token API
 * billing, so both are stripped here. When Engram grows its own explicit
 * API-key mode, this is the single seam it plugs into.
 *
 * `ENGRAM_ROOT` is the skills' engine-locator bootstrap — see the spawn
 * site's comment in `SessionManager.ts`. */

const AUTH_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

export function buildSessionEnv(base: NodeJS.ProcessEnv, engramRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ENGRAM_ROOT: engramRoot }
  for (const v of AUTH_VARS) delete env[v]
  return env
}
