import type { TopicGraph, MapAnnotations } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { EDGE_STYLE } from '../components/graph3d/types'
import { buildEdges, computeForwardAdjacency, computeFrontierIds, computeHubNodeIds } from '../components/graph3d/layout'
import {
  settlePlate,
  nodeMarkPath,
  ringMarkPath,
  diamondMarkPath,
  territoryGroups,
  hullPath,
  hullCentroid,
  plateStats,
  type PlateNode,
} from '../components/graph2d/plate'
import {
  STATE_COLOR,
  stringEdgePath,
  arrowheadTransform,
  isEdgeVisible,
  cornerTicks,
  ARROWHEAD_PATH,
  stripMathDelimiters,
} from '../components/GraphView'

/** Physical page geometry — US Letter, landscape, at the 96 CSS-px/inch
 * Chromium's printToPDF already assumes for `pageSize: 'Letter'` (see
 * main/session/exportSitting.ts, which uses the same assumption for its
 * portrait sittings). 24px margin on every side, baked into the HTML/SVG
 * itself rather than into the printToPDF `margins` option — exportMap.ts
 * asks for zero print-driver margins (same as exportSitting) so this
 * document controls its own page geometry exactly, the same way
 * sittingToPrintHtml's `body { padding }` does. */
const PAGE_W = 1056
const PAGE_H = 816
const MARGIN = 24
const PLATE_W = PAGE_W - MARGIN * 2
const PLATE_H = PAGE_H - MARGIN * 2 - 90 // room below the plate for a caption strip

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------- F2: text measurement + label placement
//
// This document is assembled as a plain markup STRING (see the header
// comment above) well before it ever reaches a renderer that could measure
// real glyphs — there is no `canvas`/`document` to hand a `measureText` call
// to at the point this function runs (main's hidden print `BrowserWindow`
// only exists downstream, in exportMap.ts). So width is ESTIMATED, per
// character, from a small bucketed table rather than computed exactly.
//
// Calibrated against real headless-Chromium prints of this exact SVG for
// both real topics and hand-built calibration strings (`--print-to-pdf`,
// word boxes read back with `pdftotext -bbox`; see the P4/P5 closing
// fix-wave report for the full before/after measurement) — then deliberately
// padded to the WIDE side for both typefaces this document uses (Inter for
// labels, Fraunces for the masthead): every real topic label's MEASURED
// rendered width came in at or under what this table would have predicted
// for it, never over. That's the property that matters — this may wrap a
// title or relocate a label a little earlier than strictly necessary, but
// must never UNDER-measure into a real collision. `LABEL_PAD` (below) adds a
// further fixed margin on top of that for the same reason: better a few
// extra labels dropped or relocated than one truly touching its neighbor on
// paper.
const NARROW_CHARS = /[iIl.,:;'"!|\s]/
const WIDE_CHARS = /[mwMW@%]/
const DIGIT_CHARS = /[0-9]/
const UPPER_CHARS = /[A-Z]/

function estimateTextWidth(text: string, fontSizePx: number): number {
  let units = 0
  for (const ch of text) {
    if (NARROW_CHARS.test(ch)) units += 0.32
    else if (WIDE_CHARS.test(ch)) units += 0.85
    else if (DIGIT_CHARS.test(ch)) units += 0.62
    else if (UPPER_CHARS.test(ch)) units += 0.68
    else units += 0.56
  }
  return units * fontSizePx
}

/** Greedy word-wrap into at most `maxLines`, truncating the LAST line with
 * an ellipsis (backing off whole words, never mid-word, with a char-by-char
 * fallback for one pathologically long word) rather than ever silently
 * dropping the overflow with no indication anything was cut. This is F2(b)'s
 * fix: `mapToPrintHtml` used to emit the masthead as one un-wrapped,
 * un-truncated `<text>` at font-size 15 — grad-classical-mechanics' real
 * 295-character title (`viewBox` width 1008px) rendered as roughly 2170px of
 * text, clipped by the SVG's own bounds mid-word ("…Central Force &
 * Two-Body/Kepler/Scatte"). */
function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let i = 0
  while (i < words.length && lines.length < maxLines) {
    let line = words[i]
    i++
    while (i < words.length) {
      const candidate = `${line} ${words[i]}`
      if (estimateTextWidth(candidate, fontSize) > maxWidth) break
      line = candidate
      i++
    }
    lines.push(line)
  }
  if (i < words.length) {
    let last = lines[lines.length - 1] ?? ''
    while (last.length > 0 && estimateTextWidth(`${last}…`, fontSize) > maxWidth) {
      const cut = last.lastIndexOf(' ')
      last = cut > 0 ? last.slice(0, cut) : last.slice(0, -1)
    }
    lines[lines.length - 1] = `${last}…`
  }
  return lines
}

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
}

