import { app } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises'
import { sessionHistoryFor } from './sessionIndex'
import { transcriptPath, projectsRoot, readTranscriptFile } from './transcriptReader'
import { parseGradeResult, parseGradeResults } from '../../shared/gradeResult'
import type { NodeProvenance, ProvenanceEvent } from '../../shared/types'

/**
 * Recovers a topic's node provenance (first-encoded moment + every review)
 * directly from Claude Code's own transcript files — never from engram.py's
 * state (that only knows the *current* FSRS numbers, not *when* or *in which
 * session* a node was first grasped). Read-only toward transcripts and
 * `~/.claude/learning`; the only write is this module's own mtime cache.
 *
 * Detection mirrors the renderer's live-session detectors byte-for-byte
 * (LearnSessionView's looksLikeReceiptCall/looksLikePretestRate,
 * ReviewSessionView's looksLikeRateCall) — a transcript is just the same
 * Bash tool_use/tool_result pairs those detectors already watch live, replayed
 * after the fact. Kept as a separate copy (not a shared import) because the
 * renderer copies are UI-adjacent (closures over refs/state setters) and this
 * one runs in the main process over a flat entry array — forking the *logic*
 * would be the real risk, so the match patterns themselves are copied verbatim.
 *
 * Coverage has three layers, all feeding the same detector/cache machinery:
 *  1. The session index's per-topic `learn` key + shared `review` key (the
 *     common case — every sitting since per-topic keying existed).
 *  2. The index's legacy `learn` key — early sittings recorded before topics
 *     got their own key (see sessionIndex.ts's migration note). Not
 *     topic-scoped, so attribution falls back to node-set membership, same
 *     mechanism as `review`.
 *  3. A disk sweep of the transcripts directory for `.jsonl` files that
 *     aren't referenced by *any* index entry at all — sittings that predate
 *     the index entirely. Also attributed by node-set membership, and
 *     size-guarded (see MAX_SWEEP_FILE_BYTES) since that directory also holds
 *     the user's unrelated interactive dev-session transcripts, which can be
 *     enormous and constantly mutating.
 */

const CACHE_FILE = 'session-scan-cache.json'

// Engram sittings are small (hundreds of KB to a couple MB even for long
// ones — see the real transcripts this was tuned against). This guards the
// disk sweep against the user's own huge interactive dev-session transcripts
// living in the same directory (one on the dev machine this was built on is
// 100+ MB and grows live) — parsing those on every scan would be slow and
// their cache entries would thrash on every mtime change. Sweep-only: index
// (id-known) sittings are trusted regardless of size, matching what
// `session:transcript` already replays in full for the chat UI.
const MAX_SWEEP_FILE_BYTES = 25 * 1024 * 1024

interface ScannedEvent {
  node: string
  sessionId: string
  date: string
  anchor: number
  kind: 'encode' | 'pretest' | 'review'
  grade: string | null
}

interface CacheEntry {
  mtimeMs: number
  events: ScannedEvent[]
}

type ScanCache = Record<string, CacheEntry>

function cachePath(): string {
  return join(app.getPath('userData'), CACHE_FILE)
}

async function readCache(): Promise<ScanCache> {
  try {
    return JSON.parse(await readFile(cachePath(), 'utf-8'))
  } catch {
    return {}
  }
}

async function writeCache(cache: ScanCache): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(cachePath(), JSON.stringify(cache), 'utf-8')
}

// ---- Detectors, copied verbatim from the renderer (see LearnSessionView.tsx
// / ReviewSessionView.tsx) — do not "clean up" divergently from those. Only a
// genuine Bash tool_use whose `input.command` matches one of these counts —
// text that merely *quotes* a receipt/rate-looking command (e.g. in a
// tool_result, or in prose) never reaches this check, because the pending-map
// lookup below is keyed off `tool_use_id`s these functions actually matched,
// never off free text. That's what keeps the disk sweep (which walks
// arbitrary dev-session transcripts) from misattributing a session that
// merely discusses or displays engram commands. ----

