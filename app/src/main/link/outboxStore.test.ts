import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, test } from 'vitest'
import { createOutboxStore } from './outboxStore'
import type { OutboxItem } from '../../shared/linkProtocol'

/**
 * The desktop-side landing zone for whatever the phone has queued. Its whole
 * job is that nothing is lost and nothing is counted twice: the phone retries
 * a batch whenever the link flaps, and a retried batch must be a no-op rather
 * than a second helping of evidence on the learner's schedule.
 */

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'outbox-'))
  file = join(dir, 'nested', 'outbox.jsonl')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function item(id: string, over: Partial<OutboxItem> = {}): OutboxItem {
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
  } as OutboxItem
}

const ID_A = '6f1c2a10-0000-4000-8000-00000000000a'
const ID_B = '6f1c2a10-0000-4000-8000-00000000000b'
const ID_C = '6f1c2a10-0000-4000-8000-00000000000c'

describe('createOutboxStore', () => {
  test('accepts a batch and reports it as pending', async () => {
    const store = createOutboxStore({ filePath: file })
    const result = await store.append([item(ID_A), item(ID_B)])

    expect(result).toEqual({ accepted: 2, duplicates: 0 })
    expect((await store.pending()).map((i) => i.id)).toEqual([ID_A, ID_B])
  })

  test('treats a replayed item as a duplicate, not a second helping', async () => {
    const store = createOutboxStore({ filePath: file })
    await store.append([item(ID_A), item(ID_B)])

    const replay = await store.append([item(ID_B), item(ID_C)])

    expect(replay).toEqual({ accepted: 1, duplicates: 1 })
    expect((await store.pending()).map((i) => i.id)).toEqual([ID_A, ID_B, ID_C])
  })

  test('survives a restart', async () => {
    await createOutboxStore({ filePath: file }).append([item(ID_A)])

    const reopened = createOutboxStore({ filePath: file })

    expect((await reopened.pending()).map((i) => i.id)).toEqual([ID_A])
  })

  test('dedupes against items written before a restart', async () => {
    await createOutboxStore({ filePath: file }).append([item(ID_A)])

    const reopened = createOutboxStore({ filePath: file })
    const result = await reopened.append([item(ID_A)])

    expect(result).toEqual({ accepted: 0, duplicates: 1 })
    expect(await reopened.pending()).toHaveLength(1)
  })

  test('drops an item from pending once drained, without forgetting it', async () => {
    const store = createOutboxStore({ filePath: file })
    await store.append([item(ID_A), item(ID_B)])

    await store.markDrained([ID_A])

    expect((await store.pending()).map((i) => i.id)).toEqual([ID_B])
    // Still known, so a replay after draining cannot re-queue it.
    expect(await store.append([item(ID_A)])).toEqual({ accepted: 0, duplicates: 1 })
  })

  test('a drain survives a restart', async () => {
    const store = createOutboxStore({ filePath: file })
    await store.append([item(ID_A), item(ID_B)])
    await store.markDrained([ID_A])

    const reopened = createOutboxStore({ filePath: file })

    expect((await reopened.pending()).map((i) => i.id)).toEqual([ID_B])
  })

  test('tolerates a torn trailing line from a crash mid-append', async () => {
    const store = createOutboxStore({ filePath: file })
    await store.append([item(ID_A), item(ID_B)])
    // Simulate a process death partway through writing a third record.
    appendFileSync(file, '{"kind":"item","item":{"id":"6f1c2a10-0000-4000-8', 'utf-8')

    const reopened = createOutboxStore({ filePath: file })

    expect((await reopened.pending()).map((i) => i.id)).toEqual([ID_A, ID_B])
    // And the store is still writable afterwards.
    expect(await reopened.append([item(ID_C)])).toEqual({ accepted: 1, duplicates: 0 })
    expect((await reopened.pending()).map((i) => i.id)).toEqual([ID_A, ID_B, ID_C])
  })

  test('never rewrites history — the log is append-only', async () => {
    const store = createOutboxStore({ filePath: file })
    await store.append([item(ID_A)])
    const afterFirst = readFileSync(file, 'utf-8')

    await store.append([item(ID_B)])
    await store.markDrained([ID_A])

    expect(readFileSync(file, 'utf-8').startsWith(afterFirst)).toBe(true)
  })
})

