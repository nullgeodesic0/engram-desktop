/** SVG path strings into triangles and stroke quads.
 *
 * Marks are defined once, in `marks.ts`, as SVG path strings — that is
 * deliberate: the same strings can feed Canvas's `Path2D` and any future
 * DOM/print consumer, so "the plate's visual language stays one." A GPU
 * painter must not re-derive those shapes in numbers, or there would be two
 * definitions of what a threshold node looks like and only one of them
 * under test.
 *
 * So this module reads the grammar back rather than replacing it. It
 * handles exactly the commands `marks.ts` emits — M, L, Q, A, Z — and
 * nothing else, because a general SVG parser would be answering questions
 * no mark asks.
 *
 * Everything here is pure arithmetic on numbers, so it is tested in the
 * same plain node environment as the rest of the engine. The GL code that
 * consumes it is a thin, untested wrapper by design; this is where the
 * mistakes would otherwise live.
 *
 * Ported verbatim from CairnDesktop's atlas engine
 * (app/src/renderer/src/app/atlas/engine/gl/geometry.ts). */

export interface Poly {
  /** Flat [x0,y0,x1,y1,…] in path units, no closing duplicate. */
  points: number[]
  closed: boolean
}

/** Flatten a path into polylines. Curves become segments: `curveSteps` on a
 * quadratic, and arcs are split into the same number of steps per 90°,
 * which keeps a ring smooth at the zoom levels the plate reaches without
 * paying for vertices nobody can see. */