function looksLikeReceiptCall(input: Record<string, unknown>): boolean {
  const command = String(input.command ?? '')
  return command.includes('receipt') && command.includes('--file')
}

function looksLikePretestRate(input: Record<string, unknown>): string | null {
  const command = String(input.command ?? '')
  if (!command.includes(' rate ') || !command.includes('--kind pretest')) return null
  const m = command.match(/--node\s+"?([^"\s]+)"?/)
  return m ? m[1] : null
}

function looksLikeRateCall(input: Record<string, unknown>): boolean {
  const command = String(input.command ?? '')
  return command.includes(' rate ') && command.includes('--rating')
}

// Local calendar date, zero-padded — never `toISOString().slice(0, 10)`, which
// silently reports UTC and misdates evening-Pacific sittings by a day (see
// CalibrationScatter.tsx's same convention). `Date` parses the transcript
// entry's ISO timestamp fine; only the *formatting* step needs to stay local.
function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateOf(entry: Record<string, unknown>): string {
  const ts = typeof entry.timestamp === 'string' ? entry.timestamp : ''
  const parsed = ts ? new Date(ts) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? localDate(parsed) : localDate(new Date())
}

function contentBlocks(entry: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!entry || typeof entry !== 'object') return []
  const message = entry.message as Record<string, unknown> | undefined
  const content = message && Array.isArray(message.content) ? (message.content as unknown[]) : []
  return content.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
}

type SittingKind = 'learn' | 'review' | 'homework' | 'sweep'

/**
 * Walks one transcript's parsed lines (as returned by `readTranscript` — same
 * array a resumed session replays into the UI) looking for Bash tool_use
 * blocks matching this sitting's kind, then the matching tool_result (by
 * `tool_use_id`) for the grade payload. `anchor` is that tool_result's index
 * in this array — the same indexing `session:transcript` already hands the
 * renderer, so a future "jump to this moment" feature can reuse it directly.
 *
 * `sittingKind === 'sweep'` is for transcripts of unknown provenance (the
 * disk-sweep fallback, see `nodeProvenance`) — since we don't know whether
 * the sitting was a learn or review session, it checks every detector rather
 * than gating by kind. The final topic filter in `nodeProvenance` (node id
 * membership) is what actually keeps unrelated sittings from contributing.
 */
function scanTranscriptEntries(lines: unknown[], sittingKind: SittingKind): Omit<ScannedEvent, 'sessionId'>[] {
  const events: Omit<ScannedEvent, 'sessionId'>[] = []
  const pending = new Map<string, { kind: 'encode' | 'pretest' | 'review' }>()

  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i] as Record<string, unknown> | null
    if (!entry || typeof entry !== 'object') continue

    if (entry.type === 'assistant') {
      for (const block of contentBlocks(entry)) {
        if (block.type !== 'tool_use' || block.name !== 'Bash') continue
        const toolUseId = typeof block.id === 'string' ? block.id : null
        if (!toolUseId) continue
        const input = (block.input ?? {}) as Record<string, unknown>

        if (sittingKind === 'learn' || sittingKind === 'sweep') {
          if (looksLikeReceiptCall(input)) {
            pending.set(toolUseId, { kind: 'encode' })
            continue
          }
          if (looksLikePretestRate(input)) {
            pending.set(toolUseId, { kind: 'pretest' })
            continue
          }
        }
        if ((sittingKind === 'review' || sittingKind === 'sweep') && looksLikeRateCall(input)) {
          pending.set(toolUseId, { kind: 'review' })
        }
      }
      continue
    }

    if (entry.type === 'user') {
      for (const block of contentBlocks(entry)) {
        if (block.type !== 'tool_result') continue
        const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null
        if (!toolUseId) continue
        const match = pending.get(toolUseId)
        if (!match) continue
        pending.delete(toolUseId)
        const date = dateOf(entry)

        if (match.kind === 'encode') {
          for (const r of parseGradeResults(block.content)) {
            events.push({ node: r.node, date, anchor: i, kind: 'encode', grade: r.grade })
          }
        } else {
          const r = parseGradeResult(block.content)
          if (r) events.push({ node: r.node, date, anchor: i, kind: match.kind, grade: r.grade })
        }
      }
    }
  }

  return events
}

