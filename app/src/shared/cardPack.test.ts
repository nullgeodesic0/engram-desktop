import { describe, expect, test } from 'vitest'
import { parseCardPack, validateAgainstOverlay } from './cardPack'

/**
 * A card pack is one node's mobile walk, generated on the desk and carried to
 * the phone. `parseCardPack` guards the shape; `validateAgainstOverlay` guards
 * the PEDAGOGY — it is the executable form of
 * plugin-overlays/engram/learn-skill.mobile-walk-protocol.md, so a generator
 * that drifts from the bargain produces a pack the phone refuses rather than a
 * sitting that quietly breaks the rules.
 */

function prose(beat: string) {
  return { beat, kind: 'prose', content: 'text' }
}

function mc(beat: string) {
  return {
    beat,
    kind: 'mc',
    stem: 'Which holds?',
    options: [
      { id: 'a', label: 'right' },
      { id: 'b', label: 'a real misconception' },
      { id: 'c', label: 'a sign flip' },
    ],
    sealed: { correctOptionIds: ['a'], revealMarkdown: 'because…' },
  }
}

function ladder(beat: string, trueSteps = 3, poolSize = 6) {
  return {
    beat,
    kind: 'ladder',
    stem: 'Build the derivation.',
    pool: Array.from({ length: poolSize }, (_, i) => ({ id: `s${i}`, label: `step ${i}` })),
    sealed: {
      orderedStepIds: Array.from({ length: trueSteps }, (_, i) => `s${i}`),
      revealMarkdown: 'because…',
    },
  }
}

function recall(beat: string) {
  return { beat, kind: 'recall', stem: 'State it cold.', sealed: { revealMarkdown: 'because…' } }
}

function pack(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    packId: '6f1c2a10-0000-4000-8000-0000000000f1',
    topic: 'grad-statistical-mechanics',
    node: 'liouville-theorem',
    nodeTitle: 'Liouville’s theorem',
    generatedAt: '2026-08-09T18:00:00.000Z',
    eligibility: { nodeKind: 'concept', threshold: false, transferReady: false, lapsed: false, experimentArm: null },
    beats: [
      prose('open_gap'),
      mc('predict'),
      { beat: 'struggle', kind: 'hints', rungs: ['first nudge', 'second nudge'] },
      prose('resolve'),
      ladder('self_explain'),
      mc('connect'),
      ladder('verify'),
      prose('close'),
    ],
    ...over,
  }
}

describe('parseCardPack', () => {
  test('accepts a well-formed pack', () => {
    expect(parseCardPack(pack())).not.toBeNull()
  })

  test('rejects an unknown card kind', () => {
    expect(parseCardPack(pack({ beats: [{ beat: 'predict', kind: 'wager' }] }))).toBeNull()
  })

  test('rejects a pack whose ladder answer is not drawn from its own pool', () => {
    const bad = ladder('verify')
    ;(bad.sealed as { orderedStepIds: string[] }).orderedStepIds = ['not-in-pool']
    expect(parseCardPack(pack({ beats: [bad] }))).toBeNull()
  })

  test('rejects a pack whose mc answer is not one of its own options', () => {
    const bad = mc('predict')
    ;(bad.sealed as { correctOptionIds: string[] }).correctOptionIds = ['zzz']
    expect(parseCardPack(pack({ beats: [bad] }))).toBeNull()
  })
})

describe('validateAgainstOverlay', () => {
  function reasons(p: unknown): string[] {
    const parsed = parseCardPack(p)
    if (!parsed) throw new Error('fixture failed to parse')
    return validateAgainstOverlay(parsed)
  }

  test('a well-formed ordinary-node pack passes', () => {
    expect(reasons(pack())).toEqual([])
  })

  test('SELF_EXPLAIN may never be a plain menu', () => {
    const beats = pack().beats as unknown[]
    beats[4] = mc('self_explain')
    expect(reasons(pack({ beats }))).toContain('self_explain may not be served as a menu')
  })

  test('VERIFY on a threshold node may not be a checkpoint chain', () => {
    const beats = pack().beats as unknown[]
    beats[6] = mc('verify')
    const p = pack({
      beats,
      eligibility: { nodeKind: 'concept', threshold: true, transferReady: false, lapsed: false, experimentArm: null },
    })
    expect(reasons(p)).toContain('verify on a carved-out node requires a ladder or a real production')
  })

  test('VERIFY on a procedure node may not be a checkpoint chain', () => {
    const beats = pack().beats as unknown[]
    beats[6] = mc('verify')
    const p = pack({
      beats,
      eligibility: { nodeKind: 'procedure', threshold: false, transferReady: false, lapsed: false, experimentArm: null },
    })
    expect(reasons(p)).toContain('verify on a carved-out node requires a ladder or a real production')
  })

  test('VERIFY on an ordinary node may be a checkpoint chain', () => {
    const beats = pack().beats as unknown[]
    beats[6] = mc('verify')
    expect(reasons(pack({ beats }))).toEqual([])
  })

  test('a ladder pool must be at least twice its true step count', () => {
    const beats = pack().beats as unknown[]
    beats[6] = ladder('verify', 4, 7)
    expect(reasons(pack({ beats }))).toContain('ladder pool must be at least 2N for N true steps')
  })

  test('a pack must run every beat, in grammar order', () => {
    const beats = (pack().beats as unknown[]).filter((_, i) => i !== 5) // drop connect
    expect(reasons(pack({ beats }))).toContain('missing beat: connect')
  })

  test('beats out of grammar order are refused', () => {
    const beats = pack().beats as unknown[]
    ;[beats[1], beats[3]] = [beats[3], beats[1]]
    expect(reasons(pack({ beats }))).toContain('beats are not in grammar order')
  })

  test('an experiment-arm node is carved out like a threshold node', () => {
    const beats = pack().beats as unknown[]
    beats[6] = mc('verify')
    const p = pack({
      beats,
      eligibility: { nodeKind: 'concept', threshold: false, transferReady: false, lapsed: false, experimentArm: 'B' },
    })
    expect(reasons(p)).toContain('verify on a carved-out node requires a ladder or a real production')
  })

  test('a recall verify satisfies a carved-out node', () => {
    const beats = pack().beats as unknown[]
    beats[6] = recall('verify')
    const p = pack({
      beats,
      eligibility: { nodeKind: 'procedure', threshold: true, transferReady: false, lapsed: false, experimentArm: null },
    })
    expect(reasons(p)).toEqual([])
  })
})
