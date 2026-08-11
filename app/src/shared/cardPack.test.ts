import { describe, expect, it, test } from 'vitest'
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
    expect(reasons(p)).toContain('verify on a carved-out node requires a composed chain, an assembly, a production, or one of the priced recognition forms (match, sort, flaw) — never a chain of picks')
  })

  test('VERIFY on a procedure node may not be a checkpoint chain', () => {
    const beats = pack().beats as unknown[]
    beats[6] = mc('verify')
    const p = pack({
      beats,
      eligibility: { nodeKind: 'procedure', threshold: false, transferReady: false, lapsed: false, experimentArm: null },
    })
    expect(reasons(p)).toContain('verify on a carved-out node requires a composed chain, an assembly, a production, or one of the priced recognition forms (match, sort, flaw) — never a chain of picks')
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
    expect(reasons(p)).toContain('verify on a carved-out node requires a composed chain, an assembly, a production, or one of the priced recognition forms (match, sort, flaw) — never a chain of picks')
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

describe('prose figures', () => {
  function packWith(figure: unknown) {
    return pack({
      beats: [
        { beat: 'open_gap', kind: 'prose', content: 'x' },
        { beat: 'predict', kind: 'mc', stem: 's',
          options: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }],
          sealed: { correctOptionIds: ['a'], revealMarkdown: 'r' } },
        { beat: 'resolve', kind: 'prose', content: 'x', figure },
        { beat: 'self_explain', kind: 'recall', stem: 's', sealed: { revealMarkdown: 'r' } },
        { beat: 'verify', kind: 'recall', stem: 's', sealed: { revealMarkdown: 'r' } },
      ],
    })
  }

  it('accepts each figure the desktop can render', () => {
    const figures: unknown[] = [
      { kind: 'formula', latex: 'E = mc^2', caption: 'mass–energy', where: [{ symbol: 'c', meaning: 'speed of light' }] },
      { kind: 'steps', steps: [{ text: 'start', note: 'why' }] },
      { kind: 'comparison', left: { label: 'A', body: 'a' }, right: { label: 'B', body: 'b' } },
      { kind: 'checks', checks: [{ check: 'let T→0', expect: 'S→0' }] },
      { kind: 'timeline', events: [{ when: '1902', what: 'published' }] },
      { kind: 'definition', term: 'x', definition: 'y' },
      { kind: 'citation', label: 'Goldstein', locator: '§2.3' },
      { kind: 'plot', series: [{ label: 'V(r)', points: [[0, 1], [1, 0]] }] },
    ]
    for (const figure of figures) {
      const parsed = parseCardPack(packWith(figure))
      expect(parsed, JSON.stringify(figure).slice(0, 40)).not.toBeNull()
    }
  })

  it('refuses a figure kind it does not know', () => {
    expect(parseCardPack(packWith({ kind: 'render_iframe', src: 'http://x' }))).toBeNull()
  })

  it('a figure is display only — it carries no sealed field', () => {
    // The line that keeps a figure from becoming an ungraded answer: what the
    // learner ANSWERS with is a walk card, what they are SHOWN is a figure.
    const parsed = parseCardPack(
      packWith({ kind: 'formula', latex: 'x', sealed: { revealMarkdown: 'leak' } }),
    )
    const resolve = parsed?.beats.find((b) => b.beat === 'resolve')
    expect(JSON.stringify(resolve)).not.toContain('leak')
  })

  it('prose without a figure is unchanged', () => {
    expect(parseCardPack(packWith(undefined))).not.toBeNull()
  })
})

