/**
 * THE REGRESSION GUARD for shared/topicMetrics.ts's central claim (see that
 * file's own header comment): computeRetentionBuckets/computeMomentum, called
 * with NO topic filter, must produce exactly what `engram.py stats` itself
 * reports under `retention.buckets`/`momentum` — because DashboardView's
 * global Coach view reads the engine's fields directly (the oracle), and this
 * file's only job is to be a faithful topic-scoped port of the SAME algorithm,
 * never a second implementation that can quietly drift.
 *
 * Also pins `topicWeekRetention(history.days)` (no topic filter) against
 * `history.weeks` — receiptsHistory.ts's OWN pre-aggregation, not engram.py
 * this time (no CLI subcommand reports a weekly rollup at all; see that
 * file's header comment). A P3 fix-wave report claimed these two were
 * byte-identical without ever running this check; they weren't (27 weeks vs.
 * 26 on real data, an extra leading week at total 0 — see topicMetrics.ts's
 * `WEEKS_BACK` doc comment for the boundary-alignment bug and its fix). This
 * check is what makes sure that claim stays true from here on rather than
 * going stale again unnoticed.
 *
 * Runs against REAL data on this machine — this install's own
 * ~/.claude/learning/receipts/*.jsonl and graphs/*.json, via the exact same
 * main-process code paths the app itself uses (readReceiptsHistory,
 * engramRead, readTopicGraph — see src/main/engramCli/). No fixtures, no
 * mocking: if engram.py and this port ever disagree on this machine's actual
 * history, this script fails exactly the way a live user's Dashboard would
 * have been wrong.
 *
 * Usage:
 *   npm run check:topic-metrics
 * (invoked as `tsx scripts/checkTopicMetricsAgreement.ts` — tsx resolves this
 * project's extensionless relative imports the way electron-vite's bundler
 * does; plain `node` cannot without them.)
 *
 * Exits non-zero and prints every mismatch on divergence; exits 0 and prints
 * a one-line summary (receipt/topic/graph counts) on agreement.
 */
import { readReceiptsHistory } from '../src/main/engramCli/receiptsHistory'
import { engramRead, readTopicGraph } from '../src/main/engramCli/readOnly'
import { computeMomentum, computeRetentionBuckets, topicWeekRetention } from '../src/renderer/src/shared/topicMetrics'
import type { EngramStats, TopicGraph, TopicListEntry } from '../src/shared/types'

/** Engine `round(x, N)` is banker's rounding; the port's is round-half-up
 * (see topicMetrics.ts's own comment at the `rate` rounding site). The two
 * can differ by at most one unit in the last rounded digit, only exactly at
 * a tie — tolerate that one ULP per decimal place, not more, so a REAL
 * divergence still fails loudly. */
function closeEnough(a: number | null, b: number | null, decimals: number): boolean {
  if (a === null || b === null) return a === b
  const ulp = 10 ** -decimals
  return Math.abs(a - b) <= ulp + 1e-9
}

