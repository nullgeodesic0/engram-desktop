import type { RawReceipt, TopicGraph } from '../../../shared/types'
import { plateStats } from '../components/graph2d/plate'

const MS_PER_DAY = 86400000

/** Local YYYY-MM-DD → local midnight epoch ms — parsed without a `Z` suffix,
 * same local-date discipline as GraphView's dueStatusFor and every other
 * due/date comparison in this app (never toISOString). */
function localMidnight(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getTime()
}

/** A `Date` (any time of day) → its own local midnight epoch ms, and →
 * YYYY-MM-DD — mirrors GraphView's dueStatusFor (`dayStart`) and
 * TopicMapView's localDateString exactly, so "today" means the same instant
 * everywhere in the app rather than drifting a few hours near midnight. Named
 * for its original caller (today); used below on window boundaries too, but
 * the extraction is the same regardless of which day it's handed. */
function todayMidnight(today: Date): number {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
}
function todayDateString(today: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
}

/** Local midnight epoch ms of the day `n` calendar days before `today` —
 * built from Date's year/month/day constructor (never ms subtraction), so a
 * DST transition inside the span doesn't shift the result by an hour. Same
 * idiom as topicMetrics.ts's `localDateNDaysAgo`. */
function daysAgoMidnight(n: number, today: Date): number {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - n).getTime()
}

/**
 * Below this many DISTINCT calendar days carrying at least one `encode`
 * receipt for the topic WITHIN the observed-pace window (see
 * `PACE_WINDOW_DAYS`), no observed-pace figure renders at all — the app says
 * there isn't enough RECENT history to project from, rather than printing a
 * number. A topic worked hard a year ago and dormant since renders nothing
 * here, same as a topic never touched — both are true statements about
 * whether the recent past predicts what's coming.
 *
 * Why 3, not 1 or 2: a "pace" is a statement about the GAPS between
 * sessions, not the sessions themselves. One active day has zero gaps to
 * measure (it's a single sitting, not a cadence). Two active days have
 * exactly one gap — not enough to tell a developing rhythm from a
 * one-off return visit. Three is the minimum that contains at least two
 * inter-session gaps, the smallest sample from which "gaps" is a
 * meaningful plural rather than a single data point dressed up as a rate.
 *
 * Checked against this machine's real receipts as of 2026-07-27 (see the P4
 * Task 1 fix-wave report for the full table): `lenin-what-is-to-be-done` has
 * 1 active day (all 5 of its encodes landed on a single day) and
 * `us-academic-labor-rights` has 2 — both correctly render nothing, and stay
 * gated at every later date simulated (their whole lifetime activity never
 * reaches 3 distinct days, so no future "today" can un-gate them either).
 * `grad-classical-mechanics` has 8 active days and renders;
 * `grad-quantum-mechanics` sits exactly on the boundary with 3.
 */
export const MIN_ACTIVE_DAYS_FOR_PACE = 3

/**
 * Observed pace is a TRAILING window ending today, not a lifetime-to-date
 * one anchored at the topic's first-ever encode — see the module doc comment
 * above `computePressure` for why. 30 days: long enough that a single lull
 * week doesn't gate a topic off, short enough that dead time from months ago
 * has fully rolled out of the average.
 */
export const PACE_WINDOW_DAYS = 30

export interface ObservedPace {
  /** distinct nodes advanced per calendar day, averaged over `windowDays`. */
  perDay: number
  /** distinct nodes whose first-ever receipt (whatever kind it carries —
   * `encode`, `pretest`, or a capstone's first `transfer`; see the F3 note
   * on `computePressure` below) landed within the window — NOT a raw receipt
   * count, and NOT `kind === 'encode'` alone. This is what makes it
   * comparable to `nodesRemaining` (also a node count, not a receipt count)
   * in the "Pace needed" figure beside it. */
  nodesAdvanced: number
  /** distinct calendar days that carried >=1 node advancing, within the
   * window. */
  activeDays: number
  /** calendar days in the window, INCLUDING days with zero activity — the
   * denominator `perDay` actually divides by. This is the number the copy
   * must state in words beside the figure. */
  windowDays: number
  /** local YYYY-MM-DD of the window's start: `today` minus
   * `PACE_WINDOW_DAYS - 1` (so start..end inclusive spans exactly
   * `PACE_WINDOW_DAYS` days), clipped forward to this topic's first-ever
   * encode when the topic is younger than the window — never implies
   * activity before the topic existed. */
  windowStart: string
  /** local YYYY-MM-DD of "today" — the window's other end. */
  windowEnd: string
}

export interface PressureFigures {
  /** Nodes with `state === 'new'` (capstone excluded, matching plateStats'
   * own territory framing) — what "unencoded" means here. */
  nodesRemaining: number
  /** The target date this figure was computed against, echoed back. */
  targetDate: string
  /** Local calendar days from today to targetDate. 0 the day of, negative
   * once the date has passed. Never itself used to imply lateness in copy —
   * a caller states it as a fact ("target date passed N days ago"). */
  daysRemaining: number
  /** nodesRemaining / daysRemaining, only when there's a nonzero-remaining
   * gap AND future runway to spread it over; null otherwise (nothing left
   * to encode, or the date is today/already passed). Arithmetic on what
   * remains — never a target the learner is failing. */
  requiredPace: number | null
  /** null below MIN_ACTIVE_DAYS_FOR_PACE — "not enough history," not a 0. */
  observedPace: ObservedPace | null
}

