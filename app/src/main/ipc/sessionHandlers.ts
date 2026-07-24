import { ipcMain, type BrowserWindow } from 'electron'
import { SessionManager } from '../session/SessionManager'
import { bridgeServer } from '../bridge/bridgeServer'
import type { BridgeAskResponse } from '../../shared/bridgeProtocol'
import type { SessionEvent } from '../../shared/sessionEvents'
import { recordSession, lastSessionFor, sessionHistoryFor } from '../session/sessionIndex'
import { getTopicSettings, setTopicSettings, type TopicSettings } from '../session/topicSettings'
import { readTranscript } from '../session/transcriptReader'

type SessionKind = 'learn' | 'review' | 'coach'

const sessions = new Map<string, SessionManager>()

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

export function registerSessionHandlers(win: BrowserWindow): void {
  rebindWindow(win)

  async function spawn(initialMessage: string, kind: SessionKind, resumeSessionId?: string, topicId?: string) {
    const manager = new SessionManager(resumeSessionId)
    sessions.set(manager.sessionId, manager)
    manager.on('event', (event: SessionEvent) => {
      activeWindow?.webContents.send('session:event', { sessionId: manager.sessionId, event })
      if (event.type === 'closed') sessions.delete(manager.sessionId)
    })
    // Resuming rides the prior turn's system prompt already in effect — --resume
    // doesn't accept a new one, so a topic's extra instructions (and its initial-context
    // files) only apply on a fresh start; a resumed session already read them once.
    const extraInstructions =
      !resumeSessionId && topicId ? await buildExtraInstructions(topicId) : undefined
    await manager.start(initialMessage, extraInstructions)
    // A specific topic gets its own remembered session, distinct from other topics'
    // (see sessionIndex.ts) — 'review'/'coach' aren't topic-scoped, so `kind` is the key.
    await recordSession(topicId ?? kind, manager.sessionId)
    return { sessionId: manager.sessionId }
  }

  ipcMain.handle('session:start', (_e, initialMessage: string, kind: SessionKind, topicId?: string) =>
    spawn(initialMessage, kind, undefined, topicId),
  )

  // "Continue if there's a previous session for this key, otherwise start fresh" — one
  // call, no separate resume-vs-start branching needed at the call site.
  ipcMain.handle('session:resume', async (_e, initialMessage: string, kind: SessionKind, topicId?: string) => {
    const previous = await lastSessionFor(topicId ?? kind)
    return spawn(initialMessage, kind, previous ?? undefined, topicId)
  })

  ipcMain.handle('session:lastFor', (_e, kind: SessionKind, topicId?: string) => lastSessionFor(topicId ?? kind))
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
    sessions.get(sessionId)?.sendUserMessage(text)
  })

  ipcMain.handle('session:abort', (_e, sessionId: string) => {
    sessions.get(sessionId)?.abort()
    sessions.delete(sessionId)
  })

  ipcMain.handle('bridge:answer', (_e, requestId: string, response: BridgeAskResponse) => {
    bridgeServer.answer(requestId, response)
  })
}
