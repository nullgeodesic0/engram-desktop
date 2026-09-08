import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { AuthSettings, SessionIndexEntry, SessionProvider } from '../../shared/types'
import type { SessionEvent } from '../../shared/sessionEvents'
import { bridgeServer } from '../bridge/bridgeServer'
import { ensurePython3Shim } from '../engramCli/pythonShim'
import { engramLearningHome } from '../engramCli/readOnly'
import { getAuthSettings } from './authSettings'
import {
  assertCodexSubscriptionAccount,
  launchCodexAppServer,
  type CodexAccountResponse,
  type CodexWireMessage,
} from './codexAppServerClient'
import { buildCodexSessionEnv } from './codexEnv'
import { mapCodexNotification } from './codexEvents'
import { buildCodexThreadSetup } from './codexPermissions'
import { resolveCodexBinary } from './codexResolver'
import { CodexTranscriptStore, codexTranscriptLine, type CodexTranscriptEvent } from './codexTranscript'
import { resolveEngramPlugin, type ResolvedPlugin } from './pluginResolver'
import { resolveBridgeWorkerPath } from './permissionConfig'

const STALL_THRESHOLD_MS = 90_000
const INTERRUPT_DEADLINE_MS = 1_500

interface CodexClientLike extends EventEmitter {
  initialize(): Promise<void>
  request<T>(method: string, params?: unknown): Promise<T>
  respondError(id: number | string, message: string): void
  close(): void
}

interface BridgeLike {
  start(): Promise<number>
  dropSession(sessionId: string): void
}

export interface CodexSessionDependencies {
  resolvePlugin: () => ResolvedPlugin
  bridge: BridgeLike
  resolveBinary: () => Promise<string>
  launchClient: (binary: string, options: { cwd?: string; env?: NodeJS.ProcessEnv }) => CodexClientLike
  getSettings: () => Promise<AuthSettings>
  ensurePythonShim: () => Promise<string | null>
  learningHome: () => Promise<string>
  transcriptRoot: () => string
  bridgeWorkerPath: () => string
  electronPath: string
  environment: NodeJS.ProcessEnv
  homeDirectory: string
  interruptDeadlineMs?: number
}

function defaultDependencies(): CodexSessionDependencies {
  return {
    resolvePlugin: resolveEngramPlugin,
    bridge: bridgeServer,
    resolveBinary: resolveCodexBinary,
    launchClient: (binary, options) => launchCodexAppServer(binary, options),
    getSettings: getAuthSettings,
    ensurePythonShim: ensurePython3Shim,
    learningHome: engramLearningHome,
    transcriptRoot: () => join(app.getPath('userData'), 'codex-transcripts'),
    bridgeWorkerPath: resolveBridgeWorkerPath,
    electronPath: process.execPath,
    environment: process.env,
    homeDirectory: homedir(),
  }
}

/** Drives a persistent Codex app-server thread while exposing precisely the
 * same session contract as the existing Claude driver. Provider details stop
 * here; the bridge, renderer, replay, exports, and Engram engine remain shared. */
export class CodexSessionManager extends EventEmitter {
  readonly sessionId: string
  readonly provider: SessionProvider = 'codex'
  providerSessionId: string
  model: string

  private readonly isResume: boolean
  private client: CodexClientLike | null = null
  private threadId: string | null = null
  private activeTurnId: string | null = null
  private pluginRoot = ''
  private learningRoot = ''
  private ended = false
  private turnOutstanding = false
  private lastAgentItemId: string | null = null
  private stallTimer: ReturnType<typeof setTimeout> | null = null
  private transcript: CodexTranscriptStore
  private ready: Promise<void>
  private readyResolve!: () => void
  private shutdownPromise: Promise<void> | null = null

  constructor(
    private readonly kind: 'learn' | 'review' | 'coach',
    resumeEntry?: SessionIndexEntry,
    private readonly deps: CodexSessionDependencies = defaultDependencies(),
  ) {
    super()
    if (resumeEntry && resumeEntry.provider !== 'codex') throw new Error('Cannot resume a non-Codex conversation with Codex')
    this.sessionId = resumeEntry?.sessionId ?? randomUUID()
    this.providerSessionId = resumeEntry?.providerSessionId ?? ''
    this.model = resumeEntry?.model ?? 'Codex default'
    this.isResume = Boolean(resumeEntry)
    this.transcript = new CodexTranscriptStore(deps.transcriptRoot(), this.sessionId)
    this.ready = new Promise((resolve) => { this.readyResolve = resolve })
  }

