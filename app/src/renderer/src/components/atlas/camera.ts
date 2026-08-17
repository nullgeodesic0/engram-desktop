/** Spatial camera for the topic map plate. Two-finger scroll pans the paper;
 * pinch (ctrl-wheel on macOS Electron) zooms toward the pointer. Pan release
 * coasts with decaying velocity. Fit and selection/region entry spring to it.
 * All arithmetic is deterministic — no Math.random.
 *
 * Ported from CairnDesktop's atlas engine (app/src/renderer/src/app/atlas/camera.ts),
 * verbatim except for two constants: Engram's plate settles a whole topic's
 * graph into view rather than an open-ended ledger, so the zoom band is the
 * SVG GraphView's own proven [0.35, 4] rather than Cairn's [0.15, 8]. */

export interface CameraView {
  x: number
  y: number
  zoom: number
  vx: number
  vy: number
}

export const ZOOM_MIN = 0.35
export const ZOOM_MAX = 4
export const ORIGIN: CameraView = { x: 0, y: 0, zoom: 1, vx: 0, vy: 0 }

const COAST_DECAY = 0.92
const COAST_STOP = 0.15
/** The frame the decay constants were tuned against. Everything is expressed
 * per-frame-at-60Hz and then corrected by real elapsed time, so a 120Hz
 * display coasts the same distance rather than half as far. */
export const FRAME_MS = 1000 / 60

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

export function createView(partial?: Partial<CameraView>): CameraView {
  return { ...ORIGIN, ...partial, zoom: clampZoom(partial?.zoom ?? 1) }
}

/** Whether a wheel event means zoom rather than pan.
 *
 * Two devices, two conventions. A trackpad sends pixel deltas for a
 * two-finger scroll — that is a pan — and sets `ctrlKey` for a pinch, which
 * is a zoom. A mouse wheel sends *line* deltas (`deltaMode` 1, or page-wise
 * 2) and has no pinch at all, so on a mouse the wheel has to be the zoom or
 * there is no way to zoom without the keyboard. `deltaMode` is the honest
 * discriminator, rather than a guess from the size of the delta. */
export function isPinchZoom(event: { ctrlKey: boolean; metaKey?: boolean; deltaMode?: number }): boolean {
  return event.ctrlKey || (event.deltaMode !== undefined && event.deltaMode !== 0)
}

/** Zoom toward a pointer in plate coordinates. */
export function zoomAt(view: CameraView, mx: number, my: number, deltaY: number): CameraView {
  const nextZoom = clampZoom(view.zoom * Math.exp(-deltaY * 0.0015))
  if (nextZoom === view.zoom) return { ...view, vx: 0, vy: 0 }
  return {
    x: mx - (mx - view.x) * (nextZoom / view.zoom),
    y: my - (my - view.y) * (nextZoom / view.zoom),
    zoom: nextZoom,
    vx: 0,
    vy: 0,
  }
}

/** Two-finger scroll pans the paper. */
export function panBy(view: CameraView, dx: number, dy: number): CameraView {
  return { ...view, x: view.x + dx, y: view.y + dy, vx: 0, vy: 0 }
}

/** Apply a wheel event: pinch zooms, otherwise pans. */
export function applyWheel(
  view: CameraView,
  event: { deltaX: number; deltaY: number; ctrlKey: boolean; deltaMode?: number },
  pointer: { x: number; y: number },
): CameraView {
  if (isPinchZoom(event)) {
    // A wheel notch is a much coarser step than a pinch, so it needs a
    // gentler factor or one click of the wheel crosses the whole zoom range.
    const scale = event.deltaMode !== undefined && event.deltaMode !== 0 ? 12 : 1
    return zoomAt(view, pointer.x, pointer.y, event.deltaY * scale)
  }
  return panBy(view, -event.deltaX, -event.deltaY)
}

/** Zoom a step about a fixed point — the keyboard's + and -, and the buttons
 * that do the same thing for anyone not using a wheel at all. */
export function zoomStep(view: CameraView, factor: number, cx: number, cy: number): CameraView {
  const next = clampZoom(view.zoom * factor)
  if (next === view.zoom) return view
  return {
    ...view,
    zoom: next,
    x: cx - ((cx - view.x) / view.zoom) * next,
    y: cy - ((cy - view.y) / view.zoom) * next,
    vx: 0,
    vy: 0,
  }
}

