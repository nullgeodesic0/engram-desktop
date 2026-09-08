import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CodexSessionManager, type CodexSessionDependencies } from './CodexSessionManager'
import type { CodexWireMessage } from './codexAppServerClient'
import type { SessionIndexEntry } from '../../shared/types'

class FakeClient extends EventEmitter {
  readonly calls: Array<{ method: string; params: unknown }> = []
  closed = false
  hangInterrupt = false
  async initialize(): Promise<void> {}
  async request<T>(method: string, params?: unknown): Promise<T> {
    this.calls.push({ method, params })
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' }, requiresOpenaiAuth: true } as T
    if (method === 'thread/start' || method === 'thread/resume') {
      return { thread: { id: 'codex-thread-1', model: 'gpt-5.1-codex-mini' } } as T
    }
    if (method === 'turn/start') return { turn: { id: 'turn-1' } } as T
    if (method === 'turn/interrupt') {
      if (this.hangInterrupt) return new Promise<T>(() => {})
      return {} as T
    }
    throw new Error(`Unexpected request ${method}`)
  }
  respondError(_id: number | string, _message: string): void {}
  close(): void { this.closed = true }
}

async function harness(resume?: SessionIndexEntry) {
  const client = new FakeClient()
  const transcriptRoot = await mkdtemp(join(tmpdir(), 'engram-codex-manager-'))
  const deps: CodexSessionDependencies = {
    resolvePlugin: () => ({ version: '1.2.3', root: '/plugins/engram/1.2.3', scriptPath: '/plugins/engram/1.2.3/scripts/engram.py' }),
    bridge: { start: async () => 4123, dropSession: () => {} },
    resolveBinary: async () => '/bin/codex',
    launchClient: () => client,
    getSettings: async () => ({
      authMode: 'codexSubscription', localBaseUrl: '', localModel: '', opencodeModel: 'auto', subscriptionModel: '', codexModel: 'gpt-5.1-codex-mini',
    }),
    ensurePythonShim: async () => null,
    learningHome: async () => '/learner/engram-data',
    transcriptRoot: () => transcriptRoot,
    bridgeWorkerPath: () => '/app/mcpBridgeWorker.mjs',
    electronPath: '/app/Engram Desktop',
    environment: { PATH: '/bin' },
    homeDirectory: '/Users/learner',
    interruptDeadlineMs: 5,
  }
  return { manager: new CodexSessionManager('learn', resume, deps), client }
}

describe('CodexSessionManager', () => {
  const kickoff = (kind: 'learn' | 'review' | 'coach', suffix = '') => ['/engram', `${kind}${suffix}`].join(':')

  it('starts a ChatGPT-backed thread with the Engram skill, bridge, model, and shared data root', async () => {
    const { manager, client } = await harness()
    await manager.start(kickoff('learn', ' calculus'), 'Use concise notation.')

    expect(manager.provider).toBe('codex')
    expect(manager.providerSessionId).toBe('codex-thread-1')
    expect(manager.model).toBe('gpt-5.1-codex-mini')

    const thread = client.calls.find((call) => call.method === 'thread/start')!
    expect(thread.params).toMatchObject({
      model: 'gpt-5.1-codex-mini',
      modelProvider: 'openai',
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      config: { forced_login_method: 'chatgpt', mcp_servers: { 'engram-ui-bridge': { required: true } } },
    })

    const turn = client.calls.find((call) => call.method === 'turn/start')!
    expect(turn.params).toMatchObject({
      threadId: 'codex-thread-1',
      input: [
        { type: 'text', text: kickoff('learn', ' calculus'), text_elements: [] },
        { type: 'skill', name: 'learn', path: '/plugins/engram/1.2.3/skills/learn/SKILL.md' },
      ],
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/learner/engram-data'], networkAccess: false },
    })
  })

  it('resumes only a Codex native thread and does not replay the kickoff', async () => {
    const resume: SessionIndexEntry = {
      sessionId: 'desktop-old', providerSessionId: 'codex-native-old', provider: 'codex', model: 'gpt-old', key: 'topic', startedAt: '2026-01-01T00:00:00Z',
    }
    const { manager, client } = await harness(resume)
    await manager.start(kickoff('learn', ' calculus'))

    expect(client.calls.find((call) => call.method === 'thread/resume')?.params).toMatchObject({ threadId: 'codex-native-old' })
    expect(client.calls.some((call) => call.method === 'turn/start')).toBe(false)

    await manager.sendUserMessageWhenReady('Continue.')
    expect(client.calls.find((call) => call.method === 'turn/start')?.params).toMatchObject({
      threadId: 'codex-thread-1',
      input: [{ type: 'text', text: 'Continue.', text_elements: [] }],
    })
  })

  it('interrupts an active turn before closing the server', async () => {
    const { manager, client } = await harness()
    await manager.start(kickoff('review'))
    manager.abort()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(client.calls.some((call) => call.method === 'turn/interrupt')).toBe(true)
    expect(client.closed).toBe(true)
  })

  it('forces the app-server closed when an interrupt never replies', async () => {
    const { manager, client } = await harness()
    await manager.start(kickoff('review'))
    client.hangInterrupt = true
    await manager.shutdown()
    expect(client.closed).toBe(true)
  })

  it('forwards mapped app-server notifications as ordinary session events', async () => {
    const { manager, client } = await harness()
    const seen: unknown[] = []
    manager.on('event', (event) => seen.push(event))
    await manager.start(kickoff('coach'))
    client.emit('notification', {
      method: 'item/agentMessage/delta', params: { threadId: 'codex-thread-1', itemId: 'message-1', delta: 'You retained ' },
    } satisfies CodexWireMessage)
    client.emit('notification', {
      method: 'item/agentMessage/delta', params: { threadId: 'codex-thread-1', itemId: 'message-1', delta: 'this.' },
    } satisfies CodexWireMessage)
    expect(seen).toContainEqual({ type: 'text', text: 'You retained ', append: false, itemId: 'message-1' })
    expect(seen).toContainEqual({ type: 'text', text: 'this.', append: true, itemId: 'message-1' })
  })
})