describe('the step composer', () => {
  function compose(beat: string, over: Record<string, unknown> = {}) {
    return {
      beat,
      kind: 'compose',
      stem: 'Write the derivation.',
      palette: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, label: `token ${i}` })),
      sealed: {
        steps: [{ tokens: ['t0', 't1'] }, { tokens: ['t2', 't3'] }],
        revealMarkdown: 'the chain',
      },
      ...over,
    }
  }

  it('may carry self_explain, because a token palette is not a menu', () => {
    const parsed = parseCardPack(
      pack({ beats: [prose('open_gap'), mc('predict'),
        { beat: 'struggle', kind: 'hints', rungs: ['a nudge'] }, prose('resolve'),
        compose('self_explain'), mc('connect'), ladder('verify'), prose('close')] }),
    )
    expect(parsed).not.toBeNull()
    expect(validateAgainstOverlay(parsed!)).toEqual([])
  })

  it('may carry a carved-out verify, where a cloze may not', () => {
    // A cloze fills gaps in a template the learner did not write; a composed
    // chain has no template. That is the whole distinction.
    const parsed = parseCardPack(
      pack({
        eligibility: { nodeKind: 'procedure', threshold: false, transferReady: false, lapsed: false, experimentArm: null },
        beats: [prose('open_gap'), mc('predict'),
          { beat: 'struggle', kind: 'hints', rungs: ['a nudge'] }, prose('resolve'),
          compose('self_explain'), mc('connect'), compose('verify'), prose('close')],
      }),
    )
    expect(parsed).not.toBeNull()
    expect(validateAgainstOverlay(parsed!)).toEqual([])
  })

  it('refuses a palette that only holds the answer', () => {
    // A palette with no spare pieces is a jigsaw: the learner finishes it by
    // elimination without composing anything. Same reasoning as the ladder's
    // pool >= 2N rule, applied to the alphabet instead of the lines.
    expect(
      parseCardPack(
        pack({ beats: [prose('open_gap'), mc('predict'),
          { beat: 'struggle', kind: 'hints', rungs: ['a'] }, prose('resolve'),
          compose('self_explain', { palette: [
            { id: 't0', label: 'a' }, { id: 't1', label: 'b' },
            { id: 't2', label: 'c' }, { id: 't3', label: 'd' }] }),
          mc('connect'), ladder('verify'), prose('close')] }),
      ),
    ).toBeNull()
  })

  it('refuses a step spelling itself with a token the learner never sees', () => {
    expect(
      parseCardPack(
        pack({ beats: [prose('open_gap'), mc('predict'),
          { beat: 'struggle', kind: 'hints', rungs: ['a'] }, prose('resolve'),
          compose('self_explain', { sealed: {
            steps: [{ tokens: ['t0', 'zzz'] }, { tokens: ['t2'] }],
            revealMarkdown: 'x' } }),
          mc('connect'), ladder('verify'), prose('close')] }),
      ),
    ).toBeNull()
  })
})

