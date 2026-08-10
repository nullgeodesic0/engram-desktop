import { type ConfidencePick } from '../../../shared/confidence'

export { feltSure, confidenceRank } from '../../../shared/confidence'
export type { ConfidencePick } from '../../../shared/confidence'

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
