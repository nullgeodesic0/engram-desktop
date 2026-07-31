/**
 * Regression guard for `shared/topicGrade.ts`'s grade trend and cross-topic
 * GPA — like `checkPunctualitySanity.ts`, there is no engine-side oracle to
 * agree with (the engine has no concept of "grade" at all, let alone a
 * historical one), so this pins basic invariants against this machine's
 * real receipt history instead of a golden value.
 *
 * `allPicks()` (calibrationStore.ts) is a renderer-only, localStorage-backed
 * function and can't run in this plain Node/tsx context — every topic's
 * calibration component is computed with an empty picks array here, which
 * only ever makes it read "not enough data" (never wrong), so it doesn't
 * weaken any of the three invariants below.
 *
 * Usage: npm run check:grade-trend-sanity
 */
import { readReceiptsHistory } from '../src/main/engramCli/receiptsHistory'
import { engramRead } from '../src/main/engramCli/readOnly'
import { computeTopicGrade, computeCrossTopicGPA, computeTopicGradeTrend, weeklyTrendCutoffs, CONCEPTUAL_GRACE_DAYS } from '../src/renderer/src/shared/topicGrade'
import type { TopicListEntry, Misconception } from '../src/shared/types'

// Local-date day-diff, same read as topicGrade.ts's own daysBetween.
function daysBetweenLocal(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000)
}

function isMisconception(row: unknown): row is Misconception {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>
  return typeof r.id === 'string' && typeof r.ts === 'string' && typeof r.topic === 'string' && typeof r.node === 'string'
}

async function main(): Promise<void> {
  const [history, topics, misconceptionRows] = await Promise.all([
    readReceiptsHistory(),
    engramRead<TopicListEntry[]>('topics'),
    engramRead<unknown[]>('misconception', ['list']),
  ])
  const misconceptions = Array.isArray(misconceptionRows) ? misconceptionRows.filter(isMisconception) : []

  if (topics.length === 0) {
    console.log('OK — no topics on disk yet; nothing to check.')
    return
  }

  const cutoffs = weeklyTrendCutoffs(history.days, 12)
  const failures: string[] = []
  const summary: string[] = []

  const grades = new Map(
    topics.map((t) => [
      t.topic,
      computeTopicGrade({ receipts: history.receipts, topic: t.topic, topicEntry: t, misconceptions, days: history.days, picks: [], mode: 'total' }),
    ]),
  )

  for (const t of topics) {
    const trend = computeTopicGradeTrend({
      receipts: history.receipts,
      topic: t.topic,
      misconceptions,
      days: history.days,
      picks: [],
      cutoffs,
    })

    // (a) every score in [0,100]
    for (const point of trend) {
      if (point.result.overall.available && point.result.overall.score !== null) {
        const s = point.result.overall.score
        if (s < 0 || s > 100) failures.push(`${t.topic} @ ${point.cutoff}: overall score ${s} outside [0,100]`)
      }
      for (const [key, c] of Object.entries(point.result.components)) {
        if (c.available && c.score !== null && (c.score < 0 || c.score > 100)) {
          failures.push(`${t.topic} @ ${point.cutoff}: ${key} score ${c.score} outside [0,100]`)
        }
      }
    }

    // (b) monotonic n — a later cutoff's n per component is never less than
    // an earlier cutoff's, since filtering receipts/misconceptions/days by
    // `<= cutoff` only ever grows the population as cutoffs advance.
    for (const key of ['recall', 'punctuality', 'conceptual', 'calibration'] as const) {
      let lastN = -1
      for (const point of trend) {
        const n = point.result.components[key].n
        if (n < lastN) failures.push(`${t.topic} @ ${point.cutoff}: ${key} n=${n} regressed below prior cutoff's n=${lastN}`)
        lastN = n
      }
    }

    // (d) conceptual semantics, re-derived directly from the rows — the one
    // place the resolved_ts mapping AND the grace window are pinned against
    // an oracle: a resolution only counts from its own `resolved_ts`
    // (falling back to `ts` for hand-edited rows missing it), and an open
    // row younger than CONCEPTUAL_GRACE_DAYS as of the cutoff counts on
    // neither side. `n` must equal the graced population; the score must be
    // the resolved share of it.
    for (const point of trend) {
      const c = point.result.components.conceptual
      if (!c.available) continue
      const rows = misconceptions.filter((m) => m.topic === t.topic && m.ts <= point.cutoff)
      const isResolvedAt = (m: Misconception): boolean =>
        m.status === 'resolved' && (m.resolved_ts ?? m.ts) <= point.cutoff
      const resolvedOracle = rows.filter(isResolvedAt).length
      const agedOpenOracle = rows.filter(
        (m) => !isResolvedAt(m) && daysBetweenLocal(m.ts, point.cutoff) >= CONCEPTUAL_GRACE_DAYS,
      ).length
      if (c.n !== agedOpenOracle + resolvedOracle) {
        failures.push(`${t.topic} @ ${point.cutoff}: conceptual n=${c.n} != oracle ${agedOpenOracle + resolvedOracle}`)
      }
      const expectedScore = (resolvedOracle / (agedOpenOracle + resolvedOracle)) * 100
      if (c.score !== null && Math.abs(c.score - expectedScore) > 1e-9) {
        failures.push(`${t.topic} @ ${point.cutoff}: conceptual score ${c.score} != oracle ${expectedScore}`)
      }
    }

    summary.push(`${t.topic}: ${trend.length} cutoffs, latest overall=${trend[trend.length - 1]?.result.overall.score ?? '—'}`)
  }

  // (c) GPA's topicsCounted never exceeds the total topic count
  const gpa = computeCrossTopicGPA(topics, grades)
  if (gpa.topicsCounted > topics.length) {
    failures.push(`GPA topicsCounted (${gpa.topicsCounted}) exceeds total topics (${topics.length})`)
  }

  if (failures.length > 0) {
    console.error('FAIL — grade trend sanity check:')
    for (const f of failures) console.error(`  ${f}`)
    process.exitCode = 1
    return
  }

  console.log(`OK — grade trend + GPA sane across all topics on disk (GPA: ${gpa.available ? gpa.letter : 'n/a'}, ${gpa.topicsCounted}/${topics.length} topics counted).`)
  for (const s of summary) console.log(`  ${s}`)
}

main().catch((err) => {
  console.error('FAIL — checkGradeTrendSanity threw:', err)
  process.exitCode = 1
})
