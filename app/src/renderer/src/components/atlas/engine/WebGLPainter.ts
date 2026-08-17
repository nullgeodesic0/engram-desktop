/** The topic map's WebGL2 painter.
 *
 * Everything is flat-shaded triangles pushed into one `TriangleBatch` and
 * flushed once per frame — the world transform lives in a shader uniform,
 * so panning/zooming never touches the vertex buffer (see `gl/batch.ts`'s
 * own doctrine comment). Shapes are the SAME SVG-path strings `marks.ts`
 * defines, read back into triangles by `gl/geometry.ts`, so this file
 * decides colours/z-order/visibility and nothing about what a threshold
 * node actually looks like — that lives in one place, `marks.ts`, shared
 * with whatever else ever needs to draw the same glyph (the Key, a future
 * print path).
 *
 * Draw order, back to front: region washes → edges (with hub-hiding, kind
 * dashing, requires arrowheads) → node bodies (fill/stroke per FSRS state,
 * capstones as their own concentric-ring+progress-arc treatment) → the
 * hover/selection ancestor/descendant trail overlay → lapse stippling and
 * the frontier pulse → an overdue glow under the due lens → plate
 * furniture (border, corner ticks). Labels are a separate Canvas2D text
 * pass over the top (`paintText`) for the same reason Cairn's engine does
 * it that way: baking a font atlas per platform/theme isn't worth it when
 * the label count is bounded (see `labels.ts`'s `MAX_LABELS`).
 *
 * Architecturally ported from CairnDesktop's atlas engine
 * (app/src/renderer/src/app/atlas/engine/gl/WebGLPainter.ts) — the
 * mechanism (batching, dual-canvas text overlay, PathCache) is Cairn's; the
 * actual draw sequence below is Engram's own domain, not a port of Cairn's
 * marks. */

import { TriangleBatch } from './gl/batch'
import { parseColor } from './gl/color'
import {
  arcTriangles,
  discTriangles,
  fillTriangles,
  flowDashes,
  glowRing,
  ringTriangles,
  strokeTriangles,
  transformTriangles,
  triangulateFan,
} from './gl/geometry'
import { hullPath, hullTopAnchor } from '../../graph2d/plate'
import {
  ARROWHEAD_PATH,
  arrowheadPlacement,
  conceptKindMarkPath,
  cornerTicks,
  halfDiscMarkPath,
  lapseStippleDots,
  nodeMarkPath,
  stringEdgePath,
} from '../marks'
import {
  atlasEdgeVisible,
  dueStatusFor,
  edgeInk,
  fillStyleFor,
  markKind,
  nodeFillOpacity,
  nodeInk,
  TRAIL_ANCESTOR_COLOR,
  TRAIL_DESCENDANT_COLOR,
  type TrailRole,
} from '../frame'
import type { AtlasNode } from '../layout'
import type { PlatePainter, RenderFrame } from './paint'
import type { PlateTokens } from './tokens'

/** `frame.ts`'s ink helpers (`nodeInk`, `edgeInk`, `DUE_LENS_COLOR`) return
 * raw `var(--color-ink-*)` strings — correct CSS, but `parseColor`
 * (gl/color.ts) only understands resolved color functions and hex, since
 * GL has no notion of a custom property. Every one of these names is
 * already resolved once per theme change in `frame.tokens` (`tokens.ts`'s
 * `readPlateTokens`) — this maps the var name back to that resolved value
 * instead of a `getComputedStyle` call per node per frame, which is what
 * the Canvas2D fallback's own `resolveVar` does (fine at its lower call
 * volume, not at this one). Passing an already-resolved string through
 * (hex, `TRAIL_ANCESTOR_COLOR`, etc.) is a no-op. */