/**
 * The exam-mode arithmetic. Reads the graph and the receipts the app already
 * fetched (`window.engram.topicGraph`/`receiptsHistory`) — no new IPC, no
 * new read of `~/.claude/learning` beyond what those two calls already do,
 * and nothing here writes anywhere. `today` is injectable for tests; real
 * callers pass nothing and get `new Date()`.
 *
 * F1 (observed pace is a TRAILING window, not a lifetime one): a deadline
 * poses exactly one question — "at the rate I'm actually going, will I get
 * there?" — and a lifetime-to-date average answers a different one. Anchored
 * at the topic's first-ever encode, the SAME fixed history reads as a
 * shrinking rate purely because the calendar advances (a real reviewer demo
 * on this machine's own receipts: `grad-classical-mechanics`'s fixed 19
 * encodes read 1.19/day on 2026-07-27, would read 0.54/day by 2026-08-15, and
 * 0.10/day by 2027-01, with nothing the learner did changing in between), and
 * it judges a learner who genuinely resumed after a long gap against ancient
 * dead time forever. `PACE_WINDOW_DAYS` fixes that: the window always ends
 * TODAY and always spans the same `PACE_WINDOW_DAYS`, so old dead time rolls
 * out of the average instead of diluting it more and more with every passing
 * day. `MIN_ACTIVE_DAYS_FOR_PACE` is applied WITHIN this window (not against
 * the topic's lifetime), so a topic dormant for a month renders no pace at
 * all — true, and more useful than a decaying number.
 *
 * This does not reopen the failure the lifetime window was chosen to prevent
 * (spec's evidence: `lenin-what-is-to-be-done` did 5 encodes on a SINGLE day,
 * and a window ending at LAST ACTIVITY rather than today would flatter that
 * to "5/day"). This window always ends today, never at last activity, and
 * the gate counts DISTINCT active days, not raw encodes — lenin's whole
 * lifetime activity is 1 active day, so it stays gated at every "today"
 * simulated from the day of the burst through months later (see the P4 Task
 * 1 fix-wave report for the swept dates).
 *
 * Node vs. receipt count (P4/P5 closing fix wave, finding F3): the numerator
 * used to be raw `kind === 'encode'` RECEIPTS, while `nodesRemaining` right
 * beside it (and `requiredPace`'s own denominator) counts NODES — two
 * different units rendered side by side as if comparable. Two ways that
 * diverges on this machine's own receipts: a node re-encoded (a lapse,
 * re-taught) contributes a second `encode` receipt for the SAME node
 * (`grad-classical-mechanics`: 19 `encode` receipts, only 18 distinct
 * encode-kind nodes); and a node can leave `new` via a `pretest` receipt
 * instead of an `encode` one (same topic: 2 nodes), which the old
 * `kind === 'encode'` filter never saw at all — so only 18 of the 20 nodes
 * that actually left `new` were counted. The fix: `nodesAdvanced` groups
 * ALL of a topic's receipts by node (mirroring shared/topicMetrics.ts's
 * `groupByNode` — "a node's FIRST receipt is its encoding event, whatever
 * kind it happens to carry") and counts each node once, on the calendar day
 * of its OWN first-ever receipt — the day it left `new`, full stop, whatever
 * kind fired that transition.
 */
export function computePressure(
  graph: TopicGraph,
  receipts: readonly RawReceipt[],
  targetDate: string,
  today: Date = new Date(),
): PressureFigures {
  const stats = plateStats(graph, null)
  const nodesRemaining = stats.total - stats.encoded

  const todayMs = todayMidnight(today)
  const daysRemaining = Math.round((localMidnight(targetDate) - todayMs) / MS_PER_DAY)
  const requiredPace = nodesRemaining > 0 && daysRemaining > 0 ? nodesRemaining / daysRemaining : null

  // Each node's OWN first-ever receipt (any kind) is the day it left `new` —
  // see the F3 doc note above. Sorting first means the loop below keeps only
  // the earliest `ts` per node without a second pass.
  const topicReceipts = [...receipts].filter((r) => r.topic === graph.topic).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  const firstReceiptDateByNode = new Map<string, string>()
  for (const r of topicReceipts) {
    if (!firstReceiptDateByNode.has(r.node)) firstReceiptDateByNode.set(r.node, r.ts)
  }
  const allAdvanceDates = [...firstReceiptDateByNode.values()].sort()

  let observedPace: ObservedPace | null = null
  if (allAdvanceDates.length > 0) {
    // Trailing PACE_WINDOW_DAYS window ending today — clipped forward to the
    // topic's real first-ever advance when the topic is younger than the
    // window, so the denominator never counts days before the topic existed.
    const windowStartMs = Math.max(daysAgoMidnight(PACE_WINDOW_DAYS - 1, today), localMidnight(allAdvanceDates[0]))
    const inWindow = allAdvanceDates.filter((d) => localMidnight(d) >= windowStartMs)
    const activeDays = new Set(inWindow).size

    if (activeDays >= MIN_ACTIVE_DAYS_FOR_PACE) {
      // F2: Math.round, not Math.floor — mirrors daysRemaining above, which
      // deliberately rounds to absorb the ±1hr local-midnight drift a DST
      // transition inside the window causes (reproduced: a window spanning
      // 2026-03-01–03-15, crossing the US spring-forward on 03-08, floors to
      // 14 where the correct inclusive count is 15).
      const windowDays = Math.round((todayMs - windowStartMs) / MS_PER_DAY) + 1
      observedPace = {
        perDay: inWindow.length / windowDays,
        nodesAdvanced: inWindow.length,
        activeDays,
        windowDays,
        windowStart: todayDateString(new Date(windowStartMs)),
        windowEnd: todayDateString(today),
      }
    }
  }

  return { nodesRemaining, targetDate, daysRemaining, requiredPace, observedPace }
}
