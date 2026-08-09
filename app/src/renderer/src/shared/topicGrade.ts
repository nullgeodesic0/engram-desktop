import type { DayActivity, Misconception, RawReceipt, TopicListEntry } from '../../../shared/types'
import type { ConfidencePick } from './calibrationStore'
import { computeRetentionBuckets, computeCalibration, RETENTION_BUCKET_MIN_N } from './topicMetrics'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { mondayOf } from './weekDigest'

// ============================================================================
// Per-topic A-F course grade — genuine accountability, not gamification.
// Every input here is already computed/loaded elsewhere in the app
// (computeRetentionBuckets/computeCalibration from topicMetrics.ts, the
// topics()/receiptsHistory()/misconceptions() calls DashboardView and
// TopicDrilldownView already make) except the punctuality metric, which is
// new: see `computeTopicPunctuality` below for why it's derivable from data
// already on disk, with no engine change.
//
// The assessor's own global self-audit (grader-health) is deliberately NOT a
// component here — it's the same number for every topic, so folding it into
// a weighted score would just shift every topic's grade by a constant,
// defeating the whole point of a grade that differentiates one course's
// standing from another's. It belongs on the Grades screen as a footnote,
// not a tile.
// ============================================================================

/** Below this many consecutive dated review pairs, a punctuality median is
 * noise, not a number — same small-n honesty rule as
 * RETENTION_BUCKET_MIN_N/CALIBRATION_MIN_N, just a smaller floor since a
 * punctuality PAIR needs two receipts where a retention tally only needs one. */
export const PUNCTUALITY_MIN_N = 3

/** Minimum sample before a component renders a number instead of "not enough
 * data yet". Coverage has no natural n (it's a ratio of current graph
 * state, always computable once a topic exists at all) so it isn't gated. */
const COMPONENT_MIN_N: Record<'recall' | 'punctuality' | 'conceptual' | 'calibration', number> = {
  recall: RETENTION_BUCKET_MIN_N,
  punctuality: PUNCTUALITY_MIN_N,
  // One or two rows are anecdotes, not a component (the old value of 1 made
  // a single fresh misconception an instant F on 10% of the grade) — same
  // small-n honesty PUNCTUALITY_MIN_N applies.
  conceptual: 3,
  calibration: RETENTION_BUCKET_MIN_N,
}

/** An OPEN misconception younger than this (as of the evaluation date) is
 * *pending re-test*, excluded from the conceptual component's numerator AND
 * denominator: the component measures resolution follow-through, and a row
 * that hasn't yet had a re-test opportunity is not evidence of poor
 * follow-through. Resolved rows always count. Matches
 * PUNCTUALITY_ZERO_AT_DAYS — two weeks is the app's standing "natural
 * re-test horizon" constant. */
export const CONCEPTUAL_GRACE_DAYS = 14

const WEIGHTS = {
  recall: 0.45,
  punctuality: 0.2,
  coverage: 0.15,
  conceptual: 0.1,
  calibration: 0.1,
} as const

export type GradeComponentKey = keyof typeof WEIGHTS

/** Two ways to read the same topic: `completed` grades only the work
 * actually done (coverage doesn't apply — by definition you've "covered"
 * everything you've looked at), `total` additionally weighs in how much of
 * the curriculum remains untouched, via the coverage component. The other
 * four components (recall/punctuality/conceptual/calibration) are properties
 * of the work you've DONE either way — there's no "recall" event for a node
 * you haven't started, so mode never changes how they're computed, only
 * whether coverage is folded into the composite. */
export type GradeMode = 'completed' | 'total'

const LETTER_CUTOFFS: [number, string][] = [
  [95, 'S'],
  [90, 'A'],
  [80, 'B'],
  [70, 'C'],
  [60, 'D'],
]

/** Fixed absolute cutoffs, not curved — there's one student here, no cohort
 * to curve against, and a self-recalibrating scale would defeat the point of
 * a stable yardstick to watch drift over weeks. */
export function scoreToLetter(score: number): string {
  for (const [min, letter] of LETTER_CUTOFFS) {
    if (score >= min) return letter
  }
  return 'F'
}