  async start(initialMessage: string, extraInstructions?: string): Promise<void> {
    const plugin = this.deps.resolvePlugin()
    this.pluginRoot = plugin.root
    const [bridgePort, binary, settings, shimDir, learningRoot] = await Promise.all([
      this.deps.bridge.start(),
      this.deps.resolveBinary(),
      this.deps.getSettings(),
      this.deps.ensurePythonShim(),
      this.deps.learningHome(),
    ])
    this.learningRoot = learningRoot
    const selectedModel = settings.codexModel.trim()
    this.model = selectedModel || 'Codex default'
    const env = buildCodexSessionEnv(this.deps.environment, plugin.root, shimDir)
    this.client = this.deps.launchClient(binary, { cwd: this.deps.homeDirectory, env })
    this.client.on('notification', (message: CodexWireMessage) => this.handleNotification(message))
    this.client.on('request', (message: CodexWireMessage) => {
      if (message.id !== undefined) this.client?.respondError(message.id, `Unsupported Codex server request: ${message.method ?? 'unknown'}`)
    })
    this.client.on('closed', (details: { code?: number | null; error?: Error }) => this.handleClose(details.code ?? null, details.error))

    try {
      await this.client.initialize()
      const account = await this.client.request<CodexAccountResponse>('account/read', { refreshToken: false })
      assertCodexSubscriptionAccount(account)
      const setup = buildCodexThreadSetup({
        bridgePort,
        sessionId: this.sessionId,
        workerPath: this.deps.bridgeWorkerPath(),
        engramRoot: plugin.root,
        electronPath: this.deps.electronPath,
        extraInstructions,
      })
      const common = {
        ...(selectedModel ? { model: selectedModel } : {}),
        modelProvider: 'openai',
        cwd: this.deps.homeDirectory,
        approvalPolicy: 'never',
        sandbox: 'workspace-write',
        config: setup.config,
        serviceName: 'engram_desktop',
        developerInstructions: setup.developerInstructions,
      }
      const response = this.isResume
        ? await this.client.request<{ thread: { id: string; model?: string } }>('thread/resume', {
            threadId: this.providerSessionId,
            ...common,
          })
        : await this.client.request<{ thread: { id: string; model?: string } }>('thread/start', common)
      this.threadId = response.thread.id
      this.providerSessionId = response.thread.id
      this.model = response.thread.model || this.model
      this.readyResolve()
      if (!this.isResume) await this.startTurn(initialMessage, true)
    } catch (error) {
      this.client.close()
      this.deps.bridge.dropSession(this.sessionId)
      throw error
    }
  }

  sendUserMessage(text: string): void {
    void this.startTurn(text, false).catch((error) => {
      this.emitEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      this.turnOutstanding = false
      this.clearStallTimer()
    })
  }

  async sendUserMessageWhenReady(text: string): Promise<void> {
    await Promise.race([this.ready, new Promise((resolve) => setTimeout(resolve, 10_000))])
    await this.startTurn(text, false)
  }

  abort(): void {
    void this.shutdown()
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    if (this.ended) return Promise.resolve()
    this.ended = true
    this.clearStallTimer()
    const client = this.client
    const turnId = this.activeTurnId
    this.shutdownPromise = (async () => {
      if (client && turnId && this.threadId) {
        let deadline: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          client.request('turn/interrupt', { threadId: this.threadId, turnId }).catch(() => {}),
          new Promise<void>((resolve) => {
            deadline = setTimeout(resolve, this.deps.interruptDeadlineMs ?? INTERRUPT_DEADLINE_MS)
          }),
        ])
        if (deadline) clearTimeout(deadline)
      }
      client?.close()
      await this.transcript.flush().catch(() => {})
    })()
    this.deps.bridge.dropSession(this.sessionId)
    return this.shutdownPromise
  }

  private async startTurn(text: string, includeSkill: boolean): Promise<void> {
    if (!this.client || !this.threadId || this.ended) return
    const input: Array<Record<string, unknown>> = [{ type: 'text', text, text_elements: [] }]
    if (includeSkill) input.push({ type: 'skill', name: this.kind, path: join(this.pluginRoot, 'skills', this.kind, 'SKILL.md') })
    await this.appendTranscript({ type: 'user_text', text })
    this.turnOutstanding = true
    this.armStallTimer()
    const result = await this.client.request<{ turn: { id: string } }>('turn/start', {
      threadId: this.threadId,
      input,
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [this.learningRoot],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      ...(this.model !== 'Codex default' ? { model: this.model } : {}),
    })
    this.activeTurnId = result.turn.id
  }

  private handleNotification(message: CodexWireMessage): void {
    if (!this.threadId) return
    this.armStallTimer()
    const mapped = mapCodexNotification(this.threadId, message)
    for (const transcriptEvent of mapped.transcript) void this.appendTranscript(transcriptEvent)
    for (const event of mapped.events) {
      if (event.type === 'text' && event.append) {
        const sameItem = Boolean(event.itemId) && event.itemId === this.lastAgentItemId
        this.lastAgentItemId = event.itemId ?? null
        event.append = sameItem
      }
      if (event.type === 'usage') {
        void this.appendTranscript({ type: 'usage', usedTokens: event.usedTokens, contextWindow: event.contextWindow, model: this.model })
      }
      if (event.type === 'turn_ended') {
        this.turnOutstanding = false
        this.activeTurnId = null
        this.clearStallTimer()
        void this.transcript.flush().then(() => this.emitEvent(event)).catch((error) => {
          this.emitEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) })
          this.emitEvent(event)
        })
        continue
      }
      this.emitEvent(event)
    }
  }

  private appendTranscript(event: CodexTranscriptEvent): Promise<void> {
    return this.transcript.append(codexTranscriptLine(event))
  }

  private armStallTimer(): void {
    this.clearStallTimer()
    if (!this.turnOutstanding) return
    this.stallTimer = setTimeout(() => this.emitEvent({ type: 'stall', seconds: STALL_THRESHOLD_MS / 1000 }), STALL_THRESHOLD_MS)
  }

  private clearStallTimer(): void {
    if (this.stallTimer) clearTimeout(this.stallTimer)
    this.stallTimer = null
  }

  private handleClose(code: number | null, error?: Error): void {
    const wasEnded = this.ended
    this.ended = true
    this.turnOutstanding = false
    this.clearStallTimer()
    this.deps.bridge.dropSession(this.sessionId)
    void this.transcript.flush().catch(() => {}).finally(() => {
      if (!wasEnded && error) this.emitEvent({ type: 'error', message: error.message })
      this.emitEvent({ type: 'closed', exitCode: code })
    })
  }

  private emitEvent(event: SessionEvent): void {
    this.emit('event', event)
  }
}
