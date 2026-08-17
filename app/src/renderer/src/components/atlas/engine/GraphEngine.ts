/** The topic map's engine — owns the camera, the live physics, the layout,
 * pointer/wheel input, the RAF loop, and painter lifecycle (including
 * GL→Canvas2D fallback on context loss). React is a thin host: it mounts
 * this once, calls `update()` when props change, and never ticks the sim
 * itself — the same split Cairn's `GraphEngine` uses, and for the same
 * reason (a canvas redrawn from React state on every render is a canvas
 * that stutters against 60fps physics).
 *
 * Ported ARCHITECTURALLY from CairnDesktop's atlas engine
 * (app/src/renderer/src/app/atlas/engine/GraphEngine.ts) — the mechanism
 * (RAF loop, dirty-flag gating, pointer/wheel/keyboard handling, drag-to-
 * reposition-and-pin, fling/coast, context-loss fallback) is Cairn's; the
 * domain logic inside it (what a click on a node/region means, what "hot"
 * means for THIS layout) is Engram's own, not a port of Cairn's business
 * logic (drag-drop file attach, link-mode, the iris-cinematic drill
 * transition — none of which have an Engram analogue and are not
 * reproduced here). */

import type { MapAnnotations, TopicGraph } from '../../../../../shared/types'
import { humanizeNodeId } from '../../../../../shared/humanizeId'
import {
  applyWheel,
  boundsOf,
  clampZoom,
  createView,
  fitView,
  fling,
  tickCoast,
  zoomStep,
  type CameraView,
  type Insets,
  NO_INSETS,
} from '../camera'
import { clampToContent, revealTarget, type Viewport } from '../framing'
import { planFlight, type Viewpoint } from '../flight'
import { buildLayout, pinNode, tickLayout, type AtlasLayout } from '../layout'
import { hitNode, hitRegion, invalidateHullCache } from './hit'
import { placeLabels, type LabelBox } from '../labels'
import { readPlateTokens, type PlateTokens } from './tokens'
import type { PlatePainter, RenderFrame } from './paint'
import { ancestorClosure, descendantPath } from '../../graph2d/plate'

export interface EngineCallbacks {
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  onFocusRegion: (seed: string | null) => void
}

export interface EngineProps {
  graph: TopicGraph
  selected: string | null
  query: string
  retrievability: Map<string, number> | null
  annotations: MapAnnotations | null
  dueLens: boolean
  visibleNodes: Set<string> | null
  regions: Map<string, string[]>
  focusedRegion: string | null
}

/** <4px of pointer movement between down and up is a click, not a drag —
 * matching the exact threshold the retired SVG `GraphView.tsx` used. */
const CLICK_SLOP = 4

/** Idle ambient physics alpha — high enough that a released drag's
 * neighbours visibly resettle, low enough that a plate at rest looks at
 * rest rather than perpetually trembling. Reheated higher on drag. */
const IDLE_ALPHA = 0.02
const DRAG_ALPHA = 0.5

export class GraphEngine {
  private readonly host: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly textCanvas: HTMLCanvasElement | null
  private readonly callbacks: EngineCallbacks
  private painter: PlatePainter
  private readonly makeFallbackPainter: (() => PlatePainter) | null

  private view: CameraView = createView()
  private tokens: PlateTokens
  private layout: AtlasLayout | null = null
  private props: EngineProps | null = null
  private insets: Insets = NO_INSETS
  private width = 0
  private height = 0
  private dpr = 1

  private hovered: string | null = null
  private hoveredRegion: string | null = null
  private draggingNode: string | null = null
  private panning = false
  private downX = 0
  private downY = 0
  private lastPointerX = 0
  private lastPointerY = 0
  private lastPointerT = 0
  private lastMoveVX = 0
  private lastMoveVY = 0
  private moved = false

  private flight: { plan: ReturnType<typeof planFlight>; start: number } | null = null
  private simAlpha = IDLE_ALPHA
  private simHot = false

