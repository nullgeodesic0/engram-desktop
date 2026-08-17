import { describe, expect, it } from 'vitest'
import { conceptKindMarkPath, type ConceptKind } from './marks'
import { fillTriangles, flattenPath } from './engine/gl/geometry'

const ALL_KINDS: ConceptKind[] = [
  'causal-parameter',
  'dynamic-process',
  'structural',
  'distributional',
  'procedural',
  'comparative',
]

/** Signed polygon area via the shoelace formula — the ground truth every
 * badge's fan-triangulated area is checked against below. */
function shoelaceArea(points: number[]): number {
  let sum = 0
  const n = points.length / 2
  for (let i = 0; i < n; i++) {
    const [x0, y0] = [points[i * 2], points[i * 2 + 1]]
    const [x1, y1] = [points[((i + 1) % n) * 2], points[((i + 1) % n) * 2 + 1]]
    sum += x0 * y1 - x1 * y0
  }
  return Math.abs(sum) / 2
}

function triangleListArea(tris: number[]): number {
  let sum = 0
  for (let i = 0; i < tris.length; i += 6) {
    const [x0, y0, x1, y1, x2, y2] = tris.slice(i, i + 6)
    sum += Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2
  }
  return sum
}

describe('conceptKindMarkPath — the viz.kind badge vocabulary', () => {
  it('draws a distinct, closed path for every kind', () => {
    const paths = ALL_KINDS.map((k) => conceptKindMarkPath(k, 10))
    expect(new Set(paths).size).toBe(ALL_KINDS.length)
    for (const d of paths) expect(d.trim().endsWith('Z')).toBe(true)
  })

  // The real regression this file exists to catch: `fillTriangles` fans
  // from the path's first vertex (see marks.ts's own doctrine comment on
  // `ConceptKind`), which only tiles a polygon correctly when it is convex.
  // A non-convex badge would still "flatten" without error — flattenPath
  // just reads vertices — but its triangulated area would silently diverge
  // from the polygon's true (shoelace) area as slivers outside the actual
  // shape get included or pieces inside it get missed. Exact equality
  // (within float slop) is only possible because every shape here IS
  // convex; this test is what enforces that stays true if a shape is ever
  // added or edited.
  it('triangulates to exactly its own true area, for every kind', () => {
    for (const k of ALL_KINDS) {
      const d = conceptKindMarkPath(k, 10)
      const [poly] = flattenPath(d)
      const trueArea = shoelaceArea(poly.points)
      const triArea = triangleListArea(fillTriangles(d))
      expect(triArea).toBeCloseTo(trueArea, 1)
    }
  })

  it('scales with the requested radius', () => {
    const small = fillTriangles(conceptKindMarkPath('structural', 5))
    const large = fillTriangles(conceptKindMarkPath('structural', 20))
    expect(triangleListArea(large)).toBeGreaterThan(triangleListArea(small) * 4)
  })
})
