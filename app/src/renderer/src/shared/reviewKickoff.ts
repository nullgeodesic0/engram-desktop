/** The one composer for every /engram:review kickoff the app can send.
 *
 * COLLECTOR CONSTRAINT (read before editing any literal here): every kickoff
 * variant below must be a SINGLE template literal, under 400 characters in
 * source with `${…}` collapsed, containing NO backtick — that is the net
 * checkDoctrine's D3.kickoff collector casts (it hashes every such literal
 * containing `/engram:`), and a literal that outgrows it silently escapes
 * the pin. Every variant must also stay clear of the D4 blindness regex
 * (/assessor|rubric|when grading|grade (it|this|the)/i). The test file
 * asserts all of this for every variant — keep it that way.
 *
 * Voice rule (checkDoctrine D3.kickoff): a kickoff may say WHICH skill and
 * WHAT the learner wants, in the learner's own navigational voice — never
 * how to teach or how to judge. The checkpoint kickoff names a protocol the
 * review skill itself defines (via the overlay pinned in D5) and the recall
 * floor the app computed; the skill owns everything pedagogical about both.
 *
 * Priority (one ask per kickoff, highest wins): retest > checkpoint >
 * time-adjusted standard > misconception digest > plain. Checkpoint and
 * time-adjusted sittings deliberately skip the digest — a re-shaped sitting
 * sends one clear navigational request, and misconception re-tests want free
 * recall, which the digest exists to invite. */

export type SittingStyle = 'standard' | 'checkpoint'
export type SittingMins = 5 | 10 | 25

/** Time → item cap, in the skill's own cap vocabulary (SKILL.md §1: quick=5,
 * Standard≈12, "longer catch-up" ≈ 2× the mode cap). Deliberately NOT a
 * minutes-per-item pace — the skill forbids the app quoting invented time
 * math; these are the three cap sizes the skill already names. */
export const TIME_CAPS: Record<SittingMins, number> = { 5: 5, 10: 12, 25: 24 }

export function capForMins(mins: SittingMins): number {
  return TIME_CAPS[mins]
}

export function coveredCount(cap: number, totalDue: number): number {
  return Math.min(cap, totalDue)
}

export interface RetestRequest {
  id: string
  topic: string
  node: string
  description: string
}

export interface ComposeOptions {
  style: SittingStyle
  mins: SittingMins
  totalDue: number
  /** Node ids on the recall floor (checkpoint-reviewed twice consecutively) —
   * interpolated into the checkpoint kickoff so the tutor knows which nodes
   * are recall-only this sitting. The app computes this from receipt sources;
   * the due payload carries no receipt history, so the tutor cannot. */
  recallDueNodes: string[]
  retest: RetestRequest | null
  /** Pre-formatted misconception digest lines (the caller owns the ledger
   * read and its best-effort failure handling). Empty array = no digest. */
  digestLines: string[]
}

export function composeReviewKickoff(opts: ComposeOptions): string {
  const { style, mins, totalDue, recallDueNodes, retest, digestLines } = opts

  if (retest) {
    return `/engram:review

Re-test request — I picked one open misconception from my ledger in the app and want this sitting to cover it:
[${retest.id}] topic "${retest.topic}", node "${retest.node}": ${retest.description}
It is filed open; "misconception resolve --id ${retest.id}" records a demonstrated correction. Please also run the normal review flow for whatever is due.`
  }

  const n = coveredCount(capForMins(mins), totalDue)

  if (style === 'checkpoint') {
    const floor = recallDueNodes.length > 0 ? ` These nodes need the normal style this time: ${recallDueNodes.join(', ')}.` : ''
    return `/engram:review quick

I have about ${mins} minutes. Please work in triage order and cover what fits — roughly ${n} items. For eligible items I would like the checkpoint style described in the review skill (chains of small choices); anything threshold, lapsed, or effectively past quick review should stay normal free recall.${floor}`
  }

  if (mins !== 10) {
    return `/engram:review

I have about ${mins} minutes today. A capped set of about ${n} items fits — please size the sitting with due --cap ${n} and run the normal review flow; whatever does not fit just stays due.`
  }

  if (digestLines.length > 0) {
    return `/engram:review

Open misconceptions currently filed in the engine's ledger for topics in this due queue:
${digestLines.join('\n')}
These are filed open for this queue's nodes; "misconception resolve --id <ID>" records a demonstrated correction. I'd like the chance to show these are fixed where they naturally come up.`
  }

  return '/engram:review'
}
