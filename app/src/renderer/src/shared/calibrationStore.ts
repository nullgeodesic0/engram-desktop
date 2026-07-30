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

const KEY = 'engram-confidence-picks'
const MAX = 200

function load(): ConfidencePick[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as ConfidencePick[]) : []
  } catch {
    return []
  }
}

export function recordConfidence(topic: string, node: string, label: string, index?: number): void {
  const picks = load()
  picks.push({ topic, node, label, ts: Date.now(), index })
  try {
    localStorage.setItem(KEY, JSON.stringify(picks.slice(-MAX)))
  } catch {
    // Full/blocked storage just means no mirror — never let it break the loop.
  }
}

/** Most recent pick for a node within the last 6 hours — the same sitting. */
export function latestPickFor(node: string): ConfidencePick | null {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000
  const picks = load()
  for (let i = picks.length - 1; i >= 0; i--) {
    if (picks[i].node === node && picks[i].ts >= cutoff) return picks[i]
  }
  return null
}

export function allPicks(): ConfidencePick[] {
  return load()
}
