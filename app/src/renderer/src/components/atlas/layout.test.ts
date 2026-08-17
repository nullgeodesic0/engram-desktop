import { describe, expect, it } from 'vitest'
import { tickLayout, type AtlasLayout, type AtlasNode } from './layout'

function node(overrides: Partial<AtlasNode> & { id: string }): AtlasNode {
  return {
    x: 0,
    y: 0,
    r: 10,
    baseR: 10,
    vx: 0,
    vy: 0,
    fx: null,
    fy: null,
    state: 'new',
    threshold: false,
    capstone: false,
    isHub: false,
    isFrontier: false,
    lapses: 0,
    due: null,
    degree: 0,
    ...overrides,
  }
}

function layoutOf(nodes: AtlasNode[]): AtlasLayout {
  return {
    nodes,
    edges: [],
    regions: [],
    width: 800,
    height: 600,
    hubNodeIds: new Set(),
    forwardAdjacency: new Map(),
  }
}

function minGap(layout: AtlasLayout): number {
  let min = Infinity
  const nodes = layout.nodes
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const gap = dist - (a.r + b.r)
      if (gap < min) min = gap
    }
  }
  return min
}

describe('tickLayout — the anti-crowding guarantee', () => {
  it('separates two nodes started exactly overlapping', () => {
    const a = node({ id: 'a', x: 400, y: 300, r: 10 })
    const b = node({ id: 'b', x: 400, y: 300, r: 10 })
    const layout = layoutOf([a, b])
    // A pure force sim alone has no direction to push along when two
    // centres coincide (dx/dy both 0) — the deterministic +x tie-break in
    // `resolveCrowding` is what this is actually testing.
    tickLayout(layout, 0.5, 400, 300)
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0)
  })

  it('holds real clearance between two nodes nudged into range, not just non-zero distance', () => {
    const a = node({ id: 'a', x: 400, y: 300, r: 10 })
    const b = node({ id: 'b', x: 415, y: 300, r: 10 }) // centres 15 apart, rims overlap by 5
    const layout = layoutOf([a, b])
    for (let i = 0; i < 5; i++) tickLayout(layout, 0.5, 400, 300)
    expect(minGap(layout)).toBeGreaterThanOrEqual(0)
  })

  it('never lets crowding creep back in across many idle ticks — the actual regression reported', () => {
    // A ring of nodes just inside collision range of their neighbours,
    // ticked at IDLE alpha for a long run (the "many quiet frames" case
    // that let repulsion's smooth falloff erode the gap over time).
    const ring = Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2
      return node({ id: `n${i}`, x: 400 + Math.cos(a) * 40, y: 300 + Math.sin(a) * 40, r: 12 })
    })
    const layout = layoutOf(ring)
    let worst = Infinity
    for (let i = 0; i < 200; i++) {
      tickLayout(layout, 0.02, 400, 300)
      worst = Math.min(worst, minGap(layout))
    }
    expect(worst).toBeGreaterThanOrEqual(-0.01) // allow float slop, never a real overlap
  })

  it('pushes a neighbour rather than moving a dragged (pinned) node', () => {
    const dragged = node({ id: 'held', x: 400, y: 300, r: 10, fx: 400, fy: 300 })
    const other = node({ id: 'free', x: 405, y: 300, r: 10 })
    const layout = layoutOf([dragged, other])
    tickLayout(layout, 0.5, 400, 300)
    expect(dragged.x).toBe(400)
    expect(dragged.y).toBe(300)
    expect(other.x).not.toBe(405)
  })

  it('leaves two already-comfortable nodes alone', () => {
    const a = node({ id: 'a', x: 200, y: 200, r: 10 })
    const b = node({ id: 'b', x: 600, y: 500, r: 10 })
    const layout = layoutOf([a, b])
    const before = { ax: a.x, ay: a.y, bx: b.x, by: b.y }
    tickLayout(layout, 0.02, 400, 300)
    // Only the weak centering force should move them, and only a hair —
    // resolveCrowding must not touch a pair this far apart at all.
    expect(Math.hypot(a.x - before.ax, a.y - before.ay)).toBeLessThan(5)
    expect(Math.hypot(b.x - before.bx, b.y - before.by)).toBeLessThan(5)
  })
})
