import { delimiter } from 'node:path'
import { FOREIGN_PLUGIN_ROOT_VARS } from './sessionEnv'

const CODEX_API_VARS = ['OPENAI_API_KEY', 'OPENAI_API_TOKEN', 'CODEX_API_KEY'] as const

export function buildCodexSubscriptionEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const name of CODEX_API_VARS) delete env[name]
  return env
}

/** A Codex subscription sitting uses the CLI's stored ChatGPT login. Ambient
 * API credentials are removed so selecting this provider cannot silently
 * spend API credits, while both plugin-root names point at the same Engram
 * engine and learning data used by Claude sessions. */
export function buildCodexSessionEnv(
  base: NodeJS.ProcessEnv,
  engramRoot: string,
  pathPrefixDir: string | null = null,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...buildCodexSubscriptionEnv(base),
    ENGRAM_ROOT: engramRoot,
    CODEX_PLUGIN_ROOT: engramRoot,
  }
  // The engine locator checks these ahead of CODEX_PLUGIN_ROOT, so a stray
  // shell export would override the root set just above.
  for (const name of FOREIGN_PLUGIN_ROOT_VARS) delete env[name]
  if (pathPrefixDir) {
    const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH'
    env[key] = env[key] ? `${pathPrefixDir}${delimiter}${env[key]}` : pathPrefixDir
  }
  return env
}
