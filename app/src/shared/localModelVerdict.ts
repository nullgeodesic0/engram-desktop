/** The learner-facing verdict for a local-model capability probe.
 *
 * SHARED because both sides need the same words: the main process uses it
 * when refusing to start a sitting, and Settings shows it beside the model
 * picker. Two copies would eventually disagree about what "ready" means,
 * and this is the sentence standing between a learner and a sitting that
 * records nothing.
 *
 * Pure — no I/O, no Electron — so it is testable without a live runtime. */

import type { LocalModelProbe } from './types'

export function describeProbe(p: LocalModelProbe): { ok: boolean; headline: string; detail: string } {
  if (p.error !== null && !p.reachable) {
    return { ok: false, headline: 'Cannot reach the server', detail: p.error }
  }
  if (p.error !== null) {
    return { ok: false, headline: 'The server refused the request', detail: p.error }
  }
  if (p.toolUse) {
    return {
      ok: true,
      headline: 'Ready to drive a sitting',
      detail: 'This model emits real tool calls, so tickets, checkpoints and grading will work.',
    }
  }
  if (p.toolUseImitation) {
    return {
      ok: false,
      headline: 'Cannot drive a sitting',
      detail:
        'The model described the tool call as text instead of making one. A sitting would look like it was working while writing nothing to your record — tickets, checkpoints and grading all travel as tool calls.',
    }
  }
  if (p.text) {
    return {
      ok: false,
      headline: 'Cannot drive a sitting',
      detail: 'The model answered in prose but ignored the tool entirely. Tickets, checkpoints and grading all travel as tool calls.',
    }
  }
  return { ok: false, headline: 'No usable reply', detail: 'The server answered but returned no content.' }
}
