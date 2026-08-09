import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
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
