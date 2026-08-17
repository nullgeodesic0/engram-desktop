/** Which names the plate shows.
 *
 * The old SVG renderer's rule was "the one you are pointing at, plus
 * whatever the zoom level lets through" (top-8-by-radius as a fallback),
 * which meant most of a topic went unnamed until you happened to hover it.
 * The rule here is the one a cartographer uses instead: every label wants
 * to be drawn; they are considered in order of how much they matter; each
 * is drawn only if its box does not collide with one already placed.
 * Crowded neighbourhoods thin themselves out, open ones stay fully named,
 * and zooming in makes room so more names appear on their own.
 *
 * Priority, highest first:
 *   1. what you are pointing at or have selected — never dropped
 *   2. the ancestor/descendant trail of the current selection, so the path
 *      you are reading is legible
 *   3. capstones and hubs before ordinary nodes — the structures a topic's
 *      shape actually turns on
 *   4. within a tier, whatever carries more requires-edges: a node twelve
 *      others depend on outranks a leaf, because it is the one you are more
 *      likely to want named
 *
 * Deterministic: no timers, no randomness, no dependence on iteration order
 * beyond the sort, so the same plate names the same things every time it is
 * drawn — including every physics tick, since node positions now move
 * (see `layout.ts`'s `tickLayout`) and a label set that reshuffled itself
 * mid-drift would be worse than one that named nothing.
 *
 * Adapted from CairnDesktop's atlas engine
 * (app/src/renderer/src/app/atlas/labels.ts) — the placement algorithm
 * (four-berth greedy, collision-tested, capped) is unchanged; the priority
 * function is rewritten for Engram's flat node taxonomy (no `AtlasLayer`
 * tiers — capstone/hub vs. ordinary, then degree, stand in for Cairn's
 * structural-layer rank). */

import { dueStatusFor } from './frame'
import type { AtlasNode } from './layout'

export interface LabelBox {
  id: string
  /** Screen-space, already laid out relative to the mark. */
  x: number
  y: number
  w: number
  h: number
  text: string
}

export interface LabelInput {
  nodes: readonly AtlasNode[]
  /** World→screen, so collision is judged in the space the reader sees. */
  toScreen: (x: number, y: number) => { x: number; y: number }
  /** Resolves a node's display text — `humanizeNodeId`, with an
   * `annotate_node` latex_label override — kept as a caller-supplied
   * resolver rather than baked into `AtlasNode` since annotations are
   * per-topic UI state, not structural graph shape. */
  labelFor: (n: AtlasNode) => string
  zoom: number
  selected: string | null
  hovered: string | null
  trail: ReadonlySet<string> | null
  /** Viewport, so off-screen labels cost nothing and never block an
   * on-screen one. */
  width: number
  height: number
  /** Panels floating over the plate; labels under them are not visible. */
  insets?: { left: number; right: number; top: number; bottom: number }
  /** Pointer position, screen-space (same frame `toScreen` outputs into) —
   * `null`/omitted when the pointer is off the canvas (or on a caller that
   * never reports one — every existing test keeps working undisturbed).
   * Lets the reader's own attention thin the plate: a name near the cursor
   * competes for its space at normal density, the same name far from the
   * cursor needs generously more clearance from its neighbours before it is
   * allowed to place at all. See `clearanceFor`'s own doctrine comment for
   * why this is "how much room a name needs," not "who wins a priority
   * tie" — cursor proximity never promotes a name past hover, selection,
   * the trail, or (under the due lens) an overdue/due-today node; it only
   * decides how crowded its own neighbourhood is allowed to be before it
   * gives up its spot. */
  cursor?: { x: number; y: number } | null
  /** Whether the due lens is on — the other piece of "contextual
   * information" this module reads, alongside cursor position. Under the
   * lens, an overdue/due-today node is exactly what the reader is here to
   * see, so it earns the same always-clear-space treatment as the trail,
   * regardless of where the cursor happens to be. */
  dueLens?: boolean
}

/** Approximate advance width per character for the plate's data face.
 * Measuring text properly means a canvas context, which would make this
 * untestable and tie label choice to a rendering backend — the boxes only
 * feed a collision test, so a constant is both sufficient and honest,
 * slightly generous so labels are dropped rather than overlapped when the
 * estimate is off. */
const CHAR_W = 0.58
const LINE_H = 13
const MAX_CHARS = 26

/** However much room there is, a plate stops being a figure past this many
 * names. */
const MAX_LABELS = 32

export function labelFontSize(n: Pick<AtlasNode, 'capstone' | 'isHub'>): number {
  return n.capstone ? 14 : n.isHub ? 13 : 12
}

/** The label a node shows: its own name, clipped so one long statement
 * cannot blockade a whole quarter of the plate. */