/** Padding added to every label/cell rectangle before comparing — absorbs
 * `estimateTextWidth`'s own error margin and leaves a visible gap between
 * neighbors even when the estimate is exact, rather than two labels sitting
 * pixel-adjacent. */
const LABEL_PAD = 1.5

type LabelAnchor = 'start' | 'middle' | 'end'

interface LabelCandidate {
  dx: number
  dy: number
  anchor: LabelAnchor
  fontSize: number
}

/** Candidate positions for one node's label, tried in this order until one
 * clears every obstacle. The first is the plate's original, always-to-the-
 * right placement (unchanged for the common case where nothing is nearby);
 * the rest fan out around the cell before finally trying a smaller face —
 * "nudging, leader offsets, a smaller label face" per F2(a)'s brief. Dropping
 * the label entirely (this document renders nothing for that node) is the
 * last resort, tried only once none of these eight fit. */
function labelCandidates(r: number): LabelCandidate[] {
  const big = 9.5
  const small = 7.5
  return [
    { dx: r + 6, dy: 4, anchor: 'start', fontSize: big },
    { dx: r + 6, dy: -5, anchor: 'start', fontSize: big },
    { dx: r + 6, dy: 13, anchor: 'start', fontSize: big },
    { dx: -(r + 6), dy: 4, anchor: 'end', fontSize: big },
    { dx: 0, dy: -(r + 7), anchor: 'middle', fontSize: big },
    { dx: 0, dy: r + 14, anchor: 'middle', fontSize: big },
    { dx: r + 5, dy: 4, anchor: 'start', fontSize: small },
    { dx: -(r + 5), dy: 4, anchor: 'end', fontSize: small },
  ]
}

function labelRect(pos: { x: number; y: number }, label: string, c: LabelCandidate): Rect {
  const width = estimateTextWidth(label, c.fontSize)
  const ascent = c.fontSize * 0.78
  const descent = c.fontSize * 0.24
  const anchorX = pos.x + c.dx
  const x0 = c.anchor === 'start' ? anchorX : c.anchor === 'end' ? anchorX - width : anchorX - width / 2
  const y0 = pos.y + c.dy - ascent
  return {
    x0: x0 - LABEL_PAD,
    y0: y0 - LABEL_PAD,
    x1: x0 + width + LABEL_PAD,
    y1: pos.y + c.dy + descent + LABEL_PAD,
  }
}

interface PlannedLabel {
  label: string
  candidate: LabelCandidate
}

/** F2(a)'s fix: the on-screen plate thins its labels below a zoom threshold
 * (GraphView's `topRadiusIds`/zoom gate) so the screen is never asked to fit
 * more text than it has pixels for — the print path used to LIFT that
 * thinning (every node labels, full stop) without adding anything back in
 * its place, which is what produced the measured 13 label-label and 23
 * label-over-cell collisions across the four real topics on this machine.
 * This keeps "every node is worth a label on paper" but adds the placement
 * pass the screen's thinning made unnecessary: each node, in priority order,
 * tries `labelCandidates` until one clears every already-placed label and
 * every cell body; if none do, the label is dropped rather than stamped on
 * top of a higher-priority neighbor. Priority mirrors the plate's own
 * importance signal (capstone > threshold > frontier, then radius — the same
 * `r` GraphView's `topRadiusIds` already ranks screen labels by) rather than
 * an arbitrary one. */
