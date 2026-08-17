/** Moving the camera from one view to another along a path that feels right.
 *
 * A naive interpolation — `x += dx * 0.18` per frame — has three faults you
 * can feel. It is frame-rate dependent, so the same movement is twice as
 * fast on a 120Hz display as on a 60Hz one. It interpolates zoom linearly,
 * but zoom is multiplicative: stepping from 4 to 0.5 by equal fractions
 * spends most of the animation crawling through the close range and then
 * flicks through the far one. And for a long jump it is simply wrong: to
 * travel across a large topic at high zoom the camera has to sweep past
 * everything at enormous apparent speed, which reads as a blur and loses
 * the reader entirely.
 *
 * The fix is old and well-tested: Van Wijk and Nuij's *Smooth and efficient
 * zooming and panning* (InfoVis 2003). Treat pan and zoom as one motion in a
 * space where the natural metric is what the eye actually sees, and the
 * optimal path zooms out, translates, and zooms back in — the movement
 * anyone makes by hand when going somewhere far away. Distance is measured
 * in screen-widths travelled rather than world units, so a jump across a
 * dense cluster and a jump across an empty one take the time they
 * respectively deserve, and nothing ever sweeps past faster than the eye
 * can follow.
 *
 * Pure and deterministic: a flight is a function of time, so the caller can
 * drive it from a real clock and it behaves identically at any frame rate.
 *
 * Ported verbatim from CairnDesktop's atlas engine
 * (app/src/renderer/src/app/atlas/flight.ts) — entirely generic camera math,
 * no domain concept anywhere in it. */

/** The camera as this path sees it: a point in the world, and how much of
 * the world is across the viewport. Width rather than zoom because the
 * whole method is about apparent size. */
export interface Viewpoint {
  /** World coordinate at the centre of the viewport. */
  cx: number
  cy: number
  /** World units visible across the viewport. */
  w: number
}

/** How much zooming the path is willing to do to save travel.
 *
 * Van Wijk derives ρ = √2 as optimal for time, and notes that a slightly
 * larger value looks better because the extra altitude gives the eye a
 * moment to see where it is going. 1.4 is very close to √2; 1.8 is a
 * visible arc. The paper's own user study landed near 1.4 for "pleasant". */
const RHO = 1.4
const RHO2 = RHO * RHO

/** Screen-widths per second. The path's arc length is measured in units
 * where 1 is roughly "the viewport moved by its own width", so this is a
 * speed the eye can name: a bit over one screenful per second. */
const SPEED = 1.9

/** Nothing shorter than this reads as motion; nothing longer than this is
 * still welcome when you are trying to get somewhere. */
const MIN_MS = 90
const MAX_MS = 900

export interface Flight {
  /** Milliseconds the flight should take. */
  duration: number
  /** Arc length in the paper's units — roughly viewport-widths travelled,
   * counting zooming as travel. Unclamped, so it stays a true measure of
   * how far the move is even when the duration has hit its ceiling. */
  length: number
  /** The viewpoint at `t` milliseconds in. Clamped at both ends. */
  at(t: number): Viewpoint
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** A flight with no path in it — used when the two views are the same, and
 * as the degenerate case of a pure zoom. */
function straight(from: Viewpoint, to: Viewpoint, length: number): Flight {
  const duration = clampDuration(length)
  return {
    duration,
    length,
    at(t) {
      const s = duration <= 0 ? 1 : Math.min(1, Math.max(0, t / duration))
      return {
        cx: lerp(from.cx, to.cx, s),
        cy: lerp(from.cy, to.cy, s),
        // Even here, zoom interpolates geometrically: equal steps in time
        // are equal *ratios* of magnification, which is how zoom is
        // perceived.
        w: from.w * Math.pow(to.w / from.w, s),
      }
    },
  }
}

/** Plan the path from one viewpoint to another.
 *
 * Follows the paper's parameterisation directly. The degenerate branch —
 * when the two centres coincide, or nearly — is not an optimisation: the
 * general formula divides by the travelled distance and would produce NaN
 * for the very common case of zooming in on what is already centred. */
export function planFlight(from: Viewpoint, to: Viewpoint): Flight {
  const dx = to.cx - from.cx
  const dy = to.cy - from.cy
  const u1 = Math.hypot(dx, dy)
  const w0 = Math.max(from.w, 1e-6)
  const w1 = Math.max(to.w, 1e-6)

  // Pure zoom (or no motion at all): the arc length is just the log of the
  // magnification, which is exactly the "equal ratios in equal times" rule.
  if (u1 < 1e-6) {
    return straight(from, to, Math.abs(Math.log(w1 / w0)) / RHO)
  }

  const b0 = (w1 * w1 - w0 * w0 + RHO2 * RHO2 * u1 * u1) / (2 * w0 * RHO2 * u1)
  const b1 = (w1 * w1 - w0 * w0 - RHO2 * RHO2 * u1 * u1) / (2 * w1 * RHO2 * u1)
  const r0 = Math.log(-b0 + Math.hypot(b0, 1))
  const r1 = Math.log(-b1 + Math.hypot(b1, 1))
  const S = (r1 - r0) / RHO

  // A path that would take no time, or one the arithmetic could not resolve
  // (co-located views at wildly different scales), degrades to the
  // straight interpolation rather than emitting NaN into the camera.
  if (!Number.isFinite(S) || Math.abs(S) < 1e-6) {
    return straight(from, to, Math.abs(Math.log(w1 / w0)) / RHO)
  }

  const duration = clampDuration(Math.abs(S))
  const coshR0 = Math.cosh(r0)
  const sinhR0 = Math.sinh(r0)
  const ux = dx / u1
  const uy = dy / u1

  return {
    duration,
    length: Math.abs(S),
    at(t) {
      const progress = duration <= 0 ? 1 : Math.min(1, Math.max(0, t / duration))
      const s = progress * S
      const u = (w0 / RHO2) * (coshR0 * Math.tanh(RHO * s + r0) - sinhR0)
      const w = (w0 * coshR0) / Math.cosh(RHO * s + r0)
      return { cx: from.cx + ux * u, cy: from.cy + uy * u, w }
    },
  }
}

function clampDuration(arcLength: number): number {
  return Math.min(MAX_MS, Math.max(MIN_MS, (arcLength / SPEED) * 1000))
}

/** How far apart two viewpoints are, in the same units the flight measures.
 *
 * Useful on its own: a caller that wants to know whether a move is worth
 * animating at all — or worth interrupting for — can ask, rather than
 * comparing coordinates that mean different things at different zooms. */
export function flightDistance(from: Viewpoint, to: Viewpoint): number {
  return planFlight(from, to).length
}
