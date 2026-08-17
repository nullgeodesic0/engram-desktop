/** The topic map's mark vocabulary — every SVG path string a node, edge, or
 * piece of plate furniture is drawn from.
 *
 * Same discipline Cairn's `marks.ts` established: shapes live here as path
 * strings, once, and `engine/gl/geometry.ts` reads that grammar back into
 * triangles rather than a second, GL-only definition of what a threshold
 * node looks like existing alongside this one. `ringMarkPath`/
 * `diamondMarkPath` are NOT redefined here — they already exist in
 * `graph2d/plate.ts` (used by the Key, the print export, and this engine
 * alike) and are re-exported below so every consumer keeps reading from one
 * source.
 *
 * The edge geometry (`stringEdgePath`, `arrowheadTransform`,
 * `ARROWHEAD_PATH`) and `cornerTicks` are ported from the retired
 * `GraphView.tsx`, with one deliberate change: the old "loose string" edge
 * carried both a deterministic per-edge bow AND an ambient time-driven sway
 * (a decorative wobble standing in for motion the frozen SVG layout didn't
 * otherwise have). This engine's nodes now move for real, via live physics
 * (`layout.ts`'s `tickLayout`) — so the sway term is dropped as redundant
 * with real motion, and only the deterministic bow (the actual "strings
 * aren't straight lines" character) is kept. */

import { seeded } from '../graph3d/layout'
import { diamondMarkPath, ringMarkPath } from '../graph2d/plate'

export { ringMarkPath, diamondMarkPath }

/** Which glyph a node's own `threshold` flag selects — diamond for a
 * threshold concept, ring otherwise. Capstones use `ringMarkPath` too (their
 * distinctness is the concentric-ring + progress-arc TREATMENT the painter
 * gives them, not a different base glyph — see `frame.ts`'s `markKind`). */
export function nodeMarkPath(threshold: boolean, r: number): string {
  return threshold ? diamondMarkPath(r) : ringMarkPath(r)
}

/** A filled half-disc, flat side down — the "learning" state's half-fill.
 *
 * The SVG renderer clipped a full ring's fill to its top half with a
 * `clipPath`; WebGL has no clip paths, so the shape is drawn directly as a
 * semicircle instead. Expressed as a path (an arc plus the closing chord)
 * so it goes through the same fill/stroke grammar as every other mark
 * rather than needing a bespoke GL primitive. */
export function halfDiscMarkPath(r: number): string {
  return `M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0 Z`
}

/** Shared control-point math for the edge quadratic — factored out of
 * `stringEdgePath` so `arrowheadTransform` samples the EXACT same curve
 * rather than a re-derivation that could silently drift out of sync with
 * the stroked spine. Deterministic per-edge bow only (see this file's own
 * doctrine comment on why the old ambient sway term is gone). */
function edgeBezierControl(
  source: string,
  target: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
  kind: 'requires' | 'other',
): { cx: number; cy: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const nx = -dy / len
  const ny = dx / len
  const key = `${source}::${target}`
  const sign = seeded(key, 7) < 0.5 ? -1 : 1
  const baseBow = kind === 'requires' ? len * 0.08 * sign : 0
  return { cx: mx + nx * baseBow, cy: my + ny * baseBow }
}

/** Edge geometry as a "loose string" — a quadratic bezier whose control
 * point carries a deterministic per-edge bow (requires edges only), so
 * links read as slack threads rather than ruled lines. Shared by the base
 * edge layer and the hover/selection trail overlay so trail edges sit
 * exactly on top of their base edge. */
export function stringEdgePath(
  source: string,
  target: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
  kind: 'requires' | 'other',
): string {
  const { cx, cy } = edgeBezierControl(source, target, a, b, kind)
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

/** Small filled arrowhead at the dependent end of a requires edge, oriented
 * along the spine's own end tangent (so it "points the way the string
 * travels" — from prerequisite into dependent). Returns the tip position
 * and rotation the painter places `ARROWHEAD_PATH` at; screen-constant
 * sizing is the painter's job (it draws in world space and divides stroke
 * widths by zoom, the same discipline every other mark uses). */
export function arrowheadPlacement(
  source: string,
  target: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
  targetRadius: number,
): { x: number; y: number; angleRad: number } {
  const { cx, cy } = edgeBezierControl(source, target, a, b, 'requires')
  // Tangent at s=1: B'(1) = 2(B - C).
  const tx = 2 * (b.x - cx)
  const ty = 2 * (b.y - cy)
  const tlen = Math.hypot(tx, ty) || 1
  const angleRad = Math.atan2(ty, tx)
  // The spine runs all the way to the target node's centre (node bodies
  // paint after edges, so the segment inside a node's own disc is simply
  // drawn over). Pulled back along the tangent by the node's own radius so
  // the arrowhead sits right at the rim rather than buried under the node.
  const x = b.x - (tx / tlen) * targetRadius
  const y = b.y - (ty / tlen) * targetRadius
  return { x, y, angleRad }
}

/** Arrowhead glyph, tip at the origin, pointing along +x — rotated/placed by
 * `arrowheadPlacement`'s result. */
export const ARROWHEAD_PATH = 'M -6 -3 L 0 0 L -6 3 Z'

/** Corner registration ticks — small printing-plate crop marks bracketing
 * each corner of the plate rect. Pure function of the plate's measured
 * size, called once per frame from the static furniture layer. */
const CORNER_TICK = 12
export function cornerTicks(w: number, h: number): string[] {
  return [
    `M 0 ${CORNER_TICK} L 0 0 L ${CORNER_TICK} 0`,
    `M ${w - CORNER_TICK} 0 L ${w} 0 L ${w} ${CORNER_TICK}`,
    `M ${w} ${h - CORNER_TICK} L ${w} ${h} L ${w - CORNER_TICK} ${h}`,
    `M ${CORNER_TICK} ${h} L 0 ${h} L 0 ${h - CORNER_TICK}`,
  ]
}

/** Centres of the small dots ringing a node with `fsrs.lapses > 0` — the
 * lapse-stipple decoration. Geometry only; the painter draws each as a tiny
 * filled disc via `discTriangles`. Count is fixed at 8, matching the old
 * SVG renderer's own stipple ring exactly. */
export function lapseStippleDots(r: number, count = 8): Array<{ x: number; y: number }> {
  const ringR = r + 4
  const dots: Array<{ x: number; y: number }> = []
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    dots.push({ x: Math.cos(a) * ringR, y: Math.sin(a) * ringR })
  }
  return dots
}
