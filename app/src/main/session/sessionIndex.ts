import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import type { SessionIndexEntry, SessionProvider } from '../../shared/types'
export type { SessionIndexEntry } from '../../shared/types'

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

export type SessionIndex = Record<string, SessionIndexEntry[]>

function defaultModel(provider: SessionProvider): string {
  return provider === 'codex' ? 'Codex default' : provider === 'opencode' ? 'OpenCode default' : 'Claude default'
}

/** Converts both the original single-row shape and the pre-provider array
 * shape into provider-safe entries. Malformed rows never become resumable. */
export function normalizeSessionIndex(raw: unknown): SessionIndex {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const index = raw as Record<string, unknown>
  const migrated: SessionIndex = {}
  for (const [key, value] of Object.entries(index)) {
    const rows = Array.isArray(value) ? value : [value]
    migrated[key] = rows.flatMap((candidate): SessionIndexEntry[] => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const row = candidate as Record<string, unknown>
      if (typeof row.sessionId !== 'string' || typeof row.key !== 'string' || typeof row.startedAt !== 'string') return []
      const provider: SessionProvider =
        row.provider === 'codex' || row.provider === 'opencode' || row.provider === 'claude' ? row.provider : 'claude'
      return [{
        sessionId: row.sessionId,
        providerSessionId: typeof row.providerSessionId === 'string' ? row.providerSessionId : row.sessionId,
        provider,
        model: typeof row.model === 'string' && row.model.trim() ? row.model : defaultModel(provider),
        key: row.key,
        startedAt: row.startedAt,
      }]
    })
  }
  return migrated
}

export function findLastSessionEntry(index: SessionIndex, key: string, provider?: SessionProvider): SessionIndexEntry | null {
  const list = index[key] ?? []
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (!provider || list[i].provider === provider) return list[i]
  }
  return null
}

async function readIndex(): Promise<SessionIndex> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(indexPath(), 'utf-8'))
  } catch {
    return {}
  }
  return normalizeSessionIndex(raw)
}

async function writeIndex(index: Record<string, SessionIndexEntry[]>): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(indexPath(), JSON.stringify(index, null, 2), 'utf-8')
}

export async function recordSession(
  key: string,
  sessionId: string,
  metadata: { provider?: SessionProvider; providerSessionId?: string; model?: string } = {},
): Promise<void> {
  const index = await readIndex()
  const list = index[key] ?? []
  const provider = metadata.provider ?? 'claude'
  list.push({
    sessionId,
    providerSessionId: metadata.providerSessionId ?? sessionId,
    provider,
    model: metadata.model?.trim() || defaultModel(provider),
    key,
    startedAt: new Date().toISOString(),
  })
  index[key] = list
  await writeIndex(index)
}

export async function lastSessionEntryFor(key: string, provider?: SessionProvider): Promise<SessionIndexEntry | null> {
  const index = await readIndex()
  return findLastSessionEntry(index, key, provider)
}

export async function lastSessionFor(key: string, provider?: SessionProvider): Promise<string | null> {
  return (await lastSessionEntryFor(key, provider))?.sessionId ?? null
}

/** Newest first — the full history for a key, for a session-history browser. */
export async function sessionHistoryFor(key: string): Promise<SessionIndexEntry[]> {
  const index = await readIndex()
  return [...(index[key] ?? [])].reverse()
}