describe('in-flight handoff', () => {
  const T0 = Date.parse('2026-08-10T10:00:00.000Z')

  function storeAt(now: () => number) {
    return createOutboxStore({ filePath: join(dir, 'outbox.jsonl'), now })
  }

  it('an item handed to a session leaves pending without being drained', async () => {
    let clock = T0
    const store = storeAt(() => clock)
    await store.append([item(ID_A)])

    await store.markInFlight([ID_A], new Date(clock).toISOString())

    expect(await store.pending()).toHaveLength(0)
    expect((await store.inFlight()).map((f) => f.item.id)).toEqual([ID_A])
  })

  it('returns to pending when its session has had long enough and produced nothing', async () => {
    // The whole point: a sitting that died leaves the learner's work queued
    // instead of marked handled. Silence past the grace is treated as failure.
    let clock = T0
    const store = storeAt(() => clock)
    await store.append([item(ID_A)])
    await store.markInFlight([ID_A], new Date(clock).toISOString())

    clock = T0 + 31 * 60_000
    expect((await store.pending()).map((i) => i.id)).toEqual([ID_A])
  })

  it('stays out of pending while its session could still be working', async () => {
    let clock = T0
    const store = storeAt(() => clock)
    await store.append([item(ID_A)])
    await store.markInFlight([ID_A], new Date(clock).toISOString())

    clock = T0 + 5 * 60_000
    expect(await store.pending()).toHaveLength(0)
  })

  it('drained beats in-flight, and is permanent', async () => {
    let clock = T0
    const store = storeAt(() => clock)
    await store.append([item(ID_A)])
    await store.markInFlight([ID_A], new Date(clock).toISOString())
    await store.markDrained([ID_A])

    clock = T0 + 10 * 60 * 60_000
    expect(await store.pending()).toHaveLength(0)
    expect(await store.inFlight()).toHaveLength(0)
  })

  it('a retry replaces the earlier handoff rather than stacking', async () => {
    let clock = T0
    const store = storeAt(() => clock)
    await store.append([item(ID_A)])
    await store.markInFlight([ID_A], new Date(T0).toISOString())
    await store.markInFlight([ID_A], new Date(T0 + 31 * 60_000).toISOString())

    // Judged against the SECOND handoff, so the retry gets its own grace.
    clock = T0 + 40 * 60_000
    expect(await store.pending()).toHaveLength(0)
    expect(await store.inFlight()).toHaveLength(1)
  })
})

describe('items that can never be settled', () => {
  const T0 = Date.parse('2026-08-10T10:00:00.000Z')

  it('gives up after repeated sittings produce nothing, and says why', async () => {
    // Not every item CAN produce a receipt. A walk parked after PREDICT
    // carries a pre-content commitment and no retrieval, so the tutor
    // correctly writes nothing — and the queue must not keep opening
    // sittings for it forever.
    let clock = T0
    const store = createOutboxStore({ filePath: join(dir, 'outbox.jsonl'), now: () => clock })
    await store.append([item(ID_A)])

    await store.markInFlight([ID_A], new Date(clock).toISOString())
    clock += 31 * 60_000
    await store.markInFlight([ID_A], new Date(clock).toISOString())
    clock += 31 * 60_000

    expect(await store.handoffCount(ID_A)).toBe(2)
    await store.markAbandoned([{ id: ID_A, reason: 'two sittings produced no receipt' }])

    expect(await store.pending()).toHaveLength(0)
    expect(await store.staleInFlight()).toHaveLength(0)
    const given = await store.abandoned()
    expect(given).toHaveLength(1)
    expect(given[0].reason).toContain('no receipt')
  })

  it('an abandoned item is never resurrected by the grace clock', async () => {
    let clock = T0
    const store = createOutboxStore({ filePath: join(dir, 'outbox.jsonl'), now: () => clock })
    await store.append([item(ID_A)])
    await store.markInFlight([ID_A], new Date(clock).toISOString())
    await store.markAbandoned([{ id: ID_A, reason: 'ungradeable' }])

    clock = T0 + 10 * 60 * 60_000
    expect(await store.pending()).toHaveLength(0)
  })
})
