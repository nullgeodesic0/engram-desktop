import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createLinkServer, type LinkServer } from './LinkServer'
import { createOutboxStore, type OutboxStore } from './outboxStore'
import { createPairingStore, type PairingStore } from './pairing'

/**
 * The phone-facing server. Distinct from `bridgeServer`, which is loopback-only
 * and speaks to the tutor's MCP worker; this one is reachable from the network
 * and speaks to an untrusted client, so every test here is about what it
 * REFUSES.
 */

let dir: string
let server: LinkServer
let pairing: PairingStore
let outbox: OutboxStore
let base: string

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'linkserver-'))
  pairing = createPairingStore({ filePath: join(dir, 'devices.json') })
  outbox = createOutboxStore({ filePath: join(dir, 'outbox.jsonl') })
  server = createLinkServer({ pairing, outbox, host: '127.0.0.1' })
  const { port } = await server.start()
  base = `http://127.0.0.1:${port}`
})
afterEach(async () => {
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

async function pair(): Promise<string> {
  const offer = await pairing.beginPairing()
  const res = await fetch(`${base}/link/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: offer.code, deviceName: 'iPhone' }),
  })
  return (await res.json()).token
}

function item(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    topic: 'grad-statistical-mechanics',
    node: 'liouville-theorem',
    mode: 'review',
    kind: 'ladder',
    confidence: 3,
    trail: 'assembly 5/6',
    committedAt: '2026-08-09T18:04:00.000Z',
    ...over,
  }
}

const ID_A = '6f1c2a10-0000-4000-8000-00000000000a'
const ID_B = '6f1c2a10-0000-4000-8000-00000000000b'

function post(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('LinkServer', () => {
  test('refuses an outbox post with no token', async () => {
    const res = await post('/link/outbox', { items: [item(ID_A)] })

    expect(res.status).toBe(401)
    expect(await outbox.pending()).toHaveLength(0)
  })

  test('refuses an outbox post with a token it never issued', async () => {
    const res = await post('/link/outbox', { items: [item(ID_A)] }, 'forged-token')

    expect(res.status).toBe(401)
    expect(await outbox.pending()).toHaveLength(0)
  })

  test('accepts an authenticated batch and queues it', async () => {
    const token = await pair()

    const res = await post('/link/outbox', { items: [item(ID_A), item(ID_B)] }, token)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ accepted: 2, duplicates: 0, rejected: 0 })
    expect((await outbox.pending()).map((i) => i.id)).toEqual([ID_A, ID_B])
  })

  test('treats a replayed batch as duplicates rather than new evidence', async () => {
    const token = await pair()
    await post('/link/outbox', { items: [item(ID_A)] }, token)

    const res = await post('/link/outbox', { items: [item(ID_A)] }, token)

    expect(await res.json()).toMatchObject({ accepted: 0, duplicates: 1 })
    expect(await outbox.pending()).toHaveLength(1)
  })

  test('drops a malformed item without failing the rest of the batch', async () => {
    const token = await pair()

    const res = await post('/link/outbox', { items: [item(ID_A), { id: 'nope' }] }, token)

    expect(await res.json()).toMatchObject({ accepted: 1, rejected: 1 })
    expect((await outbox.pending()).map((i) => i.id)).toEqual([ID_A])
  })

  test('refuses an item that arrives pre-rated', async () => {
    // The doctrine guard, exercised through the wire rather than in isolation:
    // the phone does not rate, and the server must not accept one that tried.
    const token = await pair()

    const res = await post('/link/outbox', { items: [item(ID_A, { rating: 'easy' })] }, token)

    expect(await res.json()).toMatchObject({ accepted: 0, rejected: 1 })
    expect(await outbox.pending()).toHaveLength(0)
  })

  test('refuses a body larger than the cap', async () => {
    const token = await pair()

    const res = await post('/link/outbox', 'x'.repeat(1_100_000), token)

    expect(res.status).toBe(413)
  })

  test('refuses a body that is not JSON', async () => {
    const token = await pair()

    const res = await post('/link/outbox', 'not json at all', token)

    expect(res.status).toBe(400)
  })

  test('refuses a pairing attempt with a wrong code', async () => {
    await pairing.beginPairing()

    const res = await post('/link/pair', { code: '000000', deviceName: 'iPhone' })

    expect(res.status).toBe(401)
  })

  test('answers an unknown route with 404', async () => {
    const res = await post('/link/whatever', {}, await pair())

    expect(res.status).toBe(404)
  })

  test('reports health without requiring a token, and leaks nothing', async () => {
    const res = await fetch(`${base}/link/health`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ app: 'engram-desktop', protocol: 1 })
  })
})