function planLabels(
  graph: TopicGraph,
  plate: Map<string, PlateNode>,
  frontierIds: Set<string>,
  annotations: MapAnnotations | null,
  /** Fixed obstacles no per-node label may land on, beyond cells and other
   * labels — the territory washes' faint italic root captions, currently
   * (see the call site's own comment for why these earned a dedicated
   * parameter rather than being folded into `cellObstacles`). */
  extraObstacles: Rect[] = [],
): Map<string, PlannedLabel> {
  const cellObstacles = new Map<string, Rect>()
  for (const id of graph.order) {
    const node = graph.nodes[id]
    const pos = plate.get(id)
    if (!node || !pos) continue
    const pad = 2
    cellObstacles.set(id, { x0: pos.x - pos.r - pad, y0: pos.y - pos.r - pad, x1: pos.x + pos.r + pad, y1: pos.y + pos.r + pad })
  }

  const order = graph.order
    .map((id, idx) => ({ id, idx, pos: plate.get(id) }))
    .filter((e): e is { id: string; idx: number; pos: PlateNode } => !!e.pos && !!graph.nodes[e.id])
    .sort((a, b) => {
      const na = graph.nodes[a.id]
      const nb = graph.nodes[b.id]
      const scoreOf = (id: string, n: typeof na, pos: PlateNode) =>
        (n?.capstone ? 300 : 0) + (n?.threshold ? 200 : 0) + (frontierIds.has(id) ? 100 : 0) + pos.r
      const sa = scoreOf(a.id, na, a.pos)
      const sb = scoreOf(b.id, nb, b.pos)
      return sb !== sa ? sb - sa : a.idx - b.idx
    })

  const placed = new Map<string, PlannedLabel>()
  const placedRects: Rect[] = []
  for (const { id, pos } of order) {
    const latexLabel = annotations?.[id]?.latexLabel
    const label = latexLabel ? stripMathDelimiters(latexLabel) : humanizeNodeId(id)
    for (const candidate of labelCandidates(pos.r)) {
      const rect = labelRect(pos, label, candidate)
      if (rect.x0 < 0 || rect.y0 < 0 || rect.x1 > PLATE_W || rect.y1 > PLATE_H) continue
      let blocked = false
      for (const [oid, orect] of cellObstacles) {
        if (oid === id) continue
        if (rectsOverlap(rect, orect)) {
          blocked = true
          break
        }
      }
      if (!blocked) {
        for (const orect of extraObstacles) {
          if (rectsOverlap(rect, orect)) {
            blocked = true
            break
          }
        }
      }
      if (!blocked) {
        for (const prect of placedRects) {
          if (rectsOverlap(rect, prect)) {
            blocked = true
            break
          }
        }
      }
      if (!blocked) {
        placed.set(id, { label, candidate })
        placedRects.push(rect)
        break
      }
    }
    // No candidate cleared every obstacle: dropped, per F2(a)'s brief —
    // never stamped over a higher-priority neighbor.
  }
  return placed
}

/** Small filled glyph + label row for the printed key, built from the exact
 * same `ringMarkPath`/`diamondMarkPath` mark geometry the plate uses — never a hand-drawn stand-in
 * shape that could drift from what the plate actually draws. */
function legendRow(y: number, glyph: string, label: string): string {
  return `<g transform="translate(14 ${y})">${glyph}<text x="16" y="4" font-family="var(--font-body)" font-size="10" fill="var(--color-text-dim)">${escapeXml(label)}</text></g>`
}