/** Shared letter→ink mapping, used everywhere a grade letter renders
 * (Grades' roster/drilldown, assignments, Home's topic rows and
 * needs-attention callout) so a "B" is the same color wherever it appears.
 * The user's explicit scale: S purple (a rank above A, cut in at 95),
 * A/B orange, C/D blue, F red — violet/warm/cool/danger, the ink family's
 * own four signals, no new hue needed. */
export function letterColorClass(letter: string | null): string {
  if (letter === 'S') return 'text-[var(--color-ink-violet)]'
  if (letter === 'A' || letter === 'B') return 'text-[var(--color-ink-warm)]'
  if (letter === 'C' || letter === 'D') return 'text-[var(--color-ink-cool)]'
  if (letter === 'F') return 'text-[var(--color-ink-danger)]'
  return 'text-[var(--color-text-faint)]'
}

// Local-date day-diff — both inputs are 'YYYY-MM-DD' local dates (engram.py's
// own date.today() convention, same as nodeIntervalHistory.ts's daysBetween),
// so a bare local-midnight parse (no timezone suffix) is the correct read.
function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`)
  const db = new Date(`${b}T00:00:00`)
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

// Local 'YYYY-MM-DD' today — engram.py's own date.today() convention, never
// toISOString (which would shift a day at UTC-negative offsets).
function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export interface PunctualityResult {
  n: number
  medianDaysLate: number | null
}

/** For consecutive dated receipts on the same node, `daysLate = actual review
 * date − the PRIOR receipt's own due_next`. Positive = late, ≤0 = on-time or
 * early. Median (not mean) per topic across every node's pairs — lateness
 * deltas are right-skewed by occasional bad weeks, and a median reflects
 * typical habit rather than being dragged by one outlier, which fits
 * "accountability" better than a GPA-style average would.
 *
 * Uses `receipts` directly (not the day-bucketed `ReceiptsHistory.days`,
 * which only carries {topic,node,grade} and has no due-date field) — the
 * FULL unwindowed receipt list, same population computeRetentionBuckets/
 * computeMomentum already use, so a node's early history isn't silently
 * excluded the way a 180-day window would. */
export function computeTopicPunctuality(receipts: RawReceipt[], topic: string): PunctualityResult {
  const byNode = new Map<string, RawReceipt[]>()
  for (const r of receipts) {
    if (r.topic !== topic) continue
    const list = byNode.get(r.node) ?? []
    list.push(r)
    byNode.set(r.node, list)
  }

  const deltas: number[] = []
  for (const list of byNode.values()) {
    const sorted = [...list].sort((a, b) => a.ts.localeCompare(b.ts))
    for (let i = 0; i < sorted.length - 1; i++) {
      const prior = sorted[i]
      const next = sorted[i + 1]
      if (!prior.dueNext) continue
      deltas.push(daysBetween(prior.dueNext, next.ts))
    }
  }

  return { n: deltas.length, medianDaysLate: median(deltas) }
}

export interface ComponentGrade {
  available: boolean
  n: number
  /** Raw number in the component's own natural unit (a percent for
   * recall/calibration, days for punctuality, a 0-1 ratio for coverage,
   * the TOTAL open-misconception count for conceptual — including
   * grace-window rows that `n` deliberately excludes) — the tile shows
   * this alongside the letter, never the letter alone. */
  raw: number | null
  score: number | null // 0-100, this component's own contribution before weighting
  letter: string | null
  weight: number
}

export interface TopicGradeResult {
  topic: string
  overall: { available: boolean; score: number | null; letter: string | null }
  components: Record<GradeComponentKey, ComponentGrade>
}

function notEnoughData(weight: number): ComponentGrade {
  return { available: false, n: 0, raw: null, score: null, letter: null, weight }
}

