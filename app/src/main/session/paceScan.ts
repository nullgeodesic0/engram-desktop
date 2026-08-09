import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { isReviewRateCommand } from '../../shared/signals/tutorSignals'
import { buildPaceModel, type PaceModel, type PaceSample } from '../../shared/sittingPace'

/** Measures how long review items actually take, by walking the learner's own
 * transcripts.
 *
 * The signal is the gap between consecutive `rate` calls inside one sitting:
 * a rate call is the moment an item finishes, so the span from the previous
 * one is that item's whole cost — reading the probe, recalling, writing it
 * out, the confidence pick and the reveal. Nothing else on disk records this.
 * Receipts carry a DATE only (engram.py stamps `today().isoformat()`), so they
 * cannot tell one item from another within a day.
 *
 * READ-ONLY, and outside the learning home: transcripts are Claude Code's own
 * files, which the app already reads for history and replay. Nothing here
 * writes, and nothing here touches engram state.
 *
 * The two filters are what make the number honest rather than merely
 * available:
 *   · gaps over 20 minutes are dropped, not clamped — that is a break, and
 *     counting it would make every topic look worse the more life happened
 *     mid-sitting;
 *   · gaps under 5 seconds are dropped as batched calls rather than items,
 *     which would otherwise drag a topic's median toward zero. */

const MAX_ITEM_SECONDS = 20 * 60
const MIN_ITEM_SECONDS = 5
/** Only recent history: a pace from six months ago describes a different
 * learner. Also bounds the scan. */
const MAX_FILES = 120

const TOPIC_FLAG = /--topic\s+["']?([a-z0-9][a-z0-9-]*)/

interface Line {
  timestamp?: unknown
  message?: { content?: unknown }
}

function parseTs(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** Rate calls in one transcript, as (whenMs, topic). */
function rateEventsIn(text: string): Array<{ at: number; topic: string | null }> {
  const out: Array<{ at: number; topic: string | null }> = []
  for (const raw of text.split('\n')) {
    if (!raw) continue
    let line: Line
    try {
      line = JSON.parse(raw) as Line
    } catch {
      continue
    }
    const at = parseTs(line.timestamp)
    if (at === null) continue
    const content = line.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as { type?: unknown; name?: unknown; input?: unknown }
      if (b.type !== 'tool_use' || b.name !== 'Bash') continue
      const cmd = String((b.input as { command?: unknown } | undefined)?.command ?? '')
      if (!isReviewRateCommand(cmd)) continue
      out.push({ at, topic: TOPIC_FLAG.exec(cmd)?.[1] ?? null })
    }
  }
  return out
}

/** Samples from one transcript. The first item of a sitting is measured from
 * the transcript's own first line — that span includes the session boot, which
 * the learner also waits through, so it belongs in the estimate. */
export function samplesFromTranscript(text: string): PaceSample[] {
  const events = rateEventsIn(text)
  if (events.length === 0) return []
  const firstLine = text.slice(0, text.indexOf('\n') + 1 || undefined)
  let prev: number | null = null
  try {
    prev = parseTs((JSON.parse(firstLine) as Line).timestamp)
  } catch {
    prev = null
  }
  const out: PaceSample[] = []
  for (const e of events) {
    if (prev !== null && e.topic) {
      const seconds = (e.at - prev) / 1000
      if (seconds >= MIN_ITEM_SECONDS && seconds <= MAX_ITEM_SECONDS) {
        out.push({ topic: e.topic, seconds })
      }
    }
    prev = e.at
  }
  return out
}

let cached: { model: PaceModel; at: number } | null = null
/** Rebuilt at most once an hour: the scan reads up to 120 files, and a pace
 * that shifts within a single sitting is noise rather than news. */
const CACHE_MS = 60 * 60 * 1000

export async function measurePace(now: number = Date.now()): Promise<PaceModel> {
  if (cached && now - cached.at < CACHE_MS) return cached.model
  const model = await scan()
  cached = { model, at: now }
  return model
}

async function scan(): Promise<PaceModel> {
  const samples: PaceSample[] = []
  try {
    const root = join(homedir(), '.claude', 'projects')
    const dirs = await readdir(root, { withFileTypes: true })
    const files: Array<{ path: string; mtime: number }> = []
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      const dir = join(root, d.name)
      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch {
        continue
      }
      for (const name of entries) {
        if (!name.endsWith('.jsonl')) continue
        const path = join(dir, name)
        try {
          const s = await stat(path)
          files.push({ path, mtime: s.mtimeMs })
        } catch {
          /* a file that vanished mid-scan is not an error */
        }
      }
    }
    files.sort((a, b) => b.mtime - a.mtime)
    for (const f of files.slice(0, MAX_FILES)) {
      try {
        samples.push(...samplesFromTranscript(await readFile(f.path, 'utf-8')))
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    // No transcripts, no permission, no home — the model simply has no data
    // and every caller falls back to the historical assumption.
  }
  return buildPaceModel(samples)
}
