/** Deciding where the camera should be, given what the reader just did.
 *
 * Two rules, and everything here follows from them.
 *
 * **Move as little as possible.** A camera that re-frames on every selection
 * is exhausting: you click a node you can already see, and the whole plate
 * slides under you for no gain. So the question is never "where would this
 * node look best?" but "is there anything wrong with where we are?" — and if
 * the answer is no, the camera does not move at all.
 *
 * **Keep marks legible.** There is a band of apparent size in which a node
 * can be read: too small and it is a dot with no label, too large and its
 * neighbours are off the edge and you have lost the context that makes the
 * map worth having. Automatic zoom exists to keep the thing you are looking
 * at inside that band, and for no other reason. Selecting a node frames it
 * *and its neighbourhood*, never the node alone, so arriving means arriving
 * somewhere rather than in front of a single isolated mark.
 *
 * Pure functions over rectangles. Nothing here knows about canvases, and
 * everything here is a decision the tests can check.
 *
 * Ported verbatim from CairnDesktop's atlas engine
 * (app/src/renderer/src/app/atlas/framing.ts) — entirely generic reveal-
 * targeting math over `Mark = {x, y, r}`. */

import { clampZoom, type Bounds, type CameraView, type Insets } from './camera'

export interface Viewport {
  w: number
  h: number
  insets: Insets
}

/** The part of the canvas a reader can actually see — panels float on top
 * of the rest of it. */
export function safeArea(viewport: Viewport): { x: number; y: number; w: number; h: number } {
  const { w, h, insets } = viewport
  return {
    x: insets.left,
    y: insets.top,
    w: Math.max(1, w - insets.left - insets.right),
    h: Math.max(1, h - insets.top - insets.bottom),
  }
}

/** A mark this small on screen cannot be read, labelled, or hit reliably. */
const MIN_MARK_PX = 26
/** A mark this large has eaten the frame; its neighbours are off the edge. */
const MAX_MARK_PX = 96
/** How much of the safe area a framed subject should occupy at most, so the
 * surroundings stay visible and the reader keeps their bearings. */
const SUBJECT_FILL = 0.62
/** Inside this border, content is "comfortably visible" rather than clinging
 * to the edge — a mark two pixels inside the frame is technically on screen
 * and practically lost. */
const COMFORT_PAD = 56

export interface Mark {
  x: number
  y: number
  r: number
}

/** Bounds of a set of marks, with a margin already folded in. */
export function boundsWithMargin(marks: readonly Mark[], margin = 0): Bounds | null {
  if (marks.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const m of marks) {
    minX = Math.min(minX, m.x - m.r - margin)
    minY = Math.min(minY, m.y - m.r - margin)
    maxX = Math.max(maxX, m.x + m.r + margin)
    maxY = Math.max(maxY, m.y + m.r + margin)
  }
  return { minX, minY, maxX, maxY }
}

/** The camera that puts `bounds` in the middle of the safe area at a zoom
 * chosen so the subject fills it without swallowing it. */
export function frameBounds(bounds: Bounds, viewport: Viewport, fill = SUBJECT_FILL): CameraView {
  const area = safeArea(viewport)
  const spanX = Math.max(bounds.maxX - bounds.minX, 1)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1)
  const zoom = clampZoom(Math.min((area.w * fill) / spanX, (area.h * fill) / spanY))
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return {
    x: area.x + area.w / 2 - cx * zoom,
    y: area.y + area.h / 2 - cy * zoom,
    zoom,
    vx: 0,
    vy: 0,
  }
}

/** Whether a mark is comfortably on screen — inside the safe area with room
 * to spare, at a size that can be read. */
export function isComfortable(mark: Mark, view: CameraView, viewport: Viewport): boolean {
  const area = safeArea(viewport)
  const sx = mark.x * view.zoom + view.x
  const sy = mark.y * view.zoom + view.y
  const apparent = mark.r * 2 * view.zoom
  if (apparent < MIN_MARK_PX || apparent > MAX_MARK_PX) return false
  const pad = Math.min(COMFORT_PAD, area.w / 4, area.h / 4) + apparent / 2
  return sx >= area.x + pad && sx <= area.x + area.w - pad && sy >= area.y + pad && sy <= area.y + area.h - pad
}