/** Builds the printed atlas plate as a SELF-CONTAINED HTML document — every
 * style inlined, no external requests — for main's hidden `BrowserWindow`
 * print pipeline (see main/session/exportMap.ts, which reuses exactly the
 * same offscreen-window + printToPDF mechanics main/session/exportSitting.ts
 * already established).
 *
 * This is NOT a screenshot or a re-render of the live `GraphView` component:
 * it calls the exact same geometry/path functions GraphView itself calls
 * (`settlePlate`, `nodeMarkPath`, `hullPath`, the edge-path
 * builders now exported from GraphView.tsx) so the printed figure is
 * mathematically the same specimen, just assembled as a markup string
 * instead of JSX — the same choice `sittingToPrintHtml` already made for
 * math (re-running the real KaTeX call rather than grabbing live DOM; see
 * that file's header comment for why grabbing rendered DOM was rejected).
 *
 * Every screen-only piece of state is resolved to a single, deliberate
 * choice rather than captured mid-interaction (see the report for Task 3 of
 * the Goals & Help plan for the full reasoning):
 *   - hover / transient selection: NONE. The plate prints as the whole
 *     territory, not a snapshot of whatever node the exporter's mouse
 *     happened to be over — there is no hover on paper, and a frozen
 *     selection trail would misrepresent the plate as being "about" one node.
 *   - due lens: OFF. It recolors cells by today's schedule standing, which
 *     is stale the moment the sheet is read on a later day; the printed
 *     plate uses the durable encode/consolidate/threshold vocabulary.
 *   - growth-timelapse scrubber: NOT APPLICABLE. The print always exports
 *     the full current map, never a partial-reveal frame.
 *   - search filter: OFF. Every node prints at full ink.
 *   - ambient drift (`t`): frozen at 0 — the same instant GraphView itself
 *     renders at before its first requestAnimationFrame tick, so this is a
 *     real (if fleeting) frame of the live plate, not an invented one.
 *   - zoom-gated label thinning: LIFTED. GraphView hides labels below a zoom
 *     threshold because the screen has finite pixels to spend; a print page
 *     is the one surface where every node's label is worth the ink, so every
 *     node is labeled here regardless of radius.
 *
 * Night Atlas is a dark-ground theme by design (`--color-void` etc. are near-
 * black on screen). This print document does NOT reuse those dark values —
 * it defines its OWN light-paper palette (see the `:root` block below),
 * deliberately, for two reasons: (1) a full-bleed near-black page is a real
 * ink cost this app has no business imposing on someone printing a study
 * aid, and (2) a NAIVE inversion (literally flipping each channel, or
 * swapping every dark value for its light "opposite" 1:1) would wreck the
 * `-dim`/`-faint` tokens specifically — on the dark theme, "dim" means
 * "closer to the void", i.e. DARKER than its full-strength sibling; keeping
 * that same darker hex on a light page would make "dim" tokens read as MORE
 * contrasty than the ink they're supposed to recede beneath. Every `-dim`
 * value below is instead redefined as "closer to the paper", i.e. LIGHTER
 * than its sibling — the same relationship the dark theme has to its void,
 * just re-derived for a light one rather than copied verbatim. Every ink hue
 * keeps its family (warm stays amber, cool stays steel-blue, danger stays
 * rust, hot stays gold) so a reader flipping between the app and a printed
 * plate never has to relearn what a color means — only its exact value
 * shifts, deepened where needed for legibility against cream instead of
 * near-black. The `--font-*` variables are reused completely verbatim (not
 * reworded): each already degrades to a generic system fallback
 * (Georgia/serif, system-ui/sans-serif, ui-monospace/monospace) when its
 * primary @fontsource face isn't registered, exactly as print.css already
 * relies on for the sitting export — so nothing needs picking twice.
 *
 * Grain (`plate-grain`) is kept — a fine paper-etching speckle reads fine on
 * cream too. The vignette that pulls the on-screen plate out from behind the
 * app's ambient NeuralField canvas is DROPPED entirely: paper has no
 * competing background to push into soft focus, so the effect would do
 * nothing but tint the page margins for no reason.
 */
