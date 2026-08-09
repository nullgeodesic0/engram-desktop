import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createCardPackStore, type CardPackStore } from './cardPackStore'
import { createLinkServer, type LinkServer } from './LinkServer'
import { createOutboxStore, type OutboxStore } from './outboxStore'
import { createPairingStore, type PairingStore } from './pairing'
import type { CardPack } from '../../shared/cardPack'

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
let packs: CardPackStore
let base: string

function ladderCard(beat: string) {
  return {
    beat,
    kind: 'ladder' as const,
    stem: 'Build it.',
    pool: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, label: `step ${i}` })),
    sealed: { orderedStepIds: ['s0', 's1', 's2'], revealMarkdown: 'because…' },
  }
}

function mcCard(beat: string) {
  return {
    beat,
    kind: 'mc' as const,
    stem: 'Which?',
    options: [
      { id: 'a', label: 'right' },
      { id: 'b', label: 'wrong' },
    ],
    sealed: { correctOptionIds: ['a'], revealMarkdown: 'because…' },
  }
}

function samplePack(): CardPack {
  return {
    packId: '6f1c2a10-0000-4000-8000-0000000000f1',
    topic: 'grad-statistical-mechanics',
    node: 'liouville-theorem',
    nodeTitle: 'Liouville’s theorem',
    generatedAt: '2026-08-09T18:00:00.000Z',
    eligibility: { nodeKind: 'concept', threshold: false, transferReady: false, lapsed: false, experimentArm: null },
    beats: [
      { beat: 'open_gap', kind: 'prose', content: 'x' },
      mcCard('predict'),
      { beat: 'struggle', kind: 'hints', rungs: ['nudge'] },
      { beat: 'resolve', kind: 'prose', content: 'x' },
      ladderCard('self_explain'),
      mcCard('connect'),
      ladderCard('verify'),
      { beat: 'close', kind: 'prose', content: 'x' },
    ],
  } as CardPack
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'linkserver-'))
  pairing = createPairingStore({ filePath: join(dir, 'devices.json') })
  outbox = createOutboxStore({ filePath: join(dir, 'outbox.jsonl') })
  packs = createCardPackStore({ rootDir: join(dir, 'card-packs') })
  server = createLinkServer({ pairing, outbox, packs, host: '127.0.0.1' })
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

  test('serves a stored card pack to a paired device', async () => {
    const token = await pair()
    await packs.put(samplePack())

    const res = await fetch(`${base}/link/pack?topic=grad-statistical-mechanics&node=liouville-theorem`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    expect((await res.json()).node).toBe('liouville-theorem')
  })

  test('refuses to serve a card pack without a token', async () => {
    await packs.put(samplePack())

    const res = await fetch(`${base}/link/pack?topic=grad-statistical-mechanics&node=liouville-theorem`)

    expect(res.status).toBe(401)
  })

  test('answers 404 for a node with no pack', async () => {
    const token = await pair()

    const res = await fetch(`${base}/link/pack?topic=grad-statistical-mechanics&node=absent`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(404)
  })

  test('lists the nodes a topic has packs for', async () => {
    const token = await pair()
    await packs.put(samplePack())

    const res = await fetch(`${base}/link/packs?topic=grad-statistical-mechanics`, {
      headers: { authorization: `Bearer ${token}` },
    })

    expect(await res.json()).toEqual({ nodes: ['liouville-theorem'] })
  })

  test('reports health without requiring a token, and leaks nothing', async () => {
    const res = await fetch(`${base}/link/health`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ app: 'engram-desktop', protocol: 1 })
  })
})
