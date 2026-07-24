import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { engramLearningHome } from './readOnly'

interface ReceiptLine {
  ts?: string
  grade?: string
  topic?: string
  node?: string
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

export interface ReceiptsHistory {
  days: DayActivity[] // last ~180 days, every day present (0 if no activity)
  weeks: WeekRetention[] // last ~26 weeks
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
  const home = await engramLearningHome()
  const receiptsDir = join(home, 'receipts')

  let files: string[] = []
  try {
    files = (await readdir(receiptsDir)).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return { days: [], weeks: [] }
  }

  const dayItems = new Map<string, ReceiptItem[]>()
  const weekTotals = new Map<string, { total: number; recalled: number }>()

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

  return { days, weeks: dedupedWeeks }
}
