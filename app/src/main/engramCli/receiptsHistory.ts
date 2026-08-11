import { readdir, readFile } from 'node:fs/promises'
import { memoRead } from './readMemo'
import { join } from 'node:path'
import { engramLearningHome } from './readOnly'

interface ReceiptLine {
  id?: string
  ts?: string
  grade?: string
  topic?: string
  node?: string
  kind?: string
  rating?: string
  s_before?: number
  s_after?: number
  capstone?: boolean
  interval_days?: number
  due_next?: string
  relearn?: boolean
  source?: string
  production_truncated?: boolean
}

export interface ReceiptItem {
  topic: string
  node: string
  grade: string | null
}

export interface DayActivity {
  date: string // YYYY-MM-DD
  count: number
  items: ReceiptItem[]
}

export interface WeekRetention {
  weekStart: string // YYYY-MM-DD, Monday
  total: number
  recalled: number
  rate: number | null
}

/**
 * A receipt line carrying every field the retention-bucket / momentum
 * computations need (`shared/topicMetrics.ts`) — `kind`/`id`/`rating`/
 * `sBefore`/`sAfter` on top of the day/week aggregator's own `topic`/`node`/
 * `grade`/`ts`. Named fields, not `unknown`, so a hand-edited receipt with
 * the wrong JSON type degrades to `null` here rather than reaching the
 * renderer's grouping logic as a live grenade (same discipline engram.py's
 * own `as_number`/`safe_date` apply on the read side).
 *
 * `capstone` is carried through verbatim (coerced to a strict boolean, never
 * left `undefined`) — engram.py stamps `capstone: true` on a capstone node's
 * own receipts, and shared/topicMetrics.ts's `groupByNode` depends on it to
 * recognize a capstone's first receipt (always `kind: transfer`) as a real
 * retrieval instead of silently dropping it. Mirrored in shared/types.ts.
 */
export interface RawReceipt {
  id: string | null
  ts: string
  topic: string
  node: string
  kind: string | null
  grade: string | null
  rating: string | null
  sBefore: number | null
  sAfter: number | null
  capstone: boolean
  /** The FSRS interval (days) this receipt's own rating set — engram.py's
   * `interval_days`, present on every real receipt checked. Distinct from
   * `dueNext` below: this is the SPAN, that is the resulting DATE. */
  intervalDays: number | null
  /** The exact due-date this receipt scheduled the node's next review for —
   * engram.py's `due_next`, a local 'YYYY-MM-DD' string. Combined with the
   * NEXT receipt's own `ts` for the same node, this is what
   * `shared/topicGrade.ts`'s punctuality metric compares against — the
   * engine's own literal scheduled date, not a reconstruction from
   * `intervalDays` + an assumed anchor date. */
  dueNext: string | null
  /** engram.py's `relearn: true` retry rows (`rate --relearn --attempt N`) —
   * recorded append-only but EXCLUDED by the engine from state transitions
   * and every retention-family population. Ports that mirror engine stats
   * (retention buckets, momentum) must filter these out; day/week activity
   * keeps them (a retry is real work done that day). */
  relearn: boolean
  /** engram.py's free-text provenance field (`rate --source`, default
   * "self"; the assessor writes "assessor"; checkpoint sittings write
   * "quick-mc" — the modality stamp the whole checkpoint bargain rests on).
   * Sparse by the node_kind precedent: old or hand-edited rows may lack it,
   * and the engine itself never reads it back — NEVER assume, and never
   * treat null as "self". */
  source: string | null
  /** engram.py's own flag: this receipt's stored production was cut at
   * PRODUCTION_MAX (800 chars). The engine sets it on BOTH the stash and the
   * receipt — the cap is record-wide policy, not a stash quirk — and the app
   * only reports it. Nothing was lost from the sitting itself: the full text
   * is the learner's own message in the transcript, which History still
   * holds. */
  productionTruncated: boolean
}

export interface ReceiptsHistory {
  days: DayActivity[] // last ~180 days, every day present (0 if no activity)
  weeks: WeekRetention[] // last ~26 weeks
  // EVERY receipt ever written, across every topic — deliberately NOT windowed
  // to DAYS_BACK like `days`/`weeks` above. Retention buckets need a node's
  // FIRST-ever receipt as its day-0 anchor (engram.py's compute_retention()
  // reads collect_receipts(), which has no window either); truncating this to
  // the last 180 days would silently mis-anchor any node whose encoding
  // predates the window, corrupting every bucket downstream. See
  // `shared/topicMetrics.ts` for the one place this is consumed.
  receipts: RawReceipt[]
}