export function clipLabel(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= MAX_CHARS ? line : `${line.slice(0, MAX_CHARS - 1)}…`
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Inside this radius of the cursor, a name needs no more clearance than its
 * own box — full density right where the reader is looking. */
const CURSOR_NEAR = 140
/** Past this radius, a name needs the full extra `MAX_CLEARANCE` around it —
 * the plate thins itself out the farther a neighbourhood sits from whatever
 * the reader is actually attending to. Linear falloff between the two. */
const CURSOR_FAR = 480
/** Extra margin added to every side of a far candidate's box before testing
 * it against names already placed — this is what makes a crowded but
 * unattended corner of the plate quietly drop names instead of packing them
 * in as tightly as the area right under the cursor does. Never applied to
 * hover/selected/trail names, or (under the due lens) an overdue/due-today
 * one — those already always get a spot if any berth has room; this only
 * governs how much room an ordinary name needs to be allowed one. */
const MAX_CLEARANCE = 34
/** Applied when there is no cursor position at all to measure distance
 * from (off-canvas, or a caller — including every pre-existing test — that
 * never reports one). Half of `MAX_CLEARANCE`, not the full amount: "no
 * known focus" argues for a touch more room than the fully-attended case,
 * not for treating the whole plate as maximally unattended before the
 * reader has so much as moved the mouse. */
const NO_CURSOR_CLEARANCE = MAX_CLEARANCE / 2

/** How much extra clearance (each side) a name at this priority tier and
 * screen position needs before it may claim a berth. `alwaysClear` names
 * (hover/selected/trail, or overdue/due-today under the due lens) get none
 * — the same unconditional treatment they already had before cursor
 * awareness existed. Everything else scales linearly with distance from the
 * cursor between `CURSOR_NEAR` and `CURSOR_FAR`, or falls back to
 * `NO_CURSOR_CLEARANCE` when there is no cursor position to read at all. */
export function clearanceFor(screenX: number, screenY: number, alwaysClear: boolean, cursor: { x: number; y: number } | null): number {
  if (alwaysClear) return 0
  if (!cursor) return NO_CURSOR_CLEARANCE
  const dist = Math.hypot(screenX - cursor.x, screenY - cursor.y)
  const t = Math.min(1, Math.max(0, (dist - CURSOR_NEAR) / (CURSOR_FAR - CURSOR_NEAR)))
  return t * MAX_CLEARANCE
}

/** Rank: lower sorts first and therefore wins its space. */
export function labelPriority(n: AtlasNode, input: LabelInput): number {
  if (n.id === input.hovered || n.id === input.selected) return -2
  if (input.trail?.has(n.id)) return -1
  const structuralRank = n.capstone || n.isHub ? 0 : 1
  return structuralRank * 1000 - Math.min(n.degree, 999)
}

/** The labels to draw this frame, already positioned, collision-free, and
 * in draw order. */
export function placeLabels(input: LabelInput): LabelBox[] {
  const inset = input.insets ?? { left: 0, right: 0, top: 0, bottom: 0 }
  const minX = inset.left
  const maxX = input.width - inset.right
  const minY = inset.top
  const maxY = input.height - inset.bottom

  const candidates = [...input.nodes]
    .map((n) => ({ n, rank: labelPriority(n, input) }))
    .sort((a, b) => a.rank - b.rank || a.n.id.localeCompare(b.n.id))

  const placed: LabelBox[] = []
  for (const { n, rank } of candidates) {
    if (placed.length >= MAX_LABELS) break
    const text = clipLabel(input.labelFor(n))
    if (!text) continue
    const p = input.toScreen(n.x, n.y)
    const size = labelFontSize(n)
    const w = text.length * size * CHAR_W
    const h = LINE_H
    const gap = n.r * input.zoom + 6

    const alwaysClear = rank <= -1 || Boolean(input.dueLens && (dueStatusFor(n) === 'overdue' || dueStatusFor(n) === 'today'))
    const clearance = clearanceFor(p.x, p.y, alwaysClear, input.cursor ?? null)

    // Four berths, tried in order — the same discipline as trying the
    // other three sides of a paper map's place name before giving up on it.
    const berths: Array<{ x: number; y: number }> = [
      { x: p.x + gap, y: p.y - h / 2 },
      { x: p.x - gap - w, y: p.y - h / 2 },
      { x: p.x - w / 2, y: p.y - gap - h },
      { x: p.x - w / 2, y: p.y + gap },
    ]

    let box: LabelBox | null = null
    for (const berth of berths) {
      const candidate: LabelBox = { id: n.id, x: berth.x, y: berth.y, w, h, text }
      if (candidate.x > maxX || candidate.x + candidate.w < minX) continue
      if (candidate.y > maxY || candidate.y + candidate.h < minY) continue
      // Clearance inflates the TEST box only — the rendered label keeps its
      // true size, it just needs more empty neighbourhood before it earns a
      // spot the farther it sits from the reader's own attention.
      const padded: LabelBox = { ...candidate, x: candidate.x - clearance, y: candidate.y - clearance, w: w + clearance * 2, h: h + clearance * 2 }
      if (placed.some((other) => overlaps(padded, other))) continue
      box = candidate
      break
    }
    if (!box) continue
    placed.push(box)
  }
  return placed
}
