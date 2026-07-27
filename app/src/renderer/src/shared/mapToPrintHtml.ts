import type { TopicGraph, MapAnnotations } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { EDGE_STYLE } from '../components/graph3d/types'
import { buildEdges, computeForwardAdjacency, computeFrontierIds, computeHubNodeIds } from '../components/graph3d/layout'
import {
  settlePlate,
  cellBodyPath,
  dendriteStubs,
  territoryGroups,
  hullPath,
  hullCentroid,
  plateStats,
  type PlateNode,
} from '../components/graph2d/plate'
import {
  STATE_COLOR,
  stringEdgePath,
  calligraphicEdgePath,
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

/** Small filled glyph + label row for the printed key, built from the exact
 * same `cellBodyPath` the plate itself uses — never a hand-drawn stand-in
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
 * (`settlePlate`, `cellBodyPath`, `dendriteStubs`, `hullPath`, the edge-path
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

  const neighborIdsById = new Map<string, string[]>()
  for (const e of visibleEdges) {
    if (!hubNodeIds.has(e.target)) {
      const arr = neighborIdsById.get(e.source) ?? []
      if (!arr.includes(e.target)) arr.push(e.target)
      neighborIdsById.set(e.source, arr)
    }
    if (!hubNodeIds.has(e.source)) {
      const arr = neighborIdsById.get(e.target) ?? []
      if (!arr.includes(e.source)) arr.push(e.source)
      neighborIdsById.set(e.target, arr)
    }
  }

  const svg: string[] = []

  svg.push(`<defs>`)
  svg.push(
    `<filter id="plate-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" stitchTiles="stitch" result="grain-noise"/><feColorMatrix in="grain-noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.33 0.34 0 0"/></filter>`,
  )
  // No `patternTransform` zoom-cancellation here (see plate.ts's caller in
  // GraphView) — the print plate has exactly one zoom level, 1, forever.
  svg.push(
    `<pattern id="hatch-review" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-ink-warm)" stroke-width="1.1"/></pattern>`,
  )
  svg.push(
    `<pattern id="stipple-learning" patternUnits="userSpaceOnUse" width="9" height="9"><circle cx="2.25" cy="2.25" r="0.9" fill="var(--color-ink-cool)"/><circle cx="6.75" cy="6.75" r="0.9" fill="var(--color-ink-cool)"/></pattern>`,
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
  // is resolved OFF for print; see the header comment).
  for (const [root, members] of territories.entries()) {
    const pts = members.map((id) => plate.get(id)).filter((p): p is PlateNode => !!p)
    const centroid = hullCentroid(pts)
    if (!centroid) continue
    svg.push(
      `<text x="${centroid.x.toFixed(2)}" y="${centroid.y.toFixed(2)}" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="11" fill="var(--color-text-dim)" opacity="0.45">${escapeXml(humanizeNodeId(root))}</text>`,
    )
  }

  // Edges — flat opacity: no hover/selection trail to promote or dim on paper.
  for (const e of visibleEdges) {
    const a = plate.get(e.source)
    const b = plate.get(e.target)
    if (!a || !b) continue
    const style = EDGE_STYLE[e.kind]
    if (e.kind === 'requires') {
      const d = calligraphicEdgePath(e.source, e.target, a, b, t)
      const arrowTransform = arrowheadTransform(e.source, e.target, a, b, b.r, t, 1)
      svg.push(`<path d="${d}" fill="${style.stroke}" fill-opacity="0.4"/>`)
      svg.push(`<path d="${ARROWHEAD_PATH}" fill="${style.stroke}" fill-opacity="0.4" transform="${arrowTransform}"/>`)
    } else {
      const d = stringEdgePath(e.source, e.target, a, b, 'other', t)
      svg.push(
        `<path d="${d}" fill="none" stroke="${style.stroke}" stroke-opacity="0.4" stroke-width="1.1" ${style.dash ? `stroke-dasharray="${style.dash}"` : ''}/>`,
      )
    }
  }

  // Dendrite stubs
  for (const id of graph.order) {
    const node = graph.nodes[id]
    const pos = plate.get(id)
    if (!node || !pos || node.capstone) continue
    const neighborIds = (neighborIdsById.get(id) ?? []).slice(0, 4)
    const dirs = neighborIds.map((nid) => {
      const npos = plate.get(nid)
      if (!npos) return { x: 1, y: 0 }
      return { x: npos.x - pos.x, y: npos.y - pos.y }
    })
    const stubs = dendriteStubs(id, pos, dirs, pos.r)
    for (const d of stubs) {
      svg.push(`<path d="${d}" stroke="${STATE_COLOR[node.state]}" stroke-opacity="0.45" stroke-width="1" fill="none"/>`)
    }
  }

  // Cell bodies — same encode/consolidate/threshold vocabulary as the
  // due-lens-off, nothing-selected state of the live plate.
  for (const id of graph.order) {
    const node = graph.nodes[id]
    const pos = plate.get(id)
    if (!node || !pos) continue
    const r = pos.r
    const bodyPath = cellBodyPath(id, r)

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
      svg.push(`<path d="${cellBodyPath(id, r * 0.55)}" fill="var(--color-ink-warm)" fill-opacity="${(0.25 + 0.75 * fraction).toFixed(3)}"/>`)
      svg.push(`</g>`)
      continue
    }

    const fillOpacity = 0.35 + 0.65 * (retrievability?.get(id) ?? 1)
    const dash = node.threshold ? '3 2.5' : undefined
    svg.push(`<g transform="translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})">`)
    if (node.state === 'new') {
      svg.push(`<path d="${bodyPath}" fill="none" stroke="${STATE_COLOR.new}" stroke-width="1.2" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`)
    } else if (node.state === 'learning') {
      svg.push(`<path d="${bodyPath}" fill="none" stroke="${STATE_COLOR.learning}" stroke-width="1.2" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`)
      svg.push(`<path d="${bodyPath}" fill="${STATE_COLOR.learning}" fill-opacity="${fillOpacity.toFixed(3)}" clip-path="url(#half-${escapeXml(id)})"/>`)
      svg.push(`<path d="${bodyPath}" fill="url(#stipple-learning)" fill-opacity="0.9" clip-path="url(#half-${escapeXml(id)})"/>`)
    } else {
      svg.push(`<path d="${bodyPath}" fill="${STATE_COLOR.review}" fill-opacity="${fillOpacity.toFixed(3)}"/>`)
      svg.push(`<path d="${bodyPath}" fill="url(#hatch-review)" fill-opacity="0.85"/>`)
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

  // Labels — EVERY node, not just the zoom-gated top-N the screen shows (see
  // header comment: paper has no reason to withhold a label to save pixels).
  for (const id of graph.order) {
    const node = graph.nodes[id]
    const pos = plate.get(id)
    if (!node || !pos) continue
    const latexLabel = annotations?.[id]?.latexLabel
    const label = latexLabel ? stripMathDelimiters(latexLabel) : humanizeNodeId(id)
    svg.push(
      `<g transform="translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})"><text x="${pos.r + 6}" y="4" font-size="9.5" fill="var(--color-text-dim)" font-family="var(--font-body)">${escapeXml(label)}</text></g>`,
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
  svg.push(
    `<text x="16" y="26" font-family="var(--font-serif)" font-size="15" fill="var(--color-text-primary)">${escapeXml(`Fig. — ${graph.title}`)}</text>`,
  )
  svg.push(
    `<text x="16" y="42" font-family="var(--font-data)" font-size="10" letter-spacing="0.4" fill="var(--color-text-dim)">${escapeXml(`${stats.total} cells · ${stats.consolidated} consolidated`)}</text>`,
  )

  // Legend — reuses the exact glyph vocabulary the on-screen Key panel uses
  // (same cellBodyPath calls, same seeded ids), placed bottom-left as an
  // inset panel over the plate, mirroring TopicMapView's floating Key.
  const legendX = PLATE_W - 168
  const legendY = PLATE_H - 176
  const legendRows: string[] = []
  legendRows.push(
    legendRow(20, `<path d="${cellBodyPath('legend-new', 6)}" fill="none" stroke="var(--color-ink-cool-dim)" stroke-width="1.2"/>`, 'not started'),
  )
  legendRows.push(
    legendRow(
      38,
      `<path d="${cellBodyPath('legend-learning', 6)}" fill="none" stroke="var(--color-ink-cool)" stroke-width="1.2"/><path d="${cellBodyPath('legend-learning', 6)}" fill="var(--color-ink-cool)" fill-opacity="0.8" clip-path="url(#legend-half-clip)"/>`,
      'encoding',
    ),
  )
  legendRows.push(legendRow(56, `<path d="${cellBodyPath('legend-review', 6)}" fill="var(--color-ink-warm)" fill-opacity="0.85"/>`, 'consolidated'))
  legendRows.push(
    legendRow(
      74,
      `<path d="${cellBodyPath('legend-threshold', 6)}" fill="none" stroke="var(--color-ink-hot)" stroke-width="1.2" stroke-dasharray="3 2.5"/>`,
      'threshold',
    ),
  )
  legendRows.push(
    legendRow(
      92,
      `<path d="${cellBodyPath('legend-frontier', 5)}" fill="none" stroke="var(--color-ink-cool)" stroke-width="1"/><circle r="7.5" fill="none" stroke="var(--color-ink-warm)" stroke-width="1"/>`,
      'learn next',
    ),
  )
  const lapsedDots = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2
    const r = 8
    return `<circle cx="${(Math.cos(angle) * r).toFixed(2)}" cy="${(Math.sin(angle) * r).toFixed(2)}" r="0.8" fill="var(--color-ink-danger)" opacity="0.7"/>`
  }).join('')
  legendRows.push(
    legendRow(110, `<path d="${cellBodyPath('legend-lapsed', 5)}" fill="none" stroke="var(--color-ink-cool)" stroke-width="1"/>${lapsedDots}`, 'lapsed'),
  )
  legendRows.push(
    legendRow(
      128,
      `<circle r="8" fill="none" stroke="var(--color-ink-warm)" stroke-width="1"/><path d="${cellBodyPath('legend-capstone', 5)}" fill="var(--color-ink-warm)" fill-opacity="0.85"/>`,
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
