import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Claude Code persists every session's full transcript as NDJSON under
 * `~/.claude/projects/<cwd with every "/" replaced by "-">/<sessionId>.jsonl`
 * (confirmed directly: SessionManager always spawns with `cwd: homedir()`, and
 * `~/.claude/projects/-Users-learner/<sessionId>.jsonl` exists and matches
 * a real recorded session id byte-for-byte). Used only to replay chat history
 * into the UI on resume — never written to, and irrelevant to Engram's own state.
 *
 * Sittings run from the terminal (`/learn` in an interactive `claude` started
 * in some other directory) land in a DIFFERENT `<flattened-cwd>` dir under the
 * same projects root — that's where pre-app learning history lives, so lookups
 * fall back to searching the sibling project dirs when the app's own dir
 * doesn't have the file (see findTranscriptPath).
 */
export function projectsRoot(): string {
  return join(homedir(), '.claude', 'projects')
}

/**
 * Claude Code's own name for a project directory: the cwd with every path
 * separator replaced by `-`. On POSIX that is just `/` -> `-`, so `/Users/x`
 * becomes `-Users-x` (verified byte-for-byte against a real recorded
 * session). Windows additionally has backslash separators and a drive-letter
 * colon, neither of which is legal in a directory name, so both are flattened
 * the same way: `C:\Users\x` -> `C--Users-x`.
 *
 * Treat this as a fast path, not a contract. The convention belongs to Claude
 * Code, not to this app, and nothing here would notice if it changed. That is
 * exactly why `findTranscriptPath` below falls back to sweeping every sibling
 * project directory for the session id — a globally unique id makes that
 * sweep correct regardless of how the directory got its name, so a wrong
 * guess here costs one `stat`, never a lost transcript.
 */
export function flattenCwd(cwd: string): string {
  return cwd.replace(/[/\\:]/g, '-')
}

export function transcriptsDir(): string {
  return join(projectsRoot(), flattenCwd(homedir()))
}

export function transcriptPath(sessionId: string): string {
  return join(transcriptsDir(), `${sessionId}.jsonl`)
}

/** The app's own dir first, then every sibling project dir — a session id is
 * globally unique, so the first hit is the transcript. Null when it's gone. */
export async function findTranscriptPath(sessionId: string): Promise<string | null> {
  const primary = transcriptPath(sessionId)
  try {
    await stat(primary)
    return primary
  } catch {
    // fall through to the sibling sweep
  }
  try {
    const entries = await readdir(projectsRoot(), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = join(projectsRoot(), entry.name, `${sessionId}.jsonl`)
      try {
        await stat(candidate)
        return candidate
      } catch {
        // not in this project dir — keep looking
      }
    }
  } catch {
    // projects root unreadable — treat as not found
  }
  return null
}

function parseNdjson(raw: string): unknown[] {
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

/** Path-based variant for callers (the provenance disk sweep) that already
 * hold an absolute transcript path outside the app's own project dir. */
export async function readTranscriptFile(path: string): Promise<unknown[]> {
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    return []
  }
  return parseNdjson(raw)
}

export async function readTranscript(sessionId: string): Promise<unknown[]> {
  const path = await findTranscriptPath(sessionId)
  if (!path) return [] // no transcript yet (brand new session id) — nothing to replay
  return readTranscriptFile(path)
}
