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
 * everywhere in the app rather than drifting a few hours near midnight. */
function todayMidnight(today: Date): number {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
}
function todayDateString(today: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
}

/**
 * Below this many DISTINCT calendar days carrying at least one `encode`
 * receipt for the topic, no observed-pace figure renders at all — the app
 * says there isn't enough history to project from, rather than printing a
 * number.
 *
 * Why 3, not 1 or 2: a "pace" is a statement about the GAPS between
 * sessions, not the sessions themselves. One active day has zero gaps to
 * measure (it's a single sitting, not a cadence). Two active days have
 * exactly one gap — not enough to tell a developing rhythm from a
 * one-off return visit. Three is the minimum that contains at least two
 * inter-session gaps, the smallest sample from which "gaps" is a
 * meaningful plural rather than a single data point dressed up as a rate.
 *
 * Checked against this machine's real receipts (see the report's hand-check
 * for the numbers): `long-form-humanities` has 1 active day and
 * `applied-policy` has 2 — both correctly render nothing.
 * `grad-classical-mechanics` has 8 active days and renders.
 */
export const MIN_ACTIVE_DAYS_FOR_PACE = 3

export interface ObservedPace {
  /** encodes per calendar day, averaged over `windowDays`. */
  perDay: number
  /** total `encode` receipts for this topic across the whole window. */
  totalEncodes: number
  /** distinct calendar days that carried >=1 encode, within the window. */
  activeDays: number
  /** calendar days in the window, INCLUDING days with zero activity — the
   * denominator `perDay` actually divides by. This is the number the copy
   * must state in words beside the figure. */
  windowDays: number
  /** local YYYY-MM-DD of this topic's first-ever encode receipt. */
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

  const encodeDates = receipts
    .filter((r) => r.topic === graph.topic && r.kind === 'encode')
    .map((r) => r.ts)
    .sort()
  const activeDays = new Set(encodeDates).size

  let observedPace: ObservedPace | null = null
  if (activeDays >= MIN_ACTIVE_DAYS_FOR_PACE) {
    const windowStart = encodeDates[0]
    // Calendar days elapsed from the first encode through today, INCLUSIVE
    // of both ends — the denominator includes every day with zero activity
    // in between, which is the whole point (see the module doc comment and
    // the spec's "Evidence gathered" §1: averaging over ACTIVE days only
    // would report 18/8 ≈ 2.25/day for a topic worked eight days ago and
    // untouched since, which reads as a live cadence it isn't).
    const windowDays = Math.floor((todayMs - localMidnight(windowStart)) / MS_PER_DAY) + 1
    observedPace = {
      perDay: encodeDates.length / windowDays,
      totalEncodes: encodeDates.length,
      activeDays,
      windowDays,
      windowStart,
      windowEnd: todayDateString(today),
    }
  }

  return { nodesRemaining, targetDate, daysRemaining, requiredPace, observedPace }
}
