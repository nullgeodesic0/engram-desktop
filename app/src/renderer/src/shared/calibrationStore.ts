/** Local-only record of confidence picks, paired later against assessor
 * grades for the calibration mirror. Ring buffer in localStorage — the
 * engine knows nothing about this; grades are never affected. */
export interface ConfidencePick {
  topic: string
  node: string
  label: string
  ts: number
  /** Index of the chosen option within the picker's fixed option order
   * (0 = least confident … 3 = most confident). The picker's four band
   * labels are set by the skill's dialogue-grammar, not the app, so the
   * Dashboard classifies "felt sure" by this positional index rather than
   * matching label text — see task-8-brief.md's deviation note. Optional
   * only because older picks (persisted before this field existed) won't
   * have it. */
  index?: number
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
