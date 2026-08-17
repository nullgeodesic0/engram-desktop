import { describe, expect, it } from 'vitest'
import {
  arcTriangles,
  fillTriangles,
  flattenPath,
  flowDashes,
  ringTriangles,
  strokePolyline,
  strokeTriangles,
  transformTriangles,
  triangulateFan,
} from './geometry'

/** A closed diamond, one M/L/L/L/Z — the shape of every filled mark this
 * engine draws, without depending on marks.ts (whose own path-grammar
 * round-trip tests live in marks.test.ts once marks.ts exists). */
const DIAMOND = (r: number): string => `M 0 ${-r} L ${r} 0 L 0 ${r} L ${-r} 0 Z`

/** Two half-arcs, sweeping opposite directions, meeting at the poles — the
 * shape `ringMarkPath` draws in marks.ts, reproduced here so geometry.ts's
 * arc-flattening has something real to read back without that dependency. */
const RING = (r: number): string => `M 0 ${-r} A ${r} ${r} 0 0 1 0 ${r} A ${r} ${r} 0 0 1 0 ${-r} Z`

/** Every point of a flattened path, as (x,y) pairs. */
function pairs(points: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < points.length; i += 2) out.push([points[i], points[i + 1]])
  return out
}

describe('reading the path grammar back', () => {
  it('flattens a straight-line mark to its own corners', () => {
    const [poly] = flattenPath(DIAMOND(10))
    expect(poly.closed).toBe(true)
    // A diamond is four points; the closing Z must not duplicate the first.
    expect(pairs(poly.points)).toHaveLength(4)
  })

  it('gives a filled path a non-empty, well-formed triangle list', () => {
    const tris = fillTriangles(DIAMOND(10))
    expect(tris.length).toBeGreaterThan(0)
    expect(tris.length % 6).toBe(0)
    expect(tris.every(Number.isFinite)).toBe(true)
  })

  // The ring is the shape that exercises arcs — an arc read wrongly is the
  // failure that would go unnoticed, since it still draws *something*.
  it('reconstructs a ring as a circle of the right radius', () => {
    const [poly] = flattenPath(RING(10))
    const radii = pairs(poly.points).map(([x, y]) => Math.hypot(x, y))
    for (const r of radii) expect(r).toBeCloseTo(10, 3)
    expect(radii.length).toBeGreaterThan(16)
  })

  it('walks the ring the whole way round, not across it', () => {
    const [poly] = flattenPath(RING(10))
    const angles = pairs(poly.points).map(([x, y]) => Math.atan2(y, x))
    let turned = 0
    for (let i = 1; i < angles.length; i++) {
      let step = angles[i] - angles[i - 1]
      while (step > Math.PI) step -= Math.PI * 2
      while (step < -Math.PI) step += Math.PI * 2
      turned += step
    }
    // Two half-arcs, one full turn.
    expect(Math.abs(turned)).toBeCloseTo(Math.PI * 2, 1)
  })

  it('flattens a quadratic curve into segments that start and end at its endpoints', () => {
    const d = 'M 0 0 Q 50 40 100 0'
    const [poly] = flattenPath(d)
    const pts = pairs(poly.points)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[pts.length - 1]).toEqual([100, 0])
    // Bowed toward the control point, so it must leave the straight line.
    expect(Math.max(...pts.map(([, y]) => Math.abs(y)))).toBeGreaterThan(1)
  })

  it('returns nothing for an empty or unreadable path rather than throwing', () => {
    expect(fillTriangles('')).toEqual([])
    expect(flattenPath('')).toEqual([])
    expect(fillTriangles('M 1 1')).toEqual([])
  })
})

describe('turning outlines into triangles', () => {
  it('fans a polygon into one triangle per edge', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10]
    expect(triangulateFan(square)).toHaveLength(4 * 6)
  })

  it('refuses a degenerate polygon', () => {
    expect(triangulateFan([0, 0, 1, 1])).toEqual([])
  })

  it('strokes a segment into a quad of the requested width', () => {
    const tris = strokePolyline([0, 0, 10, 0], 4, false)
    const ys = tris.filter((_, i) => i % 2 === 1)
    expect(Math.max(...ys)).toBeCloseTo(2, 6)
    expect(Math.min(...ys)).toBeCloseTo(-2, 6)
  })

  it('closes a stroked loop, so a ring outline has no gap', () => {
    const open = strokePolyline([0, 0, 10, 0, 10, 10], 1, false)
    const shut = strokePolyline([0, 0, 10, 0, 10, 10], 1, true)
    expect(shut.length).toBeGreaterThan(open.length)
  })

  it('skips zero-length segments instead of emitting NaN', () => {
    const tris = strokePolyline([5, 5, 5, 5, 10, 5], 2, false)
    expect(tris.every(Number.isFinite)).toBe(true)
  })
})