async function main(): Promise<void> {
  const [history, stats, topicsList] = await Promise.all([
    readReceiptsHistory(),
    engramRead<EngramStats>('stats'),
    engramRead<TopicListEntry[]>('topics'),
  ])

  const graphs: Record<string, TopicGraph> = {}
  const graphFailures: string[] = []
  for (const t of topicsList) {
    try {
      graphs[t.topic] = (await readTopicGraph(t.topic)) as TopicGraph
    } catch (e) {
      graphFailures.push(`${t.topic}: ${(e as Error).message}`)
    }
  }
  if (graphFailures.length) {
    // Not a mismatch by itself — but momentum's most_durable/retained_total
    // are graph-state reads, and a graph this script couldn't load is one
    // engram.py's own iter_graphs() DID load (compute_stats reads the same
    // files this script does), so a real divergence downstream is expected,
    // not a bug in the port. Surface it instead of silently narrowing the
    // comparison population.
    console.warn(`WARNING: could not read ${graphFailures.length} topic graph(s), momentum comparison may be unreliable:`)
    for (const f of graphFailures) console.warn(`  - ${f}`)
  }

  const failures: string[] = []

  // ---- retention ----
  const portBuckets = computeRetentionBuckets(history.receipts)
  for (const [name, engineBucket] of Object.entries(stats.retention.buckets)) {
    const portBucket = portBuckets[name]
    if (!portBucket) {
      failures.push(`retention.${name}: port has no such bucket at all`)
      continue
    }
    for (const key of ['recalled', 'partial', 'lapsed', 'n'] as const) {
      if (portBucket[key] !== engineBucket[key]) {
        failures.push(`retention.${name}.${key}: engine=${engineBucket[key]} port=${portBucket[key]}`)
      }
    }
    if (!closeEnough(portBucket.rate, engineBucket.rate, 3)) {
      failures.push(`retention.${name}.rate: engine=${engineBucket.rate} port=${portBucket.rate}`)
    }
  }

  // ---- momentum ----
  const portMomentum = computeMomentum(history.receipts, graphs)
  const m = stats.momentum
  const scalarChecks: [string, number, number][] = [
    ['windowDays', portMomentum.windowDays, m.window_days],
    ['reviewsWindow', portMomentum.reviewsWindow, m.reviews_7d],
    ['recalledWindow', portMomentum.recalledWindow, m.recalled_7d],
    ['retainedTotal', portMomentum.retainedTotal, m.retained_total],
  ]
  for (const [label, portVal, engineVal] of scalarChecks) {
    if (portVal !== engineVal) failures.push(`momentum.${label}: engine=${engineVal} port=${portVal}`)
  }
  if (!closeEnough(portMomentum.stabilityGainedWindow, m.stability_gained_7d, 1)) {
    failures.push(`momentum.stabilityGainedWindow: engine=${m.stability_gained_7d} port=${portMomentum.stabilityGainedWindow}`)
  }
  const pd = portMomentum.mostDurable
  const ed = m.most_durable
  if ((pd === null) !== (ed === null)) {
    failures.push(`momentum.mostDurable: engine=${JSON.stringify(ed)} port=${JSON.stringify(pd)}`)
  } else if (pd && ed) {
    if (pd.node !== ed.node) failures.push(`momentum.mostDurable.node: engine=${ed.node} port=${pd.node}`)
    if (!closeEnough(pd.stabilityDays, ed.stability_days, 1)) {
      failures.push(`momentum.mostDurable.stabilityDays: engine=${ed.stability_days} port=${pd.stabilityDays}`)
    }
  }

  // ---- weekly rollup (F6) ----
  // `topicWeekRetention` derives its week list FROM `days`; `history.weeks`
  // is receiptsHistory.ts's own independent fixed-count rollup. Both must
  // report the identical set of weeks when unfiltered — length first (a
  // length mismatch would otherwise misalign every indexed comparison below
  // into a wall of spurious per-field failures for one real bug).
  const portWeeks = topicWeekRetention(history.days)
  if (portWeeks.length !== history.weeks.length) {
    failures.push(`weeks.length: engine=${history.weeks.length} port=${portWeeks.length}`)
  } else {
    for (let i = 0; i < portWeeks.length; i++) {
      const pw = portWeeks[i]
      const ew = history.weeks[i]
      if (pw.weekStart !== ew.weekStart) failures.push(`weeks[${i}].weekStart: engine=${ew.weekStart} port=${pw.weekStart}`)
      if (pw.total !== ew.total) failures.push(`weeks[${i}].total: engine=${ew.total} port=${pw.total}`)
      if (pw.recalled !== ew.recalled) failures.push(`weeks[${i}].recalled: engine=${ew.recalled} port=${pw.recalled}`)
      if (!closeEnough(pw.rate, ew.rate, 3)) failures.push(`weeks[${i}].rate: engine=${ew.rate} port=${pw.rate}`)
    }
  }

  if (failures.length > 0) {
    console.error(`FAIL — computeRetentionBuckets/computeMomentum/topicWeekRetention (unfiltered) diverge from the engine (${failures.length} mismatch(es)):`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exitCode = 1
    return
  }

  console.log('OK — computeRetentionBuckets/computeMomentum/topicWeekRetention (unfiltered) agree with the engine exactly.')
  console.log(
    `  receipts=${history.receipts.length} topics=${topicsList.length} graphs=${Object.keys(graphs).length} ` +
      `reviews_bucketed=${Object.values(stats.retention.buckets).reduce((n, b) => n + b.n, 0)} weeks=${portWeeks.length}`,
  )
}

main().catch((e) => {
  console.error('checkTopicMetricsAgreement crashed:', e)
  process.exitCode = 1
})