/** Reads (cache-first) and detects events for one transcript by session id.
 * Returns null if the file doesn't exist or (sweep only) exceeds the size
 * guard — in both cases there's simply nothing to contribute. */
async function scanOne(
  path: string,
  sessionId: string,
  sittingKind: SittingKind,
  cache: ScanCache,
  maxBytes: number | null,
): Promise<{ events: ScannedEvent[]; dirty: boolean } | null> {
  let fileStat: { mtimeMs: number; size: number }
  try {
    fileStat = await stat(path)
  } catch {
    return null
  }
  if (maxBytes != null && fileStat.size > maxBytes) return null

  const cached = cache[path]
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return { events: cached.events, dirty: false }
  }

  const lines = await readTranscriptFile(path)
  const events = scanTranscriptEntries(lines, sittingKind).map((e) => ({ ...e, sessionId }))
  cache[path] = { mtimeMs: fileStat.mtimeMs, events }
  return { events, dirty: true }
}

/** Every `.jsonl` under EVERY project dir in `~/.claude/projects` — not just
 * the app's own dir. Terminal-run sittings (interactive `claude` started in
 * some other working directory) transcribe into their own `<flattened-cwd>`
 * dirs, and that's exactly where pre-app learning history lives. Returned as
 * absolute paths with the session id (basename); the caller filters against
 * ids already covered by the index. */
async function allSweepTranscripts(): Promise<{ path: string; sessionId: string }[]> {
  const out: { path: string; sessionId: string }[] = []
  try {
    const dirs = await readdir(projectsRoot(), { withFileTypes: true })
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue
      const dirPath = join(projectsRoot(), dir.name)
      let files: string[]
      try {
        files = await readdir(dirPath)
      } catch {
        continue
      }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue
        out.push({ path: join(dirPath, f), sessionId: f.slice(0, -'.jsonl'.length) })
      }
    }
  } catch {
    // projects root unreadable — sweep contributes nothing
  }
  return out
}

/**
 * Scans every indexed sitting for a topic (its own `learn` history, the
 * legacy shared `learn` key, and the shared `review` key) plus a disk-sweep
 * fallback for transcripts the index doesn't reference at all, and returns
 * each requested node's provenance. Only the per-topic `learn` key is
 * inherently topic-scoped — everything else (legacy `learn`, `review`, sweep)
 * is attributed to this topic purely by whether the parsed node id is in
 * `nodeIds` (the caller's topic graph is the only source of that set;
 * readHandlers.ts fetches it via readTopicGraph before calling this).
 */
