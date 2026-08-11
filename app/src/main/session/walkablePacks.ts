import { readTopicReceiptStamps } from './mobileReceipts'

/**
 * Which of a topic's card packs still have work in them.
 *
 * ## Why this exists
 *
 * `listFor` returns every pack file on disk, and nothing ever removed one.
 * The phone's `startWalk` takes the first of that list, so every walk of a
 * topic served the same node — the learner finished it, settled it, came back
 * for the next one, and was handed the one they had just done. Reported from
 * the device, on Statistical Mechanics, and it was never about settling: the
 * repeat was there from the first walk onward, and settling is simply where a
 * person notices, because that is the moment they expect the node to be done.
 *
 * A pack is a QUESTION about a node in the state it was in when the pack was
 * written. Once the node has moved on, the pack is not merely redundant, it is
 * asking about the past. Two ways it can have moved:
 *
 *   - **The desk graded it.** A receipt dated after the pack was generated
 *     means the node has been encoded or reviewed since. Compared against
 *     `generatedAt` rather than "any receipt at all", because a node reviewed
 *     last week and re-packed today is exactly the case that must still be
 *     walkable — the pack is for work not yet done.
 *   - **The phone already walked it.** Between finishing a walk and the Mac
 *     grading it there is no receipt yet, only an outbox item. Without this
 *     second test, walking two nodes back-to-back on a plane would serve the
 *     same one twice.
 *
 * ## Failing open
 *
 * If the record cannot be read, every pack is offered. The two failure
 * directions are not symmetric: a repeated node costs one wasted walk, and a
 * wrongly-retired node is one the learner can never reach from the phone
 * again. Silence in the history is not evidence that the work was done.
 */
export interface WalkablePackDeps {
  /** Each pack's node and when it was written. */
  entries: (topic: string) => Promise<{ node: string; generatedAt: string }[]>
  /** True when the record holds a receipt for this node dated at or after
   * `since`. Injected so the test does not need a history file. */
  receiptSince: (topic: string, node: string, since: string) => Promise<boolean>
  /** Nodes of this topic with evidence already queued on the phone. */
  banked: (topic: string) => Promise<Set<string>>
}

/**
 * Does this receipt mean the pack has been spent?
 *
 * engram writes some receipts date-only ('2026-08-10') and some as full ISO.
 * A date-only stamp is read as covering its WHOLE day, so a pack generated at
 * 08:03 and walked at 21:00 the same day is retired. An exact string compare
 * put '2026-08-10' before '2026-08-10T08:03:28.635Z' and concluded the node
 * had not been touched since — and since the pack's timestamp never moves, it
 * would have concluded that forever. The repeat this module exists to fix,
 * surviving inside the fix.
 *
 * The drain's `receiptSince` keeps the exact compare deliberately: there,
 * reading a date-only receipt as the START of its day can only fail to settle
 * something, never settle something that has not happened, and that is the
 * safe direction for marking work done. Retirement wants the opposite reading,
 * so it gets its own predicate rather than a flag on the shared one.
 */
export function receiptRetiresPack(receiptTs: string, packGeneratedAt: string): boolean {
  const dateOnly = !receiptTs.includes('T')
  return dateOnly ? receiptTs >= packGeneratedAt.slice(0, 10) : receiptTs >= packGeneratedAt
}

export async function walkablePacks(topic: string, deps: WalkablePackDeps): Promise<string[]> {
  const entries = await deps.entries(topic).catch(() => [])
  if (entries.length === 0) return []

  const banked = await deps.banked(topic).catch(() => new Set<string>())

  const kept: string[] = []
  for (const entry of entries) {
    if (banked.has(entry.node)) continue
    // Per pack rather than per topic: a pack's own timestamp is the only
    // thing its spentness can be measured against.
    const graded = await deps.receiptSince(topic, entry.node, entry.generatedAt).catch(() => false)
    if (!graded) kept.push(entry.node)
  }
  return kept
}

/** The real reader, for the composition root. Kept beside the pure predicate
 * so the wiring cannot pick a different definition of "graded" than the tests
 * pinned — which is exactly what happened when it borrowed the drain's. */
export async function receiptSinceProvider(
  topic: string,
  node: string,
  since: string,
): Promise<boolean> {
  const stamps = await readTopicReceiptStamps(topic, node)
  return stamps.some((ts) => receiptRetiresPack(ts, since))
}

/**
 * Narrows a topic's walkable packs to what the requested mode may open.
 *
 * A pack existing is enough to LEARN a node. It is not enough to REVIEW one:
 * a review is a retrieval the engine has scheduled, so walking a node that is
 * not due would write a review receipt for work nobody was owed, and would
 * quietly reschedule a node the engine had placed weeks out.
 *
 * Review with nothing due returns EMPTY rather than falling back to the learn
 * list. A phone that offered "review" and handed over an unscheduled node
 * would be inventing the queue it claims to be working through.
 */
export function packsForMode(
  walkable: string[],
  dueNodes: Set<string>,
  mode: 'learn' | 'review',
): string[] {
  return mode === 'review' ? walkable.filter((n) => dueNodes.has(n)) : walkable
}
