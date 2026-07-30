/**
 * Regression guard for `shared/topicGrade.ts`'s punctuality metric — the one
 * Grades component with no engine-side oracle to agree with (unlike
 * `check:topic-metrics`, which pins a port of engram.py's OWN algorithm).
 * There is no `engram.py compute_punctuality` to compare against; this
 * script instead pins basic invariants against this machine's real receipt
 * history, so a later edit to the gap-computation logic can't silently break
 * it unnoticed. Optional sixth check, not part of the standing five gates.
 *
 * Usage: npm run check:punctuality-sanity
 * (invoked as `tsx scripts/checkPunctualitySanity.ts`)
 */
import { readReceiptsHistory } from '../src/main/engramCli/receiptsHistory'
import { computeTopicPunctuality } from '../src/renderer/src/shared/topicGrade'

// A median lateness outside this range on real data would mean either a
// date-math bug or a genuinely pathological schedule — either way, worth
// failing loudly rather than silently accepting.
const PLAUSIBLE_DAYS_RANGE = 120

async function main(): Promise<void> {
  const history = await readReceiptsHistory()
  const topics = [...new Set(history.receipts.map((r) => r.topic))]

  if (topics.length === 0) {
    console.log('OK — no receipts on disk yet; nothing to check.')
    return
  }

  const failures: string[] = []
  const summary: string[] = []

  for (const topic of topics) {
    const result = computeTopicPunctuality(history.receipts, topic)
    if (result.n < 0) failures.push(`${topic}: negative n (${result.n})`)
    if (result.medianDaysLate !== null && Math.abs(result.medianDaysLate) > PLAUSIBLE_DAYS_RANGE) {
      failures.push(`${topic}: median ${result.medianDaysLate}d outside plausible range (±${PLAUSIBLE_DAYS_RANGE}d)`)
    }
    summary.push(`${topic}: n=${result.n} median=${result.medianDaysLate ?? '—'}`)
  }

  if (failures.length > 0) {
    console.error('FAIL — punctuality sanity check:')
    for (const f of failures) console.error(`  ${f}`)
    process.exitCode = 1
    return
  }

  console.log('OK — punctuality metric sane across all topics on disk.')
  for (const s of summary) console.log(`  ${s}`)
}

main().catch((err) => {
  console.error('FAIL — checkPunctualitySanity threw:', err)
  process.exitCode = 1
})
