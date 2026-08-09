import { describe, it, expect } from 'vitest'
import { buildRuler, snapToItem, stepBudget } from './sittingRuler'
import { buildPaceModel } from '../../../shared/sittingPace'

// Three samples per topic is the floor for a topic's own median to be used.
const pace = buildPaceModel([
  ...Array.from({ length: 3 }, () => ({ topic: 'slow', seconds: 600 })), // 10 min
  ...Array.from({ length: 3 }, () => ({ topic: 'fast', seconds: 120 })), // 2 min
])

const item = (topic: string, id: string, overdue = 0) => ({ topic, id, overdue_days: overdue })

describe('buildRuler', () => {
  it('gives each item a width proportional to its own measured cost', () => {
    const r = buildRuler([item('slow', 'a'), item('fast', 'b')], pace, 60)
    const [a, b] = r.segments
    expect(a.seconds).toBe(600)
    expect(b.seconds).toBe(120)
    // The whole point: unequal items must look unequal.
    expect(a.end - a.start).toBeCloseTo(5 * (b.end - b.start), 5)
  })

  it('lays segments end to end across the full ruler', () => {
    const r = buildRuler([item('slow', 'a'), item('fast', 'b'), item('fast', 'c')], pace, 60)
    expect(r.segments[0].start).toBe(0)
    expect(r.segments.at(-1)!.end).toBeCloseTo(1, 6)
    for (let i = 1; i < r.segments.length; i++) {
      expect(r.segments[i].start).toBeCloseTo(r.segments[i - 1].end, 6)
    }
  })

  it('agrees with planSitting about what fits', () => {
    // The ruler and the estimate printed beside it must never disagree, so
    // `inside` mirrors planSitting's walk exactly.
    const items = [item('fast', 'a'), item('fast', 'b'), item('slow', 'c')]
    const r = buildRuler(items, pace, 5) // 300s: two fast items (240s) fit
    expect(r.items).toBe(2)
    expect(r.plannedSeconds).toBe(240)
    expect(r.segments.map((s) => s.inside)).toEqual([true, true, false])
  })

  it('always serves at least one item, and says when that one overruns', () => {
    // Refusing to serve anything because the honest estimate is too long
    // would turn a good estimate into a locked door.
    const r = buildRuler([item('slow', 'a'), item('fast', 'b')], pace, 1)
    expect(r.items).toBe(1)
    expect(r.overruns).toBe(true)
  })

  it('does not claim an overrun when the budget genuinely covers the work', () => {
    const r = buildRuler([item('fast', 'a')], pace, 30)
    expect(r.overruns).toBe(false)
  })

  it('marks segments whose width came from the overall median, not the topic', () => {
    // `unknown` has no samples of its own, so its width is a fallback and the
    // ruler must be able to say so rather than presenting it as measured.
    const r = buildRuler([item('slow', 'a'), item('unknown', 'b')], pace, 60)
    expect(r.segments[0].measured).toBe(true)
    expect(r.segments[1].measured).toBe(false)
  })

  it('falls back to a flat cost with no pace model at all', () => {
    const r = buildRuler([item('a', 'x'), item('b', 'y')], null, 10)
    expect(r.segments.every((s) => s.seconds === 60)).toBe(true)
    expect(r.totalSeconds).toBe(120)
  })

  it('returns an empty ruler for an empty queue', () => {
    const r = buildRuler([], pace, 25)
    expect(r.segments).toHaveLength(0)
    expect(r.totalSeconds).toBe(0)
    expect(r.boundary).toBe(0)
    expect(r.overruns).toBe(false)
  })

  it('clamps the boundary to the ruler when the budget exceeds the queue', () => {
    const r = buildRuler([item('fast', 'a')], pace, 600)
    expect(r.boundary).toBe(1)
  })
})

describe('snapToItem', () => {
  const items = [item('fast', 'a'), item('fast', 'b'), item('slow', 'c')] // 120, 120, 600
  const r = buildRuler(items, pace, 10)

  it('snaps to item edges, never mid-item', () => {
    // A budget stopping halfway through an item is a number that cannot
    // happen — the sitting either serves it or it does not.
    const edges = [2, 4, 14] // cumulative minutes at each edge
    for (const f of [0.01, 0.2, 0.4, 0.6, 0.9, 1]) {
      expect(edges).toContain(snapToItem(r, f))
    }
  })

  it('picks the nearest edge', () => {
    expect(snapToItem(r, 0)).toBe(2) // first edge, 120s
    expect(snapToItem(r, 1)).toBe(14) // last edge, 840s
    // 240/840 = 0.286 is exactly the second edge.
    expect(snapToItem(r, 240 / 840)).toBe(4)
  })

  it('clamps out-of-range drags instead of returning nonsense', () => {
    expect(snapToItem(r, -5)).toBe(2)
    expect(snapToItem(r, 99)).toBe(14)
  })

  it('never returns zero minutes', () => {
    const tiny = buildRuler([{ topic: 'fast', id: 'a' }], buildPaceModel([{ topic: 'fast', seconds: 5 }]), 1)
    expect(snapToItem(tiny, 0)).toBeGreaterThanOrEqual(1)
  })

  it('is a no-op on an empty queue', () => {
    expect(snapToItem(buildRuler([], pace, 10), 0.5)).toBe(0)
  })
})

describe('stepBudget', () => {
  const r = buildRuler([item('fast', 'a'), item('fast', 'b'), item('slow', 'c')], pace, 4)

  it('walks one item at a time so the ruler is not pointer-only', () => {
    expect(r.items).toBe(2)
    expect(stepBudget(r, 1)).toBe(14) // through the slow item
    expect(stepBudget(r, -1)).toBe(2) // back to just the first
  })

  it('stops at both ends rather than running off', () => {
    const atStart = buildRuler([item('fast', 'a'), item('fast', 'b')], pace, 1)
    expect(stepBudget(atStart, -1)).toBe(2) // already at one item
    const atEnd = buildRuler([item('fast', 'a'), item('fast', 'b')], pace, 999)
    expect(stepBudget(atEnd, 1)).toBe(4) // already covers everything
  })
})
