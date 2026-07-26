/** Shared due-date bucket walk — the single place that reads every topic
 * graph's own `fsrs.due` and buckets it by local-calendar days-until-due.
 * Originally lived as a private closure inside HomeView's 7-day forecast
 * `useEffect`; Review's 14-day horizon needed the identical walk (same
 * non-new filter, same local-date discipline — getFullYear/Month/Date, never
 * toISOString), so it moved here rather than being re-implemented, and both
 * callers now share one behavior instead of two that can silently diverge.
 *
 * Semantics (byte-identical to HomeView's original walk): overdue nodes
 * (diffDays < 0) fold into bucket 0 — "due" and "overdue" both read as
 * "today's pull" — via `Math.max(0, diffDays)`. Nodes due beyond the
 * horizon are dropped, not clamped into the last bucket.
 */
export interface DueBucketsResult {
  buckets: number[]
  /** Only populated when `holdingStabilityDays` is passed — see below. */
  holdingCount: number
}

/**
 * @param days Horizon length — bucket 0 is today, bucket `days - 1` is the
 *   furthest-out day counted. HomeView passes 7, Review's horizon passes 14.
 * @param holdingStabilityDays When given, the same pass also counts nodes at
 *   `fsrs.s >= holdingStabilityDays` (any state, any due date) — folded into
 *   this walk rather than a second one over the same graphs, since Review is
 *   the only caller that needs it. Omit to skip that count entirely (`0` is
 *   returned).
 */
export async function computeDueBuckets(days: number, holdingStabilityDays?: number): Promise<DueBucketsResult> {
  const topics = await window.engram.topics()
  const buckets = new Array(days).fill(0) as number[]
  let holdingCount = 0
  const today = new Date()
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  await Promise.all(
    topics.map(async (t) => {
      try {
        const g = (await window.engram.topicGraph(t.topic)) as {
          nodes?: Record<string, { state?: string; fsrs?: { due?: string | null; s?: number | null } }>
        }
        if (!g?.nodes) return
        for (const node of Object.values(g.nodes)) {
          if (holdingStabilityDays != null) {
            const s = node?.fsrs?.s
            if (typeof s === 'number' && s >= holdingStabilityDays) holdingCount += 1
          }
          const due = node?.fsrs?.due
          if (typeof due !== 'string' || node?.state === 'new') continue
          const d = new Date(`${due}T00:00:00`)
          const diffDays = Math.floor((d.getTime() - dayStart.getTime()) / 86400000)
          const idx = Math.min(days - 1, Math.max(0, diffDays))
          if (diffDays <= days - 1) buckets[idx] += 1
        }
      } catch {
        // A topic with an unreadable graph just doesn't contribute.
      }
    }),
  )
  return { buckets, holdingCount }
}
