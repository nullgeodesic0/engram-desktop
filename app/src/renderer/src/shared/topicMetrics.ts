import type { DayActivity, RawReceipt, TopicGraph, WeekRetention } from '../../../shared/types'
import type { ConfidencePick } from './calibrationStore'
import { mondayOf } from './weekDigest'

// ============================================================================
// ONE COMPUTATION, TWO SCOPES.
//
// Coach's Retention/Momentum/Calibration numbers and the per-topic drilldown's
// numbers must never be two implementations that can quietly disagree — so
// every function here takes an OPTIONAL `topic` filter and is called by both
// DashboardView (no filter — every topic pooled, exactly what stats.retention
// used to report) and TopicDrilldownView (filter set to one topic). If this
// file's output for "no filter" ever stops matching engram.py's own
// `compute_retention`/`compute_momentum`, that is this file's bug, not a
// drilldown-only one — see task-1-report.md's reconciliation for the receipts
// this was checked against.
//
// The retention-bucket and momentum algorithms below are a deliberate,
// field-level port of engram.py's `_by_node` / `compute_retention` /
// `compute_momentum` (scripts/engram.py, v1.0.7) — not a reinterpretation.
// They exist here, instead of calling `stats`/`retention` a second time with
// a topic flag, because neither subcommand accepts one (checked against the
// real argparse wiring before writing this) and this project may not touch
// `readOnly.ts`'s allowlist. The inputs are `ReceiptsHistory.receipts` (every
// receipt ever written, unwindowed — see that field's own doc comment) and
// the topic graphs the app already fetches for the digest.
// ============================================================================

const GRADES = ['recalled', 'partial', 'lapsed'] as const
type Grade = (typeof GRADES)[number]

// Mirrors engram.py's GRADE_OF_RATING — the fallback when a receipt carries a
// scheduler rating but no assessor grade (shouldn't happen on a receipt this
// app ever wrote, but hand-edited files exist in the wild).
const GRADE_OF_RATING: Record<string, Grade> = { again: 'lapsed', hard: 'partial', good: 'recalled', easy: 'recalled' }

function isGrade(g: string | null): g is Grade {
  return g !== null && (GRADES as readonly string[]).includes(g)
}

/** A receipt's grade, falling back to its rating — mirrors engram.py's `_grade_of`. */
function gradeOf(r: RawReceipt): Grade | null {
  if (isGrade(r.grade)) return r.grade
  return r.rating ? (GRADE_OF_RATING[r.rating] ?? null) : null
}

/** Elapsed whole days between two YYYY-MM-DD calendar dates, parsed as LOCAL
 * midnight — never toISOString/UTC. engram.py's own `days_between` operates on
 * bare calendar dates with no timezone concept at all; this local-midnight
 * parse is the renderer's honest equivalent (same convention as
 * TopicMapView's `formatProvenanceDate`/`dateAtT`). */
function daysBetweenLocal(a: string, b: string): number | null {
  const da = new Date(`${a}T00:00:00`)
  const db = new Date(`${b}T00:00:00`)
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return null
  return Math.round((db.getTime() - da.getTime()) / 86_400_000)
}

/** Local YYYY-MM-DD, `n` days before `now` — getFullYear/getMonth/getDate,
 * never toISOString (local-date discipline; see daysBetweenLocal above). */