const INK_TOKEN_BY_VAR: Record<string, keyof PlateTokens> = {
  '--color-ink-warm': 'warm',
  '--color-ink-hot': 'hot',
  '--color-ink-warm-dim': 'warmDim',
  '--color-ink-cool': 'cool',
  '--color-ink-cool-dim': 'coolDim',
  '--color-ink-violet': 'violet',
  '--color-ink-danger': 'danger',
  '--color-ink-danger-dim': 'dangerDim',
}

function resolveInk(css: string, tokens: PlateTokens): string {
  if (!css.startsWith('var(')) return css
  const key = INK_TOKEN_BY_VAR[css.slice(4, -1).trim()]
  return key ? tokens[key] : css
}

/** Path-string → triangle-list memo, keyed by the string itself (fills) or
 * a stroke width quantised to 1/20px (strokes) so a zoom-varying stroke
 * width doesn't thrash the cache every frame. Capped with a blunt
 * evict-all past the ceiling — a plate never legitimately needs more
 * distinct shapes than this in one session, so growth past it is a bug,
 * not a workload to optimise for. */
class PathCache {
  private readonly fills = new Map<string, number[]>()
  private readonly strokes = new Map<string, number[]>()
  private static readonly MAX_ENTRIES = 512

  fill(d: string): number[] {
    const hit = this.fills.get(d)
    if (hit) return hit
    if (this.fills.size >= PathCache.MAX_ENTRIES) this.fills.clear()
    const tris = fillTriangles(d)
    this.fills.set(d, tris)
    return tris
  }

  stroke(d: string, width: number): number[] {
    const qw = Math.round(width * 20) / 20
    const key = `${qw}::${d}`
    const hit = this.strokes.get(key)
    if (hit) return hit
    if (this.strokes.size >= PathCache.MAX_ENTRIES) this.strokes.clear()
    const tris = strokeTriangles(d, qw)
    this.strokes.set(key, tris)
    return tris
  }
}

export class WebGLPainter implements PlatePainter {
  private readonly gl: WebGL2RenderingContext
  private readonly batch: TriangleBatch
  private readonly textCtx: CanvasRenderingContext2D | null
  private readonly canvas: HTMLCanvasElement
  private readonly textCanvas: HTMLCanvasElement | null
  private readonly cache = new PathCache()
  private width = 0
  private height = 0
  private dpr = 1