export function computeTopicGrade(inputs: {
  receipts: RawReceipt[]
  topic: string
  topicEntry: TopicListEntry | undefined
  misconceptions: Misconception[]
  days: DayActivity[]
  picks: ConfidencePick[]
  mode: GradeMode
  /** Evaluation date for the conceptual grace window (local 'YYYY-MM-DD') —
   * defaults to today; computeHistoricalTopicGrade passes its cutoff so
   * grace is cutoff-relative and consistent with the resolved_ts mapping. */
  asOf?: string
}): TopicGradeResult {
  const { receipts, topic, topicEntry, misconceptions, days, picks, mode, asOf = localToday() } = inputs

  // --- recall accuracy: blended (recalled+partial)/n across every bucket,
  // not any single bucket — the buckets are time-since-encode windows, and a
  // course grade wants ONE overall accuracy number, not "which window do I
  // read". ---
  const buckets = computeRetentionBuckets(receipts, topic)
  let recalledOrPartial = 0
  let recallN = 0
  for (const b of Object.values(buckets)) {
    recalledOrPartial += b.recalled + b.partial
    recallN += b.n
  }
  const recall: ComponentGrade =
    recallN < COMPONENT_MIN_N.recall
      ? notEnoughData(WEIGHTS.recall)
      : {
          available: true,
          n: recallN,
          raw: recalledOrPartial / recallN,
          score: (recalledOrPartial / recallN) * 100,
          letter: scoreToLetter((recalledOrPartial / recallN) * 100),
          weight: WEIGHTS.recall,
        }

  // --- punctuality: median days late, mapped onto the same 0-100 scale via
  // a linear falloff — 0 days late (or earlier) is full credit, 14+ days
  // late is zero credit, matching FSRS's own typical short-interval scale
  // (a review lapsed by two weeks has usually already lapsed the node
  // itself, per the engine's own grading). ---
  const punctuality = computeTopicPunctuality(receipts, topic)
  const PUNCTUALITY_ZERO_AT_DAYS = 14
  const punctualityComponent: ComponentGrade =
    punctuality.n < COMPONENT_MIN_N.punctuality || punctuality.medianDaysLate === null
      ? notEnoughData(WEIGHTS.punctuality)
      : (() => {
          const score = Math.max(0, Math.min(100, 100 - (punctuality.medianDaysLate / PUNCTUALITY_ZERO_AT_DAYS) * 100))
          return {
            available: true,
            n: punctuality.n,
            raw: punctuality.medianDaysLate,
            score,
            letter: scoreToLetter(score),
            weight: WEIGHTS.punctuality,
          }
        })()

  // --- coverage: how much of the curriculum is actually consolidated
  // (review-state) vs. still new/learning — a live graph snapshot, not a
  // history, so it's never gated on a minimum sample; a topic with any nodes
  // at all has a real coverage ratio. Excluded entirely in `completed` mode —
  // see GradeMode's own doctrine comment. ---
  const coverage: ComponentGrade = (() => {
    if (mode === 'completed') return notEnoughData(WEIGHTS.coverage)
    if (!topicEntry || topicEntry.nodes === 0) return notEnoughData(WEIGHTS.coverage)
    const ratio = topicEntry.states.review / topicEntry.nodes
    const score = ratio * 100
    return {
      available: true,
      n: topicEntry.nodes,
      raw: ratio,
      score,
      letter: scoreToLetter(score),
      weight: WEIGHTS.coverage,
    }
  })()

  // --- conceptual health: resolved / (aged-open + resolved) — a topic with
  // zero misconceptions ever logged has nothing to penalize OR reward, so
  // it's "not enough data" rather than a free A. Open rows inside the grace
  // window (see CONCEPTUAL_GRACE_DAYS) are pending re-test and count on
  // NEITHER side; resolved rows always count. `raw` stays the honest TOTAL
  // open count (grace included) — the tile states what's actually filed —
  // while `n` is the graced population that drives the min-N gate and the
  // score. ---
  const topicMisconceptions = misconceptions.filter((m) => m.topic === topic)
  const openRows = topicMisconceptions.filter((m) => m.status === 'open')
  const resolvedCount = topicMisconceptions.filter((m) => m.status === 'resolved').length
  const agedOpenCount = openRows.filter((m) => daysBetween(m.ts, asOf) >= CONCEPTUAL_GRACE_DAYS).length
  const conceptualTotal = agedOpenCount + resolvedCount
  const conceptual: ComponentGrade =
    conceptualTotal < COMPONENT_MIN_N.conceptual
      ? notEnoughData(WEIGHTS.conceptual)
      : {
          available: true,
          n: conceptualTotal,
          raw: openRows.length,
          score: (resolvedCount / conceptualTotal) * 100,
          letter: scoreToLetter((resolvedCount / conceptualTotal) * 100),
          weight: WEIGHTS.conceptual,
        }

  // --- calibration: felt-confidence vs. graded outcome. ---
  const cal = computeCalibration(days, picks, topic)
  const calibration: ComponentGrade =
    cal.total < COMPONENT_MIN_N.calibration
      ? notEnoughData(WEIGHTS.calibration)
      : {
          available: true,
          n: cal.total,
          raw: cal.calibrated / cal.total,
          score: (cal.calibrated / cal.total) * 100,
          letter: scoreToLetter((cal.calibrated / cal.total) * 100),
          weight: WEIGHTS.calibration,
        }

  const components: Record<GradeComponentKey, ComponentGrade> = {
    recall,
    punctuality: punctualityComponent,
    coverage,
    conceptual,
    calibration,
  }

  // Renormalize weights across only the AVAILABLE components — a brand-new
  // topic missing several components must never read as a confident F from
  // treating the missing ones as zero.
  const availableWeightSum = Object.values(components)
    .filter((c) => c.available)
    .reduce((sum, c) => sum + c.weight, 0)

  if (availableWeightSum === 0) {
    return { topic, overall: { available: false, score: null, letter: null }, components }
  }

  const overallScore = Object.values(components).reduce(
    (sum, c) => (c.available && c.score !== null ? sum + (c.score * c.weight) / availableWeightSum : sum),
    0,
  )

  return {
    topic,
    overall: { available: true, score: overallScore, letter: scoreToLetter(overallScore) },
    components,
  }
}

