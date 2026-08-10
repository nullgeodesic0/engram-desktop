/**
 * What a confidence pick IS, and how to read one.
 *
 * Split out of `renderer/src/shared/calibrationStore.ts`, which keeps the
 * localStorage ring buffer. The buffer is storage; the classification rule is
 * not, and the grade derivations need the rule without the browser. Leaving
 * them together meant `topicGrade` — a pure computation the main process now
 * shares to serve the phone — dragged `localStorage` into a Node program.
 *
 * `calibrationStore` re-exports all three names, so every existing import
 * keeps working and there is still exactly one definition.
 */

/** Local-only record of confidence picks, paired later against assessor
 * grades for the calibration mirror. Ring buffer in localStorage — the
 * engine knows nothing about this; grades are never affected. */
export interface ConfidencePick {
  topic: string
  node: string
  label: string
  ts: number
  /** Index of the chosen option within the picker's fixed option order.
   * The dialogue grammar pins that order MOST-CONFIDENT-FIRST — Certain
   * (~90), Pretty sure (~70), Half unsure (~50), Just guessing (~25) — so
   * **0 = most confident and 3 = least**. An earlier version of this
   * comment claimed the opposite, and every consumer that trusted it
   * classified "felt sure" backwards (caught live: the Coach scatter's
   * x-axis read flipped). Interpret ONLY through `feltSure()`/
   * `confidenceRank()` below — never a raw `index >= 2` comparison.
   * Optional only because older picks (persisted before this field
   * existed) won't have it. */
  index?: number
}

/** True when the pick was one of the two confident bands (Certain / Pretty
 * sure — picker positions 0 and 1). THE one classification rule; see the
 * `index` doc comment above for the ordering this encodes. */
export function feltSure(index: number): boolean {
  return index <= 1
}

/** Ascending-confidence rank for plotting (0 = Just guessing … 3 = Certain)
 * — the picker's positional index reversed, so a "low → high" axis can stay
 * a plain left-to-right mapping. */
export function confidenceRank(index: number): number {
  return 3 - index
}