export function flattenPath(d: string, curveSteps = 12): Poly[] {
  const out: Poly[] = []
  let cur: number[] = []
  let cx = 0
  let cy = 0
  let startX = 0
  let startY = 0

  const tokens = d.match(/[MLQAZmlqaz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) ?? []
  let i = 0
  const num = (): number => Number(tokens[i++])

  const push = (closed: boolean): void => {
    if (cur.length >= 4) out.push({ points: cur, closed })
    cur = []
  }

  while (i < tokens.length) {
    const cmd = tokens[i++]
    switch (cmd) {
      case 'M': {
        push(false)
        cx = num()
        cy = num()
        startX = cx
        startY = cy
        cur = [cx, cy]
        break
      }
      case 'L': {
        cx = num()
        cy = num()
        cur.push(cx, cy)
        break
      }
      case 'Q': {
        const qx = num()
        const qy = num()
        const ex = num()
        const ey = num()
        for (let s = 1; s <= curveSteps; s++) {
          const t = s / curveSteps
          const mt = 1 - t
          cur.push(mt * mt * cx + 2 * mt * t * qx + t * t * ex, mt * mt * cy + 2 * mt * t * qy + t * t * ey)
        }
        cx = ex
        cy = ey
        break
      }
      case 'A': {
        // marks.ts emits only circular arcs (rx === ry), as the two halves
        // of a ring. Sweep direction and the large-arc flag both matter,
        // and both are read rather than assumed.
        const rx = num()
        num() // ry, equal to rx for every arc this codebase draws
        num() // x-axis-rotation, always 0 on a circle
        const largeArc = num()
        const sweep = num()
        const ex = num()
        const ey = num()
        appendArc(cur, cx, cy, ex, ey, rx, largeArc === 1, sweep === 1, curveSteps)
        cx = ex
        cy = ey
        break
      }
      case 'Z':
      case 'z': {
        push(true)
        cx = startX
        cy = startY
        break
      }
      default:
        // A stray number outside a command: skip it rather than spin.
        break
    }
  }
  push(false)
  return out
}

/** Circular arc from (x0,y0) to (x1,y1) of radius r, appended as segments.
 * The centre is one of the two points at distance r from both ends; which
 * one is picked is what `largeArc` and `sweep` decide. */
function appendArc(
  out: number[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  largeArc: boolean,
  sweep: boolean,
  stepsPerQuarter: number,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const half = Math.hypot(dx, dy) / 2
  if (half === 0) return
  const radius = Math.max(r, half)
  // Distance from the chord's midpoint out to the centre.
  const h = Math.sqrt(Math.max(0, radius * radius - half * half))
  const mx = (x0 + x1) / 2
  const my = (y0 + y1) / 2
  const ux = -dy / (half * 2)
  const uy = dx / (half * 2)
  const side = largeArc === sweep ? 1 : -1
  const ccx = mx + side * h * ux
  const ccy = my + side * h * uy

  let a0 = Math.atan2(y0 - ccy, x0 - ccx)
  let a1 = Math.atan2(y1 - ccy, x1 - ccx)
  if (sweep && a1 < a0) a1 += Math.PI * 2
  if (!sweep && a1 > a0) a1 -= Math.PI * 2
  const sweepAngle = a1 - a0
  // Segments proportional to the arc's drawn length rather than a fixed
  // count per quarter turn: a 10px mark reads as round with a dozen sides,
  // and the marks on this plate are small.
  const arcLen = Math.abs(sweepAngle) * radius
  const steps = Math.max(4, Math.min(stepsPerQuarter * 4, Math.ceil(arcLen / 3)))
  for (let s = 1; s <= steps; s++) {
    const a = a0 + (sweepAngle * s) / steps
    out.push(ccx + Math.cos(a) * radius, ccy + Math.sin(a) * radius)
  }
}

/** Fan-triangulate a polygon about its centroid.
 *
 * A centroid fan rather than ear clipping, because every filled shape on
 * this plate is convex or star-shaped about its middle — the marks by
 * construction, the region wash because it is a convex hull. Ear clipping
 * would be more code answering a case the mark grammar does not contain. */
export function triangulateFan(points: number[]): number[] {
  const n = points.length / 2
  if (n < 3) return []
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    cx += points[i * 2]
    cy += points[i * 2 + 1]
  }
  cx /= n
  cy /= n
  const tris: number[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    tris.push(cx, cy, points[i * 2], points[i * 2 + 1], points[j * 2], points[j * 2 + 1])
  }
  return tris
}

/** Expand a polyline into triangles of the given width.
 *
 * Segment quads plus a round-ish joint: each interior vertex gets a small
 * fan so a bowed edge does not show a notch where two segments meet.
 * Widths here are world units; the caller divides by zoom when a stroke
 * should stay constant on screen. */
export function strokePolyline(points: number[], width: number, closed: boolean): number[] {
  const n = points.length / 2
  if (n < 2) return []
  const half = width / 2
  const tris: number[] = []
  const last = closed ? n : n - 1

  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n
    const x0 = points[i * 2]
    const y0 = points[i * 2 + 1]
    const x1 = points[j * 2]
    const y1 = points[j * 2 + 1]
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    const nx = (-dy / len) * half
    const ny = (dx / len) * half
    tris.push(
      x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny,
      x0 + nx, y0 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny,
    )
  }

  // Joints, only where the line actually turns. A corner sharp enough to
  // show a gap is the only place a joint earns its triangles — putting one
  // on every vertex was catastrophic on a flattened circle, which turns
  // only a few degrees per segment and needed no joints at all: a ring paid
  // 1176 vertices instead of 294 as soon as the zoom dropped, and with a
  // hundred nodes on screen that is megabytes of geometry rebuilt every
  // frame.
  if (width > 1.5) {
    const first = closed ? 0 : 1
    const stop = closed ? n : n - 1
    for (let i = first; i < stop; i++) {
      if (turnsAt(points, i, n, closed) > JOINT_ANGLE) {
        appendDisc(tris, points[i * 2], points[i * 2 + 1], half, 6)
      }
    }
  }
  return tris
}

/** Above this turn, two segment quads leave a visible notch on their
 * outside edge and a joint is worth its triangles. Below it they overlap
 * enough to read as one continuous stroke. */
const JOINT_ANGLE = (24 * Math.PI) / 180