  /** Set whenever something happened that the NEXT frame must actually
   * paint for — a prop update, a hover change, a keypress. Checked
   * alongside `needsPaint()` (which covers continuous motion: an active
   * flight, a hot sim, a coasting camera) so an idle plate costs one
   * boolean OR per frame instead of a full tick+paint. */
  private dirty = true
  private raf: number | null = null
  private running = false
  private lastFrameT = 0
  private startedAt = 0
  private paintFailures = 0
  private themeObserver: MutationObserver | null = null
  private resizeObserver: ResizeObserver | null = null
  private reducedMotion = false

  constructor(
    host: HTMLElement,
    canvas: HTMLCanvasElement,
    textCanvas: HTMLCanvasElement | null,
    callbacks: EngineCallbacks,
    painter: PlatePainter,
    makeFallbackPainter: (() => PlatePainter) | null = null,
  ) {
    this.host = host
    this.canvas = canvas
    this.textCanvas = textCanvas
    this.callbacks = callbacks
    this.painter = painter
    this.makeFallbackPainter = makeFallbackPainter
    this.tokens = readPlateTokens(host)
    this.reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  mount(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('dblclick', this.onDblClick)
    this.canvas.addEventListener('keydown', this.onKeyDown)
    this.canvas.addEventListener('mouseleave', this.onMouseLeave)
    this.canvas.addEventListener('webglcontextlost', this.onContextLost as EventListener)

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize())
      this.resizeObserver.observe(this.host)
    }
    this.handleResize()

    if (typeof MutationObserver !== 'undefined') {
      this.themeObserver = new MutationObserver(() => {
        this.tokens = readPlateTokens(this.host)
      })
      this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    }

