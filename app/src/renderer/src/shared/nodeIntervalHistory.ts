import type { ReceiptsHistory } from '../../../shared/types'

// Module-level cache, shared across every mounted ladder/delta card — the
// simpler of the two plumbing options the brief offers (vs. threading a
// `nodeDates` prop down through ReviewSessionView/LearnSessionView/
// SessionHistoryDrawer, none of which otherwise need to know a node's full
// receipt history). A short TTL rather than a one-shot memo: a live sitting
// keeps landing new grades, and each one changes what `receiptsHistory()`
// would return for that node (its own return-history gains a rung). A plain
// TTL gets the same practical freshness — grades within one sitting are
// seconds to tens-of-seconds apart (probe → production → grade), well above
// this window — while still deduping the common case of several consumers
// mounting together in the same tick (a done-phase screen with both a
// stability figure and several ladders shares one IPC round trip).
const CACHE_TTL_MS = 4000
let cachedAt = 0
let cachedPromise: Promise<ReceiptsHistory> | null = null

export function getReceiptsHistoryCached(): Promise<ReceiptsHistory> {
  const now = Date.now()
  if (!cachedPromise || now - cachedAt > CACHE_TTL_MS) {
    cachedPromise = window.engram.receiptsHistory()
    cachedAt = now
  }
  return cachedPromise
}

export interface Rung {
  days: number
  lapsed: boolean
}

// Local-date day-diff — both inputs are already the 'YYYY-MM-DD' local dates
// `receiptsHistory().days[].date` hands back, so a bare local midnight parse
// (no timezone suffix) keeps this consistent with that source rather than
// reintroducing a UTC/local seam.
function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`)
  const db = new Date(`${b}T00:00:00`)
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

// Local-date discipline (getFullYear/Month/Date — never toISOString), same
// pattern this codebase uses everywhere a "today" needs to be a calendar day
// rather than a UTC instant (see ReviewSessionView's daysOverdueLocal).
export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The node's real dated review gaps, oldest → newest — day-diffs between
 * successive REAL dated review events (one per calendar day this node was
 * reviewed; same-day re-reviews collapse, the unit is a day not a receipt),
 * no synthetic final rung. This is the shared data path both IntervalLadder
 * (which appends a synthetic final rung from a just-landed GradeResult) and
 * the schedule-delta card (which wants only the single most-recent real gap)
 * build on, so a node's return history is computed exactly once per shape
 * rather than twice. Optionally narrowed to one topic and time-bounded to
 * `asOfDate` (a receipt dated after the sitting a replayed card belongs to
 * hadn't happened yet as of that card). */
export function datedGapsForNode(
  history: ReceiptsHistory,
  node: string,
  topic: string | undefined,
  asOfDate: string | undefined,
): { dates: string[]; rungs: Rung[] } {
  const byDate = new Map<string, string | null>()
  for (const day of history.days) {
    for (const item of day.items) {
      if (item.node !== node) continue
      if (topic && item.topic !== topic) continue
      byDate.set(day.date, item.grade)
    }
  }
  let dates = [...byDate.keys()].sort()
  if (asOfDate) dates = dates.filter((d) => d <= asOfDate)

  const rungs: Rung[] = []
  for (let i = 1; i < dates.length; i++) {
    rungs.push({ days: daysBetween(dates[i - 1], dates[i]), lapsed: byDate.get(dates[i]) === 'lapsed' })
  }
  return { dates, rungs }
}

/** The single dated gap immediately preceding a just-landed grade — the
 * elapsed days between the previous dated review and the one that produced
 * this sitting's result, i.e. what the prior schedule actually asked of this
 * node (never the newly-set forward interval, which lives on the
 * GradeResult itself as `intervalDays`).
 *
 * Null when unknowable — fewer than two dated events for this node, or the
 * just-landed grade's own receipt hasn't reached `history` yet (the same
 * best-effort tradeoff IntervalLadder's own dedupe already accepts: by the
 * time a done-phase or ceremony screen renders, the engine has usually
 * already persisted the receipt, but `receiptsHistory()` is a fresh disk
 * read with no guarantee). Deliberately returns null rather than the older
 * gap between two earlier reviews in that case — an honestly-missing prior
 * interval beats a technically-real but misleading one. */
export function priorIntervalDays(
  history: ReceiptsHistory,
  node: string,
  topic: string | undefined,
  asOfDate: string | undefined,
): number | null {
  const { dates, rungs } = datedGapsForNode(history, node, topic, asOfDate)
  if (rungs.length === 0) return null
  const referenceDate = asOfDate ?? localToday()
  if (dates[dates.length - 1] !== referenceDate) return null
  return rungs[rungs.length - 1].days
}