// ============================================================================
// Cross-topic GPA — no new math, aggregates each topic's own already-computed
// composite. Weighted by node count (a "credit hours" analog: a 40-node
// topic should move the GPA more than a 3-node one), renormalized over only
// the topics with an available grade — same "don't let missing data read as
// zero" discipline computeTopicGrade itself uses for its components.
// ============================================================================

export interface CrossTopicGPA {
  available: boolean
  score: number | null
  letter: string | null
  topicsCounted: number
}

export function computeCrossTopicGPA(topics: TopicListEntry[], grades: Map<string, TopicGradeResult>): CrossTopicGPA {
  let weightedSum = 0
  let nodeWeightSum = 0
  let topicsCounted = 0

  for (const t of topics) {
    const grade = grades.get(t.topic)
    if (!grade?.overall.available || grade.overall.score === null || t.nodes === 0) continue
    weightedSum += grade.overall.score * t.nodes
    nodeWeightSum += t.nodes
    topicsCounted++
  }

  if (nodeWeightSum === 0) return { available: false, score: null, letter: null, topicsCounted: 0 }

  const score = weightedSum / nodeWeightSum
  return { available: true, score, letter: scoreToLetter(score), topicsCounted }
}

// ============================================================================
// Grade trend — completed-mode ONLY, by design, not an oversight. Coverage
// (the one component that differs between `completed`/`total`) reads a LIVE
// graph snapshot with no "as-of" query, and a node can regress out of
// `review` state via forgetting — a `total`-mode historical line would
// silently disagree with the live coverage number shown elsewhere on this
// same screen. Rather than invent a second, weaker coverage semantics for
// "as of the past," the trend only ever charts the `completed` composite.
// Callers must caption this explicitly (never let a trend line be mistaken
// for `total` mode's own number).
// ============================================================================

/** `cutoff` is a local 'YYYY-MM-DD' date — receipts/misconceptions/days are
 * already stored as matching local-date strings, so `<=` string comparison
 * is correct for them directly. `picks` is the one exception: ConfidencePick.ts
 * is a numeric millisecond timestamp, NOT a date string, so it needs a real
 * timestamp boundary (end of the cutoff day) rather than a string compare —
 * getting this wrong would silently let every future pick leak into every
 * historical cutoff. */
