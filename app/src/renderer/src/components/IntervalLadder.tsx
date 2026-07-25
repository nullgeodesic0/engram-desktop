import { useEffect, useMemo, useState } from 'react'
import type { GradeResult } from '../../../shared/gradeResult'
import type { ReceiptsHistory } from '../../../shared/types'

// Module-level cache, shared across every mounted ladder — the simpler of
// the two plumbing options the brief offers (vs. threading a `nodeDates`
// prop down through ReviewSessionView/LearnSessionView/SessionHistoryDrawer,
// none of which otherwise need to know a node's full receipt history). A
// short TTL rather than a one-shot memo: a live sitting keeps landing new
// grades, and each one changes what `receiptsHistory()` would return for
// that node (its own return-history gains a rung). Re-deriving the palette's
// own invalidation hook (`invalidateSearchIndex`, fired in
// ReviewSessionView/LearnSessionView at grade landings) would mean coupling
// this file to searchIndex.ts's cache lifecycle for a cosmetic sparkline; a
// plain TTL gets the same practical freshness — grades within one sitting
// are seconds to tens-of-seconds apart (probe → production → grade), well
// above this window — while still deduping the common case of several
// ladders mounting together in the same tick (SessionHistoryDrawer replaying
// a sitting with a dozen grade rows shares one IPC round trip instead of one
// per card).
const CACHE_TTL_MS = 4000
let cachedAt = 0
let cachedPromise: Promise<ReceiptsHistory> | null = null

function getReceiptsHistoryCached(): Promise<ReceiptsHistory> {
  const now = Date.now()
  if (!cachedPromise || now - cachedAt > CACHE_TTL_MS) {
    cachedPromise = window.engram.receiptsHistory()
    cachedAt = now
  }
  return cachedPromise
}

interface Rung {
  days: number
  lapsed: boolean
}

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

// Local-date day-diff — both inputs are already the 'YYYY-MM-DD' local dates
// `receiptsHistory().days[].date` hands back, so a bare local midnight
// parse (no timezone suffix) keeps this consistent with that source rather
// than reintroducing a UTC/local seam.
function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`)
  const db = new Date(`${b}T00:00:00`)
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

// Local-date discipline (getFullYear/Month/Date — never toISOString), same
// pattern this codebase uses everywhere a "today" needs to be a calendar day
// rather than a UTC instant (see ReviewSessionView's daysOverdueLocal).
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
    // One dated event per calendar day this node was reviewed (same-day
    // re-reviews collapse — the ladder's unit is a day, not a receipt), each
    // carrying that day's last grade for the lapsed/danger check below.
    const byDate = new Map<string, string | null>()
    for (const day of history.days) {
      for (const item of day.items) {
        if (item.node !== result.node) continue
        if (topic && item.topic !== topic) continue
        byDate.set(day.date, item.grade)
      }
    }
    let dates = [...byDate.keys()].sort()
    // Time-bound a replayed card to its own sitting — a receipt dated after
    // the sitting this card belongs to hadn't happened yet as of that card.
    if (asOfDate) dates = dates.filter((d) => d <= asOfDate)
    if (dates.length < 2) return null

    const rs: Rung[] = []
    for (let i = 1; i < dates.length; i++) {
      rs.push({ days: daysBetween(dates[i - 1], dates[i]), lapsed: byDate.get(dates[i]) === 'lapsed' })
    }
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
