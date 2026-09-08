import type { EnvironmentCheckResult } from './types'

export function environmentIsReady(result: EnvironmentCheckResult): boolean {
  if (!result.pluginOk) return false
  return result.authMode === 'codexSubscription' ? result.codexOk === true : result.claudeOk
}
