import { describe, expect, it } from 'vitest'
import { pinNode, tickLayout, type AtlasLayout, type AtlasNode, type AtlasRegion } from './layout'

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
    kind: null,
    ...overrides,
  }
}

function layoutOf(nodes: AtlasNode[], regions: AtlasRegion[] = []): AtlasLayout {
  return {
    nodes,
    edges: [],
    regions,
    width: 800,
    height: 600,
    hubNodeIds: new Set(),
    capstoneIds: new Set(),
    forwardAdjacency: new Map(),
  }
}

function centroidOf(nodes: readonly AtlasNode[]): { x: number; y: number } {
  const x = nodes.reduce((s, n) => s + n.x, 0) / nodes.length
  const y = nodes.reduce((s, n) => s + n.y, 0) / nodes.length
  return { x, y }
}

function meanSpread(nodes: readonly AtlasNode[]): number {
  const c = centroidOf(nodes)
  return nodes.reduce((s, n) => s + Math.hypot(n.x - c.x, n.y - c.y), 0) / nodes.length
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

describe('tickLayout — region cohesion (the "tangled mess" regression)', () => {
  it('pulls a scattered region back toward its own centroid over many ticks', () => {
    // Loosely scattered, well clear of collision range — spread must shrink
    // from cohesion alone, not from resolveCrowding pushing members apart.
    const members = [
      node({ id: 'a', x: 100, y: 100, r: 8 }),
      node({ id: 'b', x: 400, y: 100, r: 8 }),
      node({ id: 'c', x: 100, y: 400, r: 8 }),
      node({ id: 'd', x: 400, y: 400, r: 8 }),
      node({ id: 'e', x: 250, y: 250, r: 8 }),
    ]
    const region: AtlasRegion = { seed: 'a', name: 'Sub-topic', memberIds: members.map((m) => m.id) }
    const layout = layoutOf(members, [region])
    const before = meanSpread(members)
    for (let i = 0; i < 200; i++) tickLayout(layout, 0.02, 400, 300)
    expect(meanSpread(members)).toBeLessThan(before * 0.5)
  })

  it('keeps two distinct regions from merging into one blob', () => {
    const left = Array.from({ length: 4 }, (_, i) => node({ id: `l${i}`, x: 100 + i * 15, y: 100 + i * 10, r: 8 }))
    const right = Array.from({ length: 4 }, (_, i) => node({ id: `r${i}`, x: 700 + i * 15, y: 500 + i * 10, r: 8 }))
    const regions: AtlasRegion[] = [
      { seed: 'l0', name: 'Left', memberIds: left.map((m) => m.id) },
      { seed: 'r0', name: 'Right', memberIds: right.map((m) => m.id) },
    ]
    const layout = layoutOf([...left, ...right], regions)
    for (let i = 0; i < 200; i++) tickLayout(layout, 0.02, 400, 300)
    const gap = Math.hypot(centroidOf(left).x - centroidOf(right).x, centroidOf(left).y - centroidOf(right).y)
    // Each region tightens around its own centroid; the two centroids stay
    // far apart — cohesion pulls WITHIN a region, never between regions.
    expect(gap).toBeGreaterThan(300)
    expect(meanSpread(left)).toBeLessThan(60)
    expect(meanSpread(right)).toBeLessThan(60)
  })

  it('never pulls a dragged (pinned) region member off the reader\'s hand', () => {
    const dragged = node({ id: 'held', x: 900, y: 900, r: 8, fx: 900, fy: 900 })
    const others = Array.from({ length: 3 }, (_, i) => node({ id: `o${i}`, x: 100 + i * 10, y: 100 + i * 10, r: 8 }))
    const region: AtlasRegion = { seed: 'held', name: 'Sub-topic', memberIds: [dragged.id, ...others.map((m) => m.id)] }
    const layout = layoutOf([dragged, ...others], [region])
    for (let i = 0; i < 50; i++) tickLayout(layout, 0.5, 400, 300)
    expect(dragged.x).toBe(900)
    expect(dragged.y).toBe(900)
  })

  it('does not yank a region\'s other members toward a fast-moving drag — the reported "shaking"', () => {
    // A region of comfortably-spaced (not pre-overlapping) members; one is
    // then dragged from far away, sweeping through the cluster one tick at
    // a time, the way a real fast mouse drag delivers a new pinned position
    // every frame. The OTHER members should keep settling smoothly, not
    // lurch toward wherever the drag currently is — a region's live
    // centroid must not include a pinned member's position, or every other
    // member chases it every tick.
    const dragged = node({ id: 'held', x: -400, y: 300, r: 8, fx: -400, fy: 300 })
    const others = [
      node({ id: 'o0', x: 400, y: 300, r: 8 }),
      node({ id: 'o1', x: 460, y: 300, r: 8 }),
      node({ id: 'o2', x: 400, y: 360, r: 8 }),
    ]
    const region: AtlasRegion = { seed: 'held', name: 'Sub-topic', memberIds: ['held', ...others.map((m) => m.id)] }
    const layout = layoutOf([dragged, ...others], [region])

    let worstJump = 0
    for (let i = 0; i < 80; i++) {
      pinNode(layout, 'held', -400 + i * 10, 300)
      const before = others.map((o) => ({ x: o.x, y: o.y }))
      tickLayout(layout, 0.15, 400, 300)
      for (let k = 0; k < others.length; k++) {
        worstJump = Math.max(worstJump, Math.hypot(others[k].x - before[k].x, others[k].y - before[k].y))
      }
    }
    // A centroid dragged along by the pinned node's own fast motion would
    // produce jumps well past this; a settled region only ever nudges.
    expect(worstJump).toBeLessThan(15)
  })

  it('spreads a close drag-graze over a few ticks instead of one instant snap', () => {
    // A dragged node parked deep inside a single neighbour's clearance —
    // the "brief close graze" a fast drag produces routinely. Uncapped,
    // resolveCrowding's pinned-push branch closes the ENTIRE overlap in
    // one sweep; capped, the neighbour steps out over a few ticks instead.
    const dragged = node({ id: 'held', x: 400, y: 300, r: 10, fx: 400, fy: 300 })
    const grazed = node({ id: 'n', x: 408, y: 300, r: 10 }) // centres 8 apart; minDist = 50
    const layout = layoutOf([dragged, grazed])
    const firstTickJump = (() => {
      const before = { x: grazed.x, y: grazed.y }
      tickLayout(layout, 0.15, 400, 300)
      return Math.hypot(grazed.x - before.x, grazed.y - before.y)
    })()
    // The overlap here is 42 — an uncapped sweep resolves the whole thing
    // in one tick; the capped push must not.
    expect(firstTickJump).toBeLessThan(20)
    // ...but it still fully resolves within a handful of frames.
    for (let i = 0; i < 20; i++) tickLayout(layout, 0.15, 400, 300)
    expect(Math.hypot(grazed.x - dragged.x, grazed.y - dragged.y)).toBeGreaterThanOrEqual(dragged.r + grazed.r + 29)
  })
})
