import { ipcMain, type BrowserWindow } from 'electron'
import { SessionManager } from '../session/SessionManager'
import { OpencodeSessionManager } from '../session/opencodeSession'
import { CodexSessionManager } from '../session/CodexSessionManager'
import { getAuthSettings } from '../session/authSettings'
import { bridgeServer } from '../bridge/bridgeServer'
import type { BridgeAskResponse } from '../../shared/bridgeProtocol'
import type { SessionEvent } from '../../shared/sessionEvents'
import { recordSession, lastSessionEntryFor, lastSessionFor, sessionHistoryFor } from '../session/sessionIndex'
import { getTopicSettings, setTopicSettings, type TopicSettings } from '../session/topicSettings'
import { readTranscript } from '../session/transcriptReader'
import { exportSitting } from '../session/exportSitting'
import { exportMap } from '../session/exportMap'
import { backupNow, describeArchive, restoreFromArchive, pickBackupArchivePath, getBackupInfo } from '../session/backup'
import type { ExportSittingRequest, ExportSittingResult, ExportMapRequest, SessionIndexEntry, SessionProvider } from '../../shared/types'

type SessionKind = 'learn' | 'review' | 'coach'

/** The one contract both drivers satisfy — structural, not `implements`, so
 * neither class needs to import the other's module. `SessionManager` (Claude)
 * and `OpencodeSessionManager` (OpenCode + Cursor) are otherwise unrelated:
 * different child process, different wire protocol, different provider —
 * everything downstream of `startSession` below (the sessions registry, IPC,
 * the renderer, mark derivation, replay) only ever needs this much. */
interface DrivenSession {
  readonly sessionId: string
  readonly provider: SessionProvider
  readonly providerSessionId: string
  readonly model: string
  start(initialMessage: string, extraInstructions?: string): Promise<void>
  sendUserMessage(text: string): void
  sendUserMessageWhenReady(text: string): Promise<void>
  abort(): void
  shutdown?: () => Promise<void>
  on(event: 'event', listener: (event: SessionEvent) => void): unknown
}

const sessions = new Map<string, DrivenSession>()

/** True while any sitting is live.
 *
 * The pack scheduler waits on this: two sittings at once compete for the same
 * engine, and a background top-up should never be the thing that slows down a
 * learner who is actually sitting there. */
export function anySessionRunning(): boolean {
  return sessions.size > 0
}

/** Fired the moment the engine goes from "one or more sittings live" to
 * "none" — a sitting closed, or was aborted, and nothing replaced it. This is
 * what makes the pack scheduler EVENT-driven rather than poll-driven: the
 * previous design waited up to ten minutes (or six hours, under the old
 * cooldown) to notice the desk was free; this notices on the same tick the
 * desk becomes free, whether that sitting was a pack top-up itself (so the
 * NEXT under-stocked topic starts immediately, chaining sittings back-to-back
 * until every topic reaches its target) or an ordinary desk `/learn`/`/review`
 * (so the scheduler resumes exactly where an interruption paused it, rather
 * than waiting out a poll interval first). */
const idleListeners: Array<() => void> = []

/** Registers a callback for the idle transition. Not a single slot — nothing
 * stops a second subscriber existing later, and a `Set`-of-one now is cheaper
 * than a breaking change later. */
export function onIdle(fn: () => void): void {
  idleListeners.push(fn)
}

function notifyIfIdle(): void {
  if (sessions.size === 0) {
    for (const fn of idleListeners) fn()
  }
}

// Mutable rather than a captured constructor param — the tray keeps the app running
// after the window closes, so a later reopen creates a genuinely new BrowserWindow;
// event forwarding needs to follow it rather than sending into a destroyed window.
let activeWindow: BrowserWindow | null = null

/** Call again whenever the window is recreated (see main/index.ts's focusOrCreateWindow). */
export function rebindWindow(win: BrowserWindow): void {
  activeWindow = win
  bridgeServer.setWindow(win)
}

/** Combines a topic's free-text system-prompt extra with its "initial context" file
 * list (see topicSettings.ts) into one --append-system-prompt addition. File content
 * itself is never read here — the model's own Read tool (already allowlisted, see
 * permissionConfig.ts) does that, so this only needs to name the paths. */
