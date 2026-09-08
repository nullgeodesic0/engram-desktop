import { describe, expect, it } from 'vitest'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import {
  CodexAppServerClient,
  CodexJsonRpcConnection,
  assertCodexSubscriptionAccount,
  normalizeCodexModels,
  type CodexWireMessage,
} from './codexAppServerClient'

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    kill: () => boolean
  }
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => true
  return child
}

describe('CodexJsonRpcConnection', () => {
  it('correlates out-of-order responses with the request that created them', async () => {
    const sent: CodexWireMessage[] = []
    const rpc = new CodexJsonRpcConnection((message) => sent.push(message))

    const account = rpc.request<{ account: string }>('account/read', { refreshToken: false })
    const models = rpc.request<{ data: string[] }>('model/list', { includeHidden: false })

    expect(sent).toEqual([
      { id: 1, method: 'account/read', params: { refreshToken: false } },
      { id: 2, method: 'model/list', params: { includeHidden: false } },
    ])

    rpc.accept({ id: 2, result: { data: ['gpt-fast'] } })
    rpc.accept({ id: 1, result: { account: 'chatgpt' } })

    await expect(account).resolves.toEqual({ account: 'chatgpt' })
    await expect(models).resolves.toEqual({ data: ['gpt-fast'] })
  })

  it('rejects a request with the server error message', async () => {
    const sent: CodexWireMessage[] = []
    const rpc = new CodexJsonRpcConnection((message) => sent.push(message))
    const response = rpc.request('thread/start', {})

    rpc.accept({ id: 1, error: { code: -32602, message: 'invalid model' } })

    await expect(response).rejects.toThrow('invalid model')
  })

  it('rejects immediately when writing the request fails', async () => {
    const rpc = new CodexJsonRpcConnection(() => {
      throw new Error('stdin closed')
    })

    await expect(rpc.request('model/list', {})).rejects.toThrow('stdin closed')
  })
})

describe('CodexAppServerClient', () => {
  it('performs the required initialize handshake and forwards notifications', async () => {
    const child = fakeChild()
    const sent: CodexWireMessage[] = []
    child.stdin.on('data', (chunk) => {
      for (const line of chunk.toString('utf-8').trim().split('\n')) sent.push(JSON.parse(line))
    })
    const client = new CodexAppServerClient(child)
    const ready = client.initialize()

    expect(sent[0]).toMatchObject({ id: 1, method: 'initialize' })
    child.stdout.write(`${JSON.stringify({ id: 1, result: { userAgent: 'codex', codexHome: '/x', platformFamily: 'unix', platformOs: 'macos' } })}\n`)
    await ready

    expect(sent[1]).toEqual({ method: 'initialized' })

    const notification = once(client, 'notification')
    child.stdout.write(`${JSON.stringify({ method: 'warning', params: { threadId: null, message: 'heads up' } })}\n`)
    await expect(notification).resolves.toEqual([{ method: 'warning', params: { threadId: null, message: 'heads up' } }])
  })

  it('rejects pending requests when the app-server exits', async () => {
    const child = fakeChild()
    const client = new CodexAppServerClient(child)
    const request = client.request('model/list', {})

    child.emit('close', 1)

    await expect(request).rejects.toThrow('exited with code 1')
  })
})

describe('Codex subscription account guard', () => {
  it('accepts a ChatGPT login', () => {
    expect(() => assertCodexSubscriptionAccount({ account: { type: 'chatgpt', email: null, planType: 'plus' }, requiresOpenaiAuth: true })).not.toThrow()
  })

  it('rejects an API-key login before a sitting can spend API credits', () => {
    expect(() => assertCodexSubscriptionAccount({ account: { type: 'apiKey' }, requiresOpenaiAuth: true })).toThrow(
      'logged in with an API key',
    )
  })

  it('explains how to log in when no Codex account exists', () => {
    expect(() => assertCodexSubscriptionAccount({ account: null, requiresOpenaiAuth: true })).toThrow('codex login')
  })
})

describe('normalizeCodexModels', () => {
  it('keeps visible models and preserves the server default', () => {
    expect(
      normalizeCodexModels({
        data: [
          { id: 'hidden', model: 'hidden', displayName: 'Hidden', description: 'internal', hidden: true, isDefault: false, inputModalities: ['text'] },
          { id: 'gpt-fast', model: 'gpt-fast', displayName: 'GPT Fast', description: 'Lightweight', hidden: false, isDefault: true, inputModalities: ['text', 'image'] },
          { id: 'gpt-deep', model: 'gpt-deep', displayName: 'GPT Deep', description: 'Thorough', hidden: false, isDefault: false, inputModalities: ['text'] },
        ],
        nextCursor: null,
      }),
    ).toEqual([
      { value: '', label: 'Codex default', description: 'GPT Fast — Lightweight', inputModalities: ['text', 'image'] },
      { value: 'gpt-fast', label: 'GPT Fast', description: 'Lightweight', inputModalities: ['text', 'image'] },
      { value: 'gpt-deep', label: 'GPT Deep', description: 'Thorough', inputModalities: ['text'] },
    ])
  })
})