export function mapToPrintHtml(
  graph: TopicGraph,
  retrievability: Map<string, number> | null,
  annotations: MapAnnotations | null,
): string {
  const plate: Map<string, PlateNode> = settlePlate(graph, PLATE_W, PLATE_H)
  const edges = buildEdges(graph)
  const frontierIds = computeFrontierIds(graph)
  const forwardAdjacency = computeForwardAdjacency(edges)
  const hubNodeIds = computeHubNodeIds(graph)
  const territories = territoryGroups(graph)
  const stats = plateStats(graph, retrievability)
  const visibleEdges = edges.filter((e) => isEdgeVisible(e, hubNodeIds, forwardAdjacency))
  const t = 0 // frozen — see the header comment above

  const svg: string[] = []

  svg.push(`<defs>`)
  svg.push(
    `<filter id="plate-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" stitchTiles="stitch" result="grain-noise"/><feColorMatrix in="grain-noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.33 0.34 0 0"/></filter>`,
  )
  svg.push(`<clipPath id="legend-half-clip"><rect x="-10" y="0" width="20" height="10"/></clipPath>`)
  for (const id of graph.order) {
    const node = graph.nodes[id]
    if (node?.state !== 'learning' || node.capstone) continue
    const r = plate.get(id)?.r ?? 8
    svg.push(`<clipPath id="half-${escapeXml(id)}"><rect x="${-r * 1.6}" y="0" width="${r * 3.2}" height="${r * 1.6}"/></clipPath>`)
  }
  svg.push(`</defs>`)

  svg.push(`<rect x="0" y="0" width="${PLATE_W}" height="${PLATE_H}" fill="black" filter="url(#plate-grain)" opacity="0.035"/>`)

  svg.push(`<g>`)

  // Territory washes
  for (const members of territories.values()) {
    const pts = members.map((id) => plate.get(id)).filter((p): p is PlateNode => !!p)
    if (pts.length < 3) continue
    const d = hullPath(pts, 26)
    if (!d) continue
    const consolidatedFraction = members.filter((id) => graph.nodes[id]?.state === 'review').length / members.length
    svg.push(
      `<path d="${d}" fill="var(--color-ink-warm)" fill-opacity="${(0.03 + 0.09 * consolidatedFraction).toFixed(3)}" stroke="none"/>`,
    )
  }

  // Territory labels — always shown (the due lens that hides these on screen
  // is resolved OFF for print; see the header comment). Their rects are also
  // fed to `planLabels` below as fixed obstacles — one of the two real
  // collisions this document shipped with (F2(a)'s own quoted example,
  // "GeneralizedCapstone Coordinates Dof") was a per-node label landing on
  // top of one of THESE faint italic captions, not on another per-node
  // label or a cell — so a placement pass that only knew about cells and
  // other labels still missed it.
  const territoryLabelRects: Rect[] = []
  for (const [root, members] of territories.entries()) {
    const pts = members.map((id) => plate.get(id)).filter((p): p is PlateNode => !!p)
    const centroid = hullCentroid(pts)
    if (!centroid) continue
    // Tracked uppercase mono, matching the on-screen plate's sector
    // captions; measured on the UPPERCASED string (wider) so the obstacle
    // rect fed to planLabels stays honest about the extra width.
    const territoryLabel = humanizeNodeId(root).toUpperCase()
    svg.push(
      `<text x="${centroid.x.toFixed(2)}" y="${centroid.y.toFixed(2)}" text-anchor="middle" font-family="var(--font-data)" font-size="10" letter-spacing="1.6" fill="var(--color-text-dim)" opacity="0.5">${escapeXml(territoryLabel)}</text>`,
    )
    territoryLabelRects.push(labelRect(centroid, territoryLabel, { dx: 0, dy: 0, anchor: 'middle', fontSize: 12 }))
  }

  // Edges — flat opacity: no hover/selection trail to promote or dim on paper.
  for (const e of visibleEdges) {
    const a = plate.get(e.source)
    const b = plate.get(e.target)
    if (!a || !b) continue
    const style = EDGE_STYLE[e.kind]
    if (e.kind === 'requires') {
      const d = stringEdgePath(e.source, e.target, a, b, 'requires', t)
      const arrowTransform = arrowheadTransform(e.source, e.target, a, b, b.r, t, 1)
      svg.push(`<path d="${d}" fill="none" stroke="${style.stroke}" stroke-opacity="0.4" stroke-width="1.2"/>`)
      svg.push(`<path d="${ARROWHEAD_PATH}" fill="${style.stroke}" fill-opacity="0.4" transform="${arrowTransform}"/>`)
    } else {
      const d = stringEdgePath(e.source, e.target, a, b, 'other', t)
      svg.push(
        `<path d="${d}" fill="none" stroke="${style.stroke}" stroke-opacity="0.4" stroke-width="1.1" ${style.dash ? `stroke-dasharray="${style.dash}"` : ''}/>`,
      )
    }
  }

  // Cell bodies — same encode/consolidate/threshold vocabulary as the
  // due-lens-off, nothing-selected state of the live plate.
  for (const id of graph.order) {
    const node = graph.nodes[id]
    const pos = plate.get(id)
    if (!node || !pos) continue
    const r = pos.r
    // Threshold concepts take the diamond mark; geometry, not a dash, now
    // carries that distinction (the printed Key documents both).
    const bodyPath = nodeMarkPath(node.threshold, r)

    if (node.capstone) {
      const outerR = r + 4
      const circumference = 2 * Math.PI * outerR
      const fraction = stats.total > 0 ? stats.encoded / stats.total : 1
      svg.push(`<g transform="translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})">`)
      svg.push(`<circle r="${outerR}" fill="none" stroke="var(--color-ink-warm)" stroke-width="1.2"/>`)
      svg.push(
        `<circle r="${outerR}" fill="none" stroke="var(--color-ink-warm)" stroke-width="2" stroke-linecap="round" stroke-dasharray="${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90)"/>`,
      )
      svg.push(`<circle r="${r}" fill="none" stroke="var(--color-ink-warm)" stroke-width="1.2"/>`)
      svg.push(`<circle r="${(r * 0.62).toFixed(2)}" fill="none" stroke="var(--color-ink-warm)" stroke-width="1"/>`)
      svg.push(`<circle r="${(r * 0.45).toFixed(2)}" fill="var(--color-ink-warm)" fill-opacity="${(0.25 + 0.75 * fraction).toFixed(3)}"/>`)
      svg.push(`</g>`)
      continue
    }

    const fillOpacity = 0.35 + 0.65 * (retrievability?.get(id) ?? 1)
    svg.push(`<g transform="translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})">`)
    if (node.state === 'new') {
      svg.push(`<path d="${bodyPath}" fill="none" stroke="${STATE_COLOR.new}" stroke-width="1.2"/>`)
    } else if (node.state === 'learning') {
      svg.push(`<path d="${bodyPath}" fill="none" stroke="${STATE_COLOR.learning}" stroke-width="1.2"/>`)
      svg.push(`<path d="${bodyPath}" fill="${STATE_COLOR.learning}" fill-opacity="${fillOpacity.toFixed(3)}" clip-path="url(#half-${escapeXml(id)})"/>`)
    } else {
      svg.push(`<path d="${bodyPath}" fill="${STATE_COLOR.review}" fill-opacity="${fillOpacity.toFixed(3)}"/>`)
      svg.push(`<path d="${bodyPath}" fill="none" stroke="${STATE_COLOR.review}" stroke-width="1.2" stroke-opacity="0.9"/>`)
    }
    svg.push(`</g>`)
  }

  // Rings/decorations — lapsed stipple + frontier ring, both durable graph
  // facts (not schedule-standing), so they print exactly as the live plate
  // shows them with the due lens off.
  for (const id of graph.order) {
    const node = graph.nodes[id]
    const pos = plate.get(id)
    if (!node || !pos || node.capstone) continue
    const r = pos.r
    const lapsed = (node.fsrs.lapses ?? 0) > 0
    const isFrontier = frontierIds.has(id)
    if (!lapsed && !isFrontier) continue
    svg.push(`<g transform="translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})">`)
    if (lapsed) {
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2
        const stippleR = r + 3.5
        svg.push(
          `<circle cx="${(Math.cos(angle) * stippleR).toFixed(2)}" cy="${(Math.sin(angle) * stippleR).toFixed(2)}" r="0.8" fill="var(--color-ink-danger)" opacity="0.7"/>`,
        )
      }
    }
    if (isFrontier) {
      svg.push(`<circle r="${r + 5}" stroke="var(--color-ink-warm)" fill="none" stroke-width="1"/>`)
    }
    svg.push(`</g>`)
  }

  // Labels — EVERY node gets a placement attempt, not just the zoom-gated
  // top-N the screen shows (paper has no reason to withhold a label to save
  // pixels) — but WHERE each one lands (or whether it lands at all) is now a
  // collision-checked plan, not an unconditional `r + 6`; see `planLabels`'s
  // own header comment for F2(a)'s full reasoning.
  const labelPlan = planLabels(graph, plate, frontierIds, annotations, territoryLabelRects)
  for (const id of graph.order) {
    const pos = plate.get(id)
    const planned = labelPlan.get(id)
    if (!pos || !planned) continue
    const { label, candidate } = planned
    svg.push(
      `<g transform="translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})"><text x="${candidate.dx.toFixed(2)}" y="${candidate.dy.toFixed(2)}" text-anchor="${candidate.anchor}" font-size="${candidate.fontSize}" fill="var(--color-text-dim)" font-family="var(--font-body)">${escapeXml(label)}</text></g>`,
    )
  }

  svg.push(`</g>`)

  // Furniture — hairline border + corner registration ticks, fixed to the
  // page rather than the specimen (same OUTSIDE-the-transform placement
  // GraphView uses, just with no transform group to be outside of here since
  // the print plate never pans/zooms in the first place).
  svg.push(`<rect x="0.5" y="0.5" width="${PLATE_W - 1}" height="${PLATE_H - 1}" fill="none" stroke="var(--color-hairline)" stroke-width="1"/>`)
  for (const d of cornerTicks(PLATE_W, PLATE_H)) {
    svg.push(`<path d="${d}" fill="none" stroke="var(--color-ink-warm-dim)" stroke-width="1.2"/>`)
  }
  // Masthead — F2(b): a topic's `title` is free text with no length cap
  // (grad-classical-mechanics' real title is 295 characters), so this used
  // to be one un-wrapped, un-truncated `<text>` that the viewBox clipped mid-
  // word. `wrapText` bounds it to MASTHEAD_MAX_LINES honestly — wrapping
  // what fits, truncating with an ellipsis whatever doesn't — and the
  // subtitle line is pushed down by however many lines the title actually
  // took, so it never lands on top of a two-line title.
  const MASTHEAD_X = 16
  const MASTHEAD_Y0 = 26
  const MASTHEAD_FONT_SIZE = 15
  const MASTHEAD_LINE_HEIGHT = 17
  const MASTHEAD_MAX_LINES = 2
  const MASTHEAD_SUBTITLE_GAP = 16 // matches the original single-line 42 − 26 baseline gap
  const mastheadLines = wrapText(`Fig. — ${graph.title}`, PLATE_W - MASTHEAD_X * 2, MASTHEAD_FONT_SIZE, MASTHEAD_MAX_LINES)
  mastheadLines.forEach((line, i) => {
    svg.push(
      `<text x="${MASTHEAD_X}" y="${MASTHEAD_Y0 + i * MASTHEAD_LINE_HEIGHT}" font-family="var(--font-serif)" font-size="${MASTHEAD_FONT_SIZE}" fill="var(--color-text-primary)">${escapeXml(line)}</text>`,
    )
  })
  const subtitleY = MASTHEAD_Y0 + (mastheadLines.length - 1) * MASTHEAD_LINE_HEIGHT + MASTHEAD_SUBTITLE_GAP
  svg.push(
    `<text x="${MASTHEAD_X}" y="${subtitleY}" font-family="var(--font-data)" font-size="10" letter-spacing="0.4" fill="var(--color-text-dim)">${escapeXml(`${stats.total} cells · ${stats.consolidated} consolidated`)}</text>`,
  )

  // Legend — reuses the exact glyph vocabulary the on-screen Key panel uses
  // (same ringMarkPath/diamondMarkPath calls), placed bottom-RIGHT as an
  // inset panel over the plate (`legendX = PLATE_W - 168`), mirroring
  // TopicMapView's floating Key.
  const legendX = PLATE_W - 168
  const legendY = PLATE_H - 176
  const legendRows: string[] = []
  legendRows.push(
    legendRow(20, `<path d="${ringMarkPath(6)}" fill="none" stroke="var(--color-ink-cool-dim)" stroke-width="1.2"/>`, 'not started'),
  )
  legendRows.push(
    legendRow(
      38,
      `<path d="${ringMarkPath(6)}" fill="none" stroke="var(--color-ink-cool)" stroke-width="1.2"/><path d="${ringMarkPath(6)}" fill="var(--color-ink-cool)" fill-opacity="0.8" clip-path="url(#legend-half-clip)"/>`,
      'encoding',
    ),
  )
  legendRows.push(legendRow(56, `<path d="${ringMarkPath(6)}" fill="var(--color-ink-warm)" fill-opacity="0.85"/>`, 'consolidated'))
  legendRows.push(
    legendRow(
      74,
      `<path d="${diamondMarkPath(6)}" fill="none" stroke="var(--color-ink-hot)" stroke-width="1.2"/>`,
      'threshold',
    ),
  )
  legendRows.push(
    legendRow(
      92,
      `<path d="${ringMarkPath(5)}" fill="none" stroke="var(--color-ink-cool)" stroke-width="1"/><circle r="7.5" fill="none" stroke="var(--color-ink-warm)" stroke-width="1"/>`,
      'learn next',
    ),
  )
  const lapsedDots = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2
    const r = 8
    return `<circle cx="${(Math.cos(angle) * r).toFixed(2)}" cy="${(Math.sin(angle) * r).toFixed(2)}" r="0.8" fill="var(--color-ink-danger)" opacity="0.7"/>`
  }).join('')
  legendRows.push(
    legendRow(110, `<path d="${ringMarkPath(5)}" fill="none" stroke="var(--color-ink-cool)" stroke-width="1"/>${lapsedDots}`, 'lapsed'),
  )
  legendRows.push(
    legendRow(
      128,
      `<circle r="8" fill="none" stroke="var(--color-ink-warm)" stroke-width="1"/><circle r="5" fill="none" stroke="var(--color-ink-warm)" stroke-width="1"/><circle r="3.4" fill="var(--color-ink-warm)" fill-opacity="0.85"/>`,
      'capstone seal',
    ),
  )
  svg.push(
    `<g transform="translate(${legendX} ${legendY})"><rect x="0" y="0" width="156" height="150" fill="var(--color-void)" fill-opacity="0.92" stroke="var(--color-hairline)"/><text x="14" y="16" font-family="var(--font-data)" font-size="9" letter-spacing="0.4" fill="var(--color-text-dim)">KEY</text>${legendRows.join('')}</g>`,
  )

  const svgMarkup = `<svg viewBox="0 0 ${PLATE_W} ${PLATE_H}" width="${PLATE_W}" height="${PLATE_H}" xmlns="http://www.w3.org/2000/svg">${svg.join('')}</svg>`

  const printedOn = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeXml(graph.title)} — map</title>