export function computeHistoricalTopicGrade(inputs: {
  receipts: RawReceipt[]
  topic: string
  misconceptions: Misconception[]
  days: DayActivity[]
  picks: ConfidencePick[]
  cutoff: string
}): TopicGradeResult {
  const { receipts, topic, misconceptions, days, picks, cutoff } = inputs
  const cutoffMs = new Date(`${cutoff}T23:59:59`).getTime()

  return computeTopicGrade({
    receipts: receipts.filter((r) => r.ts <= cutoff),
    topic,
    topicEntry: undefined, // coverage is never available historically — see doctrine comment above
    // A resolution only counts from its own date: a row resolved AFTER the
    // cutoff was still open as of the cutoff, so it maps back to 'open' here
    // rather than letting today's resolutions rewrite every past week's
    // conceptual health. A resolved row missing `resolved_ts` can only come
    // from hand-editing (the engine always stamps it) — treated as resolved
    // at `ts`, which reproduces pre-fix behavior for exactly those rows and
    // never inflates a past open count.
    misconceptions: misconceptions
      .filter((m) => m.ts <= cutoff)
      .map((m) =>
        m.status === 'resolved' && (m.resolved_ts ?? m.ts) > cutoff
          ? { ...m, status: 'open' as const, resolved_ts: undefined }
          : m,
      ),
    days: days.filter((d) => d.date <= cutoff),
    picks: picks.filter((p) => p.ts <= cutoffMs),
    mode: 'completed',
    // Grace is cutoff-relative: a row that was fresh as of this cutoff was
    // pending re-test THEN, whatever its age is today.
    asOf: cutoff,
  })
}

export interface TopicGradeTrendPoint {
  cutoff: string
  result: TopicGradeResult
}

export function computeTopicGradeTrend(inputs: {
  receipts: RawReceipt[]
  topic: string
  misconceptions: Misconception[]
  days: DayActivity[]
  picks: ConfidencePick[]
  cutoffs: string[]
}): TopicGradeTrendPoint[] {
  const { receipts, topic, misconceptions, days, picks, cutoffs } = inputs
  return cutoffs.map((cutoff) => ({
    cutoff,
    result: computeHistoricalTopicGrade({ receipts, topic, misconceptions, days, picks, cutoff }),
  }))
}

/** The last `weeks` real Mondays present in `days` (receiptsHistory's own
 * ~180-day window) — same week-boundary rule `topicWeekRetention` already
 * uses (`mondayOf`, from weekDigest.ts), so the trend's cadence never
 * disagrees with any other week-bucketed view in the app. */
export function weeklyTrendCutoffs(days: DayActivity[], weeks = 12): string[] {
  const mondays: string[] = []
  const seen = new Set<string>()
  for (const d of days) {
    const monday = mondayOf(d.date)
    if (seen.has(monday)) continue
    seen.add(monday)
    mondays.push(monday)
  }
  return mondays.slice(-weeks)
}

// ============================================================================
// Literal assignments — a browsable gradebook, not a style choice. Each row
// is one real graded event ("Inertia Tensor — First Learn", "Reduced Mass —
// Review, Jul 22"), not an abstract statistical category (those are the
// Subgrades above). This is the transparent audit trail underneath the
// Subgrades' numbers, not a second scoring pass — the weighted composite
// above already owns the math; assignments exist so "why is my recall
// accuracy what it is" has real, dated, individually-graded rows to point to.
// ============================================================================

export interface AssignmentRow {
  key: string
  node: string
  label: string
  date: string | null
  /** Which kind of graded event this was — carried structurally so the UI
   * renders "First Learn"/"Review"/"Transfer Probe" from data instead of
   * re-parsing `label`'s prose. `review` is also the fallback for receipts
   * with no recorded kind, matching assignmentLabel's own fallback. */
  kind: 'encode' | 'review' | 'transfer' | 'unstarted'
  outcome: 'recalled' | 'partial' | 'lapsed' | 'unstarted'
  letter: string | null
  /** The receipt's provenance stamp, carried for DISPLAY only (the QUICK
   * chip on checkpoint rows). Deliberately absent from every computation in
   * this file — checkpoint receipts are full-weight by locked decision; the
   * schedule penalty is the corrective, not the grade. */
  source: string | null
  /** The engine cut this receipt's stored production at 800 chars. */
  productionTruncated?: boolean
}

