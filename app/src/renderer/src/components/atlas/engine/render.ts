/** The Canvas2D fallback painter — mounted when WebGL2 is unavailable at
 * startup, or swapped in mid-session on a lost GL context (see
 * `GraphEngine.ts`'s `makeFallbackPainter`).
 *
 * Same `PlatePainter` contract as `WebGLPainter`, same draw order, same
 * domain decisions (`frame.ts`/`marks.ts` own those either way) — but
 * drawn with Canvas2D's own path/arc/dash primitives instead of the
 * triangle-batch pipeline, since Canvas2D already has native `setLineDash`
 * and `Path2D`, and reimplementing `gl/geometry.ts`'s tessellation just to
 * feed a 2D context would be answering a question Canvas2D already
 * answers. A genuine, if visually simpler, degradation path — not a
 * placeholder. */

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

function resolveVar(css: string, host: HTMLElement): string {
  if (!css.startsWith('var(')) return css
  const name = css.slice(4, -1).trim()
  const v = getComputedStyle(host).getPropertyValue(name).trim()
  return v || '#808080'
}

export class Canvas2DPainter implements PlatePainter {
  private readonly ctx: CanvasRenderingContext2D
  private readonly canvas: HTMLCanvasElement
  private width = 0
  private height = 0
  private dpr = 1

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas2D unavailable')
    this.ctx = ctx
    this.canvas = canvas
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.dpr = dpr
    this.canvas.width = Math.max(1, Math.round(width * dpr))
    this.canvas.height = Math.max(1, Math.round(height * dpr))
  }

  dispose(): void {
    // Nothing to release — Canvas2D holds no GPU handles this app owns.
  }

  paint(frame: RenderFrame): void {
    const ctx = this.ctx
    const col = (css: string): string => resolveVar(css, this.canvas)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = col(frame.tokens.void)
    ctx.fillRect(0, 0, this.width, this.height)

    ctx.save()
    ctx.translate(frame.view.x, frame.view.y)
    ctx.scale(frame.view.zoom, frame.view.zoom)

    this.paintRegions(frame, col)
    this.paintEdges(frame, col)
    this.paintNodes(frame, col)
    this.paintTrail(frame, col)
    this.paintFurniture(frame, col)
    ctx.restore()

    this.paintText(frame, col)
  }

  private nodeVisible(n: AtlasNode, frame: RenderFrame): boolean {
    return frame.visibleNodes === null || frame.visibleNodes.has(n.id)
  }

  private trailRoleFor(n: AtlasNode, frame: RenderFrame): TrailRole {
    if (n.id === frame.selected) return 'selected'
    if (frame.ancestorSet?.has(n.id)) return 'ancestor'
    if (frame.descendantSet?.has(n.id)) return 'descendant'
    return null
  }

  private paintRegions(frame: RenderFrame, col: (c: string) => string): void {
    const ctx = this.ctx
    const byId = new Map(frame.layout.nodes.map((n) => [n.id, n]))
    // Warm ink — see WebGLPainter's own doctrine comment on this same wash
    // (`--color-ink-hairline` read as "no color at all," not neutral chrome).
    const washColor = col(frame.tokens.warm)
    for (const region of frame.layout.regions) {
      const pts = region.memberIds.map((id) => byId.get(id)).filter((n): n is AtlasNode => Boolean(n))
      if (pts.length < 3) continue
      const focused = frame.focusedRegion === region.seed
      const dimmed = frame.focusedRegion !== null && !focused
      const consolidatedFraction = pts.filter((n) => n.state === 'review').length / pts.length
      const path = new Path2D(hullPath(pts, 26))
      ctx.fillStyle = washColor
      ctx.globalAlpha = (focused ? 0.09 : dimmed ? 0.015 : 0.045) * (consolidatedFraction * 0.6 + 0.4)
      ctx.fill(path)
      ctx.globalAlpha = focused ? 0.35 : dimmed ? 0.06 : 0.16
      ctx.lineWidth = 1 / frame.view.zoom
      ctx.strokeStyle = washColor
      ctx.stroke(path)
    }
    ctx.globalAlpha = 1
  }

  private paintEdges(frame: RenderFrame, col: (c: string) => string): void {
    const ctx = this.ctx
    const byId = new Map(frame.layout.nodes.map((n) => [n.id, n]))
    const invZoom = 1 / frame.view.zoom
    for (const e of frame.layout.edges) {
      if (!atlasEdgeVisible(e, frame.layout.hubNodeIds, frame.layout.forwardAdjacency)) continue
      const a = byId.get(e.source)
      const b = byId.get(e.target)
      if (!a || !b) continue
      if (!this.nodeVisible(a, frame) && !this.nodeVisible(b, frame)) continue
      const spec = edgeInk(e.kind)
      const kind: 'requires' | 'other' = e.kind === 'requires' ? 'requires' : 'other'
      const d = stringEdgePath(e.source, e.target, a, b, kind)
      ctx.strokeStyle = col(spec.color)
      ctx.lineWidth = spec.width * frame.linkThickness * invZoom
      ctx.globalAlpha = 0.85
      ctx.setLineDash(spec.dash ? spec.dash.map((v) => v * invZoom) : [])
      ctx.stroke(new Path2D(d))
      ctx.setLineDash([])

      if (e.kind === 'requires') {
        const { x, y, angleRad } = arrowheadPlacement(e.source, e.target, a, b, b.r)
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(angleRad)
        ctx.scale(invZoom, invZoom)
        ctx.fillStyle = col(spec.color)
        ctx.fill(new Path2D(ARROWHEAD_PATH))
        ctx.restore()
      }
    }
    ctx.globalAlpha = 1
  }

  private paintNodes(frame: RenderFrame, col: (c: string) => string): void {
    const ctx = this.ctx
    const invZoom = 1 / frame.view.zoom
    for (const n of frame.layout.nodes) {
      if (!this.nodeVisible(n, frame)) continue
      const dueStatus = frame.dueLens ? dueStatusFor(n) : null
      const trailRole = frame.dueLens ? null : this.trailRoleFor(n, frame)
      const ink = col(nodeInk(n.state, dueStatus, trailRole))
      const opacity = nodeFillOpacity(frame.retrievability?.get(n.id))
      const kind = markKind(n)
      const strokeW = (n.threshold ? 1.4 : 1.2) * invZoom

      ctx.save()
      ctx.translate(n.x, n.y)

      if (dueStatus === 'overdue') {
        const grad = ctx.createRadialGradient(0, 0, n.r * 0.7, 0, 0, n.r * 2.2)
        grad.addColorStop(0, col('var(--color-ink-danger)'))
        grad.addColorStop(1, 'transparent')
        ctx.globalAlpha = 0.5
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(0, 0, n.r * 2.2, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }

      if (kind === 'capstone') {
        this.paintCapstoneNode(n, frame, col, invZoom)
        ctx.restore()
        continue
      }

      const d = new Path2D(nodeMarkPath(n.threshold, n.r))
      const style = fillStyleFor(n.state)
      ctx.strokeStyle = ink
      ctx.lineWidth = strokeW
      if (style === 'filled') {
        ctx.fillStyle = ink
        ctx.globalAlpha = opacity * 0.92
        ctx.fill(d)
        ctx.globalAlpha = 0.9
        ctx.stroke(d)
      } else if (style === 'half') {
        ctx.fillStyle = ink
        ctx.globalAlpha = opacity * 0.85
        ctx.fill(new Path2D(halfDiscMarkPath(n.r)))
        ctx.globalAlpha = opacity
        ctx.stroke(d)
      } else {
        ctx.globalAlpha = opacity
        ctx.stroke(d)
      }
      ctx.globalAlpha = 1

      if (n.lapses > 0) {
        ctx.fillStyle = col(frame.tokens.dangerDim)
        ctx.globalAlpha = 0.8
        for (const dot of lapseStippleDots(n.r)) {
          ctx.beginPath()
          ctx.arc(dot.x, dot.y, 1.1 * invZoom, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      // `viz.kind` badge — see marks.ts's own doctrine comment (and
      // WebGLPainter's matching block) on why this is a small stroke-only
      // corner mark in a dim, not a new, ink.
      if (n.kind) {
        const badgeR = Math.min(7, Math.max(3, n.r * 0.38))
        const badgeOffset = n.r * 0.72
        ctx.save()
        ctx.translate(badgeOffset, badgeOffset)
        ctx.strokeStyle = col(frame.tokens.textDim)
        ctx.lineWidth = 1 * invZoom
        ctx.globalAlpha = 0.8
        ctx.stroke(new Path2D(conceptKindMarkPath(n.kind, badgeR)))
        ctx.globalAlpha = 1
        ctx.restore()
      }

      if (n.isFrontier) {
        const pulse = frame.reducedMotion ? 0.6 : 0.4 + 0.3 * Math.sin(frame.nowSec * 1.6)
        ctx.globalAlpha = pulse
        ctx.strokeStyle = col(frame.tokens.warm)
        ctx.lineWidth = 1.4 * invZoom
        ctx.stroke(new Path2D(nodeMarkPath(n.threshold, n.r + 3)))
        ctx.globalAlpha = 1
      }

      if (trailRole === 'selected') {
        ctx.strokeStyle = col(frame.tokens.textPrimary)
        ctx.lineWidth = 1.6 * invZoom
        ctx.globalAlpha = 0.9
        ctx.beginPath()
        ctx.arc(0, 0, n.r + 4, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      ctx.restore()
    }
  }

  private paintCapstoneNode(n: AtlasNode, frame: RenderFrame, col: (c: string) => string, invZoom: number): void {
    const ctx = this.ctx
    const outerR = n.r + 3
    const ink = col(nodeInk(n.state, null, this.trailRoleFor(n, frame)))
    ctx.strokeStyle = col(frame.tokens.warm)
    ctx.lineWidth = 1.2 * invZoom
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.arc(0, 0, outerR, 0, Math.PI * 2)
    ctx.stroke()

    ctx.fillStyle = ink
    ctx.globalAlpha = 0.75
    ctx.beginPath()
    ctx.arc(0, 0, n.r * 0.62, 0, Math.PI * 2)
    ctx.fill()

    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1 * invZoom
    ctx.beginPath()
    ctx.arc(0, 0, n.r, 0, Math.PI * 2)
    ctx.stroke()

    const fraction = Math.max(0, Math.min(1, frame.retrievability?.get(n.id) ?? (n.state === 'review' ? 1 : 0)))
    ctx.globalAlpha = 0.95
    ctx.lineWidth = 1.6 * invZoom
    ctx.beginPath()
    ctx.arc(0, 0, outerR + 3, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2)
    ctx.stroke()

    if (this.trailRoleFor(n, frame) === 'selected') {
      ctx.strokeStyle = col(frame.tokens.textPrimary)
      ctx.lineWidth = 1.4 * invZoom
      ctx.globalAlpha = 0.9
      ctx.beginPath()
      ctx.arc(0, 0, outerR + 6, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  private paintTrail(frame: RenderFrame, col: (c: string) => string): void {
    if (frame.dueLens) return
    const ctx = this.ctx
    const byId = new Map(frame.layout.nodes.map((n) => [n.id, n]))
    const invZoom = 1 / frame.view.zoom
    const anchor = frame.selected ?? frame.hovered
    const anchorNode = anchor ? byId.get(anchor) : null
    if (!anchorNode) return

    const draw = (ids: ReadonlySet<string> | null, color: string): void => {
      if (!ids) return
      ctx.strokeStyle = col(color)
      ctx.lineWidth = 2 * invZoom
      ctx.globalAlpha = 0.9
      for (const id of ids) {
        const other = byId.get(id)
        if (!other) continue
        ctx.stroke(new Path2D(stringEdgePath(anchorNode.id, id, anchorNode, other, 'other')))
      }
    }
    draw(frame.ancestorSet, TRAIL_ANCESTOR_COLOR)
    draw(frame.descendantSet, TRAIL_DESCENDANT_COLOR)
    ctx.globalAlpha = 1
  }

  private paintFurniture(frame: RenderFrame, col: (c: string) => string): void {
    const ctx = this.ctx
    const invZoom = 1 / frame.view.zoom
    ctx.strokeStyle = col(frame.tokens.hairline)
    ctx.lineWidth = 1.4 * invZoom
    ctx.globalAlpha = 0.5
    const w = frame.width / frame.view.zoom
    const h = frame.height / frame.view.zoom
    const ox = -frame.view.x / frame.view.zoom
    const oy = -frame.view.y / frame.view.zoom
    ctx.save()
    ctx.translate(ox, oy)
    for (const tick of cornerTicks(w, h)) ctx.stroke(new Path2D(tick))
    ctx.restore()
    ctx.globalAlpha = 1
  }

  private paintText(frame: RenderFrame, col: (c: string) => string): void {
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.textBaseline = 'middle'
    this.paintRegionLabels(frame, col)
    if (frame.labels.length === 0) return
    ctx.fillStyle = col(frame.tokens.textPrimary)
    for (const label of frame.labels) {
      ctx.font = `${label.h - 1}px ${frame.tokens.fontData}`
      ctx.globalAlpha = label.id === frame.selected || label.id === frame.hovered ? 1 : 0.85
      ctx.fillText(label.text, label.x, label.y + label.h / 2)
    }
    ctx.globalAlpha = 1
  }

  /** Region name captions — see `WebGLPainter`'s own doctrine comment on
   * this same restoration. Same anchor math, same hover/focus rule, drawn
   * with Canvas2D text instead of a GL batch. */
  private paintRegionLabels(frame: RenderFrame, col: (c: string) => string): void {
    const ctx = this.ctx
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
      ctx.fillStyle = col(frame.tokens.textDim)
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
