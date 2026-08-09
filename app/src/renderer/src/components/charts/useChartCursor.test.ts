import { describe, it, expect } from 'vitest'
import { slotAt } from './useChartCursor'

const box = (left: number, width: number) => ({ left, width })

describe('slotAt', () => {
  it('splits the plot into `count` equal slots', () => {
    // 7 buckets over 700px, no gutter: each slot is 100px wide.
    const b = box(0, 700)
    expect(slotAt(0, b, 7)).toBe(0)
    expect(slotAt(99, b, 7)).toBe(0)
    expect(slotAt(100, b, 7)).toBe(1)
    expect(slotAt(650, b, 7)).toBe(6)
  })

  it('clamps past either end instead of returning null', () => {
    // A pointer just off the last bar is still pointing at the last bar.
    const b = box(0, 700)
    expect(slotAt(-40, b, 7)).toBe(0)
    expect(slotAt(700, b, 7)).toBe(6)
    expect(slotAt(9999, b, 7)).toBe(6)
  })

  it('accounts for the element being offset in the viewport', () => {
    // Same geometry, shifted 250px right: the answers must not move.
    expect(slotAt(250, box(250, 700), 7)).toBe(0)
    expect(slotAt(350, box(250, 700), 7)).toBe(1)
  })

  it('subtracts the axis gutter as a fraction, so it holds at any width', () => {
    // Both charts draw into a scaling viewBox, so a 16-unit gutter in a
    // 600-unit box is 2.67% of the rendered width at EVERY size. The same
    // fraction must therefore give the same slot boundary at two very
    // different widths — a pixel figure would be right at one only.
    const g = { left: 16 / 600 }
    //   320px box → 8.53px gutter → 311.5px plot → 7 slots of ~44.5px
    expect(slotAt(52, box(0, 320), 7, g)).toBe(0)
    expect(slotAt(54, box(0, 320), 7, g)).toBe(1)
    //   1200px box → 32px gutter → 1168px plot → slots of ~166.9px
    expect(slotAt(197, box(0, 1200), 7, g)).toBe(0)
    expect(slotAt(201, box(0, 1200), 7, g)).toBe(1)
    // The gutter itself always reads as the first slot, never negative.
    expect(slotAt(2, box(0, 320), 7, g)).toBe(0)
  })

  it('resolves every one of 180 ticks somewhere in range', () => {
    const b = box(0, 600)
    const seen = new Set<number>()
    for (let px = 0; px < 600; px++) {
      const s = slotAt(px, b, 180)
      expect(s).not.toBeNull()
      expect(s! >= 0 && s! < 180).toBe(true)
      seen.add(s!)
    }
    // 600px over 180 slots is 3.33px each — every day must be reachable.
    expect(seen.size).toBe(180)
  })

  it('returns null when there is nothing to point at', () => {
    expect(slotAt(10, box(0, 700), 0)).toBeNull()
    expect(slotAt(10, box(0, 0), 7)).toBeNull()
    // Gutters wider than the box leave no plot.
    expect(slotAt(10, box(0, 30), 7, { left: 20, right: 20 })).toBeNull()
  })
})
