import { PLUGIN_INSTALL_COMMANDS } from '../components/EnvironmentSteps'

/** Human framing for the ugliest failure classes — the Engram plugin not being
 * installed, or the claude binary not launching at all (see EnvironmentGate /
 * EnvironmentSteps, whose guided-setup copy this deliberately mirrors — sharing
 * the same PLUGIN_INSTALL_COMMANDS constant — so a raw session error and the
 * proactive setup screen never disagree). Everything else passes through
 * untouched. */
export function friendlyErrorText(message: string): { headline: string; detail: string | null } {
  const lower = message.toLowerCase()
  if (lower.includes('engram plugin not found') || lower.includes('no usable engram plugin')) {
    return {
      headline: `Engram plugin not found. Install it: \`${PLUGIN_INSTALL_COMMANDS[0]}\` then \`${PLUGIN_INSTALL_COMMANDS[1]}\`, then relaunch.`,
      detail: message,
    }
  }
  if (lower.includes('enoent') || lower.includes('spawn') || lower.includes('command not found') || lower.includes('not found')) {
    return {
      headline: 'Couldn’t run the claude CLI. Install it from claude.ai/code and make sure you’re logged in, then relaunch.',
      detail: message,
    }
  }
  return { headline: message, detail: null }
}