  constructor(canvas: HTMLCanvasElement, textCanvas: HTMLCanvasElement | null = null) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: true })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl
    this.canvas = canvas
    this.textCanvas = textCanvas
    this.textCtx = textCanvas?.getContext('2d') ?? null
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    this.batch = new TriangleBatch(gl)
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.round(width * dpr))
    this.canvas.height = Math.max(1, Math.round(height * dpr))
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    if (this.textCanvas) {
      this.textCanvas.width = Math.max(1, Math.round(width * dpr))
      this.textCanvas.height = Math.max(1, Math.round(height * dpr))
    }
  }

  dispose(): void {
    this.batch.dispose()
  }

  paint(frame: RenderFrame): void {
    const { gl } = this
    const [vr, vg, vb] = parseColor(frame.tokens.void)
    gl.clearColor(vr, vg, vb, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    this.batch.begin()
    this.paintRegions(frame)
    this.paintEdges(frame)
    this.paintNodes(frame)
    this.paintTrail(frame)
    this.paintFurniture(frame)

    const screenW = this.width * this.dpr
    const screenH = this.height * this.dpr
    const tx = frame.view.x * this.dpr
    const ty = frame.view.y * this.dpr
    this.batch.flush(screenW, screenH, tx, ty, frame.view.zoom * this.dpr)

    this.paintText(frame)
  }

  // ---- regions ----------------------------------------------------------

  private paintRegions(frame: RenderFrame): void {
    const { layout } = frame
    if (layout.regions.length === 0) return
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    // Warm ink, matching the retired SVG renderer's own region wash — the
    // Consolidation Axis reads a region's own survived fraction through the
    // SAME warm hue every node uses for "review" state, not a per-region
    // identity color (DESIGN.md's Off-Axis Violet Rule bars a color from
    // existing "because a surface needs one"). Colorizing this from the
    // engine's flat hairline gray IS the fix: the wash already tracked
    // consolidatedFraction in its alpha, it just drew that signal in the
    // wrong ink.
    const washRgb = parseColor(frame.tokens.warm)
    for (const region of layout.regions) {
      const pts = region.memberIds.map((id) => byId.get(id)).filter((n): n is AtlasNode => Boolean(n))
      if (pts.length < 3) continue
      const focused = frame.focusedRegion === region.seed
      const dimmed = frame.focusedRegion !== null && !focused
      const d = hullPath(pts.map((p) => ({ x: p.x, y: p.y })), 26)
      const alpha = (focused ? 0.09 : dimmed ? 0.015 : 0.045) * (this.consolidatedFraction(pts) * 0.6 + 0.4)
      this.batch.push(this.cache.fill(d), washRgb, alpha)
      const strokeAlpha = focused ? 0.35 : dimmed ? 0.06 : 0.16
      this.batch.push(this.cache.stroke(d, 1 / frame.view.zoom), washRgb, strokeAlpha)
    }
  }

  private consolidatedFraction(nodes: readonly AtlasNode[]): number {
    if (nodes.length === 0) return 0
    const reviewed = nodes.filter((n) => n.state === 'review').length
    return reviewed / nodes.length
  }

  // ---- edges --------------------------------------------------------------

  private paintEdges(frame: RenderFrame): void {
    const { layout } = frame
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    const invZoom = 1 / frame.view.zoom
    for (const e of layout.edges) {
      if (!atlasEdgeVisible(e, layout.hubNodeIds, layout.forwardAdjacency, layout.capstoneIds)) continue
      const a = byId.get(e.source)
      const b = byId.get(e.target)
      if (!a || !b) continue
      if (!this.nodeVisible(a, frame) && !this.nodeVisible(b, frame)) continue
      const spec = edgeInk(e.kind)
      const rgb = parseColor(resolveInk(spec.color, frame.tokens))
      const kind: 'requires' | 'other' = e.kind === 'requires' ? 'requires' : 'other'
      const d = stringEdgePath(e.source, e.target, a, b, kind)
      const width = spec.width * frame.linkThickness * invZoom

      if (spec.dash) {
        // WebGL has no native dash array — walked as discrete lit segments
        // via the same arc-length machinery the flow effect uses, just
        // with a fixed (non-animating) phase.
        const [dash, gap] = spec.dash
        const flat = this.samplePath(d)
        for (const [x0, y0, x1, y1] of flowDashes(flat, dash * invZoom, gap * invZoom, 0)) {
          this.batch.push(strokeTriangles(`M ${x0} ${y0} L ${x1} ${y1}`, width), rgb, 0.7)
        }
      } else {
        this.batch.push(this.cache.stroke(d, width), rgb, 0.85)
      }

      if (e.kind === 'requires') {
        const { x, y, angleRad } = arrowheadPlacement(e.source, e.target, a, b, b.r)
        const head = transformTriangles(fillTriangles(ARROWHEAD_PATH), x, y, invZoom, angleRad)
        this.batch.push(head, rgb, 0.85)
      }
    }
  }

  /** Flatten a quadratic edge path to a polyline the dash-walker can read —
   * `flowDashes` (geometry.ts) wants points, not a path string. Cheap: an
   * edge is one M/Q, twelve segments. */
  private samplePath(d: string): number[] {
    const m = d.match(/M ([\d.-]+) ([\d.-]+) Q ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/)
    if (!m) return []
    const [, ax, ay, cx, cy, bx, by] = m.map(Number)
    const pts: number[] = []
    const steps = 12
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const mt = 1 - t
      pts.push(mt * mt * ax + 2 * mt * t * cx + t * t * bx, mt * mt * ay + 2 * mt * t * cy + t * t * by)
    }
    return pts
  }

  // ---- nodes --------------------------------------------------------------

  private trailRoleFor(n: AtlasNode, frame: RenderFrame): TrailRole {
    if (n.id === frame.selected) return 'selected'
    if (frame.ancestorSet?.has(n.id)) return 'ancestor'
    if (frame.descendantSet?.has(n.id)) return 'descendant'
    return null
  }

  private nodeVisible(n: AtlasNode, frame: RenderFrame): boolean {
    return frame.visibleNodes === null || frame.visibleNodes.has(n.id)
  }

  private paintNodes(frame: RenderFrame): void {
    const invZoom = 1 / frame.view.zoom
    for (const n of frame.layout.nodes) {
      if (!this.nodeVisible(n, frame)) continue
      const dueStatus = frame.dueLens ? dueStatusFor(n) : null
      const trailRole = frame.dueLens ? null : this.trailRoleFor(n, frame)
      const ink = nodeInk(n.state, dueStatus, trailRole)
      const rgb = parseColor(resolveInk(ink, frame.tokens))
      const opacity = nodeFillOpacity(frame.retrievability?.get(n.id))
      const kind = markKind(n)
      const strokeW = (n.threshold ? 1.4 : 1.2) * invZoom

      if (dueStatus === 'overdue') {
        const glow = glowRing(0, 0, n.r * 0.7, n.r * 2.2)
        this.batch.pushVarying(glow.tris, parseColor(frame.tokens.danger), glow.alphas.map((a) => a * 0.5), n.x, n.y)
      }

      if (kind === 'capstone') {
        this.paintCapstone(n, frame, rgb, invZoom)
        continue
      }

      // `nodeMarkPath` returns a path centred at the ORIGIN (see its own
      // doctrine comment in marks.ts/plate.ts) — every push of it below
      // MUST carry `n.x, n.y` as the batch's own dx/dy offset, or the glyph
      // draws at world (0,0) regardless of where the node actually sits.
      // That was missing on three of these four branches: every ring and
      // diamond mark collapsed onto one point at the origin, which is
      // exactly "no node icons, just lines" — the edges (computed in real
      // absolute coordinates) still drew correctly between the nodes' true
      // positions; nothing marked the endpoints.
      const d = nodeMarkPath(n.threshold, n.r)
      const style = fillStyleFor(n.state)
      if (style === 'filled') {
        this.batch.push(this.cache.fill(d), rgb, opacity * 0.92, n.x, n.y)
        this.batch.push(this.cache.stroke(d, strokeW), rgb, 0.9, n.x, n.y)
      } else if (style === 'half') {
        const half = halfDiscMarkPath(n.r)
        this.batch.push(transformTriangles(fillTriangles(half), 0, 0, 1), rgb, opacity * 0.85, n.x, n.y)
        this.batch.push(this.cache.stroke(d, strokeW), rgb, opacity, n.x, n.y)
      } else {
        this.batch.push(this.cache.stroke(d, strokeW), rgb, opacity, n.x, n.y)
      }

      if (n.lapses > 0) {
        const dotRgb = parseColor(frame.tokens.dangerDim)
        for (const dot of lapseStippleDots(n.r)) {
          this.batch.push(discTriangles(dot.x, dot.y, 1.1 * invZoom, 8), dotRgb, 0.8, n.x, n.y)
        }
      }

      // `viz.kind` badge — see marks.ts's own doctrine comment on why this
      // is a small stroke-only corner mark rather than a replacement for
      // the ring/diamond glyph above. Dim ink, not a new hue: the SHAPE is
      // what carries "which kind of concept," the same restraint the
      // Off-Axis Violet Rule already holds color to elsewhere on this
      // plate — a badge does not need to double-encode its own meaning in
      // colour too.
      if (n.kind) {
        const badgeR = Math.min(7, Math.max(3, n.r * 0.38))
        const badgeOffset = n.r * 0.72
        const badgeD = conceptKindMarkPath(n.kind, badgeR)
        this.batch.push(this.cache.stroke(badgeD, 1 * invZoom), parseColor(frame.tokens.textDim), 0.8, n.x + badgeOffset, n.y + badgeOffset)
      }

      if (n.isFrontier) {
        const pulse = frame.reducedMotion ? 0.6 : 0.4 + 0.3 * Math.sin(frame.nowSec * 1.6)
        this.batch.push(this.cache.stroke(nodeMarkPath(n.threshold, n.r + 3), 1.4 * invZoom), parseColor(frame.tokens.warm), pulse, n.x, n.y)
      }

      if (trailRole === 'selected') {
        this.batch.push(ringTriangles(0, 0, n.r + 4, 1.6 * invZoom, 40), parseColor(frame.tokens.textPrimary), 0.9, n.x, n.y)
      }
    }
  }

  private paintCapstone(n: AtlasNode, frame: RenderFrame, rgb: readonly [number, number, number], invZoom: number): void {
    const outerR = n.r + 3
    this.batch.push(ringTriangles(0, 0, outerR, 1.2 * invZoom, 48), parseColor(frame.tokens.warm), 0.9, n.x, n.y)
    this.batch.push(discTriangles(0, 0, n.r * 0.62, 40), rgb, 0.75, n.x, n.y)
    this.batch.push(ringTriangles(0, 0, n.r, 1 * invZoom, 40), parseColor(frame.tokens.warm), 0.9, n.x, n.y)
    // Progress sweep — fraction of dependents already reviewed. `degree` is
    // fan-in+fan-out (see `layout.ts`), so a plain requires-fan-in count
    // isn't available here; the sweep instead reads the SAME retrievability-
    // driven opacity every other node uses, scaled to [0,1], as an honest
    // proxy for "how settled is what feeds this" without inventing a second
    // statistic the rest of the plate does not show.
    const fraction = Math.max(0, Math.min(1, frame.retrievability?.get(n.id) ?? (n.state === 'review' ? 1 : 0)))
    this.batch.push(arcTriangles(0, 0, outerR + 3, 1.6 * invZoom, fraction, 48), parseColor(frame.tokens.warm), 0.95, n.x, n.y)
    if (this.trailRoleFor(n, frame) === 'selected') {
      this.batch.push(ringTriangles(0, 0, outerR + 6, 1.4 * invZoom, 48), parseColor(frame.tokens.textPrimary), 0.9, n.x, n.y)
    }
  }

  // ---- trail ----------------------------------------------------------------

  private paintTrail(frame: RenderFrame): void {
    if (frame.dueLens) return
    const { layout } = frame
    if (!frame.ancestorSet && !frame.descendantSet) return
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    const invZoom = 1 / frame.view.zoom
    const anchor = frame.selected ?? frame.hovered
    const anchorNode = anchor ? byId.get(anchor) : null
    if (!anchorNode) return

    const draw = (ids: ReadonlySet<string> | null, color: string): void => {
      if (!ids) return
      const rgb = parseColor(color)
      for (const id of ids) {
        const other = byId.get(id)
        if (!other) continue
        const d = stringEdgePath(anchorNode.id, id, anchorNode, other, 'other')
        this.batch.push(strokeTriangles(d, 2 * invZoom), rgb, 0.9)
      }
    }
    draw(frame.ancestorSet, TRAIL_ANCESTOR_COLOR)
    draw(frame.descendantSet, TRAIL_DESCENDANT_COLOR)
  }

  // ---- furniture --------------------------------------------------------

  private paintFurniture(frame: RenderFrame): void {
    const invZoom = 1 / frame.view.zoom
    const rgb = parseColor(frame.tokens.hairline)
    const w = frame.width / frame.view.zoom
    const h = frame.height / frame.view.zoom
    const ox = -frame.view.x / frame.view.zoom
    const oy = -frame.view.y / frame.view.zoom
    for (const tick of cornerTicks(w, h)) {
      this.batch.push(strokeTriangles(tick, 1.4 * invZoom), rgb, 0.5, ox, oy)
    }
  }

  // ---- labels (Canvas2D overlay) -----------------------------------------

  private paintText(frame: RenderFrame): void {
    const ctx = this.textCtx
    if (!ctx || !this.textCanvas) return
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.textBaseline = 'middle'
    this.paintRegionLabels(frame, ctx)
    if (frame.labels.length === 0) return
    ctx.fillStyle = frame.tokens.textPrimary
    for (const label of frame.labels) {
      const size = /** matches `labels.ts`'s own `labelFontSize` scale */ label.h - 1
      ctx.font = `${size}px ${frame.tokens.fontData}`
      ctx.globalAlpha = label.id === frame.selected || label.id === frame.hovered ? 1 : 0.85
      ctx.fillText(label.text, label.x, label.y + label.h / 2)
    }
    ctx.globalAlpha = 1
  }

  /** Region name captions — the retired SVG renderer had these
   * (`regionName(seed)` at `hullTopAnchor`, plus a consolidated/due readout
   * on hover) and the WebGL port silently dropped them along with the
   * hull's color, leaving a plate of unlabeled node clusters. Restoring
   * these IS the "bring back the segmenting" fix: a hull with no caption
   * reads as clutter, the same hull with a caption reads as a charted
   * sub-topic. Drawn on the text canvas (screen space, via the same
   * world→screen projection `GraphEngine`'s `placeLabels` uses) rather than
   * batched into the GL triangle pass, for the same reason node labels are:
   * crisp text at any zoom without a font atlas. */
  private paintRegionLabels(frame: RenderFrame, ctx: CanvasRenderingContext2D): void {
    const { layout, view } = frame
    if (layout.regions.length === 0) return
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    const toScreen = (x: number, y: number): { x: number; y: number } => ({ x: x * view.zoom + view.x, y: y * view.zoom + view.y })
    for (const region of layout.regions) {
      const pts = region.memberIds.map((id) => byId.get(id)).filter((n): n is AtlasNode => Boolean(n))
      const anchor = hullTopAnchor(pts, 26)
      if (!anchor) continue
      const isHovered = !frame.visibleNodes && frame.hoveredRegion === region.seed
      const isFocused = frame.focusedRegion === region.seed
      const overlapsMember = pts.some((p) => Math.hypot(p.x - anchor.x, p.y - anchor.y) < p.r + 10)
      const anchorScreen = toScreen(anchor.x, overlapsMember ? anchor.y - 12 : anchor.y)

      ctx.textAlign = 'center'
      ctx.font = `10px ${frame.tokens.fontData}`
      ctx.fillStyle = frame.tokens.textDim
      ctx.globalAlpha = frame.visibleNodes ? 0.25 : isHovered || isFocused ? 0.85 : 0.25
      ctx.fillText(region.name.toUpperCase(), anchorScreen.x, anchorScreen.y)

      if (isHovered) {
        const consolidated = pts.filter((n) => n.state === 'review').length
        const due = pts.filter((n) => {
          const status = dueStatusFor(n)
          return status === 'overdue' || status === 'today'
        }).length
        ctx.font = `9px ${frame.tokens.fontData}`
        ctx.globalAlpha = 0.85
        ctx.fillText(`consolidated ${consolidated}/${pts.length} · due ${due}`, anchorScreen.x, anchorScreen.y + 11)
      }
    }
    ctx.textAlign = 'left'
    ctx.globalAlpha = 1
  }
}

// Re-exported so callers that only need to fan a polygon (a region wash's
// own fallback path in `render.ts`) do not need a second dependency line.
export { triangulateFan }
