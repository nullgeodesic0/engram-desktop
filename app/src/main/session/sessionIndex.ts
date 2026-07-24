import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'

export interface SessionIndexEntry {
  sessionId: string
  key: string
  startedAt: string
}

/**
 * Remembers `{key -> session_id[]}` across app restarts — an append-only history,
 * not just the latest, so past sessions can actually be browsed (see
 * `sessionHistoryFor`) rather than being silently discarded on the next
 * `recordSession()` call the way the original single-entry version did. This is
 * a UI convenience index, not a copy of Engram state (engram.py's own files
 * remain the only source of truth for topic/node/receipt data) — losing this
 * file just means resume/history forgets past session ids, nothing more.
 *
 * `key` is either a session kind ('review', 'coach' — those aren't topic-scoped)
 * or a specific topic id (for 'learn' — each topic remembers its own history).
 */
function indexPath(): string {
  return join(app.getPath('userData'), 'session-index.json')
}

async function readIndex(): Promise<Record<string, SessionIndexEntry[]>> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(indexPath(), 'utf-8'))
  } catch {
    return {}
  }
  // One-time migration from the original single-entry-per-key shape.
  const index = raw as Record<string, SessionIndexEntry[] | SessionIndexEntry>
  const migrated: Record<string, SessionIndexEntry[]> = {}
  for (const [key, value] of Object.entries(index)) {
    migrated[key] = Array.isArray(value) ? value : [value]
  }
  return migrated
}

async function writeIndex(index: Record<string, SessionIndexEntry[]>): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(indexPath(), JSON.stringify(index, null, 2), 'utf-8')
}

export async function recordSession(key: string, sessionId: string): Promise<void> {
  const index = await readIndex()
  const list = index[key] ?? []
  list.push({ sessionId, key, startedAt: new Date().toISOString() })
  index[key] = list
  await writeIndex(index)
}

export async function lastSessionFor(key: string): Promise<string | null> {
  const index = await readIndex()
  const list = index[key] ?? []
  return list.length > 0 ? list[list.length - 1].sessionId : null
}

/** Newest first — the full history for a key, for a session-history browser. */
export async function sessionHistoryFor(key: string): Promise<SessionIndexEntry[]> {
  const index = await readIndex()
  return [...(index[key] ?? [])].reverse()
}