<style>
:root {
  /* A deliberate light-paper palette, NOT the app's dark Night Atlas
     variables inverted — see mapToPrintHtml.ts's header comment for why a
     naive inversion of the "-dim" tokens specifically would be wrong. */
  --color-void: #f2ead9;
  --color-hairline: #c9bc9e;
  --color-ink-cool: #2f5b73;
  --color-ink-cool-dim: #aac3ce;
  --color-ink-warm: #b9791f;
  --color-ink-warm-dim: #ddc79a;
  --color-ink-hot: #ad7d12;
  --color-ink-danger: #a1483a;
  --color-ink-danger-dim: #ddb7ae;
  --color-text-primary: #2a2116;
  --color-text-dim: #6b5d47;
  --font-serif: 'Fraunces', Georgia, serif;
  --font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-data: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--color-void); }
.page { width: ${PAGE_W}px; height: ${PAGE_H}px; padding: ${MARGIN}px; }
svg { display: block; }
.caption {
  margin-top: 10px;
  font-family: var(--font-data);
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-dim);
}
</style>
</head>
<body>
<div class="page">
${svgMarkup}
<div class="caption">${escapeXml(`Printed ${printedOn} · a snapshot — decay/consolidation figures are as of this date, not live · Engram Desktop`)}</div>
</div>
</body>
</html>`
}
