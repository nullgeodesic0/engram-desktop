import { describe, expect, it } from 'vitest'
import { buildLearnPreview } from './mobileLearnPreview'
import type { RawGraph } from './mobileLearnPreview'

describe('buildLearnPreview', () => {
  // `as RawGraph`: real graph.json carries claim/rubric/transfer_probe on every
  // node, and the fixture needs them present to prove they never leak — the
  // excess-property check that would otherwise catch a typo here is exactly
  // what a real untyped JSON.parse read does not get either way.
  const graph = {
    order: ['taught-one', 'unpacked-two', 'unpacked-three'],
    nodes: {
      'taught-one': {
        state: 'review',
        probe: 'Already taught — should never surface here.',
        claim: 'secret',
        threshold: false,
      },
      'unpacked-two': {
        state: 'new',
        probe: 'What does the virial theorem say about a bounded orbit?',
        claim: 'secret claim',
        rubric: ['secret rubric line'],
        transfer_probe: 'secret transfer',
        threshold: true,
      },
      'unpacked-three': {
        state: 'new',
        probe: 'A second unpacked node, never reached because order wins.',
        claim: 'secret',
        threshold: false,
      },
    },
  } as RawGraph

  it('previews the first NEW node in curriculum order, skipping already-taught ones', () => {
    const preview = buildLearnPreview(graph, new Set(), (id) => id)
    expect(preview?.node).toBe('unpacked-two')
    expect(preview?.probe).toBe('What does the virial theorem say about a bounded orbit?')
    expect(preview?.threshold).toBe(true)
  })

  it('skips a new node that is already packed', () => {
    const preview = buildLearnPreview(graph, new Set(['unpacked-two']), (id) => id)
    expect(preview?.node).toBe('unpacked-three')
  })

  it('returns null when everything new is already packed', () => {
    const preview = buildLearnPreview(graph, new Set(['unpacked-two', 'unpacked-three']), (id) => id)
    expect(preview).toBeNull()
  })

  it('returns null for a topic fully taught', () => {
    const allTaught = {
      order: ['a'],
      nodes: { a: { state: 'review', probe: 'x', claim: 'y', threshold: false } },
    } as RawGraph
    expect(buildLearnPreview(allTaught, new Set(), (id) => id)).toBeNull()
  })

  it('never includes claim, rubric, or transfer_probe on the returned shape', () => {
    const preview = buildLearnPreview(graph, new Set(), (id) => id)
    const json = JSON.stringify(preview)
    expect(json).not.toContain('secret')
  })

  it('applies the humanizer to the title', () => {
    const preview = buildLearnPreview(graph, new Set(), (id) => `TITLE(${id})`)
    expect(preview?.nodeTitle).toBe('TITLE(unpacked-two)')
  })
})
