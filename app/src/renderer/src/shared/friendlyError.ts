import { CODEX_PLUGIN_INSTALL_COMMANDS, PLUGIN_INSTALL_COMMANDS } from '../components/EnvironmentSteps'

/** Human framing for the ugliest failure classes — the Engram plugin not being
 * installed, or the claude binary not launching at all (see EnvironmentGate /
 * EnvironmentSteps, whose guided-setup copy this deliberately mirrors — sharing
 * the same PLUGIN_INSTALL_COMMANDS constant — so a raw session error and the
 * proactive setup screen never disagree). Everything else passes through
 * untouched. */
export function friendlyErrorText(message: string): { headline: string; detail: string | null } {
  const lower = message.toLowerCase()
  if (lower.includes('codex')) {
    return {
      headline: lower.includes('not logged in') || lower.includes('api key')
        ? 'Codex subscription sign-in needs attention. Run `codex login`, choose ChatGPT, then try again.'
        : 'Couldn’t run OpenAI Codex. Install the Codex CLI and sign in with ChatGPT, then try again.',
      detail: message,
    }
  }
  if (lower.includes('engram plugin not found') || lower.includes('no usable engram plugin') || lower.includes('engram learning engine not found')) {
    return {
      headline: `Engram’s learning engine was not found. Install it for Claude with \`${PLUGIN_INSTALL_COMMANDS[0]}\` and \`${PLUGIN_INSTALL_COMMANDS[1]}\`, or for Codex with \`${CODEX_PLUGIN_INSTALL_COMMANDS[0]}\` and \`${CODEX_PLUGIN_INSTALL_COMMANDS[1]}\`.`,
      detail: message,
    }
  }
  if (lower.includes('enoent') || lower.includes('spawn') || lower.includes('command not found') || lower.includes('not found')) {
    return {
      headline: 'Couldn’t run the selected provider CLI. Check Settings → Session provider, install that CLI, and sign in to its subscription.',
      detail: message,
    }
  }
  return { headline: message, detail: null }
}
