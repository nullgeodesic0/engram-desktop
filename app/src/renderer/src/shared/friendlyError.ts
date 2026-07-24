/** Human framing for the ugliest failure class — the claude binary not
 * launching at all. Everything else passes through untouched. */
export function friendlyErrorText(message: string): { headline: string; detail: string | null } {
  const lower = message.toLowerCase()
  if (lower.includes('enoent') || lower.includes('spawn') || lower.includes('not found')) {
    return {
      headline: 'Claude CLI could not be launched — check the setup (Settings → environment, or reinstall the claude CLI).',
      detail: message,
    }
  }
  return { headline: message, detail: null }
}
