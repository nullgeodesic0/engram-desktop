import { EventEmitter } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import type { CodexModelOption } from '../../shared/types'
import { spawnCli } from '../platform'
import { NdjsonLineSplitter } from './streamParser'

export type CodexWireMessage = {
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string }
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/** Small transport-independent JSON-RPC core. The process wrapper feeds parsed
 * app-server lines into `accept`; keeping correlation here makes the protocol
 * behavior testable without launching Codex or consuming a subscription turn. */
export class CodexJsonRpcConnection {
  private nextId = 1
  private readonly pending = new Map<number | string, PendingRequest>()

  constructor(private readonly send: (message: CodexWireMessage) => void) {}

  request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    const message: CodexWireMessage = { id, method }
    if (params !== undefined) message.params = params
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      try {
        this.send(message)
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  notify(method: string, params?: unknown): void {
    const message: CodexWireMessage = { method }
    if (params !== undefined) message.params = params
    this.send(message)
  }

  accept(message: CodexWireMessage): boolean {
    if (message.id === undefined || (!('result' in message) && !message.error)) return false
    const request = this.pending.get(message.id)
    if (!request) return false
    this.pending.delete(message.id)
    if (message.error) {
      request.reject(new Error(message.error.message || `Codex app-server error ${message.error.code ?? 'unknown'}`))
    } else {
      request.resolve(message.result)
    }
    return true
  }

  rejectAll(error: Error): void {
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }
}

export type CodexAppServerProcess = EventEmitter & {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  kill(signal?: NodeJS.Signals | number): boolean
}

/** Process-backed Codex app-server connection. It owns framing and lifecycle;
 * higher layers own thread semantics and decide which notifications matter. */
export class CodexAppServerClient extends EventEmitter {
  private readonly splitter = new NdjsonLineSplitter()
  private readonly rpc: CodexJsonRpcConnection
  private stderr = ''
  private closed = false

  constructor(private readonly child: CodexAppServerProcess) {
    super()
    this.rpc = new CodexJsonRpcConnection((message) => {
      if (this.closed) throw new Error('Codex app-server is closed')
      this.child.stdin.write(`${JSON.stringify(message)}\n`)
    })
    child.stdout.on('data', (chunk: Buffer | string) => this.handleStdout(chunk.toString()))
    child.stderr.on('data', (chunk: Buffer | string) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-16_384)
    })
    child.on('error', (error: Error) => this.handleClose(null, error))
    child.on('close', (code: number | null) => this.handleClose(code))
  }

  async initialize(): Promise<void> {
    await this.rpc.request('initialize', {
      clientInfo: { name: 'engram_desktop', title: 'Engram Desktop', version: '0.1.5' },
      capabilities: null,
    })
    this.rpc.notify('initialized')
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    return this.rpc.request<T>(method, params)
  }

  respond(id: number | string, result: unknown): void {
    this.child.stdin.write(`${JSON.stringify({ id, result })}\n`)
  }

  respondError(id: number | string, message: string): void {
    this.child.stdin.write(`${JSON.stringify({ id, error: { code: -32601, message } })}\n`)
  }

  close(): void {
    if (!this.closed) this.child.kill()
  }

  private handleStdout(chunk: string): void {
    for (const raw of this.splitter.push(chunk)) {
      const message = raw as CodexWireMessage
      if (this.rpc.accept(message)) continue
      if (message.method) this.emit(message.id === undefined ? 'notification' : 'request', message)
    }
  }

  private handleClose(code: number | null, cause?: Error): void {
    if (this.closed) return
    this.closed = true
    const detail = this.stderr.trim()
    const message = cause?.message ?? `Codex app-server exited with code ${code ?? 'unknown'}`
    const error = new Error(detail ? `${message}: ${detail}` : message)
    this.rpc.rejectAll(error)
    this.emit('closed', { code, error })
  }
}

export function launchCodexAppServer(
  binary: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): CodexAppServerClient {
  const child = spawnCli(binary, ['app-server', '--listen', 'stdio://'], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return new CodexAppServerClient(child)
}

export interface CodexAccountResponse {
  account: { type: string; email?: string | null; planType?: string } | null
  requiresOpenaiAuth: boolean
}

/** Codex subscription mode is intentionally stricter than normal Codex: an
 * API-key login is rejected before any model turn can start. */
export function assertCodexSubscriptionAccount(response: CodexAccountResponse): void {
  if (!response.account) {
    throw new Error('OpenAI Codex is not logged in. Run `codex login`, choose ChatGPT, then try again.')
  }
  if (response.account.type !== 'chatgpt') {
    throw new Error(
      'OpenAI Codex is logged in with an API key. Codex subscription mode only uses a ChatGPT subscription; run `codex logout` and `codex login`, then choose ChatGPT.',
    )
  }
}

interface RawCodexModel {
  id: string
  model: string
  displayName: string
  description: string
  hidden: boolean
  isDefault: boolean
  inputModalities?: string[]
}

export function normalizeCodexModels(response: { data: RawCodexModel[]; nextCursor: string | null }): CodexModelOption[] {
  const visible = response.data.filter((model) => !model.hidden)
  const defaultModel = visible.find((model) => model.isDefault)
  const defaultDescription = defaultModel
    ? `${defaultModel.displayName}${defaultModel.description ? ` — ${defaultModel.description}` : ''}`
    : 'Whatever Codex currently recommends for this subscription.'
  return [
    { value: '', label: 'Codex default', description: defaultDescription, inputModalities: defaultModel?.inputModalities ?? [] },
    ...visible.map((model) => ({
      value: model.model || model.id,
      label: model.displayName || model.model || model.id,
      description: model.description || 'Available to the signed-in ChatGPT account.',
      inputModalities: model.inputModalities ?? [],
    })),
  ]
}
