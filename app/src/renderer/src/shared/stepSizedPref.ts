/** The "step-sized reviews for derivations" Settings toggle — ON by default.
 *
 * Reviewing a multi-step derivation by re-deriving it whole costs 8 to 14
 * minutes an item on this app's own measured pace (graduate mechanics and
 * quantum topics), which turns a review queue into an evening. The step-sized
 * protocol (D5-pinned overlay, review-skill.step-sized-protocol.md) reviews
 * such an item by its plan plus the one pivotal step, and the full-solve
 * floor brings the whole derivation back every third review.
 *
 * Local app preference, same reasoning as checkpointAllNodesPref.ts: the
 * engine never reads it; it only decides whether the review kickoff names
 * the protocol for the sitting — and that per-sitting naming is what
 * licenses the overlay. */

const KEY = 'engram-step-sized-reviews'

export function loadStepSized(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function saveStepSized(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? 'on' : 'off')
  } catch {
    // best-effort
  }
}