    this.running = true
    this.startedAt = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy(): void {
    this.running = false
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('dblclick', this.onDblClick)
    this.canvas.removeEventListener('keydown', this.onKeyDown)
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave)
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost as EventListener)
    this.resizeObserver?.disconnect()
    this.themeObserver?.disconnect()
    this.painter.dispose()
  }

  setInsets(insets: Insets): void {
    this.insets = insets
  }

  /** Push new props in. Rebuilds the layout only when the graph or region
   * partition actually changed — a due-lens toggle or a retrievability
   * refresh must not re-settle the plate out from under a reader's hover. */
  update(props: EngineProps): void {
    const prev = this.props
    const graphChanged = !prev || prev.graph !== props.graph
    const regionsChanged = !prev || prev.regions !== props.regions
    this.props = props

    if (graphChanged || regionsChanged || !this.layout) {
      this.layout = buildLayout(props.graph, Math.max(1, this.width), Math.max(1, this.height), props.regions)
      this.simAlpha = IDLE_ALPHA
      invalidateHullCache(this.layout)
      if (graphChanged) this.fitToContent(true)
    }
    if (prev && prev.selected !== props.selected && props.selected) this.flyToSelected(props.selected)
    if (prev && prev.focusedRegion !== props.focusedRegion) this.flyToRegion(props.focusedRegion)
    this.dirty = true
  }

  // ---- sizing -------------------------------------------------------------

  private handleResize(): void {
    const rect = this.host.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    if (rect.width === this.width && rect.height === this.height && dpr === this.dpr) return
    this.width = Math.max(1, rect.width)
    this.height = Math.max(1, rect.height)
    this.dpr = dpr
    this.canvas.style.width = `${this.width}px`
    this.canvas.style.height = `${this.height}px`
    if (this.textCanvas) {
      this.textCanvas.style.width = `${this.width}px`
      this.textCanvas.style.height = `${this.height}px`
    }
    this.painter.resize(this.width, this.height, this.dpr)
  }

  // ---- camera moves ---------------------------------------------------

  private viewport(): Viewport {
    return { w: this.width, h: this.height, insets: this.insets }
  }

  private toViewpoint(v: CameraView): Viewpoint {
    return { cx: (this.width / 2 - v.x) / v.zoom, cy: (this.height / 2 - v.y) / v.zoom, w: this.width / v.zoom }
  }

  private fromViewpoint(vp: Viewpoint): CameraView {
    const zoom = clampZoom(this.width / vp.w)
    return { x: this.width / 2 - vp.cx * zoom, y: this.height / 2 - vp.cy * zoom, zoom, vx: 0, vy: 0 }
  }

  private startFlight(target: CameraView): void {
    if (this.reducedMotion) {
      this.view = target
      this.flight = null
      return
    }
    this.flight = { plan: planFlight(this.toViewpoint(this.view), this.toViewpoint(target)), start: performance.now() }
  }

  private fitToContent(instant = false): void {
    if (!this.layout || this.layout.nodes.length === 0) return
    const bounds = boundsOf(this.layout.nodes)
    if (!bounds) return
    const target = fitView(bounds, this.width, this.height, 64, this.insets)
    if (instant) this.view = target
    else this.startFlight(target)
  }

  private flyToSelected(id: string): void {
    if (!this.layout) return
    const n = this.layout.nodes.find((node) => node.id === id)
    if (!n) return
    const target = revealTarget(n, this.view, this.viewport())
    if (target) this.startFlight(target)
  }

  private flyToRegion(seed: string | null): void {
    if (!seed || !this.layout) return
    const region = this.layout.regions.find((r) => r.seed === seed)
    if (!region) return
    const byId = new Map(this.layout.nodes.map((n) => [n.id, n]))
    const pts = region.memberIds.map((id) => byId.get(id)).filter((n): n is NonNullable<typeof n> => Boolean(n))
    const bounds = boundsOf(pts)
    if (!bounds) return
    const target = fitView(bounds, this.width, this.height, 60, this.insets)
    this.startFlight(target)
  }

  // ---- pointer ------------------------------------------------------------

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.view.x) / this.view.zoom, y: (sy - this.view.y) / this.view.zoom }
  }

  private localPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.dirty = true
    this.canvas.setPointerCapture(e.pointerId)
    const p = this.localPoint(e)
    this.downX = p.x
    this.downY = p.y
    this.lastPointerX = p.x
    this.lastPointerY = p.y
    this.lastPointerT = performance.now()
    this.lastMoveVX = 0
    this.lastMoveVY = 0
    this.moved = false
    this.flight = null

    if (!this.layout) return
    const world = this.screenToWorld(p.x, p.y)
    const hit = hitNode(this.layout, world.x, world.y)
    if (hit) {
      this.draggingNode = hit.id
      pinNode(this.layout, hit.id, world.x, world.y)
      this.simAlpha = DRAG_ALPHA
    } else {
      this.panning = true
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.dirty = true
    const p = this.localPoint(e)
    const now = performance.now()
    const dt = Math.max(1, now - this.lastPointerT)
    this.lastMoveVX = ((p.x - this.lastPointerX) / dt) * 16.67
    this.lastMoveVY = ((p.y - this.lastPointerY) / dt) * 16.67

    if (Math.hypot(p.x - this.downX, p.y - this.downY) > CLICK_SLOP) this.moved = true

    if (this.draggingNode && this.layout) {
      const world = this.screenToWorld(p.x, p.y)
      pinNode(this.layout, this.draggingNode, world.x, world.y)
      this.simAlpha = DRAG_ALPHA
      invalidateHullCache(this.layout)
    } else if (this.panning) {
      this.view = { ...this.view, x: this.view.x + (p.x - this.lastPointerX), y: this.view.y + (p.y - this.lastPointerY), vx: 0, vy: 0 }
    } else if (this.layout) {
      const world = this.screenToWorld(p.x, p.y)
      const hit = hitNode(this.layout, world.x, world.y)
      this.hovered = hit?.id ?? null
      this.hoveredRegion = hit ? null : hitRegion(this.layout, world.x, world.y)
      this.canvas.style.cursor = hit ? 'pointer' : this.hoveredRegion ? 'pointer' : 'grab'
    }

    this.lastPointerX = p.x
    this.lastPointerY = p.y
    this.lastPointerT = now
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (this.draggingNode) {
      if (this.layout) {
        pinNode(this.layout, this.draggingNode, null, null)
        invalidateHullCache(this.layout)
      }
      this.draggingNode = null
      this.simAlpha = Math.max(this.simAlpha, 0.2)
    } else if (this.panning) {
      this.panning = false
      if (!this.moved) {
        // A click on the background that started and ended within slop: if
        // it landed in a region, toggle focus; otherwise release focus.
        const p = this.localPoint(e)
        const world = this.screenToWorld(p.x, p.y)
        const region = this.layout ? hitRegion(this.layout, world.x, world.y) : null
        this.callbacks.onFocusRegion(region && region !== this.props?.focusedRegion ? region : null)
      } else {
        this.view = fling(this.view, this.lastMoveVX, this.lastMoveVY)
      }
    } else if (!this.moved && this.layout) {
      const p = this.localPoint(e)
      const world = this.screenToWorld(p.x, p.y)
      const hit = hitNode(this.layout, world.x, world.y)
      if (hit) this.callbacks.onSelect(hit.id)
    }
    try {
      this.canvas.releasePointerCapture(e.pointerId)
    } catch {
      // Already released (e.g. pointercancel beat us here) — nothing to do.
    }
  }

  private onDblClick = (e: MouseEvent): void => {
    if (!this.layout) return
    const rect = this.canvas.getBoundingClientRect()
    const world = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
    const hit = hitNode(this.layout, world.x, world.y)
    if (hit) this.callbacks.onOpen(hit.id)
  }

  private onMouseLeave = (): void => {
    this.hovered = null
    this.hoveredRegion = null
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    this.dirty = true
    this.flight = null
    const p = this.localPoint(e as unknown as PointerEvent)
    this.view = applyWheel(this.view, e, p)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.dirty = true
    if (e.key === '+' || e.key === '=') {
      this.flight = null
      this.view = zoomStep(this.view, 1.25, this.width / 2, this.height / 2)
    } else if (e.key === '-') {
      this.flight = null
      this.view = zoomStep(this.view, 0.8, this.width / 2, this.height / 2)
    } else if (e.key === 'Escape') {
      this.callbacks.onFocusRegion(null)
    } else if (e.key === '0') {
      this.fitToContent(false)
    }
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault()
    this.paintFailures = 3 // force the fallback swap on the next frame
  }

  // ---- frame loop -----------------------------------------------------

  private needsPaint(): boolean {
    return Boolean(this.flight) || this.simHot || this.panning || this.draggingNode !== null || Math.hypot(this.view.vx, this.view.vy) > 0.001
  }

  private loop = (t: number): void => {
    if (!this.running) return
    const dt = this.lastFrameT ? t - this.lastFrameT : 16.67
    this.lastFrameT = t

    if (this.paintFailures >= 3 && this.makeFallbackPainter) {
      this.painter.dispose()
      this.painter = this.makeFallbackPainter()
      this.painter.resize(this.width, this.height, this.dpr)
      this.paintFailures = 0
    }

    // The gate: an idle plate — nothing dirty since the last frame, no
    // flight/coast/sim/drag in flight — costs one boolean check per frame
    // instead of a tick+paint. `dirty` covers discrete events (a prop
    // update, a hover change, a keypress); `needsPaint()` covers continuous
    // motion carried over from the PREVIOUS frame's own state (simHot from
    // the last tick, an active flight, a still-coasting camera) — checking
    // last frame's state to decide whether this one does work is the same
    // one-frame-lagged gate Cairn's engine uses.
    if (this.dirty || this.needsPaint()) {
      this.dirty = false

      if (this.flight) {
        const elapsed = t - this.flight.start
        const vp = this.flight.plan.at(elapsed)
        this.view = this.fromViewpoint(vp)
        if (elapsed >= this.flight.plan.duration) this.flight = null
      } else if (!this.panning && !this.draggingNode) {
        const coasted = tickCoast(this.view, dt)
        if (coasted) this.view = coasted
      }

      if (this.layout && this.props) {
        const bounds = boundsOf(this.layout.nodes)
        this.view = clampToContent(this.view, bounds, this.viewport())
        const cx = this.width / 2
        const cy = this.height / 2
        this.simHot = tickLayout(this.layout, this.simAlpha, cx, cy)
        if (this.simHot) invalidateHullCache(this.layout)
        // Idle alpha decays toward rest once a reheat (drag) has settled, so
        // the plate does not stay perpetually "warm" after the interaction
        // that warmed it ends.
        if (this.simAlpha > IDLE_ALPHA) this.simAlpha = Math.max(IDLE_ALPHA, this.simAlpha * 0.96)
      }

      try {
        this.paint(t)
        this.paintFailures = 0
      } catch (err) {
        this.paintFailures++
        console.error('atlas paint failure', err)
      }
    }

    this.raf = requestAnimationFrame(this.loop)
  }

  private paint(t: number): void {
    if (!this.layout || !this.props) return
    const p = this.props
    const selected = p.selected
    const anchor = selected ?? this.hovered
    const ancestorSet = p.dueLens ? null : anchor ? this.ancestryFor(anchor, selected !== null) : null
    const descendantSet = p.dueLens ? null : anchor ? this.descendancyFor(anchor, selected !== null) : null

    const labelFor = (n: { id: string }): string => {
      const latex = p.annotations?.[n.id]?.latexLabel
      return latex ? latex.replace(/\$\$?/g, '') : humanizeNodeId(n.id)
    }
    const labels: LabelBox[] = placeLabels({
      nodes: this.layout.nodes,
      toScreen: (x, y) => ({ x: x * this.view.zoom + this.view.x, y: y * this.view.zoom + this.view.y }),
      labelFor,
      zoom: this.view.zoom,
      selected,
      hovered: this.hovered,
      trail: ancestorSet && descendantSet ? new Set([...ancestorSet, ...descendantSet]) : ancestorSet ?? descendantSet,
      width: this.width,
      height: this.height,
      insets: this.insets,
    })

    const frame: RenderFrame = {
      layout: this.layout,
      view: this.view,
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      tokens: this.tokens,
      title: p.graph.title,
      selected,
      hovered: this.hovered,
      dueLens: p.dueLens,
      ancestorSet,
      descendantSet,
      visibleNodes: p.visibleNodes,
      retrievability: p.retrievability,
      focusedRegion: p.focusedRegion,
      query: p.query,
      nowSec: (t - this.startedAt) / 1000,
      reducedMotion: this.reducedMotion,
      labels,
    }
    this.painter.paint(frame)
  }

  /** Full transitive closure when a node is genuinely selected (a click);
   * one hop only on bare hover — the exact priority the retired SVG
   * renderer used, so a preview always reads as "adjacent to what I'm
   * looking at" and a selection reads as the whole path. */
  private ancestryFor(id: string, isSelection: boolean): ReadonlySet<string> {
    if (!this.layout || !this.props) return new Set()
    if (isSelection) return ancestorClosure(this.props.graph, id)
    const node = this.props.graph.nodes[id]
    return new Set((node?.edges.requires ?? []).filter((r) => !this.layout!.hubNodeIds.has(r)))
  }

  private descendancyFor(id: string, isSelection: boolean): ReadonlySet<string> {
    if (!this.layout || !this.props) return new Set()
    if (isSelection) return descendantPath(this.props.graph, id)
    return new Set((this.layout.forwardAdjacency.get(id) ?? []).filter((d) => !this.layout!.hubNodeIds.has(d)))
  }
}