/** Where the camera should go so a node can be read — or null when it is
 * already fine where it is.
 *
 * Returning null is the important half. Most selections need no camera
 * move at all, and a function that always produced a target would produce
 * a plate that never sits still.
 *
 * When a move is needed, it is the smallest one that fixes the actual
 * problem: a mark that is off screen at a readable size is *panned* to,
 * keeping the zoom the reader chose, while a mark that is the wrong size is
 * re-zoomed into the legible band. Changing the zoom when only the position
 * was wrong is the commonest way an auto-camera breaks a reader's mental
 * model of the map. */
export function revealTarget(
  mark: Mark,
  view: CameraView,
  viewport: Viewport,
  /** Marks that should stay in frame if the zoom has to change — the
   * node's prerequisites and dependents. Framing a node alone is what made
   * selecting feel like being shoved into a wall. */
  neighbourhood: readonly Mark[] = [],
): CameraView | null {
  if (isComfortable(mark, view, viewport)) return null
  const area = safeArea(viewport)
  const apparent = mark.r * 2 * view.zoom

  if (apparent >= MIN_MARK_PX && apparent <= MAX_MARK_PX) {
    // Right size, wrong place: pan only.
    return {
      ...view,
      x: area.x + area.w / 2 - mark.x * view.zoom,
      y: area.y + area.h / 2 - mark.y * view.zoom,
      vx: 0,
      vy: 0,
    }
  }

  // Wrong size. Frame the neighbourhood when there is one, so arriving
  // means arriving somewhere rather than in front of a single mark.
  const group = neighbourhood.length > 0 ? [mark, ...neighbourhood] : [mark]
  const bounds = boundsWithMargin(group, mark.r * 0.75)
  if (!bounds) return null
  const framed = frameBounds(bounds, viewport)
  // However the neighbourhood works out, the subject itself must land
  // inside the legible band — a hub with sixty dependents would otherwise
  // frame them all and leave every one of them a dot.
  const minZoom = MIN_MARK_PX / (mark.r * 2)
  const maxZoom = MAX_MARK_PX / (mark.r * 2)
  const zoom = clampZoom(Math.min(Math.max(framed.zoom, minZoom), maxZoom))
  return {
    x: area.x + area.w / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom,
    y: area.y + area.h / 2 - ((bounds.minY + bounds.maxY) / 2) * zoom,
    zoom,
    vx: 0,
    vy: 0,
  }
}

/** How much of the safe area must still hold content.
 *
 * Some overscroll is wanted — being able to push the graph aside to look at
 * it, or to make room for a panel, is part of handling a map. Being able to
 * lose it entirely is not. So the rule is an overlap rule: the content and
 * the visible frame must keep a stated amount of each other, stated as a
 * fraction of the frame so it feels the same on any window size, and capped
 * by the content's own size so a small graph is not forbidden from moving. */
const KEEP_VISIBLE = 0.3

/** The camera clamped so the content cannot be pushed out of reach.
 *
 * This is the actual guarantee, not the fling speed limit: capping the
 * throw only makes it take longer to lose the plate, while bounding the
 * destination means it cannot be lost at all, at any speed, by any gesture
 * — wheel, drag, coast, or a layout that moved under a stationary camera. */
export function clampToContent(view: CameraView, bounds: Bounds | null, viewport: Viewport): CameraView {
  if (!bounds) return view
  const area = safeArea(viewport)
  const left = bounds.minX * view.zoom + view.x
  const right = bounds.maxX * view.zoom + view.x
  const top = bounds.minY * view.zoom + view.y
  const bottom = bounds.maxY * view.zoom + view.y
  const keepX = Math.min(area.w * KEEP_VISIBLE, right - left)
  const keepY = Math.min(area.h * KEEP_VISIBLE, bottom - top)

  let x = view.x
  let y = view.y
  if (left > area.x + area.w - keepX) x -= left - (area.x + area.w - keepX)
  if (right < area.x + keepX) x += area.x + keepX - right
  if (top > area.y + area.h - keepY) y -= top - (area.y + area.h - keepY)
  if (bottom < area.y + keepY) y += area.y + keepY - bottom
  return x === view.x && y === view.y ? view : { ...view, x, y }
}
