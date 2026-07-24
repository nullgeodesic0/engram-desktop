import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { sessionHistoryFor } from './sessionIndex'
import { transcriptPath, readTranscript } from './transcriptReader'
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
 */

const CACHE_FILE = 'session-scan-cache.json'

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
// / ReviewSessionView.tsx) — do not "clean up" divergently from those. ----

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

function dateOf(entry: Record<string, unknown>): string {
  const ts = typeof entry.timestamp === 'string' ? entry.timestamp : ''
  return ts.slice(0, 10) || new Date().toISOString().slice(0, 10)
}

function contentBlocks(entry: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!entry || typeof entry !== 'object') return []
  const message = entry.message as Record<string, unknown> | undefined
  const content = message && Array.isArray(message.content) ? (message.content as unknown[]) : []
  return content.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
}

/**
 * Walks one transcript's parsed lines (as returned by `readTranscript` — same
 * array a resumed session replays into the UI) looking for Bash tool_use
 * blocks matching this sitting's kind, then the matching tool_result (by
 * `tool_use_id`) for the grade payload. `anchor` is that tool_result's index
 * in this array — the same indexing `session:transcript` already hands the
 * renderer, so a future "jump to this moment" feature can reuse it directly.
 */
function scanTranscriptEntries(lines: unknown[], sittingKind: 'learn' | 'review'): Omit<ScannedEvent, 'sessionId'>[] {
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
        if (sittingKind === 'learn') {
          if (looksLikeReceiptCall(input)) {
            pending.set(toolUseId, { kind: 'encode' })
          } else if (looksLikePretestRate(input)) {
            pending.set(toolUseId, { kind: 'pretest' })
          }
        } else if (looksLikeRateCall(input)) {
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

/**
 * Scans every indexed sitting for a topic (its own `learn` history plus the
 * shared `review` history) and returns each requested node's provenance.
 * Review sittings aren't topic-scoped in the index (see sessionIndex.ts), so
 * a review-kind event only counts if its node id is in `nodeIds` — the
 * caller's topic graph is the only source of that set (readHandlers.ts fetches
 * it via readTopicGraph before calling this).
 */
export async function nodeProvenance(topic: string, nodeIds: string[]): Promise<Record<string, NodeProvenance>> {
  const nodeIdSet = new Set(nodeIds)
  const cache = await readCache()
  let cacheDirty = false

  const learnSittings = await sessionHistoryFor(topic)
  const reviewSittings = await sessionHistoryFor('review')

  // A resumed session reappears in the index once per resume but shares one
  // transcript file — dedupe by sessionId so its events aren't counted twice.
  const seenSessionIds = new Set<string>()
  const jobs: { sessionId: string; sittingKind: 'learn' | 'review' }[] = []
  for (const s of learnSittings) {
    if (seenSessionIds.has(s.sessionId)) continue
    seenSessionIds.add(s.sessionId)
    jobs.push({ sessionId: s.sessionId, sittingKind: 'learn' })
  }
  for (const s of reviewSittings) {
    if (seenSessionIds.has(s.sessionId)) continue
    seenSessionIds.add(s.sessionId)
    jobs.push({ sessionId: s.sessionId, sittingKind: 'review' })
  }

  const allEvents: ScannedEvent[] = []

  for (const job of jobs) {
    const path = transcriptPath(job.sessionId)
    let mtimeMs: number
    try {
      mtimeMs = (await stat(path)).mtimeMs
    } catch {
      continue // no transcript on disk for this session id — nothing to scan
    }

    const cached = cache[path]
    let events: ScannedEvent[]
    if (cached && cached.mtimeMs === mtimeMs) {
      events = cached.events
    } else {
      const lines = await readTranscript(job.sessionId)
      events = scanTranscriptEntries(lines, job.sittingKind).map((e) => ({ ...e, sessionId: job.sessionId }))
      cache[path] = { mtimeMs, events }
      cacheDirty = true
    }
    allEvents.push(...events)
  }

  if (cacheDirty) await writeCache(cache)

  const result: Record<string, NodeProvenance> = {}
  for (const id of nodeIdSet) result[id] = { firstEncoded: null, reviews: [] }

  for (const e of allEvents) {
    if (!nodeIdSet.has(e.node)) continue
    const prov = result[e.node]
    const event: ProvenanceEvent = { sessionId: e.sessionId, date: e.date, anchor: e.anchor, kind: e.kind, grade: e.grade }
    if (e.kind === 'review') {
      prov.reviews.push(event)
    } else if (!prov.firstEncoded || event.date < prov.firstEncoded.date) {
      prov.firstEncoded = event
    }
  }

  for (const prov of Object.values(result)) {
    prov.reviews.sort((a, b) => a.date.localeCompare(b.date) || a.anchor - b.anchor)
  }

  return result
}