/** How sharply the polyline turns at vertex `i`, in radians. */
function turnsAt(points: readonly number[], i: number, n: number, closed: boolean): number {
  const prev = i === 0 ? (closed ? n - 1 : 0) : i - 1
  const next = i === n - 1 ? (closed ? 0 : n - 1) : i + 1
  if (prev === i || next === i) return 0
  const ax = points[i * 2] - points[prev * 2]
  const ay = points[i * 2 + 1] - points[prev * 2 + 1]
  const bx = points[next * 2] - points[i * 2]
  const by = points[next * 2 + 1] - points[i * 2 + 1]
  const la = Math.hypot(ax, ay)
  const lb = Math.hypot(bx, by)
  if (la === 0 || lb === 0) return 0
  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb)))
  return Math.acos(cos)
}

function appendDisc(out: number[], cx: number, cy: number, r: number, steps: number): void {
  for (let s = 0; s < steps; s++) {
    const a0 = (s / steps) * Math.PI * 2
    const a1 = ((s + 1) / steps) * Math.PI * 2
    out.push(cx, cy, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r)
  }
}

/** Triangles for a filled path, in path units. */
export function fillTriangles(d: string): number[] {
  const tris: number[] = []
  for (const poly of flattenPath(d)) {
    if (poly.points.length >= 6) tris.push(...triangulateFan(poly.points))
  }
  return tris
}

/** Triangles for a stroked path, in path units. */
export function strokeTriangles(d: string, width: number): number[] {
  const tris: number[] = []
  for (const poly of flattenPath(d)) {
    tris.push(...strokePolyline(poly.points, width, poly.closed))
  }
  return tris
}

/** An annulus, for rings drawn as strokes without going through the path
 * grammar — the seal's concentric circles and the selection halo. */
export function ringTriangles(cx: number, cy: number, radius: number, width: number, steps = 48): number[] {
  const tris: number[] = []
  const inner = Math.max(0, radius - width / 2)
  const outer = radius + width / 2
  for (let s = 0; s < steps; s++) {
    const a0 = (s / steps) * Math.PI * 2
    const a1 = ((s + 1) / steps) * Math.PI * 2
    const c0 = Math.cos(a0)
    const s0 = Math.sin(a0)
    const c1 = Math.cos(a1)
    const s1 = Math.sin(a1)
    tris.push(
      cx + c0 * inner, cy + s0 * inner, cx + c0 * outer, cy + s0 * outer, cx + c1 * outer, cy + s1 * outer,
      cx + c0 * inner, cy + s0 * inner, cx + c1 * outer, cy + s1 * outer, cx + c1 * inner, cy + s1 * inner,
    )
  }
  return tris
}

/** A filled disc. */
export function discTriangles(cx: number, cy: number, radius: number, steps = 48): number[] {
  const tris: number[] = []
  appendDisc(tris, cx, cy, radius, steps)
  return tris
}

/** A partial ring, clockwise from 12 o'clock — the capstone's progress
 * sweep. */
export function arcTriangles(
  cx: number,
  cy: number,
  radius: number,
  width: number,
  fraction: number,
  steps = 48,
): number[] {
  const f = Math.max(0, Math.min(1, fraction))
  if (f === 0) return []
  const tris: number[] = []
  const inner = Math.max(0, radius - width / 2)
  const outer = radius + width / 2
  const total = Math.max(1, Math.ceil(steps * f))
  const start = -Math.PI / 2
  for (let s = 0; s < total; s++) {
    const a0 = start + (s / total) * f * Math.PI * 2
    const a1 = start + ((s + 1) / total) * f * Math.PI * 2
    const c0 = Math.cos(a0)
    const s0 = Math.sin(a0)
    const c1 = Math.cos(a1)
    const s1 = Math.sin(a1)
    tris.push(
      cx + c0 * inner, cy + s0 * inner, cx + c0 * outer, cy + s0 * outer, cx + c1 * outer, cy + s1 * outer,
      cx + c0 * inner, cy + s0 * inner, cx + c1 * outer, cy + s1 * outer, cx + c1 * inner, cy + s1 * inner,
    )
  }
  return tris
}

/** Translate/rotate/scale a triangle list in place-ish (returns a new
 * list). */
