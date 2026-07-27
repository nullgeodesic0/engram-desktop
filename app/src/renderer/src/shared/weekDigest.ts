import type { DayActivity, WeekRetention, ReceiptItem, TopicGraph } from '../../../shared/types'
import type { ConfidencePick } from './calibrationStore'
import { humanizeNodeId } from '../../../shared/humanizeId'

/** Monday of the ISO week containing this date — mirrors
 * main/engramCli/receiptsHistory.ts's mondayOf() exactly (and
 * RetentionTrend's client-side copy), so "this week" here lines up with the
 * same week receiptsHistory already bucketed items into. Receipt dates are
 * the engine's LOCAL calendar date written verbatim (engram.py's
 * date.today()), so this arithmetic is calendar-only — no timezone
 * conversion happens here or in the source. Exported so shared/topicMetrics.ts's
 * topic-scoped week regrouping uses this SAME definition of "which week is
 * this day in" rather than growing a third copy. */
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const day = d.getUTCDay() // 0 = Sunday
  const diff = (day + 6) % 7 // days since Monday
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

export interface WeekDigestInput {
  /** receiptsHistory().days — every day of the last ~180 days, 0-count days included. */
  days: DayActivity[]
  /** receiptsHistory().weeks — last ~26 Monday-start weeks. */
  weeks: WeekRetention[]
  /** allPicks() from calibrationStore — local confidence picks to join against grades. */
  picks: ConfidencePick[]
  /** Topic graphs for topics with activity this week, keyed by topic id — used only to
   * look up each touched node's `threshold` flag and label the ones that crossed. Topics
   * with no graph available (not fetched, or fetch failed) simply contribute no threshold
   * names — never an error. */
  graphs: Record<string, TopicGraph>
  /** Reference "now" — defaults to `new Date()`. Exposed for deterministic testing. */
  now?: Date
}

/** Overconfident share for one week's joined picks — raw counts kept (not
 * just a rate) so the caption can read "hot on 3 of 9" rather than a bare
 * percentage. */
export interface WeekCalibration {
  overconfident: number
  total: number
}

