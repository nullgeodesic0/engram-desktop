import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createCardPackStore } from './cardPackStore'
import type { CardPack } from '../../shared/cardPack'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cardpack-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function store() {
  return createCardPackStore({ rootDir: join(dir, 'card-packs') })
}

function ladder(beat: string) {
  return {
    beat,
    kind: 'ladder' as const,
    stem: 'Build it.',
    pool: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, label: `step ${i}` })),
    sealed: { orderedStepIds: ['s0', 's1', 's2'], revealMarkdown: 'because…' },
  }
}

function pack(over: Partial<CardPack> = {}): CardPack {
  return {
    packId: '6f1c2a10-0000-4000-8000-0000000000f1',
    topic: 'grad-statistical-mechanics',
    node: 'liouville-theorem',
    nodeTitle: 'Liouville’s theorem',
    generatedAt: '2026-08-09T18:00:00.000Z',
    eligibility: { nodeKind: 'concept', threshold: false, transferReady: false, lapsed: false, experimentArm: null },
    beats: [
      { beat: 'open_gap', kind: 'prose', content: 'x' },
      {
        beat: 'predict',
        kind: 'mc',
        stem: 'Which?',
        options: [
          { id: 'a', label: 'right' },
          { id: 'b', label: 'wrong' },
        ],
        sealed: { correctOptionIds: ['a'], revealMarkdown: 'because…' },
      },
      { beat: 'struggle', kind: 'hints', rungs: ['nudge'] },
      { beat: 'resolve', kind: 'prose', content: 'x' },
      ladder('self_explain'),
      {
        beat: 'connect',
        kind: 'mc',
        stem: 'Which neighbour?',
        options: [
          { id: 'a', label: 'right' },
          { id: 'b', label: 'wrong' },
        ],
        sealed: { correctOptionIds: ['a'], revealMarkdown: 'because…' },
      },
      ladder('verify'),
      { beat: 'close', kind: 'prose', content: 'x' },
    ],
    ...over,
  } as CardPack
}

describe('createCardPackStore', () => {
  test('stores a pack and reads it back', async () => {
    const s = store()
    await s.put(pack())

    expect((await s.get('grad-statistical-mechanics', 'liouville-theorem'))?.packId).toBe(pack().packId)
  })

  test('returns null for a node it has no pack for', async () => {
    expect(await store().get('grad-statistical-mechanics', 'nothing-here')).toBeNull()
  })

  test('survives a restart', async () => {
    await store().put(pack())

    expect(await store().get('grad-statistical-mechanics', 'liouville-theorem')).not.toBeNull()
  })

  test('a newer pack for the same node replaces the older one', async () => {
    const s = store()
    await s.put(pack())
    await s.put(pack({ packId: '6f1c2a10-0000-4000-8000-0000000000f2', generatedAt: '2026-08-09T19:00:00.000Z' }))

    expect((await s.get('grad-statistical-mechanics', 'liouville-theorem'))?.packId).toBe(
      '6f1c2a10-0000-4000-8000-0000000000f2',
    )
  })

  test('refuses a pack that breaks the overlay, and stores nothing', async () => {
    const s = store()
    // VERIFY served as a menu on a threshold node — the carve-out the overlay
    // is most emphatic about.
    const bad = pack({
      eligibility: { nodeKind: 'concept', threshold: true, transferReady: false, lapsed: false, experimentArm: null },
      beats: pack().beats.map((c) =>
        c.beat === 'verify'
          ? {
              beat: 'verify',
              kind: 'mc',
              stem: 'Which?',
              options: [
                { id: 'a', label: 'right' },
                { id: 'b', label: 'wrong' },
              ],
              sealed: { correctOptionIds: ['a'], revealMarkdown: 'because…' },
            }
          : c,
      ) as CardPack['beats'],
    })

    await expect(s.put(bad)).rejects.toThrow(/carved-out/)
    expect(await s.get('grad-statistical-mechanics', 'liouville-theorem')).toBeNull()
  })

  test('lists the nodes it holds packs for, by topic', async () => {
    const s = store()
    await s.put(pack())
    await s.put(pack({ packId: '6f1c2a10-0000-4000-8000-0000000000f3', node: 'ergodic-hypothesis' }))
    await s.put(pack({ packId: '6f1c2a10-0000-4000-8000-0000000000f4', topic: 'grad-electrodynamics' }))

    expect((await s.listFor('grad-statistical-mechanics')).sort()).toEqual([
      'ergodic-hypothesis',
      'liouville-theorem',
    ])
  })

  test('refuses a topic or node name that would escape the store directory', async () => {
    const s = store()

    await expect(s.put(pack({ node: '../../../../etc/passwd' }))).rejects.toThrow(/unsafe/)
    expect(await s.get('grad-statistical-mechanics', '../../../../etc/passwd')).toBeNull()
  })
})