async function buildExtraInstructions(topicId: string): Promise<string | undefined> {
  const settings = await getTopicSettings(topicId)
  const parts: string[] = []
  if (settings.systemPromptExtra.trim()) parts.push(settings.systemPromptExtra.trim())
  if (settings.contextFiles.length > 0) {
    parts.push(
      `Before teaching this topic, read these reference files for context (use the Read tool):\n${settings.contextFiles.map((p) => `- ${p}`).join('\n')}`,
    )
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

/** True while any driven session's child process is alive — the map deletes
 * entries on their 'closed' event, so size is liveness. Exported for
 * topicTrash.ts's live-session refusal gate (D2.trashGate). */
/** Kills every live tutor child. Called from `before-quit` — without this,
 * an app quit (or kill) leaves the `claude -p` children orphaned: still
 * running, still writing the session transcript, holding the session id a
 * later `--resume` needs, and talking to a bridge whose loopback server died
 * with this process (observed live, 2026-08-03: an orphan kept a sitting's
 * transcript growing for minutes after the app was gone, and the learner's
 * resume met a session still "in use"). */
export async function abortAllSessions(): Promise<void> {
  const closing = [...sessions.values()].map((manager) => {
    if (manager.shutdown) return manager.shutdown()
    manager.abort()
    return Promise.resolve()
  })
  sessions.clear()
  await Promise.all(closing)
}

export function hasLiveSessions(): boolean {
  return sessions.size > 0
}

/** Starts a session. The one place a `claude` child is created, whether the
 * caller is the renderer over IPC or main itself — the mobile drain needs to
 * start a sitting too, and a second spawn path would be a second place for the
 * session registry, the event wiring and the extra-instructions rule to drift. */
export async function startSession(
  initialMessage: string,
  kind: SessionKind,
  resumeSession?: string | SessionIndexEntry,
  topicId?: string,
  // A background kickoff (pack top-up, the phone's ASK button, the mobile
  // drain) sends one message and expects the sitting to finish the whole
  // job unattended, then get out of the way. Nothing was ever telling it to
  // get out of the way: `turn_ended` fired, the process sat there holding
  // stdin open for a reply nobody was going to send, `sessions` never
  // dropped back to zero, and `anySessionRunning()`/`notifyIfIdle()` — the
  // whole point of the event-driven scheduler — went permanently stuck
  // after the FIRST background sitting. Observed live, 2026-08-11: a
  // derivatives top-up finished, logged its receipt, and then sat resident
  // for 19+ minutes, silently refusing every later ASK tap and never
  // chaining to the next under-stocked topic. An interactive desk sitting
  // (the renderer's `session:start`) must never pass this — the learner is
  // still there to send the next turn.
  autoCloseAfterTurn = false,
): Promise<{ sessionId: string }> {
  // Provider dispatch — the only place a sitting's driver is chosen. Both
  // classes satisfy `DrivenSession` above, so nothing past this line (the
  // registry, event forwarding, resume bookkeeping) branches on which one
  // this is.
  const { authMode } = await getAuthSettings()
  const provider: SessionProvider = authMode === 'codexSubscription' ? 'codex' : authMode === 'opencodeCursor' ? 'opencode' : 'claude'
  const resumeEntry = typeof resumeSession === 'string'
    ? { sessionId: resumeSession, providerSessionId: resumeSession, provider, model: `${provider} default`, key: topicId ?? kind, startedAt: '' } satisfies SessionIndexEntry
    : resumeSession
  const manager: DrivenSession = provider === 'codex'
    ? new CodexSessionManager(kind, resumeEntry)
    : provider === 'opencode'
      ? new OpencodeSessionManager(resumeEntry?.sessionId)
      : new SessionManager(resumeEntry?.providerSessionId)
  sessions.set(manager.sessionId, manager)
  manager.on('event', (event: SessionEvent) => {
    activeWindow?.webContents.send('session:event', { sessionId: manager.sessionId, event })
    if (event.type === 'closed') {
      sessions.delete(manager.sessionId)
      notifyIfIdle()
    } else if (autoCloseAfterTurn && event.type === 'turn_ended') {
      manager.abort()
    }
  })
  // Resuming rides the prior turn's system prompt already in effect — --resume
  // doesn't accept a new one, so a topic's extra instructions (and its initial-context
  // files) only apply on a fresh start; a resumed session already read them once.
  const extraInstructions =
    !resumeEntry && topicId ? await buildExtraInstructions(topicId) : undefined
  try {
    await manager.start(initialMessage, extraInstructions)
  } catch (error) {
    // A resolver/auth/config failure can happen before a child exists and
    // therefore before any `closed` event has a chance to clean the registry.
    // Never leave that failed start occupying the global session slot.
    sessions.delete(manager.sessionId)
    manager.abort()
    notifyIfIdle()
    throw error
  }
  // A specific topic gets its own remembered session, distinct from other topics'
  // (see sessionIndex.ts) — 'review'/'coach' aren't topic-scoped, so `kind` is the key.
  await recordSession(topicId ?? kind, manager.sessionId, {
    provider: manager.provider,
    providerSessionId: manager.providerSessionId,
    model: manager.model,
  })
  return { sessionId: manager.sessionId }
}

export function registerSessionHandlers(win: BrowserWindow): void {
  rebindWindow(win)

  ipcMain.handle('session:start', (_e, initialMessage: string, kind: SessionKind, topicId?: string) =>
    startSession(initialMessage, kind, undefined, topicId),
  )

  // "Continue if there's a previous session for this key, otherwise start fresh" — one
  // call, no separate resume-vs-start branching needed at the call site.
  ipcMain.handle('session:resume', async (_e, initialMessage: string, kind: SessionKind, topicId?: string) => {
    const { authMode } = await getAuthSettings()
    const provider: SessionProvider = authMode === 'codexSubscription' ? 'codex' : authMode === 'opencodeCursor' ? 'opencode' : 'claude'
    const previous = await lastSessionEntryFor(topicId ?? kind, provider)
    return startSession(initialMessage, kind, previous ?? undefined, topicId)
  })

  ipcMain.handle('session:lastFor', async (_e, kind: SessionKind, topicId?: string) => {
    const { authMode } = await getAuthSettings()
    const provider: SessionProvider = authMode === 'codexSubscription' ? 'codex' : authMode === 'opencodeCursor' ? 'opencode' : 'claude'
    return lastSessionFor(topicId ?? kind, provider)
  })
  ipcMain.handle('session:historyFor', (_e, kind: SessionKind, topicId?: string) => sessionHistoryFor(topicId ?? kind))

  // History replay on resume — reads Claude Code's own on-disk transcript for a
  // previous session id (see transcriptReader.ts), never Engram's state.
  ipcMain.handle('session:transcript', (_e, sessionId: string) => readTranscript(sessionId))

  ipcMain.handle('topicSettings:get', (_e, topicId: string) => getTopicSettings(topicId))
  ipcMain.handle('topicSettings:set', (_e, topicId: string, settings: TopicSettings) =>
    setTopicSettings(topicId, settings),
  )

  // Informational only (see the data-layer design's direct-mutation exception) — settings
  // writes (visuals/focus/model --set/commit) are safe under engram.py's own lockfile
  // regardless; this just lets the Settings panel show a "applies on next save" notice
  // rather than silently interleaving with a live session for clarity.
  ipcMain.handle('session:anyActive', () => sessions.size > 0)

  ipcMain.handle('session:send', (_e, sessionId: string, text: string) => {
    // Ready-gated (see sendUserMessageWhenReady): fresh sessions resolve
    // readiness immediately; a just-resumed one holds the send until the
    // CLI's repair pass is done consuming its own transcript.
    return sessions.get(sessionId)?.sendUserMessageWhenReady(text)
  })

  ipcMain.handle('session:abort', (_e, sessionId: string) => {
    sessions.get(sessionId)?.abort()
    sessions.delete(sessionId)
    notifyIfIdle()
  })

  ipcMain.handle('bridge:answer', (_e, requestId: string, response: BridgeAskResponse) => {
    bridgeServer.answer(requestId, response)
  })

  // Lab-notebook export (see session/exportSitting.ts) — always targets
  // `activeWindow` rather than a captured window, same rationale as
  // `rebindWindow` above: the tray can recreate the window mid-lifetime.
  ipcMain.handle('session:export', (_e, req: ExportSittingRequest): Promise<ExportSittingResult> =>
    exportSitting(activeWindow, req),
  )

  // Map-as-plate export (see session/exportMap.ts) — same activeWindow
  // rationale as session:export above.
  ipcMain.handle('map:export', (_e, req: ExportMapRequest): Promise<ExportSittingResult> =>
    exportMap(activeWindow, req),
  )

  // Backup & restore (see session/backup.ts) — the one destructive-capable
  // flow in the app. `backup:restore` passes `sessions.size > 0` as the
  // active-session check: the exact same source of truth `session:anyActive`
  // reports above, not a re-derived one.
  ipcMain.handle('backup:now', (_e, destDir?: string) => backupNow(destDir))
  ipcMain.handle('backup:describe', (_e, archivePath: string) => describeArchive(archivePath))
  ipcMain.handle('backup:restore', (_e, archivePath: string, confirmation: string) =>
    restoreFromArchive(archivePath, confirmation, () => sessions.size > 0),
  )
  ipcMain.handle('backup:pickArchive', () => pickBackupArchivePath())
  ipcMain.handle('backup:info', () => getBackupInfo())
}