function localDateNDaysAgo(n: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ------------------------------------------------------------- date range
//
// Task 4: ONE range control per surface (DashboardView, TopicDrilldownView),
// governing the receipt-derived charts — Activity, weekly trend, Calibration,
// and (drilldown only) the retention buckets below. It deliberately does NOT
// govern: the global Retention/Momentum StatCards (`stats.retention`/
// `stats.momentum` — the engine's own fixed windows, the oracle from the P3
// Task 1 fix wave; see p3-t1-fixwave-report.md) or Momentum in EITHER scope
// (the drilldown's own `computeMomentum` mirrors the engine's compute_momentum
// field-for-field, including its hardcoded 7-day window — MOMENTUM_WINDOW_DAYS
// is not a parameter, it is what "momentum" means here, the same way it is in
// engram.py; two of its five fields, `mostDurable`/`retainedTotal`, are
// current-graph-state snapshots with no date-range meaning at all regardless).
// See task-4-report.md for the full boundary justification.

export interface DateRange {
  from: string // YYYY-MM-DD, local, inclusive
  to: string // YYYY-MM-DD, local, inclusive
}

export type RangeKey = '7' | '30' | '90' | 'all'

export const RANGE_OPTIONS: { value: RangeKey; label: string; days: number | null }[] = [
  { value: '7', label: '7d', days: 7 },
  { value: '30', label: '30d', days: 30 },
  { value: '90', label: '90d', days: 90 },
  { value: 'all', label: 'All', days: null },
]

/** Local-date bounds for a range preset, or `null` for 'all' (no filter —
 * every governed chart shows its full unwindowed/180-day population, exactly
 * the pre-Task-4 behavior). `to` is always local today; `from` is `days - 1`
 * back so a "7d" range covers exactly 7 calendar days INCLUDING today — both
 * ends inclusive. Built on `localDateNDaysAgo` (never toISOString), the same
 * helper `computeMomentum`'s own 7-day cutoff already uses. */
export function rangeBounds(key: RangeKey, now: Date = new Date()): DateRange | null {
  const opt = RANGE_OPTIONS.find((o) => o.value === key)
  if (!opt || opt.days === null) return null
  return { from: localDateNDaysAgo(opt.days - 1, now), to: localDateNDaysAgo(0, now) }
}

/** The active range, stated in words — placed beside every chart it governs
 * so a filtered number can never be mistaken for an all-time one (spec §4).
 * Local calendar-date formatting only (`T00:00:00`, never toISOString/UTC),
 * matching TopicDrilldownView's own `formatDate`. */
export function rangeCaption(key: RangeKey, bounds: DateRange | null): string {
  if (!bounds) return 'all time — last 180 days'
  const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const opt = RANGE_OPTIONS.find((o) => o.value === key)
  return `${opt?.label ?? key} — ${fmt(bounds.from)}–${fmt(bounds.to)}`
}

/** `DayActivity[]` restricted to a date range — plain string comparison,
 * never Date parsing: `.date` is always YYYY-MM-DD, which sorts lexically
 * exactly as it sorts chronologically, so this needs no timezone handling at
 * all. `null` range (the 'all' preset) is a no-op passthrough. */
export function filterDaysByRange(days: DayActivity[], range: DateRange | null): DayActivity[] {
  if (!range) return days
  return days.filter((d) => d.date >= range.from && d.date <= range.to)
}

/** Stable ordering for receipts whose `ts`/`id` may be missing on a
 * hand-edited file — mirrors engram.py's `_sort_key`: an unparseable/missing
 * `ts` sorts LAST so it can never win a node's day-0 encoding slot. */
function receiptSortKey(r: RawReceipt): [number, string, string] {
  const ok = !!r.ts && !isNaN(new Date(`${r.ts}T00:00:00`).getTime())
  return [ok ? 0 : 1, r.ts ?? '', r.id ?? '']
}

function compareReceipts(a: RawReceipt, b: RawReceipt): number {
  const ka = receiptSortKey(a)
  const kb = receiptSortKey(b)
  if (ka[0] !== kb[0]) return ka[0] - kb[0]
  if (ka[1] !== kb[1]) return ka[1] < kb[1] ? -1 : 1
  if (ka[2] !== kb[2]) return ka[2] < kb[2] ? -1 : 1
  return 0
}

interface NodeSlot {
  first: RawReceipt
  reviews: RawReceipt[]
  transfers: RawReceipt[]
}

/** (topic, node) -> {first, reviews, transfers} — mirrors engram.py's
 * `_by_node`. A node's FIRST receipt is its encoding event, whatever kind it
 * happens to carry, and never counts as a review: there was no prior memory
 * to retain yet. The one exception (engram.py's own): a capstone's first
 * receipt is a `kind: transfer` — capstones have no encoding phase at all —
 * so that specific case is filed as a transfer, not swallowed as an encode.
 * `r.capstone` is carried all the way from the receipt JSONL through
 * `RawReceipt` (main/engramCli/receiptsHistory.ts) — it used to be dropped at
 * that IPC boundary, which made this branch dead code even on a real
 * capstone-first-receipt: momentum silently under-reported (0 reviews
 * instead of 1) for exactly the population — a capstone whose only receipt
 * is a transfer — this branch exists to handle. */
function groupByNode(receipts: RawReceipt[], topic?: string): Map<string, NodeSlot> {
  const pool = topic ? receipts.filter((r) => r.topic === topic) : receipts
  const ordered = [...pool].sort(compareReceipts)
  const out = new Map<string, NodeSlot>()
  for (const r of ordered) {
    if (!r.topic || !r.node) continue
    const key = `${r.topic}\x00${r.node}`
    if (!out.has(key)) {
      out.set(key, { first: r, reviews: [], transfers: [] })
      const capstoneTransfer = r.capstone === true && r.kind === 'transfer' && !!r.rating
      if (capstoneTransfer) out.get(key)!.transfers.push(r)
      continue
    }
    const slot = out.get(key)!
    if (r.kind === 'review' && r.rating) slot.reviews.push(r)
    else if (r.kind === 'transfer' && r.rating) slot.transfers.push(r)
  }
  return out
}

// ---------------------------------------------------------------- retention

/** engram.py's RETENTION_BUCKETS (scripts/engram.py, v1.0.7) — windows that
 * partition [0, inf) so no review is ever silently dropped. `early` (0-3
 * days) is re-encoding, not retention, and is reported but never the
 * headline. One named tuple, not scattered literals, per both this file's
 * callers. */
export const RETENTION_BUCKETS: readonly [name: string, lo: number, hi: number][] = [
  ['early', 0, 3],
  ['7d', 4, 14],
  ['30d', 15, 59],
  ['90d', 60, 179],
  ['180d+', 180, Infinity],
]

/** Below this many reviews, a bucket's rate is noise, not a number — see
 * `bucketDisplay` below. Matches engram.py's own TRANSFER_MIN_N (the
 * smallest floor the engine sets anywhere: "a rate over fewer than five
 * probes moves more than 20 points on one item, and a number a single datum
 * can swing by 20 points is not a rate"). Retention buckets are exactly that
 * shape once restricted to one topic, so the same floor applies. One named
 * constant — every caller imports this, none hardcodes 5. */
export const RETENTION_BUCKET_MIN_N = 5

export interface RetentionBucket {
  recalled: number
  partial: number
  lapsed: number
  n: number
  rate: number | null
}

/** Per-bucket retention (early/7d/30d/90d/180d+), optionally restricted to
 * one topic — the exact port of engram.py's `compute_retention` bucket loop,
 * over `_by_node`'s grouping. Every review is bucketed by ITS OWN
 * days-since-encode (not just first reviews), so a chronic node keeps
 * contributing to every window it ever lands in.
 *
 * `range` (Task 4, drilldown only — DashboardView never passes one) restricts
 * WHICH REVIEWS are tallied, by the review's own date — it never restricts
 * which receipts `groupByNode` sees when finding each node's `first`
 * (encoding) receipt. That distinction is the whole point: `first` must
 * always be the node's TRUE first-ever receipt, full stop, or a review at day
 * 100 whose encoding fell outside a narrow selected range would look like a
 * fresh day-0 encode and land in `early` instead of `90d` — silently
 * corrupting the one thing this bucket structure exists to measure. So
 * `groupByNode(receipts, topic)` below is deliberately called with the FULL,
 * unranged receipt list; only the per-review tally loop checks `range`. */
export function computeRetentionBuckets(receipts: RawReceipt[], topic?: string, range?: DateRange | null): Record<string, RetentionBucket> {
  const nodes = groupByNode(receipts, topic)
  const buckets: Record<string, RetentionBucket> = {}
  for (const [name] of RETENTION_BUCKETS) buckets[name] = { recalled: 0, partial: 0, lapsed: 0, n: 0, rate: null }

  for (const slot of nodes.values()) {
    const enc = slot.first.ts
    for (const r of slot.reviews) {
      if (range && (r.ts < range.from || r.ts > range.to)) continue
      const elapsed = daysBetweenLocal(enc, r.ts)
      if (elapsed === null) continue
      for (const [name, lo, hi] of RETENTION_BUCKETS) {
        if (elapsed >= lo && elapsed <= hi) {
          const b = buckets[name]
          const g = gradeOf(r)
          if (g) b[g]++
          b.n++
          break
        }
      }
    }
  }
  for (const b of Object.values(buckets)) {
    // NOT bit-identical to engram.py's `round(x, 3)` here: Python's round()
    // is banker's (round-half-to-even), this is round-half-up. The two
    // disagree only when the unrounded value sits exactly on a .0005
    // boundary, and by at most one unit in the 3rd decimal (e.g. 0.813 vs
    // 0.812) — invisible once rendered at percent granularity (bucketDisplay
    // below multiplies by 100 and rounds again). Left as-is; the agreement
    // check (scripts/checkTopicMetricsAgreement.ts) tolerates exactly this
    // one-ULP gap on `rate` rather than papering over a real divergence.
    if (b.n) b.rate = Math.round(((b.recalled + b.partial) / b.n) * 1000) / 1000
  }
  return buckets
}

/** How a retention bucket should render — the small-n honesty rule. Below
 * `RETENTION_BUCKET_MIN_N`, the headline is the raw count (never a rate that
 * one review could swing by 20+ points), the caption says why in the app's
 * own voice rather than staying silent about the switch, and `tone` is
 * deliberately flat ('dim') rather than colored by the untrusted rate
 * underneath — a warm-toned "3" would read as a confident number wearing a
 * caption that says the opposite. Returns everything a `StatCard` needs
 * spread directly, so DashboardView and TopicDrilldownView render this
 * identically rather than each inventing its own tone logic on top. */
export function bucketDisplay(b: RetentionBucket): { value: string; caption: string; tone: 'default' | 'warm' | 'danger' | 'dim' } {
  if (b.n === 0) return { value: '—', caption: 'no reviews yet', tone: 'dim' }
  if (b.n < RETENTION_BUCKET_MIN_N) {
    return { value: String(b.n), caption: `too few to rate (n<${RETENTION_BUCKET_MIN_N})`, tone: 'dim' }
  }
  const rate = b.rate ?? 0
  return {
    value: `${Math.round(rate * 100)}%`,
    caption: `n=${b.n}`,
    tone: rate >= 0.85 ? 'warm' : rate < 0.6 ? 'danger' : 'default',
  }
}

// ----------------------------------------------------------------- momentum

export const MOMENTUM_WINDOW_DAYS = 7

/** Reviews ∪ transfers, excluding each node's first (encoding) receipt —
 * mirrors engram.py's `_retrieval_receipts`, the population `momentum` reads
 * (a transfer probe advances FSRS exactly like a review, so excluding it
 * would undercount real durability growth). */
function retrievalReceipts(receipts: RawReceipt[], topic?: string): Set<RawReceipt> {
  const nodes = groupByNode(receipts, topic)
  const out = new Set<RawReceipt>()
  for (const slot of nodes.values()) {
    for (const r of slot.reviews) out.add(r)
    for (const r of slot.transfers) out.add(r)
  }
  return out
}

export interface TopicMomentum {
  windowDays: number
  reviewsWindow: number
  recalledWindow: number
  stabilityGainedWindow: number
  mostDurable: { node: string; stabilityDays: number } | null
  retainedTotal: number
}

/** The last MOMENTUM_WINDOW_DAYS' worth of receipt-side momentum
 * (reviews/recalls/stability gained), plus the CURRENT graph-side snapshot
 * (most durable node, total retained) — mirrors engram.py's
 * `compute_momentum` field for field. The graph-side half needs no receipt
 * filtering at all: `graphs[topic]` (or every graph, unfiltered) already IS
 * that topic's current state. */
export function computeMomentum(
  receipts: RawReceipt[],
  graphs: Record<string, TopicGraph>,
  topic?: string,
  now: Date = new Date(),
): TopicMomentum {
  const cutoff = localDateNDaysAgo(MOMENTUM_WINDOW_DAYS, now)
  const pool = topic ? receipts.filter((r) => r.topic === topic) : receipts
  const genuine = retrievalReceipts(receipts, topic)

  let reviewsWindow = 0
  let recalledWindow = 0
  let gained = 0
  for (const r of pool) {
    if (!r.ts || r.ts < cutoff) continue
    if (!genuine.has(r)) continue
    reviewsWindow++
    if (r.sBefore !== null && r.sAfter !== null && r.sAfter > r.sBefore) gained += r.sAfter - r.sBefore
    if (r.grade === 'recalled') recalledWindow++
  }

  let mostDurable: { node: string; stabilityDays: number } | null = null
  let retainedTotal = 0
  const graphList = topic ? (graphs[topic] ? [graphs[topic]] : []) : Object.values(graphs)
  for (const g of graphList) {
    for (const [nid, node] of Object.entries(g.nodes)) {
      if (node.state === 'review') retainedTotal++
      const s = node.fsrs.s
      if (s !== null && (mostDurable === null || s > mostDurable.stabilityDays)) {
        mostDurable = { node: nid, stabilityDays: Math.round(s * 10) / 10 }
      }
    }
  }

  return {
    windowDays: MOMENTUM_WINDOW_DAYS,
    reviewsWindow,
    recalledWindow,
    stabilityGainedWindow: Math.round(gained * 10) / 10,
    mostDurable,
    retainedTotal,
  }
}

// --------------------------------------------------------------- calibration

/** Below this many paired picks, a calibration verdict (overconfident /
 * underconfident / calibrated split) is noise, not a diagnosis — the same
 * small-n honesty rule RETENTION_BUCKET_MIN_N applies to retention buckets,
 * now applied to calibration too (a per-topic slice made this bite: a
 * one-pick topic was rendering a confident-looking verdict off n=1).
 *
 * Deliberately NOT engram.py's own CAL_MIN_N (10): that floor gates a
 * different, denser population — every review receipt that happens to carry
 * a `confidence` field, pooled globally. This population is local
 * confidence-picker picks (calibrationStore, recorded only when that widget
 * is shown) sliced down to one topic — sparser by construction, and a floor
 * of 10 would silently empty the calibration section for most topics that
 * otherwise have real signal. RETENTION_BUCKET_MIN_N is this app's own
 * already-chosen "a rate under fewer than five probes is noise" floor (see
 * that constant's doc comment); reusing it here — rather than either
 * inventing a third number or importing the engine's — keeps one deliberate
 * small-n threshold across both metrics this app renders per topic. */
export const CALIBRATION_MIN_N = RETENTION_BUCKET_MIN_N

export interface CalibrationCounts {
  overconfident: number
  underconfident: number
  calibrated: number
  total: number
  /** The topic-filtered picks — hand back to the caller so CalibrationScatter
   * gets exactly the population these counts describe, not the full set. */
  picks: ConfidencePick[]
}

/** Local confidence picks (calibrationStore) joined against the assessor's own
 * grade history (receiptsHistory's day buckets) by topic+node+LOCAL calendar
 * date — extracted verbatim from DashboardView's original inline join so the
 * StatBlocks and the drilldown can never compute two different answers to
 * "was I calibrated". `days` is passed through UNfiltered: the join already
 * requires `it.topic === pick.topic`, so filtering `picks` alone is sufficient
 * to scope the whole computation to one topic. */
export function computeCalibration(days: DayActivity[], picks: ConfidencePick[], topic?: string): CalibrationCounts {
  const pool = topic ? picks.filter((p) => p.topic === topic) : picks
  const itemsByDay = new Map(days.map((d) => [d.date, d.items]))

  let overconfident = 0
  let underconfident = 0
  let calibrated = 0
  for (const pick of pool) {
    if (pick.index === undefined) continue
    // Receipts are keyed by the engine's LOCAL calendar date — getFullYear/
    // Month/Date, never toISOString. Same rule, same reason, as the original
    // DashboardView join and CalibrationScatter's own copy.
    const d = new Date(pick.ts)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const items = itemsByDay.get(day)
    if (!items) continue
    const match = items.find((it) => it.topic === pick.topic && it.node === pick.node)
    if (!match) continue
    const feltSure = pick.index >= 2
    const recalled = match.grade === 'recalled'
    if (feltSure && !recalled) overconfident++
    else if (!feltSure && recalled) underconfident++
    else calibrated++
  }

  return { overconfident, underconfident, calibrated, total: overconfident + underconfident + calibrated, picks: pool }
}

// ------------------------------------------------------------- topic charts

/** `receiptsHistory().days`, restricted to one topic's own items — feeds
 * ActivityStrip in the drilldown the same shape the global Coach view feeds
 * it, just pre-filtered. `topic` optional (Task 4): the global Activity chart
 * now goes through the SAME range-filtering call site as the drilldown's, so
 * `undefined` here means "every topic pooled" rather than a second identity
 * copy of this function for the global surface. */
export function topicDayActivity(days: DayActivity[], topic?: string): DayActivity[] {
  return days.map((d) => {
    const items = topic ? d.items.filter((it) => it.topic === topic) : d.items
    return { date: d.date, count: items.length, items }
  })
}

/** Re-derives weekly recall-rate (RetentionCurve's shape) from topic-filtered
 * day items, grouped by the SAME Monday-of-week rule receiptsHistory.ts's own
 * week aggregation uses (imported from weekDigest.ts, not a third copy). One
 * week entry per Monday actually present in `days`, oldest first, so a topic
 * with a quiet stretch still renders a well-formed (if empty) series rather
 * than an object in arbitrary key order.
 *
 * `topic` optional (Task 4) — the global weekly-trend charts (RetentionCurve/
 * RetentionTrend) now recompute from `receiptsHistory().days` through this
 * SAME function with no topic filter, instead of reading `receiptsHistory().weeks`
 * (main process's own pre-aggregation) directly. That switch is what lets a
 * date-range control filter the global weekly trend at all — `weeks` is
 * pre-aggregated server-side with no range parameter, but `days` (already
 * fetched, per-day) can be range-sliced in the renderer and re-rolled up
 * here. Verified once against real data that this produces byte-identical
 * per-week totals/recalled to `receiptsHistory().weeks` when given the full,
 * unfiltered `days` (see task-4-report.md) — this is not a second algorithm,
 * it is the SAME one `receiptsHistory.ts`'s main-process aggregation uses,
 * now also reachable from the renderer with an optional slice. */
export function topicWeekRetention(days: DayActivity[], topic?: string): WeekRetention[] {
  const totals = new Map<string, { total: number; recalled: number }>()
  for (const d of days) {
    const items = topic ? d.items.filter((it) => it.topic === topic) : d.items
    if (items.length === 0) continue
    const week = mondayOf(d.date)
    const bucket = totals.get(week) ?? { total: 0, recalled: 0 }
    bucket.total += items.length
    bucket.recalled += items.filter((it) => it.grade === 'recalled').length
    totals.set(week, bucket)
  }

  const weeks: WeekRetention[] = []
  const seen = new Set<string>()
  for (const d of days) {
    const week = mondayOf(d.date)
    if (seen.has(week)) continue
    seen.add(week)
    const bucket = totals.get(week)
    weeks.push({
      weekStart: week,
      total: bucket?.total ?? 0,
      recalled: bucket?.recalled ?? 0,
      rate: bucket && bucket.total > 0 ? bucket.recalled / bucket.total : null,
    })
  }
  return weeks
}
