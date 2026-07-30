import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import type { CrashLogEntry } from '../../shared/types'

/** Local-only crash visibility — no third-party telemetry SDK, matching the
 * app's existing no-account, everything-local posture (see Phase 3 of the
 * shippable-pass roadmap). Before this, an uncaught exception or unhandled
 * rejection in the main process had no handler at all: Electron's own
 * default either silently swallows it or crashes the process with nothing
 * written anywhere the learner could find. This gives the app a place to put
 * that error, surfaced in Settings -> Diagnostics, so "it just closed" has an
 * actual reason attached the next time it's opened. */

const MAX_ENTRIES = 200

function logPath(): string {
  return join(app.getPath('userData'), 'crash-log.jsonl')
}

function readEntries(): CrashLogEntry[] {
  try {
    const raw = readFileSync(logPath(), 'utf-8')
    return raw
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as CrashLogEntry)
  } catch {
    return []
  }
}

/** Appends one entry, then re-caps the file to the last MAX_ENTRIES — never
 * lets a crash-prone session grow this file without bound. Deliberately
 * synchronous: called from `uncaughtException`, where the process may exit
 * immediately after, so an async write could be lost. */
export function logCrash(source: CrashLogEntry['source'], err: unknown): void {
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const entry: CrashLogEntry = {
      timestamp: new Date().toISOString(),
      source,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }
    appendFileSync(logPath(), JSON.stringify(entry) + '\n', 'utf-8')
    const entries = readEntries()
    if (entries.length > MAX_ENTRIES) {
      writeFileSync(logPath(), entries.slice(-MAX_ENTRIES).map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8')
    }
  } catch {
    // Logging the crash must never itself throw — worst case, this crash
    // goes unrecorded, same as before this module existed.
  }
}

/** For Settings -> Diagnostics — most recent first. */
export function getCrashLog(): CrashLogEntry[] {
  return readEntries().reverse()
}

/** Installs the process-wide handlers — call once, at startup, before
 * anything else can throw. `uncaughtException` still exits (main-process
 * state after one is unreliable enough that continuing risks worse
 * corruption than a clean, logged exit), but now with a reason on disk
 * instead of a silent disappearance. `unhandledRejection` only logs: Node's
 * own historical leniency here is usually the right call for a promise
 * rejecting unexpectedly, and installing a handler at all already changes
 * the default from "may crash the process" (current Node versions) to
 * "stays up, but visibly" — the actual goal of this module. */
export function installGlobalErrorHandlers(): void {
  process.on('uncaughtException', (err) => {
    logCrash('uncaughtException', err)
    console.error('[engram-desktop] uncaught exception, exiting:', err)
    app.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    logCrash('unhandledRejection', reason)
    console.error('[engram-desktop] unhandled rejection:', reason)
  })
}