describe('match, sort and flaw', () => {
  function match(beat: string, pairs = 4, over: Record<string, unknown> = {}) {
    const ids = Array.from({ length: pairs }, (_, i) => i)
    return {
      beat, kind: 'match', stem: 'Pair each with what it belongs to.',
      left: ids.map((i) => ({ id: `l${i}`, label: `left ${i}` })),
      right: ids.map((i) => ({ id: `r${i}`, label: `right ${i}` })),
      sealed: {
        pairs: ids.map((i) => ({ left: `l${i}`, right: `r${i}` })),
        revealMarkdown: 'the pairing',
      },
      ...over,
    }
  }
  function sort(beat: string, items = 6, buckets = 2, over: Record<string, unknown> = {}) {
    return {
      beat, kind: 'sort', stem: 'Put each where it belongs.',
      buckets: Array.from({ length: buckets }, (_, i) => ({ id: `b${i}`, label: `bucket ${i}` })),
      items: Array.from({ length: items }, (_, i) => ({ id: `i${i}`, label: `item ${i}` })),
      sealed: {
        placements: Array.from({ length: items }, (_, i) => ({ item: `i${i}`, bucket: `b${i % buckets}` })),
        revealMarkdown: 'the partition',
      },
      ...over,
    }
  }
  function flaw(beat: string, over: Record<string, unknown> = {}) {
    return {
      beat, kind: 'flaw', stem: 'One line breaks. Which?',
      steps: [{ text: 'first' }, { text: 'second' }, { text: 'third' }, { text: 'fourth' }],
      sealed: { flawedIndex: 2, why: 'the sign flips here', revealMarkdown: 'because…' },
      ...over,
    }
  }
  const shell = (selfExplain: unknown, connect: unknown = mc('connect')) => ({
    beats: [prose('open_gap'), mc('predict'),
      { beat: 'struggle', kind: 'hints', rungs: ['a nudge'] }, prose('resolve'),
      selfExplain, connect, ladder('verify'), prose('close')],
  })

  it('a four-pair match may carry self_explain', () => {
    const p = parseCardPack(pack(shell(match('self_explain'))))
    expect(p).not.toBeNull()
    expect(validateAgainstOverlay(p!)).toEqual([])
  })

  it('a three-pair match may not — six orderings is a coin flip with extra steps', () => {
    expect(parseCardPack(pack(shell(match('self_explain', 3))))).toBeNull()
  })

  it('a match with an unpairable left item is refused', () => {
    expect(
      parseCardPack(pack(shell(match('self_explain', 4, {
        sealed: { pairs: [{ left: 'l0', right: 'r0' }], revealMarkdown: 'x' } })))),
    ).toBeNull()
  })

  it('a sort clears the floor on the product, not on either count', () => {
    // 2^6 = 64, comfortably past 24.
    expect(validateAgainstOverlay(parseCardPack(pack(shell(sort('self_explain', 6, 2))))!)).toEqual([])
    // 2^4 = 16, short of it.
    expect(parseCardPack(pack(shell(sort('self_explain', 4, 2))))).toBeNull()
  })

  it('a flaw card may sit at connect', () => {
    const p = parseCardPack(pack(shell(ladder('self_explain'), flaw('connect'))))
    expect(p).not.toBeNull()
    expect(validateAgainstOverlay(p!)).toEqual([])
  })

  it('a flaw card may never carry self_explain', () => {
    // One of six is a 17% guess. The overlay protects that beat from exactly
    // this, and the schema refuses it rather than leaving it to authorship.
    expect(parseCardPack(pack(shell(flaw('self_explain'))))).toBeNull()
  })

  it('a flaw card pointing past the end of its own chain is refused', () => {
    expect(
      parseCardPack(pack(shell(ladder('self_explain'), flaw('connect', {
        sealed: { flawedIndex: 9, why: 'x', revealMarkdown: 'y' } })))),
    ).toBeNull()
  })

  it('match or sort MAY carry a carved-out verify — the priced widening', () => {
    // Deliberate loosening. The alternative on a phone is not free recall, it
    // is nothing at all: a threshold node never checked away from the desk is
    // not protected by the stricter rule, only skipped. The price is paid in
    // the evidence (mobile-recognition, hard-at-best), not in the schema.
    const p = parseCardPack({
      ...pack(shell(ladder('self_explain'))),
      eligibility: { nodeKind: 'concept', threshold: true, transferReady: false, lapsed: false, experimentArm: null },
      beats: [prose('open_gap'), mc('predict'),
        { beat: 'struggle', kind: 'hints', rungs: ['a'] }, prose('resolve'),
        ladder('self_explain'), mc('connect'), match('verify'), prose('close')],
    })
    expect(validateAgainstOverlay(p!)).toEqual([])
  })

  it('a plain menu still may not carry a carved-out verify', () => {
    // The widening admits forms with a real answer space. A four-option pick
    // stays refused: it is a coin flip wearing a checkmark.
    const p = parseCardPack({
      ...pack(shell(ladder('self_explain'))),
      eligibility: { nodeKind: 'concept', threshold: true, transferReady: false, lapsed: false, experimentArm: null },
      beats: [prose('open_gap'), mc('predict'),
        { beat: 'struggle', kind: 'hints', rungs: ['a'] }, prose('resolve'),
        ladder('self_explain'), mc('connect'), mc('verify'), prose('close')],
    })
    expect(validateAgainstOverlay(p!)).toContain(
      'verify on a carved-out node requires a composed chain, an assembly, a production, or one of the priced recognition forms (match, sort, flaw) — never a chain of picks',
    )
  })
})
