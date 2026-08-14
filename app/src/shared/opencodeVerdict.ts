/** The learner-facing verdict for an OpenCode + Cursor capability probe —
 * shared the same way `localModelVerdict.ts` is (main process and Settings
 * both need the same words, and two copies would eventually disagree). */

import type { OpencodeProbe } from './types'

export function describeOpencodeProbe(p: OpencodeProbe): { ok: boolean; headline: string; detail: string } {
  if (p.error) return { ok: false, headline: 'The probe failed', detail: p.error }
  if (p.toolUse) {
    const cost = p.costUsd !== null ? ` (cost: $${p.costUsd.toFixed(4)})` : ''
    return { ok: true, headline: 'Ready to drive a sitting', detail: `This model made a real tool call${cost}.` }
  }
  return {
    ok: false,
    headline: 'Cannot drive a sitting',
    detail: 'The model replied but never called the tool — tickets, checkpoints and grading all travel as tool calls.',
  }
}
