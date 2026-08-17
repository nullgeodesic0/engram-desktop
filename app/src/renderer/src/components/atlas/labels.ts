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
  for (const { n } of candidates) {
    if (placed.length >= MAX_LABELS) break
    const text = clipLabel(input.labelFor(n))
    if (!text) continue
    const p = input.toScreen(n.x, n.y)
    const size = labelFontSize(n)
    const w = text.length * size * CHAR_W
    const h = LINE_H
    const gap = n.r * input.zoom + 6

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
      if (placed.some((other) => overlaps(candidate, other))) continue
      box = candidate
      break
    }
    if (!box) continue
    placed.push(box)
  }
  return placed
}
