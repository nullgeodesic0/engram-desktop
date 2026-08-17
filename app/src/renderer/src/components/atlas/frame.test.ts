import { describe, expect, it } from 'vitest'
import { isEdgeVisible } from './frame'

describe('isEdgeVisible — capstone vs. ordinary structural hub', () => {
  it('shows an edge touching neither a hub nor a capstone', () => {
    const visible = isEdgeVisible({ source: 'a', target: 'b', kind: 'requires' }, new Set(), new Map())
    expect(visible).toBe(true)
  })

  it('keeps the "only dependent" exception for an ordinary structural hub', () => {
    const hubNodeIds = new Set(['hub'])
    const forwardAdjacency = new Map([['a', ['hub']]])
    // 'a' has exactly one dependent (the hub itself) — the genuine last
    // step before mastery, still shown.
    expect(isEdgeVisible({ source: 'a', target: 'hub', kind: 'requires' }, hubNodeIds, forwardAdjacency)).toBe(true)
  })

  it('still hides an ordinary hub edge when the source has other dependents too', () => {
    const hubNodeIds = new Set(['hub'])
    const forwardAdjacency = new Map([['a', ['hub', 'other']]])
    expect(isEdgeVisible({ source: 'a', target: 'hub', kind: 'requires' }, hubNodeIds, forwardAdjacency)).toBe(false)
  })

  it('hides EVERY edge touching a capstone, including the one that would survive the hub exception', () => {
    const hubNodeIds = new Set(['cap'])
    const capstoneIds = new Set(['cap'])
    // Same shape as the "only dependent" case above — under the plain hub
    // rule this would be visible. A capstone drops the exception entirely.
    const forwardAdjacency = new Map([['a', ['cap']]])
    expect(isEdgeVisible({ source: 'a', target: 'cap', kind: 'requires' }, hubNodeIds, forwardAdjacency, capstoneIds)).toBe(false)
  })

  it('hides a non-requires edge touching a capstone too', () => {
    const hubNodeIds = new Set(['cap'])
    const capstoneIds = new Set(['cap'])
    expect(isEdgeVisible({ source: 'cap', target: 'b', kind: 'analogous_to' }, hubNodeIds, new Map(), capstoneIds)).toBe(false)
  })

  it('capstoneIds defaults to empty — omitting it reproduces the plain hub behaviour exactly', () => {
    const hubNodeIds = new Set(['hub'])
    const forwardAdjacency = new Map([['a', ['hub']]])
    expect(isEdgeVisible({ source: 'a', target: 'hub', kind: 'requires' }, hubNodeIds, forwardAdjacency)).toBe(true)
  })
})