/** The fastest a release may throw the plate, in screen px per frame.
 *
 * With COAST_DECAY at 0.92 a fling travels about `v / -ln(0.92)` ≈ 12x its
 * release speed, so an unclamped velocity of a few hundred sends the graph
 * thousands of pixels away with no way back but Fit. At 45 the longest
 * possible coast is a bit over half a thousand pixels — a flick across the
 * plate, which is what the gesture is for. */
const MAX_FLING = 45

/** Seed coast velocity from the last pointer deltas (screen px per
 * frame-ish). Clamped as a belt to the braces: the velocity being measured
 * wrongly is a bug to fix at the source, but a bug there should cost a
 * slightly-off glide rather than losing the plate entirely. */
export function fling(view: CameraView, vx: number, vy: number): CameraView {
  const speed = Math.hypot(vx, vy)
  if (speed <= MAX_FLING || speed === 0) return { ...view, vx, vy }
  const scale = MAX_FLING / speed
  return { ...view, vx: vx * scale, vy: vy * scale }
}

/** One coast step over `dtMs` of real time. Returns null when the camera has
 * stopped.
 *
 * Frame-rate independence is not a nicety here: a fixed step per frame would
 * decay twice as fast on a ProMotion display as on 60Hz, and the same flick
 * would travel half as far — the same gesture doing two different things on
 * two machines, neither of which anyone chose. */
export function tickCoast(view: CameraView, dtMs: number = FRAME_MS): CameraView | null {
  const speed = Math.hypot(view.vx, view.vy)
  if (speed < COAST_STOP) return null
  const frames = Math.min(4, Math.max(0, dtMs / FRAME_MS))
  const decay = Math.pow(COAST_DECAY, frames)
  // The exact integral of a continuously decaying velocity over the step,
  // rather than velocity x time. Multiplying would make the distance depend
  // on how finely the step was sliced — which is the very thing the elapsed
  // time is here to remove.
  const travelled = (decay - 1) / Math.log(COAST_DECAY)
  return {
    x: view.x + view.vx * travelled,
    y: view.y + view.vy * travelled,
    zoom: view.zoom,
    vx: view.vx * decay,
    vy: view.vy * decay,
  }
}

/** Snap immediately — used under prefers-reduced-motion. */
export function snapTo(target: { x: number; y: number; zoom: number }): CameraView {
  return { x: target.x, y: target.y, zoom: clampZoom(target.zoom), vx: 0, vy: 0 }
}

/** Run coast to rest synchronously (tests / reduced motion). */
export function settleCoast(view: CameraView): CameraView {
  let cur = view
  for (let i = 0; i < 200; i++) {
    const next = tickCoast(cur)
    if (!next) return { ...cur, vx: 0, vy: 0 }
    cur = next
  }
  return { ...cur, vx: 0, vy: 0 }
}

/** Fitting never magnifies past this. A sparse graph sits at its natural
 * size in the middle of the frame rather than being blown up to fill it. */
export const MAX_FIT_ZOOM = 1

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

export const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 }

/** The camera that puts `bounds` in the middle of a `w`x`h` viewport, as
 * large as it will go. Clamped to the zoom range, so a single node does not
 * fill the screen and a large topic is not scaled below legibility. */
export function fitView(
  bounds: Bounds,
  w: number,
  h: number,
  margin = 64,
  insets: Insets = NO_INSETS,
): CameraView {
  // Panels float over the plate, so the canvas is bigger than the part of it
  // anyone can see — the camera is told about the occlusion rather than
  // fitting to the raw canvas and centring the graph behind the sidebar.
  const spanX = Math.max(bounds.maxX - bounds.minX, 1)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1)
  const usableW = Math.max(1, w - insets.left - insets.right - margin * 2)
  const usableH = Math.max(1, h - insets.top - insets.bottom - margin * 2)
  const zoom = clampZoom(Math.min(usableW / spanX, usableH / spanY, MAX_FIT_ZOOM))
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const centreX = insets.left + (w - insets.left - insets.right) / 2
  const centreY = insets.top + (h - insets.top - insets.bottom) / 2
  return { x: centreX - cx * zoom, y: centreY - cy * zoom, zoom, vx: 0, vy: 0 }
}

/** Bounding box of positioned marks, including their radii so nothing is
 * clipped at the edge of the frame. */
export function boundsOf(nodes: readonly { x: number; y: number; r: number }[]): Bounds | null {
  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    if (n.x - n.r < minX) minX = n.x - n.r
    if (n.y - n.r < minY) minY = n.y - n.r
    if (n.x + n.r > maxX) maxX = n.x + n.r
    if (n.y + n.r > maxY) maxY = n.y + n.r
  }
  return { minX, minY, maxX, maxY }
}
