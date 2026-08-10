import { describe, expect, it } from 'vitest'
import { arcPrefixesOf, humanizeWithArcs } from '../../shared/humanizeId'

// The real shapes, taken from the corpus on disk.
const STAT_MECH = [
  'fd-microcanonical-entropy', 'fd-equipartition-virial', 'fd-phase-space-liouville',
  'ce-canonical-partition-function', 'ce-grand-partition-function', 'ce-free-energy',
  'qs-grand-canonical-mode-factorization', 'qs-bose-einstein', 'qs-fermi-dirac',
  'capstone',
]

describe('arcPrefixesOf', () => {
  it('finds a prefix shared by three or more siblings', () => {
    expect([...arcPrefixesOf(STAT_MECH)].sort()).toEqual(['ce', 'fd', 'qs'])
  })

  it('will not promote a prefix only two nodes share', () => {
    // Two is a coincidence; three is a convention. Without this, any pair of
    // nodes starting the same way would invent an arc.
    expect([...arcPrefixesOf(['ab-one', 'ab-two', 'zz-solo'])]).toEqual([])
  })

  it('accepts real words as prefixes, because this corpus uses them', () => {
    // `in-` and `an-` are arcs in the annealing topic. Any dictionary-based
    // rule would refuse them; sibling frequency does not care what a prefix
    // spells.
    const ids = ['in-a', 'in-b', 'in-c', 'an-x', 'an-y', 'an-z']
    expect([...arcPrefixesOf(ids)].sort()).toEqual(['an', 'in'])
  })

  it('will not promote a long shared word as a tag', () => {
    // Three nodes called `derivation-a/b/c` do share "derivation", but that is
    // a word they have in common, not a tag prefixed to them — promoting it
    // leaves the reader with "DERIVATION · A".
    expect([...arcPrefixesOf(['derivation-a', 'derivation-b', 'derivation-c'])]).toEqual([])
  })

  it('never treats a whole id as a prefix', () => {
    expect([...arcPrefixesOf(['solo', 'solo', 'solo'])]).toEqual([])
  })
})

describe('humanizeWithArcs', () => {
  const arcs = arcPrefixesOf(STAT_MECH)

  it('renders a known arc as a tag', () => {
    expect(humanizeWithArcs('ce-canonical-partition-function', arcs)).toBe(
      'CE · Canonical Partition Function',
    )
  })

  it('leaves a node with no arc exactly as before', () => {
    expect(humanizeWithArcs('capstone', arcs)).toBe('Capstone')
    expect(humanizeWithArcs('runge-lenz-vector', arcs)).toBe('Runge Lenz Vector')
  })

  it('is identical to plain humanising when no arcs are known', () => {
    // The context-free path must not change. so3-rotations was the false
    // positive that killed the guess-based rule.
    expect(humanizeWithArcs('so3-rotations', new Set())).toBe('So3 Rotations')
    expect(humanizeWithArcs('ce-canonical-partition-function', new Set())).toBe(
      'Ce Canonical Partition Function',
    )
  })
})