export function transformTriangles(
  tris: readonly number[],
  tx: number,
  ty: number,
  scale: number,
  radians = 0,
): number[] {
  const out = new Array<number>(tris.length)
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  for (let i = 0; i < tris.length; i += 2) {
    const x = tris[i] * scale
    const y = tris[i + 1] * scale
    out[i] = tx + x * cos - y * sin
    out[i + 1] = ty + x * sin + y * cos
  }
  return out
}

/** Sub-polylines marching along a path — the loose-string sway of an edge,
 * or a flow effect along it.
 *
 * Returns the lit stretches of a dashed line whose pattern slides by
 * `phase` (0–1, wrapping) toward the end of the polyline. Splitting it out
 * from the painting keeps the one part that can be wrong — the arc-length
 * walk — in a module node can test, and lets the effect be checked without
 * a GPU. */
export function flowDashes(points: readonly number[], dash: number, gap: number, phase: number): number[][] {
  const period = dash + gap
  if (period <= 0 || points.length < 4) return []

  // Cumulative arc length, so a dash keeps its size on a curve instead of
  // stretching where the segments happen to be long.
  const n = points.length / 2
  const cum: number[] = [0]
  for (let i = 1; i < n; i++) {
    const dx = points[i * 2] - points[(i - 1) * 2]
    const dy = points[i * 2 + 1] - points[(i - 1) * 2 + 1]
    cum.push(cum[i - 1] + Math.hypot(dx, dy))
  }
  const total = cum[n - 1]
  if (total <= 0) return []

  const at = (s: number): [number, number] => {
    const t = Math.max(0, Math.min(total, s))
    let i = 1
    while (i < n && cum[i] < t) i++
    const prev = cum[i - 1]
    const span = cum[i] - prev || 1
    const f = (t - prev) / span
    return [
      points[(i - 1) * 2] + (points[i * 2] - points[(i - 1) * 2]) * f,
      points[(i - 1) * 2 + 1] + (points[i * 2 + 1] - points[(i - 1) * 2 + 1]) * f,
    ]
  }

  const out: number[][] = []
  const offset = ((phase % 1) + 1) % 1
  for (let start = (offset - 1) * period; start < total; start += period) {
    const a = start
    const b = start + dash
    if (b <= 0 || a >= total) continue
    const [x0, y0] = at(a)
    const [x1, y1] = at(b)
    out.push([x0, y0, x1, y1])
  }
  return out
}

/** A ring of triangles that fades outward: solid at `rIn`, gone at `rOut`.
 *
 * The building block for every optical effect on the plate — the halo
 * around a consolidated node, the pulsing frontier ring, the soft edge of
 * an overdue glow. Returns positions and a matching per-vertex alpha so the
 * falloff is a real gradient rather than a stack of discs. */
export function glowRing(cx: number, cy: number, rIn: number, rOut: number, steps = 24): { tris: number[]; alphas: number[] } {
  const tris: number[] = []
  const alphas: number[] = []
  const n = Math.max(6, Math.floor(steps))
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    const i0x = cx + Math.cos(a0) * rIn
    const i0y = cy + Math.sin(a0) * rIn
    const i1x = cx + Math.cos(a1) * rIn
    const i1y = cy + Math.sin(a1) * rIn
    const o0x = cx + Math.cos(a0) * rOut
    const o0y = cy + Math.sin(a0) * rOut
    const o1x = cx + Math.cos(a1) * rOut
    const o1y = cy + Math.sin(a1) * rOut
    tris.push(i0x, i0y, o0x, o0y, o1x, o1y)
    alphas.push(1, 0, 0)
    tris.push(i0x, i0y, o1x, o1y, i1x, i1y)
    alphas.push(1, 0, 1)
  }
  return { tris, alphas }
}

/** A filled disc that fades from the centre outward. */
export function glowDisc(cx: number, cy: number, r: number, steps = 16): { tris: number[]; alphas: number[] } {
  const tris: number[] = []
  const alphas: number[] = []
  const n = Math.max(6, Math.floor(steps))
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    tris.push(cx, cy, cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cx + Math.cos(a1) * r, cy + Math.sin(a1) * r)
    alphas.push(1, 0, 0)
  }
  return { tris, alphas }
}