export interface WeekDigestOutput {
  reviews: { thisWeek: number; lastWeek: number }
  recallRate: { thisWeek: number; lastWeek: number } | null
  consolidated: { count: number; thresholds: string[] }
  calibrationDrift: { thisWeek: WeekCalibration; lastWeek: WeekCalibration } | null
  hardestNodes: { node: string; grades: number }[]
  /** Atlas-voice fig caption, two-three sentences, ready to render verbatim. */
  caption: string
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

/** "Fig. N —" caption date style — matches TopicMapView's formatProvenanceDate
 * exactly (local, no UTC shift for a date-only string). */
function formatCaptionDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Earliest `fsrs.due` across every node in every fetched graph — the next
 * date anything returns, regardless of topic. `input.graphs` is already in
 * hand for the threshold lookup, so this costs no extra IPC. Dates are
 * `YYYY-MM-DD` strings, which sort correctly as plain strings. */
function earliestDue(graphs: Record<string, TopicGraph>): string | null {
  let earliest: string | null = null
  for (const graph of Object.values(graphs)) {
    for (const node of Object.values(graph.nodes)) {
      const due = node.fsrs.due
      if (due && (earliest === null || due < earliest)) earliest = due
    }
  }
  return earliest
}

/**
 * Pure derivation — no DOM, no window.engram calls — so the weekly digest's
 * numbers can be hand-checked and unit tested against a fixture straight
 * from receiptsHistory/calibrationStore output.
 */
export function computeWeekDigest(input: WeekDigestInput): WeekDigestOutput {
  const now = input.now ?? new Date()
  const thisWeekStart = mondayOf(isoDate(now))
  const lastWeekDate = new Date(`${thisWeekStart}T00:00:00Z`)
  lastWeekDate.setUTCDate(lastWeekDate.getUTCDate() - 7)
  const lastWeekStart = isoDate(lastWeekDate)

  const thisWeekBucket = input.weeks.find((w) => w.weekStart === thisWeekStart) ?? null
  const lastWeekBucket = input.weeks.find((w) => w.weekStart === lastWeekStart) ?? null

  const reviews = { thisWeek: thisWeekBucket?.total ?? 0, lastWeek: lastWeekBucket?.total ?? 0 }
  const recallRate =
    thisWeekBucket?.rate != null && lastWeekBucket?.rate != null
      ? { thisWeek: thisWeekBucket.rate, lastWeek: lastWeekBucket.rate }
      : null

  // Items belonging to this week, gathered from `days` (receiptsHistory's day
  // buckets are keyed by the same local calendar date the week grouping uses).
  const thisWeekItems: ReceiptItem[] = []
  for (const day of input.days) {
    if (mondayOf(day.date) === thisWeekStart) thisWeekItems.push(...day.items)
  }

  // "Consolidated this week": receipts carry a grade but not a before/after
  // FSRS state, so there is no exact signal for "this receipt moved the node
  // out of learning". As an honest approximation, we count a node as
  // consolidated when its most recent receipt this week graded 'recalled'
  // and the node is currently sitting in 'review' state in its topic graph
  // (i.e. it has already graduated out of 'learning' by now) — this slightly
  // over-counts nodes that were already in review before this week's
  // receipt, but under normal use a 'recalled' receipt on a learning node is
  // exactly the event that promotes it, so the overlap is small.
  const seenNodes = new Set<string>()
  let consolidatedCount = 0
  const thresholdNames = new Set<string>()
  for (const item of thisWeekItems) {
    const key = `${item.topic}::${item.node}`
    if (seenNodes.has(key)) continue
    const graph = input.graphs[item.topic]
    const node = graph?.nodes[item.node]
    if (!node) continue
    if (item.grade === 'recalled' && node.state === 'review') {
      seenNodes.add(key)
      consolidatedCount++
      if (node.threshold) thresholdNames.add(humanizeNodeId(item.node))
    }
  }

  // Hardest nodes: most again/hard grades this week. Receipts only carry the
  // assessor's coarse grade (recalled/partial/lapsed), not the FSRS
  // again/hard/good/easy rating — 'lapsed' and 'partial' are the closest
  // honest stand-ins for "again" and "hard".
  const missGrades = new Map<string, number>()
  for (const item of thisWeekItems) {
    if (item.grade !== 'lapsed' && item.grade !== 'partial') continue
    const key = `${item.topic}::${item.node}`
    missGrades.set(key, (missGrades.get(key) ?? 0) + 1)
  }
  const hardestNodes = Array.from(missGrades.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, grades]) => ({ node: humanizeNodeId(key.split('::')[1]), grades }))

  // Calibration drift: overconfident share this week vs. last week, joined
  // the same way DashboardView's Calibration section joins picks to grades
  // (topic+node+day, local calendar date from the pick's own timestamp).
  const itemsByDay = new Map(input.days.map((d) => [d.date, d.items]))
  function weekCalibration(weekStart: string): WeekCalibration {
    let overconfident = 0
    let total = 0
    for (const pick of input.picks) {
      if (pick.index === undefined) continue
      const d = new Date(pick.ts)
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (mondayOf(day) !== weekStart) continue
      const items = itemsByDay.get(day)
      if (!items) continue
      const match = items.find((it) => it.topic === pick.topic && it.node === pick.node)
      if (!match) continue
      total++
      const feltSure = pick.index >= 2
      if (feltSure && match.grade !== 'recalled') overconfident++
    }
    return { overconfident, total }
  }
  const thisWeekCalibration = weekCalibration(thisWeekStart)
  const lastWeekCalibration = weekCalibration(lastWeekStart)
  const calibrationDrift =
    thisWeekCalibration.total > 0 && lastWeekCalibration.total > 0
      ? { thisWeek: thisWeekCalibration, lastWeek: lastWeekCalibration }
      : null

  const caption = renderCaption(
    {
      reviews,
      recallRate,
      consolidated: { count: consolidatedCount, thresholds: Array.from(thresholdNames) },
      calibrationDrift,
      hardestNodes,
    },
    earliestDue(input.graphs),
  )

  return {
    reviews,
    recallRate,
    consolidated: { count: consolidatedCount, thresholds: Array.from(thresholdNames) },
    calibrationDrift,
    hardestNodes,
    caption,
  }
}

/** Atlas-voice caption — honest numbers, no guilt or celebration framing, no
 * exclamation marks. A quiet week gets one line instead of the usual three,
 * naming the earliest return date when any node anywhere has one due. */
function renderCaption(d: Omit<WeekDigestOutput, 'caption'>, earliest: string | null): string {
  if (d.reviews.thisWeek === 0) {
    return earliest ? `Fig. — a quiet week; earliest return ${formatCaptionDate(earliest)}.` : 'Fig. — a quiet week.'
  }

  const parts: string[] = []

  let recallClause = `${d.reviews.thisWeek} recall${d.reviews.thisWeek === 1 ? '' : 's'}`
  if (d.recallRate) {
    recallClause += ` at ${pct(d.recallRate.thisWeek)}`
    const delta = Math.round(d.recallRate.thisWeek * 100) - Math.round(d.recallRate.lastWeek * 100)
    if (delta > 0) recallClause += `, up from ${pct(d.recallRate.lastWeek)}`
    else if (delta < 0) recallClause += `, down from ${pct(d.recallRate.lastWeek)}`
    else recallClause += `, level with ${pct(d.recallRate.lastWeek)}`
  }
  parts.push(`Fig. — ${recallClause}.`)

  if (d.consolidated.thresholds.length > 0) {
    parts.push(`${d.consolidated.thresholds.length} threshold${d.consolidated.thresholds.length === 1 ? '' : 's'} crossed.`)
  }

  if (d.calibrationDrift) {
    const { overconfident, total } = d.calibrationDrift.thisWeek
    parts.push(`Confidence ran hot on ${overconfident} of ${total}.`)
  }

  return parts.join(' ')
}
