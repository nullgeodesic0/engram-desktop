import { useEffect, useState } from 'react'
import type { GradeResult } from '../../../../shared/gradeResult'
import type { ReceiptsHistory } from '../../../../shared/types'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { getReceiptsHistoryCached, priorIntervalDays } from '../../shared/nodeIntervalHistory'

const CROSSED_THRESHOLD_DAYS = 21

interface DeltaRow {
  node: string
  before: number
  after: number
}

/** A sitting's schedule movement, one row per node whose prior interval is
 * actually known — the day-gap the LAST schedule asked of it (derived from
 * receipts, via `IntervalLadder`'s own data path — see
 * shared/nodeIntervalHistory.ts) against the fresh interval this grade just
 * set. Never zero-filled and never fabricated: a node graded for the first
 * time, or one whose receipt hasn't reached history yet, simply has no row.
 * Renders nothing when no row survives, except the one case worth naming
 * anyway — every node in the sitting lapsed. */
export function ScheduleDelta({
  results,
  topic,
  asOfDate,
}: {
  results: GradeResult[]
  /** Narrows the receipts lookup to one topic — see IntervalLadder's own
   * `topic` prop for why this is optional (Review's mixed-topic queue). */
  topic?: string
  /** Time-bounds a replayed card's lookup to its own sitting — see
   * IntervalLadder's `asOfDate`. Omitted by live surfaces. */
  asOfDate?: string
}) {
  const [history, setHistory] = useState<ReceiptsHistory | null>(null)

  useEffect(() => {
    let cancelled = false
    getReceiptsHistoryCached()
      .then((h) => {
        if (!cancelled) setHistory(h)
      })
      .catch(() => {
        // Best-effort, same discipline as IntervalLadder — no card rather
        // than a crashed done-phase screen.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!history) return null

  const rows: DeltaRow[] = []
  for (const r of results) {
    if (r.intervalDays === null) continue
    const before = priorIntervalDays(history, r.node, topic, asOfDate)
    if (before === null) continue
    rows.push({ node: r.node, before, after: Math.round(r.intervalDays) })
  }

  if (rows.length === 0) {
    const allLapsed = results.length > 0 && results.every((r) => r.grade === 'lapsed')
    if (!allLapsed) return null
    return (
      <div className="tilt-card panel-raised p-4 max-w-md">
        <div className="fig-caption">Fig. — every node in this sitting lapsed; no schedule moved forward.</div>
      </div>
    )
  }

  const earliestBefore = Math.min(...rows.map((r) => r.before))
  const earliestAfter = Math.min(...rows.map((r) => r.after))
  const crossed = rows.filter((r) => r.before <= CROSSED_THRESHOLD_DAYS && r.after > CROSSED_THRESHOLD_DAYS).length

  return (
    <div className="tilt-card panel-raised p-4 max-w-md flex flex-col gap-1.5">
      <div className="flex flex-col gap-1">
        {/* Index-suffixed for the same reason as StabilityMovement: one node
            can be graded more than once in a single sitting. */}
        {rows.map((r, i) => (
          <div key={`${r.node}-${i}`} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-[var(--color-text-dim)] truncate">{humanizeNodeId(r.node)}</span>
            <span className="label-data shrink-0 text-[var(--color-text-faint)]">
              {r.before}d → <span className="text-[var(--color-ink-warm)]">{r.after}d</span>
            </span>
          </div>
        ))}
      </div>
      <div className="fig-caption">
        Fig. — earliest return{' '}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {earliestBefore}d → {earliestAfter}d
        </span>
        {' · '}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{crossed}</span> node{crossed === 1 ? '' : 's'} past{' '}
        {CROSSED_THRESHOLD_DAYS} days
      </div>
    </div>
  )
}