const DAYS_BACK = 180
const WEEKS_BACK = 26

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const day = d.getUTCDay() // 0 = Sunday
  const diff = (day + 6) % 7 // days since Monday
  d.setUTCDate(d.getUTCDate() - diff)
  return isoDate(d)
}

/**
 * Direct reads of `~/.claude/learning/receipts/*.jsonl` — same justification as
 * readTopicGraph reading graphs/<topic>.json directly: a documented, stable,
 * engine-owned schema, safe to read (never write) outside a live session. No
 * read-only engram.py subcommand exposes day-by-day activity, only point-in-time
 * snapshots (stats/due/decay), so this is the only way to power a streak
 * calendar or a retention trend without inventing new engine capability.
 * Aggregated here (not shipped raw) to keep the IPC payload small regardless
 * of how many receipts have accumulated.
 */
export async function readReceiptsHistory(): Promise<ReceiptsHistory> {
  // Memoised for a couple of seconds. The phone's menu asks whether each pack
  // has been graded since it was written, once per pack, and each of those
  // questions read this whole history — eleven full parses to answer one
  // menu. See readMemo.ts for why the window is short.
  return memoRead('receipts-history', readReceiptsHistoryUncached)
}

async function readReceiptsHistoryUncached(): Promise<ReceiptsHistory> {
  const home = await engramLearningHome()
  const receiptsDir = join(home, 'receipts')

  let files: string[] = []
  try {
    files = (await readdir(receiptsDir)).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return { days: [], weeks: [], receipts: [] }
  }

  const dayItems = new Map<string, ReceiptItem[]>()
  const weekTotals = new Map<string, { total: number; recalled: number }>()
  const rawReceipts: RawReceipt[] = []

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - DAYS_BACK)

  await Promise.all(
    files.map(async (file) => {
      let raw: string
      try {
        raw = await readFile(join(receiptsDir, file), 'utf-8')
      } catch {
        return
      }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        let entry: ReceiptLine
        try {
          entry = JSON.parse(line)
        } catch {
          continue
        }
        if (!entry.ts || !entry.topic || !entry.node) continue

        // Unwindowed, unlike the day/week aggregation below — see the
        // `receipts` field's own doc comment on ReceiptsHistory.
        rawReceipts.push({
          id: typeof entry.id === 'string' ? entry.id : null,
          ts: entry.ts,
          topic: entry.topic,
          node: entry.node,
          kind: typeof entry.kind === 'string' ? entry.kind : null,
          grade: entry.grade ?? null,
          rating: typeof entry.rating === 'string' ? entry.rating : null,
          sBefore: typeof entry.s_before === 'number' ? entry.s_before : null,
          sAfter: typeof entry.s_after === 'number' ? entry.s_after : null,
          capstone: entry.capstone === true,
          intervalDays: typeof entry.interval_days === 'number' ? entry.interval_days : null,
          dueNext: typeof entry.due_next === 'string' ? entry.due_next : null,
          relearn: entry.relearn === true,
          source: typeof entry.source === 'string' ? entry.source : null,
          productionTruncated: entry.production_truncated === true,
        })

        const entryDate = new Date(`${entry.ts}T00:00:00Z`)
        if (entryDate < cutoff) continue

        const items = dayItems.get(entry.ts) ?? []
        items.push({ topic: entry.topic, node: entry.node, grade: entry.grade ?? null })
        dayItems.set(entry.ts, items)

        const week = mondayOf(entry.ts)
        const bucket = weekTotals.get(week) ?? { total: 0, recalled: 0 }
        bucket.total += 1
        if (entry.grade === 'recalled') bucket.recalled += 1
        weekTotals.set(week, bucket)
      }
    }),
  )

  const days: DayActivity[] = []
  const today = new Date()
  for (let i = DAYS_BACK - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const date = isoDate(d)
    const items = dayItems.get(date) ?? []
    days.push({ date, count: items.length, items })
  }

  const weeks: WeekRetention[] = []
  for (let i = WEEKS_BACK - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i * 7)
    const weekStart = mondayOf(isoDate(d))
    const bucket = weekTotals.get(weekStart)
    weeks.push({
      weekStart,
      total: bucket?.total ?? 0,
      recalled: bucket?.recalled ?? 0,
      rate: bucket && bucket.total > 0 ? bucket.recalled / bucket.total : null,
    })
  }
  // Dedup in case the loop above produced repeated weekStarts for the same week
  const seen = new Set<string>()
  const dedupedWeeks = weeks.filter((w) => (seen.has(w.weekStart) ? false : (seen.add(w.weekStart), true)))

  return { days, weeks: dedupedWeeks, receipts: rawReceipts }
}