const OUTCOME_LETTER: Record<'recalled' | 'partial' | 'lapsed', string> = {
  recalled: 'A',
  partial: 'C',
  lapsed: 'F',
}

/** Exported for the Assignments UI's own date renders (group date spans,
 * per-row dates) — one formatting rule, not two. */
export function formatAssignmentDate(ts: string): string {
  return new Date(`${ts}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function assignmentLabel(node: string, kind: string | null, ts: string): string {
  const title = humanizeNodeId(node)
  if (kind === 'encode') return `${title} — First Learn`
  if (kind === 'transfer') return `${title} — Transfer Probe, ${formatAssignmentDate(ts)}`
  return `${title} — Review, ${formatAssignmentDate(ts)}`
}

/** Most-recent-first. `allNodeIds` (a topic's full `TopicGraph.order`, never
 * its `nodes` map — see the call site's own comment on why only the bare id
 * list is fetched) is optional and only consulted in `total` mode: a node
 * with zero receipts ever gets its own "Not Yet Started" row, contributing
 * as incomplete/zero to the topic's standing (the user's own call — an
 * unstarted node counts against the total-work grade, not just a visible
 * gap) exactly the way the `coverage` component above already treats it. */
export function buildTopicAssignments(
  receipts: RawReceipt[],
  topic: string,
  mode: GradeMode,
  allNodeIds?: string[],
): AssignmentRow[] {
  const topicReceipts = receipts.filter((r) => r.topic === topic)
  const rows: AssignmentRow[] = topicReceipts.map((r) => {
    const outcome = (r.grade === 'recalled' || r.grade === 'partial' || r.grade === 'lapsed' ? r.grade : null) as
      | 'recalled'
      | 'partial'
      | 'lapsed'
      | null
    return {
      key: r.id ?? `${r.node}-${r.ts}-${r.kind ?? ''}`,
      node: r.node,
      label: assignmentLabel(r.node, r.kind, r.ts),
      date: r.ts,
      kind: (r.kind === 'encode' || r.kind === 'transfer' ? r.kind : 'review') as 'encode' | 'transfer' | 'review',
      outcome: outcome ?? 'lapsed',
      letter: outcome ? OUTCOME_LETTER[outcome] : null,
      source: r.source ?? null,
      productionTruncated: r.productionTruncated === true,
    }
  })

  if (mode === 'total' && allNodeIds) {
    const startedNodes = new Set(topicReceipts.map((r) => r.node))
    for (const node of allNodeIds) {
      if (startedNodes.has(node)) continue
      rows.push({
        key: `${node}-unstarted`,
        node,
        label: `${humanizeNodeId(node)} — Not Yet Started`,
        date: null,
        kind: 'unstarted',
        outcome: 'unstarted',
        letter: null,
        source: null,
      })
    }
  }

  rows.sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1 // unstarted rows sink to the bottom
    if (!b.date) return -1
    return b.date.localeCompare(a.date)
  })

  return rows
}

export interface AssignmentGroup {
  node: string
  rows: AssignmentRow[]
}

/** Groups a flat assignment list into one entry per node — a mature topic's
 * 44+ individual review rows collapse into a handful of collapsible groups,
 * one per node, instead of one long undifferentiated scroll. Ordered by each
 * group's own newest row (an unstarted-only group has no dated row, so it
 * sinks last — same rule individual rows already use in buildTopicAssignments). */
export function groupAssignmentsByNode(rows: AssignmentRow[]): AssignmentGroup[] {
  const byNode = new Map<string, AssignmentRow[]>()
  for (const row of rows) {
    const list = byNode.get(row.node) ?? []
    list.push(row)
    byNode.set(row.node, list)
  }

  const groups: AssignmentGroup[] = [...byNode.entries()].map(([node, groupRows]) => ({ node, rows: groupRows }))
  groups.sort((a, b) => {
    const aDate = a.rows.find((r) => r.date)?.date ?? null
    const bDate = b.rows.find((r) => r.date)?.date ?? null
    if (!aDate && !bDate) return 0
    if (!aDate) return 1
    if (!bDate) return -1
    return bDate.localeCompare(aDate)
  })
  return groups
}
