import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Claude Code persists every session's full transcript as NDJSON under
 * `~/.claude/projects/<cwd with every "/" replaced by "-">/<sessionId>.jsonl`
 * (confirmed directly: SessionManager always spawns with `cwd: homedir()`, and
 * `~/.claude/projects/-Users-tylerhadsell/<sessionId>.jsonl` exists and matches
 * a real recorded session id byte-for-byte). Used only to replay chat history
 * into the UI on resume — never written to, and irrelevant to Engram's own state.
 */
export function transcriptPath(sessionId: string): string {
  const flattenedCwd = homedir().replace(/\//g, '-')
  return join(homedir(), '.claude', 'projects', flattenedCwd, `${sessionId}.jsonl`)
}

export async function readTranscript(sessionId: string): Promise<unknown[]> {
  let raw: string
  try {
    raw = await readFile(transcriptPath(sessionId), 'utf-8')
  } catch {
    return [] // no transcript yet (brand new session id) — nothing to replay
  }
  const lines: unknown[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      lines.push(JSON.parse(trimmed))
    } catch {
      // skip malformed line rather than fail the whole replay
    }
  }
  return lines
}
