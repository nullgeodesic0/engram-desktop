import { useEffect, useMemo, useState } from 'react'
import type { GradeResult } from '../../../shared/gradeResult'
import type { ReceiptsHistory } from '../../../shared/types'
import { datedGapsForNode, getReceiptsHistoryCached, localToday, type Rung } from '../shared/nodeIntervalHistory'

const MIN_H = 5
const MAX_H = 18
// log2(1+180) — 180 is the receipts window itself (readReceiptsHistory's
// DAYS_BACK) — is the largest gap the data could ever produce, so the height
// scale saturates there rather than at an arbitrary round number.
const MAX_LOG = Math.log2(181)
const CAP = 7

function rungHeightPx(days: number): number {
  const raw = Math.log2(1 + Math.max(0, days))
  const t = Math.min(1, raw / MAX_LOG)
  return MIN_H + t * (MAX_H - MIN_H)
}

/** The memory's return history, rung by rung — day-gaps between a node's
 * successive REAL dated review events (oldest → newest, left → right), plus
 * the just-landed `result.intervalDays` as one final rung standing in for
 * the scheduled return. A rung whose event graded `lapsed` renders in danger
 * ink and steps down off the shared baseline — a visible break in the climb.
 * Fewer than two dated historical events means there is no real gap to show
 * yet (a node's first-ever review, say) — renders nothing rather than
 * drawing a "ladder" out of a single point. */
export function IntervalLadder({
  result,
  topic,
  asOfDate,
}: {
  result: GradeResult
  /** Narrows matching receipts to one topic before filtering by node id.
   * Optional: surfaces that don't have a single topic in scope for this card
   * (Review's mixed-topic queue, replayed via SessionHistoryDrawer with
   * `historyKey === 'review'`) can omit it, and the ladder falls back to
   * matching by node id alone — still correct in practice, since node slugs
   * are not reused across topics in this app's data. */
  topic?: string
  /** Local 'YYYY-MM-DD' — time-bounds a replayed card's ladder to the
   * sitting it belongs to, so a historical grade card shows the node's
   * return history AS OF that sitting, not as of right now (every replayed
   * card for a node would otherwise look identical — all the way up to
   * today). Also doubles as the "is the last historical rung actually THIS
   * result's own receipt" reference date for the same-event dedupe below.
   * Omitted by live surfaces (ReviewSessionView) and by the drawer when a
   * batch's own timestamp couldn't be recovered — the ladder then reads as
   * of today, unchanged from before this prop existed. */
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
        // Best-effort, same discipline as every other receiptsHistory
        // consumer (searchIndex.ts) — no ladder rather than a crashed card.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rungs = useMemo<Rung[] | null>(() => {
    if (!history) return null
    const { dates, rungs: gaps } = datedGapsForNode(history, result.node, topic, asOfDate)
    if (dates.length < 2) return null

    const rs: Rung[] = [...gaps]
    if (result.intervalDays !== null) {
      // `receiptsHistory()` re-reads disk on every call, so the just-landed
      // grade's own receipt is usually ALREADY the last dated event above —
      // the historical gap ending on the reference date and this final rung
      // would otherwise be the same event rendered twice (two adjacent
      // danger rungs for a single lapse). Drop that last historical gap in
      // favor of the final rung built straight from `result` itself.
      const referenceDate = asOfDate ?? localToday()
      if (rs.length > 0 && dates[dates.length - 1] === referenceDate) rs.pop()
      rs.push({ days: Math.round(result.intervalDays), lapsed: result.grade === 'lapsed' })
    }
    return rs.length > 0 ? rs : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, result.node, result.intervalDays, result.grade, topic, asOfDate])

  if (!rungs || rungs.length === 0) return null

  const elided = rungs.length > CAP
  const shown = elided ? rungs.slice(rungs.length - CAP) : rungs
  const tooltip = rungs.map((r) => `${r.days}d`).join(' · ')

  return (
    <div
      className="scatter-fade-in flex items-end gap-[3px] pb-1.5"
      title={tooltip}
      aria-label={`return history: ${tooltip}`}
    >
      {elided && (
        <span className="label-data text-[10px] text-[var(--color-text-faint)] self-end pb-0.5 shrink-0">…</span>
      )}
      {shown.map((r, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full shrink-0"
          style={{
            height: `${rungHeightPx(r.days)}px`,
            background: r.lapsed ? 'var(--color-ink-danger)' : 'var(--color-ink-warm)',
            transform: r.lapsed ? 'translateY(6px)' : undefined,
          }}
        />
      ))}
    </div>
  )
}