describe('the shapes drawn without a path', () => {
  it('builds an annulus around its radius', () => {
    const tris = ringTriangles(0, 0, 20, 4)
    const radii: number[] = []
    for (let i = 0; i < tris.length; i += 2) radii.push(Math.hypot(tris[i], tris[i + 1]))
    expect(Math.min(...radii)).toBeCloseTo(18, 6)
    expect(Math.max(...radii)).toBeCloseTo(22, 6)
  })

  it('sweeps an arc proportional to the fraction given', () => {
    const quarter = arcTriangles(0, 0, 20, 3, 0.25).length
    const half = arcTriangles(0, 0, 20, 3, 0.5).length
    expect(half).toBeGreaterThan(quarter)
    expect(arcTriangles(0, 0, 20, 3, 0)).toEqual([])
  })

  it('starts the sweep at twelve o’clock', () => {
    const tris = arcTriangles(0, 0, 20, 2, 0.25)
    // The first vertex sits on the inner edge, straight up from the centre.
    expect(tris[0]).toBeCloseTo(0, 6)
    expect(tris[1]).toBeCloseTo(-19, 6)
  })

  it('clamps a fraction past one rather than winding twice', () => {
    expect(arcTriangles(0, 0, 20, 3, 4).length).toBe(arcTriangles(0, 0, 20, 3, 1).length)
  })
})

describe('placing a shape in the world', () => {
  it('scales and translates', () => {
    expect(transformTriangles([1, 0, 0, 1, -1, 0], 10, 20, 2)).toEqual([12, 20, 10, 22, 8, 20])
  })

  it('rotates a quarter turn', () => {
    const [x, y] = transformTriangles([1, 0], 0, 0, 1, Math.PI / 2)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(1, 6)
  })
})

describe('flowing dashes along an edge', () => {
  const line = [0, 0, 100, 0]

  it('lays dashes along the line', () => {
    const dashes = flowDashes(line, 10, 10, 0)
    expect(dashes.length).toBeGreaterThan(2)
    for (const [x0, y0, x1, y1] of dashes) {
      expect(y0).toBeCloseTo(0, 6)
      expect(y1).toBeCloseTo(0, 6)
      expect(x1).toBeGreaterThan(x0)
    }
  })

  it('marches forward as the phase advances', () => {
    const a = flowDashes(line, 10, 10, 0)
    const b = flowDashes(line, 10, 10, 0.5)
    expect(a.map((d) => d[0].toFixed(3)).join()).not.toBe(b.map((d) => d[0].toFixed(3)).join())
  })

  it('wraps without gaps at the seam, so the flow never stutters', () => {
    const before = flowDashes(line, 10, 10, 0.999)
    const after = flowDashes(line, 10, 10, 0.001)
    expect(before.length).toBeGreaterThan(0)
    expect(after.length).toBeGreaterThan(0)
    expect(Math.abs(before.length - after.length)).toBeLessThanOrEqual(1)
  })

  it('keeps dashes inside the line, never running off the end', () => {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      for (const [x0, , x1] of flowDashes(line, 10, 10, phase)) {
        expect(x0).toBeGreaterThanOrEqual(-0.001)
        expect(x1).toBeLessThanOrEqual(100.001)
      }
    }
  })

  it('measures by arc length, so a bend does not stretch the dashes', () => {
    const bent = [0, 0, 100, 0, 100, 100]
    for (const [x0, y0, x1, y1] of flowDashes(bent, 10, 10, 0.3)) {
      const len = Math.hypot(x1 - x0, y1 - y0)
      expect(len).toBeLessThanOrEqual(10.001)
      expect(len).toBeGreaterThan(0)
    }
  })

  it('says nothing for a degenerate path or pattern', () => {
    expect(flowDashes([0, 0], 10, 10, 0)).toEqual([])
    expect(flowDashes(line, 0, 0, 0)).toEqual([])
    expect(flowDashes([5, 5, 5, 5], 10, 10, 0)).toEqual([])
  })
})

describe('the vertex budget a frame can afford', () => {
  it('does not put joints on a smooth curve', () => {
    const thin = strokeTriangles(RING(10), 1.2).length
    const wide = strokeTriangles(RING(10), 4).length
    expect(wide).toBe(thin)
  })

  it('still joints a real corner', () => {
    const corner = strokePolyline([0, 0, 100, 0, 100, 100], 6, false)
    const bare = strokePolyline([0, 0, 100, 0, 100, 100], 1, false)
    expect(corner.length).toBeGreaterThan(bare.length)
  })

  it('flattens a small mark to a small number of sides', () => {
    const small = flattenPath(RING(8))[0].points.length / 2
    const large = flattenPath(RING(80))[0].points.length / 2
    expect(small).toBeLessThan(24)
    expect(large).toBeGreaterThan(small)
  })

  it('keeps a whole dense plate inside a sane per-frame budget', () => {
    let verts = 0
    for (let i = 0; i < 110; i++) {
      const d = i % 3 === 0 ? RING(11) : DIAMOND(13)
      verts += fillTriangles(d).length / 2 + strokeTriangles(d, 2.4).length / 2
    }
    expect(verts).toBeLessThan(40_000)
  })
})