export async function nodeProvenance(topic: string, nodeIds: string[]): Promise<Record<string, NodeProvenance>> {
  const nodeIdSet = new Set(nodeIds)
  const cache = await readCache()
  let cacheDirty = false

  const learnSittings = await sessionHistoryFor(topic)
  const legacyLearnSittings = await sessionHistoryFor('learn')
  const reviewSittings = await sessionHistoryFor('review')
  const homeworkSittings = await sessionHistoryFor('homework')

  // A resumed session reappears in the index once per resume but shares one
  // transcript file — dedupe by sessionId so its events aren't counted twice
  // (also doubles as the "already covered by the index" set for the sweep below).
  const seenSessionIds = new Set<string>()
  const jobs: { sessionId: string; sittingKind: SittingKind }[] = []
  for (const s of learnSittings) {
    if (seenSessionIds.has(s.sessionId)) continue
    seenSessionIds.add(s.sessionId)
    jobs.push({ sessionId: s.sessionId, sittingKind: 'learn' })
  }
  for (const s of legacyLearnSittings) {
    if (seenSessionIds.has(s.sessionId)) continue
    seenSessionIds.add(s.sessionId)
    jobs.push({ sessionId: s.sessionId, sittingKind: 'learn' })
  }
  for (const s of reviewSittings) {
    if (seenSessionIds.has(s.sessionId)) continue
    seenSessionIds.add(s.sessionId)
    jobs.push({ sessionId: s.sessionId, sittingKind: 'review' })
  }
  // Homework sittings (Course Automation H2) — FR-drill receipts made inside
  // them attribute to provenance exactly like review ones; the scanners
  // inside are kind-agnostic, only this enumeration gates.
  for (const s of homeworkSittings) {
    if (seenSessionIds.has(s.sessionId)) continue
    seenSessionIds.add(s.sessionId)
    jobs.push({ sessionId: s.sessionId, sittingKind: 'homework' })
  }

  const allEvents: ScannedEvent[] = []

  for (const job of jobs) {
    const res = await scanOne(transcriptPath(job.sessionId), job.sessionId, job.sittingKind, cache, null)
    if (!res) continue
    if (res.dirty) cacheDirty = true
    allEvents.push(...res.events)
  }

  // Disk sweep — pick up sittings from before the index existed at all (see
  // module doc, layer 3), across EVERY project dir (terminal-run sittings
  // transcribe under their own cwd's dir). Every id already covered by an
  // index entry above is skipped; what's left is scanned with both detector
  // sets (sittingKind 'sweep') and size-guarded.
  for (const t of await allSweepTranscripts()) {
    if (seenSessionIds.has(t.sessionId)) continue
    seenSessionIds.add(t.sessionId)
    const res = await scanOne(t.path, t.sessionId, 'sweep', cache, MAX_SWEEP_FILE_BYTES)
    if (!res) continue
    if (res.dirty) cacheDirty = true
    allEvents.push(...res.events)
  }

  // Prune rows for transcripts that no longer exist (topic/session deleted,
  // or `~/.claude/projects` cleared) — otherwise the cache only ever grows.
  // A cheap sync existsSync pass, not another stat() round-trip per path.
  for (const path of Object.keys(cache)) {
    if (!existsSync(path)) {
      delete cache[path]
      cacheDirty = true
    }
  }

  if (cacheDirty) await writeCache(cache)

  const result: Record<string, NodeProvenance> = {}
  const encodeCandidatesByNode = new Map<string, ProvenanceEvent[]>()
  for (const id of nodeIdSet) result[id] = { firstEncoded: null, reviews: [] }

  for (const e of allEvents) {
    if (!nodeIdSet.has(e.node)) continue
    const prov = result[e.node]
    const event: ProvenanceEvent = { sessionId: e.sessionId, date: e.date, anchor: e.anchor, kind: e.kind, grade: e.grade }
    if (e.kind === 'review') {
      prov.reviews.push(event)
    } else {
      const candidates = encodeCandidatesByNode.get(e.node) ?? []
      candidates.push(event)
      encodeCandidatesByNode.set(e.node, candidates)
    }
  }

  // firstEncoded must be the globally-earliest encode/pretest across all three
  // sources (index, legacy key, sweep) — those aren't processed in a single
  // guaranteed chronological order (the sweep in particular walks directory
  // listing order, not time order), so this sorts explicitly by date rather
  // than relying on processing order. `date` is only day-granular; same-day
  // ties keep whichever was encountered first in `allEvents` (stable sort),
  // which is an acceptable, deterministic tie-break rather than a meaningful
  // sub-day ordering.
  for (const [node, candidates] of encodeCandidatesByNode) {
    candidates.sort((a, b) => a.date.localeCompare(b.date))
    result[node].firstEncoded = candidates[0]
  }

  for (const prov of Object.values(result)) {
    // Newest first — a review's date is day-granular, so ties break on anchor
    // descending (later tool_result in the same/latest transcript sorts first).
    prov.reviews.sort((a, b) => b.date.localeCompare(a.date) || b.anchor - a.anchor)
  }

  return result
}
