import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { drainOutbox } from './mobileDrain'
import { createOutboxStore, type OutboxStore } from './outboxStore'
import type { OutboxItem } from '../../shared/linkProtocol'

/**
 * The drain is where phone evidence becomes a real sitting. Its contract is
 * mostly about not losing things: a session that fails to start must leave the
 * queue exactly as it found it, because the alternative is evidence the learner
 * genuinely produced disappearing between two machines.
 */

let dir: string
let outbox: OutboxStore
let started: Array<{ message: string; kind: string; topic?: string }>
/** Set by a test to push the store past the in-flight grace. */
let lateClock: number | null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drain-'))
  outbox = createOutboxStore({
    filePath: join(dir, 'outbox.jsonl'),
    now: () => lateClock ?? Date.now(),
  })
  started = []
  lateClock = null
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function item(suffix: string, topic = 'grad-statistical-mechanics'): OutboxItem {
  return {
    id: `6f1c2a10-0000-4000-8000-00000000000${suffix}`,
    topic,
    node: 'liouville-theorem',
    mode: 'learn',
    kind: 'ladder',
    confidence: 3,
    trail: 'assembly 3/3',
    committedAt: '2026-08-09T18:04:00.000Z',
  } as OutboxItem
}

function deps(overrides: Partial<Parameters<typeof drainOutbox>[0]> = {}) {
  return {
    outbox,
    batchDir: join(dir, 'batches'),
    startSession: async (message: string, kind: string, topic?: string) => {
      started.push({ message, kind, topic })
      return 'session-1'
    },
    // Default: the engine has written nothing. The pessimistic default is the
    // right one — a test that forgets to say otherwise should see work left
    // unsettled rather than silently marked done.
    receiptSince: async () => false,
    ...overrides,
  }
}

describe('drainOutbox', () => {
  test('does nothing when the queue is empty', async () => {
    const result = await drainOutbox(deps())

    expect(result.sessionsStarted).toBe(0)
    expect(started).toHaveLength(0)
  })

  test('starts one session per topic', async () => {
    await outbox.append([item('a'), item('b'), item('c', 'grad-electrodynamics')])

    const result = await drainOutbox(deps())

    expect(result.sessionsStarted).toBe(2)
    expect(started.map((s) => s.topic).sort()).toEqual(['grad-electrodynamics', 'grad-statistical-mechanics'])
  })

  test('writes the evidence to a file and names it in the kickoff', async () => {
    await outbox.append([item('a'), item('b')])

    await drainOutbox(deps())

    const message = started[0].message
    const pathMatch = message.match(/(\/[^\s]+\.json)/)
    expect(pathMatch).not.toBeNull()
    const written = JSON.parse(readFileSync(pathMatch![1], 'utf-8'))
    expect(written.items).toHaveLength(2)
    expect(message).toContain('/engram:learn')
    expect(message).toContain('companion app')
  })

  test('a started session takes items out of pending without settling them', async () => {
    await outbox.append([item('a')])

    const result = await drainOutbox(deps())

    expect(await outbox.pending()).toHaveLength(0)
    expect(await outbox.inFlight()).toHaveLength(1)
    // Handed over is not settled, and the result says which is which.
    expect(result.itemsDrained).toBe(1)
    expect(result.itemsSettled).toBe(0)
  })

  test('settles an in-flight item once the engine has written its receipt', async () => {
    await outbox.append([item('a')])
    await drainOutbox(deps())

    const result = await drainOutbox(deps({ receiptSince: async () => true }))

    expect(result.itemsSettled).toBe(1)
    expect(await outbox.inFlight()).toHaveLength(0)
    expect(await outbox.pending()).toHaveLength(0)
  })

  test('leaves an in-flight item alone while its sitting could still be working', async () => {
    await outbox.append([item('a')])
    await drainOutbox(deps())

    // No receipt yet, and the grace has not passed: the sitting may simply be
    // slow. Re-sending now would double the evidence.
    const result = await drainOutbox(deps())

    expect(result.itemsSettled).toBe(0)
    expect(result.sessionsStarted).toBe(0)
    expect(await outbox.inFlight()).toHaveLength(1)
  })

  test('gives up after two fruitless sittings rather than looping forever', async () => {
    // Observed live: the tutor settled a predict-only card and deliberately
    // wrote no receipt, because a pre-content commitment is not retrieval.
    // The queue kept opening sittings for it. Persistence, past a point, is
    // just a loop.
    await outbox.append([item('a')])
    const t0 = new Date('2026-08-10T10:00:00.000Z')
    await drainOutbox(deps({ now: () => t0 }))

    lateClock = t0.getTime() + 31 * 60_000
    const second = await drainOutbox(deps({ now: () => new Date(lateClock!) }))
    expect(second.itemsRetried).toBe(1)
    expect(second.itemsAbandoned).toBe(0)

    lateClock = t0.getTime() + 62 * 60_000
    const third = await drainOutbox(deps({ now: () => new Date(lateClock!) }))
    expect(third.itemsAbandoned).toBe(1)
    expect(third.sessionsStarted).toBe(0)
    expect(await outbox.pending()).toHaveLength(0)

    const given = await outbox.abandoned()
    expect(given[0].reason).toContain('no receipt')
  })

  test('a sitting that produced nothing gives the work back', async () => {
    // The defect this whole reconciliation exists for: a session that
    // crashed, was closed, or never rated used to leave the learner's evidence
    // marked handled with nothing in the record to show for it.
    await outbox.append([item('a')])
    const t0 = new Date('2026-08-10T10:00:00.000Z')
    await drainOutbox(deps({ now: () => t0 }))

    lateClock = t0.getTime() + 31 * 60_000
    expect(await outbox.pending()).toHaveLength(1)

    const retry = await drainOutbox(deps({ now: () => new Date(lateClock!) }))
    expect(retry.itemsRetried).toBe(1)
    expect(retry.sessionsStarted).toBe(1)
  })

  test('leaves the queue untouched when a session fails to start', async () => {
    await outbox.append([item('a')])

    const result = await drainOutbox(
      deps({
        startSession: async () => {
          throw new Error('claude binary not found')
        },
      }),
    )

    expect(result.sessionsStarted).toBe(0)
    expect(result.failures).toHaveLength(1)
    // The learner did this work. It must still be here to try again.
    expect(await outbox.pending()).toHaveLength(1)
  })

  test('one topic failing does not cost another topic its drain', async () => {
    await outbox.append([item('a'), item('c', 'grad-electrodynamics')])

    await drainOutbox(
      deps({
        startSession: async (_m: string, _k: string, topic?: string) => {
          if (topic === 'grad-electrodynamics') throw new Error('nope')
          started.push({ message: _m, kind: _k, topic })
          return 'session-1'
        },
      }),
    )

    const pending = await outbox.pending()
    expect(pending.map((i) => i.topic)).toEqual(['grad-electrodynamics'])
  })

  test('the batch carries no rating and no source stamp', async () => {
    // The phone did not grade its work and neither does the drain — the
    // session does. Anything else here would be the app authoring the record.
    await outbox.append([item('a')])

    await drainOutbox(deps())

    const raw = readFileSync(started[0].message.match(/(\/[^\s]+\.json)/)![1], 'utf-8')
    expect(raw).not.toContain('"rating"')
    expect(raw).not.toContain('"source"')
  })
})
