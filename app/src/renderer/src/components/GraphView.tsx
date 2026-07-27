import { useEffect, useMemo, useRef, useState } from 'react'
import type { TopicGraph, EngramNode, MapAnnotations } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { EDGE_STYLE, type SimEdge } from './graph3d/types'
import { buildEdges, computeForwardAdjacency, computeFrontierIds, computeHubNodeIds, seeded } from './graph3d/layout'
import {
  settlePlate,
  cellBodyPath,
  dendriteStubs,
  territoryGroups,
  hullPath,
  hullCentroid,
  plateStats,
  ancestorClosure,
  descendantPath,
  type PlateNode,
} from './graph2d/plate'

// Kept re-exported so TopicMapView's modal edge-kind labels can still import
// EDGE_STYLE from this module.
export { EDGE_STYLE }

/** SVG `<text>` can't host KaTeX (no DOM to render into), so a node's
 * annotate_node latex_label — meant for MathRenderer elsewhere — is shown
 * here as plain text with the `$`/`$$` math delimiters stripped rather than
 * rendered. Leaves the LaTeX source itself untouched, just legible without
 * literal dollar signs cluttering the plate. */
export function stripMathDelimiters(text: string): string {
  return text.replace(/\$\$?/g, '')
}

// Exported so NodeTable can color its state/due cells with the exact same
// vocabulary the plate uses — a table row and a map cell should never
// disagree about what "consolidated" or "overdue" mean.
export const STATE_COLOR: Record<EngramNode['state'], string> = {
  new: 'var(--color-ink-cool-dim)',
  learning: 'var(--color-ink-cool)',
  review: 'var(--color-ink-warm)',
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export type DueStatus = 'overdue' | 'today' | 'future'

export const DUE_LENS_COLOR: Record<DueStatus, string> = {
  overdue: 'var(--color-ink-danger)',
  today: 'var(--color-ink-warm)',
  future: 'var(--color-ink-cool-dim)',
}

/** Where a node's own schedule sits relative to today, LOCAL-date compared —
 * getFullYear/Month/Date, never toISOString, matching the discipline
 * ReviewSessionView's daysOverdueLocal and HomeView's due forecast already
 * use so "today" reads identically everywhere due dates get compared in this
 * app. `null` for a node with nothing to compare yet: state 'new' has no
 * schedule, and the due lens leaves those untouched per the brief. Exported
 * so NodeTable's "due" filter and due-column status use this exact
 * definition rather than a parallel reimplementation. */
export function dueStatusFor(node: EngramNode): DueStatus | null {
  if (node.state === 'new' || !node.fsrs.due) return null
  const today = new Date()
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const d = new Date(`${node.fsrs.due}T00:00:00`)
  const diffDays = Math.floor((d.getTime() - dayStart.getTime()) / 86400000)
  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  return 'future'
}

/** Shared control-point math for the "loose string" quadratic — factored out
 * of stringEdgePath so the calligraphic taper (below) samples the EXACT same
 * curve rather than a re-derivation that could silently drift out of sync
 * with the hairline spine. Both baseBow (deterministic per-edge bow, requires
 * edges only) and sway (ambient drift-clock ripple) are unchanged from the
 * pre-taper implementation. */
function edgeBezierControl(
  source: string,
  target: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
  kind: 'requires' | 'other',
  t: number,
): { cx: number; cy: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const nx = -dy / len
  const ny = dx / len
  const key = `${source}::${target}`
  const sign = seeded(key, 7) < 0.5 ? -1 : 1
  const baseBow = kind === 'requires' ? len * 0.08 * sign : 0
  // The string's belly swings a touch more than the endpoints drift, with a
  // per-edge phase and rate so no two threads move in lockstep.
  const swayRate = 0.35 + seeded(key, 8) * 0.3
  const swayPhase = seeded(key, 9) * Math.PI * 2
  const sway = t === 0 ? 0 : Math.sin(t * swayRate + swayPhase) * Math.min(9, len * 0.06)
  return { cx: mx + nx * (baseBow + sway), cy: my + ny * (baseBow + sway) }
}

/** Edge geometry as a "loose string" — a quadratic bezier whose control
 * point carries both the deterministic per-edge bow (requires edges only)
 * and a slow ambient sway driven by the drift clock `t`, so links ripple
 * like slack threads while their endpoints ride the nodes' own drift.
 * Shared by the base edge layer (non-requires hairlines) and the
 * hover/selection trail overlay so trail edges sit exactly on top of their
 * base edge at every instant. */
function stringEdgePath(
  source: string,
  target: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
  kind: 'requires' | 'other',
  t: number,
): string {
  const { cx, cy } = edgeBezierControl(source, target, a, b, kind, t)
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

/** Point and unit tangent at parameter `s` (0..1) along the quadratic bezier
 * A -> (cx,cy) -> B. Used to sample the taper outline below. */
function quadPointAndTangent(
  a: { x: number; y: number },
  cx: number,
  cy: number,
  b: { x: number; y: number },
  s: number,
): { x: number; y: number; nx: number; ny: number } {
  const mt = 1 - s
  const x = mt * mt * a.x + 2 * mt * s * cx + s * s * b.x
  const y = mt * mt * a.y + 2 * mt * s * cy + s * s * b.y
  // B'(s) = 2(1-s)(C-A) + 2s(B-C)
  const tx = 2 * mt * (cx - a.x) + 2 * s * (b.x - cx)
  const ty = 2 * mt * (cy - a.y) + 2 * s * (b.y - cy)
  const tlen = Math.hypot(tx, ty) || 1
  // Unit normal (perpendicular to the tangent), not the tangent itself.
  return { x, y, nx: -ty / tlen, ny: tx / tlen }
}

// Sample count for the taper outline — a quadratic bezier is already a very
// low-order curve (one control point), so a handful of samples reproduces it
// with no visible faceting once anti-aliased; this is a fixed, modest cost
// per requires-edge per render (not per-pixel, not per-frame beyond the
// existing drift re-render), comparable to the single stroked path it
// replaces.
const TAPER_SAMPLES = 12

/** Requires-edge spine, offset perpendicular into a filled tapered ribbon —
 * ~2.2px at the prerequisite end (source/`a`, per buildEdges: `source` is
 * always the node listed in another node's `requires`, i.e. the
 * prerequisite) narrowing to ~0.8px at the dependent end (target/`b`), so
 * the ink visibly "lifts" as it travels from what-you-need to what-it-
 * unlocks. Built from the identical edgeBezierControl the hairline spine
 * uses, so sway/drift are pixel-identical to stringEdgePath's output. */
function calligraphicEdgePath(
  source: string,
  target: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
  widthStart = 2.2,
  widthEnd = 0.8,
): string {
  const { cx, cy } = edgeBezierControl(source, target, a, b, 'requires', t)
  const top: { x: number; y: number }[] = []
  const bottom: { x: number; y: number }[] = []
  for (let i = 0; i <= TAPER_SAMPLES; i++) {
    const s = i / TAPER_SAMPLES
    const { x, y, nx, ny } = quadPointAndTangent(a, cx, cy, b, s)
    const halfW = (widthStart + (widthEnd - widthStart) * s) / 2
    top.push({ x: x + nx * halfW, y: y + ny * halfW })
    bottom.push({ x: x - nx * halfW, y: y - ny * halfW })
  }
  const pts = [...top, ...bottom.reverse()]
  return (
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + ' Z'
  )
}

/** Small filled arrowhead at the dependent end of a requires edge, oriented
 * along the spine's own end tangent (so it "points the way the string
 * travels" — from prerequisite into dependent) and sized in screen space via
 * the caller-supplied inverse-zoom scale, so it reads the same size whether
 * the plate is zoomed to 0.35x or 4x. */
function arrowheadTransform(
  source: string,
  target: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
  targetRadius: number,
  t: number,
  invZoom: number,
): string {
  const { cx, cy } = edgeBezierControl(source, target, a, b, 'requires', t)
  // Tangent at s=1: B'(1) = 2(B - C).
  const tx = 2 * (b.x - cx)
  const ty = 2 * (b.y - cy)
  const tlen = Math.hypot(tx, ty) || 1
  const angle = (Math.atan2(ty, tx) * 180) / Math.PI
  // The spine runs all the way to the target node's CENTER (same as the
  // pre-taper hairline always did — node bodies render after edges, so the
  // segment inside a node's own disc is simply painted over). An arrowhead
  // is small enough that placing it at the center would land entirely
  // inside that disc and never be seen, so it's pulled back along the
  // tangent by the node's own drifted radius to sit right at the rim.
  const tipX = b.x - (tx / tlen) * targetRadius
  const tipY = b.y - (ty / tlen) * targetRadius
  return `translate(${tipX.toFixed(2)} ${tipY.toFixed(2)}) rotate(${angle.toFixed(2)}) scale(${invZoom.toFixed(4)})`
}
const ARROWHEAD_PATH = 'M -6 -3 L 0 0 L -6 3 Z'

/** Corner registration ticks — small printing-plate crop marks bracketing
 * each corner of the plate rect, inset `TICK` px along both edges. Pure
 * function of the plate's measured size, so it costs nothing per frame: it's
 * called once per render from the (static, non-drifting) furniture layer,
 * never from inside the drift path. */
const CORNER_TICK = 12
function cornerTicks(w: number, h: number): string[] {
  return [
    `M 0 ${CORNER_TICK} L 0 0 L ${CORNER_TICK} 0`,
    `M ${w - CORNER_TICK} 0 L ${w} 0 L ${w} ${CORNER_TICK}`,
    `M ${w} ${h - CORNER_TICK} L ${w} ${h} L ${w - CORNER_TICK} ${h}`,
    `M ${CORNER_TICK} ${h} L 0 ${h} L 0 ${h - CORNER_TICK}`,
  ]
}

/** Hides any edge touching a hub id (the capstone, or a capstone-like
 * "synthesis" node nearly everything requires-into) except a genuine "final"
 * requires edge — the hub's only dependent is this source, i.e. the natural
 * last step before mastery. Ported verbatim from the old three.js component's
 * predicate (with `showCapstoneLinks` permanently off, since that toggle is
 * gone from this props contract). */
function isEdgeVisible(e: SimEdge, hubNodeIds: Set<string>, forwardAdjacency: Map<string, string[]>): boolean {
  if (hubNodeIds.size === 0) return true
  const touchesHub = hubNodeIds.has(e.source) || hubNodeIds.has(e.target)
  if (!touchesHub) return true
  if (e.kind === 'requires' && hubNodeIds.has(e.target)) {
    const dependents = forwardAdjacency.get(e.source)
    return (dependents?.length ?? 0) <= 1
  }
  return false
}

interface GraphViewProps {
  graph: TopicGraph
  selected: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  query: string
  retrievability: Map<string, number> | null
  /** Tutor-authored LaTeX overrides (see mapAnnotations.ts) — when a node has
   * a latex_label, it replaces the plain humanizeNodeId label (delimiters
   * stripped; see stripMathDelimiters above). Optional: undefined behaves
   * exactly as before annotate_node existed. */
  annotations?: MapAnnotations | null
  /** Schedule-lens toggle owned by TopicMapView — while on, node bodies
   * recolor by fsrs.due standing instead of encode/consolidate state, and
   * territory labels hide (the plate should read as pure schedule at a
   * glance, not compete with wash captions). */
  dueLens: boolean
  /** Growth-replay lens owned by TopicMapView (GrowthScrubber) — when a
   * Set, nodes outside it sink to near-zero opacity (still occupying their
   * plate position, so nothing reflows as the scrub advances) and any edge
   * touching a hidden node hides outright. `null`/undefined is the live
   * plate — zero behavior change from before this prop existed. */
  visibleNodes?: Set<string> | null
}

export function GraphView({
  graph,
  selected,
  onSelect,
  onOpen,
  query,
  retrievability,
  annotations,
  dueLens,
  visibleNodes,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const [hovered, setHovered] = useState<string | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSize({ w: rect.width || 800, h: rect.height || 600 })
  }, [])

  const panAnimRef = useRef<number | null>(null)
  function cancelPanAnimation() {
    if (panAnimRef.current !== null) {
      cancelAnimationFrame(panAnimRef.current)
      panAnimRef.current = null
    }
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      cancelPanAnimation()
      const rect = el!.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      setView((v) => {
        const nextZoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.0015), 0.35, 4)
        const nextX = mouseX - (mouseX - v.x) * (nextZoom / v.zoom)
        const nextY = mouseY - (mouseY - v.y) * (nextZoom / v.zoom)
        return { x: nextX, y: nextY, zoom: nextZoom }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Measured plate dimensions, defaulted before the container's first paint —
  // same fallback settlePlate always used, just named so the plate-furniture
  // layer (border, corner ticks, grain/vignette rects) can share it without
  // re-deriving from `size` at every use site.
  const plateW = size?.w ?? 800
  const plateH = size?.h ?? 600
  const plate: Map<string, PlateNode> = useMemo(
    () => settlePlate(graph, plateW, plateH),
    [graph, plateW, plateH],
  )

  // Ambient drift clock — cells wander a couple of pixels around their
  // settled position and links sway like slack threads. ~30fps is plenty for
  // motion this slow; skipped entirely under prefers-reduced-motion (t stays
  // 0, which every consumer treats as "static plate").
  //
  // The map itself already unmounts on tab switch (it's not inside App's
  // KeepMounted — see the comment on `main` in App.tsx), so the loop is
  // naturally torn down there; the gap this closes is the window losing
  // focus/visibility while the Map tab stays frontmost (backgrounded, another
  // app focused, minimized). Same signal NeuralField uses for the same
  // reason: document.visibilityState + window focus are the cheapest checks
  // available (no observer setup) and already proven not to fight anything
  // else in this view.
  const [t, setT] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let last = 0
    let running = false
    const loop = (now: number) => {
      if (now - last >= 33) {
        last = now
        setT(now / 1000)
      }
      raf = requestAnimationFrame(loop)
    }
    function syncRunning() {
      const shouldRun = document.visibilityState === 'visible' && document.hasFocus()
      if (shouldRun && !running) {
        running = true
        raf = requestAnimationFrame(loop)
      } else if (!shouldRun && running) {
        running = false
        if (raf) cancelAnimationFrame(raf)
      }
    }
    document.addEventListener('visibilitychange', syncRunning)
    window.addEventListener('blur', syncRunning)
    window.addEventListener('focus', syncRunning)
    syncRunning()
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', syncRunning)
      window.removeEventListener('blur', syncRunning)
      window.removeEventListener('focus', syncRunning)
    }
  }, [])

  // Per-node drifted positions — seeded phase/rate per cell so the plate
  // breathes irregularly rather than in lockstep. Radii and the settled
  // anchors are untouched; territory washes and the pan-to-selected target
  // deliberately keep reading the static `plate`.
  const drifted: Map<string, PlateNode> = useMemo(() => {
    if (t === 0) return plate
    const m = new Map<string, PlateNode>()
    for (const [id, p] of plate) {
      const rateX = 0.28 + seeded(id, 11) * 0.24
      const rateY = 0.24 + seeded(id, 12) * 0.24
      const phaseX = seeded(id, 13) * Math.PI * 2
      const phaseY = seeded(id, 14) * Math.PI * 2
      m.set(id, {
        x: p.x + Math.sin(t * rateX + phaseX) * 5,
        y: p.y + Math.cos(t * rateY + phaseY) * 5,
        r: p.r,
      })
    }
    return m
  }, [plate, t])
  const edges = useMemo(() => buildEdges(graph), [graph])
  const frontierIds = useMemo(() => computeFrontierIds(graph), [graph])
  const forwardAdjacency = useMemo(() => computeForwardAdjacency(edges), [edges])
  const hubNodeIds = useMemo(() => computeHubNodeIds(graph), [graph])
  const territories = useMemo(() => territoryGroups(graph), [graph])
  const stats = useMemo(() => plateStats(graph, retrievability), [graph, retrievability])
  const visibleEdges = useMemo(
    () => edges.filter((e) => isEdgeVisible(e, hubNodeIds, forwardAdjacency)),
    [edges, hubNodeIds, forwardAdjacency],
  )
  // Up to 4 non-hub neighbors per node, from any kind of visible edge — feeds
  // the dendrite stubs, a purely cosmetic "this cell has connections" cue.
  const neighborIdsById = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of visibleEdges) {
      if (!hubNodeIds.has(e.target)) {
        const arr = m.get(e.source) ?? []
        if (!arr.includes(e.target)) arr.push(e.target)
        m.set(e.source, arr)
      }
      if (!hubNodeIds.has(e.source)) {
        const arr = m.get(e.target) ?? []
        if (!arr.includes(e.source)) arr.push(e.source)
        m.set(e.target, arr)
      }
    }
    return m
  }, [visibleEdges, hubNodeIds])
  // Fallback ranking so *something* labels even before the container has been
  // measured (top 8 by radius drives the below-1.1x-zoom label cap).
  const topRadiusIds = useMemo(() => {
    return new Set(
      [...graph.order]
        .map((id) => ({ id, r: plate.get(id)?.r ?? 0 }))
        .sort((a, b) => b.r - a.r)
        .slice(0, 8)
        .map((x) => x.id),
    )
  }, [graph, plate])

  const q = query.trim().toLowerCase()
  function matchesQuery(id: string): boolean {
    if (!q) return true
    if (id.toLowerCase().includes(q)) return true
    if (humanizeNodeId(id).toLowerCase().includes(q)) return true
    return graph.nodes[id]?.claim.toLowerCase().includes(q) ?? false
  }

  // Selecting a node promotes the trail from a one-hop preview to the node's
  // full transitive prerequisite chain (ancestorClosure/descendantPath in
  // plate.ts). Hover alone, with nothing selected, keeps the original
  // first-order-only preview completely untouched — see the branch below.
  // `active` now prefers `selected` over `hovered` (the old priority was the
  // reverse) so a selection's trail isn't interrupted by mousing over some
  // other node; deselecting (selected -> null) falls straight back through
  // to `hovered`, restoring the pre-existing hover behavior exactly.
  const isTrailMode = selected !== null
  const active = selected ?? hovered
  // One lens at a time: the due lens already recolors node bodies by
  // schedule, so a trail overlay drawn in ancestor/descendant vocabulary on
  // top would mix languages the plate is trying to keep separate — same
  // instinct that hides territory labels while the lens is on. Selection
  // itself (pan-to-selected, the node modal) is untouched; only the trail's
  // *rendering* is suppressed here.
  const trailEdgesActive = isTrailMode && !dueLens

  // Ancestors/descendants: transitive closure while selected, first-order
  // (hub-excluded, direct requires/dependents only — the exact semantics
  // ported from the retired three.js scene, commits 1aa5ec0/5fd18a2) on bare
  // hover. Both stay one hop in the hover case so that preview always reads
  // as "this is what's adjacent to what I'm looking at", never a full path.
  const ancestorSet = useMemo(() => {
    if (selected) return ancestorClosure(graph, selected)
    return active ? new Set((graph.nodes[active]?.edges.requires ?? []).filter((id) => !hubNodeIds.has(id))) : null
  }, [selected, active, graph, hubNodeIds])
  const descendantSet = useMemo(() => {
    if (selected) return descendantPath(graph, selected)
    return active ? new Set((forwardAdjacency.get(active) ?? []).filter((id) => !hubNodeIds.has(id))) : null
  }, [selected, active, forwardAdjacency, hubNodeIds])
  const relevantIds = useMemo(() => {
    if (!active) return null
    const s = new Set<string>([active])
    ancestorSet?.forEach((id) => s.add(id))
    descendantSet?.forEach((id) => s.add(id))
    return s
  }, [active, ancestorSet, descendantSet])

  // Search-dim and relevance-dim compose via Math.min, not multiplication —
  // a node only needs one good reason (matching the query, or being on the
  // active trail) to stay at full visibility. The relevance floor drops
  // further while selected (0.15 vs hover's 0.22) — a committed selection
  // can afford to push everything else further back than a passing hover.
  // The replay floor (visibleNodes) composes the same way: a node not yet
  // "inked" by the scrub position sinks near-invisible regardless of what
  // the search/trail lenses think of it.
  function nodeOpacity(id: string): number {
    const searchOpacity = matchesQuery(id) ? 1 : 0.18
    const dimFloor = isTrailMode ? 0.15 : 0.22
    const relevanceOpacity = relevantIds && !relevantIds.has(id) ? dimFloor : 1
    const replayOpacity = visibleNodes && !visibleNodes.has(id) ? 0.04 : 1
    return Math.min(searchOpacity, relevanceOpacity, replayOpacity)
  }

  // Whether an edge belongs to the ancestor/descendant trail — while
  // selected this walks the full chain (both endpoints in the closure, or
  // one endpoint being the selected node itself); on bare hover it collapses
  // back to "touches the active node directly", identical to the pre-trail
  // behavior.
  function isAncestorTrailEdge(e: SimEdge): boolean {
    if (e.kind !== 'requires' || !ancestorSet) return false
    if (isTrailMode) return ancestorSet.has(e.source) && (e.target === active || ancestorSet.has(e.target))
    return e.target === active && ancestorSet.has(e.source)
  }
  function isDescendantTrailEdge(e: SimEdge): boolean {
    if (e.kind !== 'requires' || !descendantSet) return false
    if (isTrailMode) return descendantSet.has(e.target) && (e.source === active || descendantSet.has(e.source))
    return e.source === active && descendantSet.has(e.target)
  }

  const fontSize = clamp(11 / view.zoom, 8, 13)

  const draggingRef = useRef<{ x: number; y: number } | null>(null)
  function onBgPointerDown(e: React.PointerEvent<SVGRectElement>) {
    cancelPanAnimation()
    draggingRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onBgPointerMove(e: React.PointerEvent<SVGRectElement>) {
    if (!draggingRef.current) return
    const dx = e.clientX - draggingRef.current.x
    const dy = e.clientY - draggingRef.current.y
    draggingRef.current = { x: e.clientX, y: e.clientY }
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }
  function onBgPointerUp() {
    draggingRef.current = null
  }

  // Pan-to-selected: whenever `selected` changes to a real node (deep-link,
  // drawer navigation), ease the view so it centers with a bit of zoom-in.
  // Cancelled by user pan/zoom input (see onWheel/onBgPointerDown) or by a
  // newer selection replacing this effect before it finishes.
  useEffect(() => {
    if (!selected) return
    const target = plate.get(selected)
    const el = containerRef.current
    if (!target || !el) return
    const rect = el.getBoundingClientRect()
    const w = rect.width || size?.w || 800
    const h = rect.height || size?.h || 600
    cancelPanAnimation()
    const start = { ...view }
    const targetZoom = Math.max(start.zoom, 1.3)
    const targetX = w / 2 - target.x * targetZoom
    const targetY = h / 2 - target.y * targetZoom
    const duration = 450
    const t0 = performance.now()
    function step(now: number) {
      const t = clamp((now - t0) / duration, 0, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setView({
        x: start.x + (targetX - start.x) * eased,
        y: start.y + (targetY - start.y) * eased,
        zoom: start.zoom + (targetZoom - start.zoom) * eased,
      })
      panAnimRef.current = t < 1 ? requestAnimationFrame(step) : null
    }
    panAnimRef.current = requestAnimationFrame(step)
    return () => cancelPanAnimation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, plate])

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      aria-label="Topic node map — mouse/trackpad only in this pass (click to select, drag to pan, scroll to zoom, double-click to open). Use the command palette (Cmd/Ctrl+K) to reach any node by keyboard."
      role="img"
    >
      <svg className="h-full w-full">
        <defs>
          <filter id="plate-blur">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          {/* Same blur technique as plate-blur, tuned down to cell scale for
              the due lens's overdue glow. */}
          <filter id="plate-node-glow">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          {/* Plate grain — one static feTurbulence filter, referenced by a
              single full-plate rect below. Never touches `t`/`drifted`/view,
              so it costs nothing beyond its one-time rasterization; panning
              and zooming don't re-run it because the rect it's applied to
              lives outside the pan/zoom transform group entirely (paper, not
              specimen). feColorMatrix zeroes the RGB channels and derives
              alpha from the noise's own luminance, so the rect's low opacity
              (see below) reads as fine black speckle rather than colored
              static. */}
          <filter id="plate-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.85"
              numOctaves={2}
              seed={4}
              stitchTiles="stitch"
              result="grain-noise"
            />
            <feColorMatrix
              in="grain-noise"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.33 0.33 0.34 0 0"
            />
          </filter>
          {/* Plate vignette — transparent center fading to the void color at
              the rim. Static gradient, referenced by a rect outside the
              transform group; the darkening is capped at 0.42 opacity and
              doesn't start until 65% out, so rim nodes stay legible rather
              than getting crushed into the frame. */}
          <radialGradient id="plate-vignette" cx="50%" cy="50%" r="72%">
            <stop offset="0%" stopColor="var(--color-void)" stopOpacity={0} />
            <stop offset="65%" stopColor="var(--color-void)" stopOpacity={0} />
            <stop offset="100%" stopColor="var(--color-void)" stopOpacity={0.42} />
          </radialGradient>
          {/* Node-fill engraving patterns — fine diagonal hatch for 'review'
              (warm), sparse stipple for 'learning' (cool); 'new' stays hollow
              (no pattern) since the point of that state is emptiness. Layered
              on TOP of the existing STATE_COLOR/DUE_LENS_COLOR fill as a
              second path with fill="url(#...)", never replacing it.

              Unit-space reasoning: these <pattern>s live in this top-level
              <defs>, outside the pan/zoom `<g transform>` below, but they're
              REFERENCED by fill="url(...)" from paths INSIDE that group. Per
              the SVG spec, patternUnits="userSpaceOnUse" resolves x/y/width/
              height in the user coordinate system of the referencing element
              at reference time — which includes every ancestor transform,
              i.e. the group's `scale(view.zoom)`. Left alone, that means a
              6px tile would render at 6*zoom screen pixels: hatch spacing
              would visibly balloon as you zoom in, exactly the "spacing
              constant in screen space" failure the brief calls out.
              `patternTransform={scale(1/view.zoom)}` cancels that ambient
              scale (scale(s) ∘ scale(1/s) = identity), so the tile is 6
              local units defined at zoom=1 and stays ~6 screen px at any
              zoom from 0.35 to 4 — objectBoundingBox units were not an
              option here since that ties tile size to each node's own bbox
              (every node a different hatch scale), not to screen space. This
              re-renders on view.zoom changes (wheel zoom, pan-to-selected
              easing) but never on the per-frame drift clock `t`, so it's no
              more per-frame cost than the rest of the static furniture. */}
          <pattern id="hatch-review" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform={`scale(${1 / view.zoom}) rotate(45)`}>
            <line x1={0} y1={0} x2={0} y2={6} stroke="var(--color-ink-warm)" strokeWidth={1.1} />
          </pattern>
          <pattern id="stipple-learning" patternUnits="userSpaceOnUse" width={9} height={9} patternTransform={`scale(${1 / view.zoom})`}>
            <circle cx={2.25} cy={2.25} r={0.9} fill="var(--color-ink-cool)" />
            <circle cx={6.75} cy={6.75} r={0.9} fill="var(--color-ink-cool)" />
          </pattern>
          {graph.order
            .filter((id) => graph.nodes[id]?.state === 'learning' && !graph.nodes[id]?.capstone)
            .map((id) => {
              const r = plate.get(id)?.r ?? 8
              return (
                <clipPath id={`half-${id}`} key={id}>
                  <rect x={-r * 1.6} y={0} width={r * 3.2} height={r * 1.6} />
                </clipPath>
              )
            })}
        </defs>
        <rect
          x={0}
          y={0}
          width="100%"
          height="100%"
          fill="transparent"
          onPointerDown={onBgPointerDown}
          onPointerMove={onBgPointerMove}
          onPointerUp={onBgPointerUp}
          onPointerCancel={onBgPointerUp}
        />
        {/* Plate grain + vignette — deliberately OUTSIDE the pan/zoom
            transform group below. These are the paper, not the drawing: they
            must stay put in screen space while the specimen (territories,
            edges, cells, labels — everything inside the `<g transform>`)
            pans and zooms across them. Both are fixed-size rects with a
            static filter/gradient reference — no per-frame computation, no
            dependency on `t`/`view`/`drifted`. pointer-events:none lets pan
            drags started here fall through to the capture rect above. */}
        <rect
          x={0}
          y={0}
          width={plateW}
          height={plateH}
          fill="black"
          filter="url(#plate-grain)"
          opacity={0.035}
          pointerEvents="none"
        />
        <rect x={0} y={0} width={plateW} height={plateH} fill="url(#plate-vignette)" pointerEvents="none" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {/* Territory washes */}
          {Array.from(territories.entries()).map(([root, members]) => {
            const pts = members.map((id) => plate.get(id)).filter((p): p is PlateNode => !!p)
            if (pts.length < 3) return null
            const d = hullPath(pts, 26)
            if (!d) return null
            const consolidatedFraction =
              members.filter((id) => graph.nodes[id]?.state === 'review').length / members.length
            return (
              <path
                key={root}
                d={d}
                fill="var(--color-ink-warm)"
                fillOpacity={0.03 + 0.09 * consolidatedFraction}
                stroke="none"
                filter="url(#plate-blur)"
                pointerEvents="none"
              />
            )
          })}

          {/* Territory labels — faint serif captions at each wash's hull
              centroid (same hull convexHull feeds hullPath), named from the
              group's root node id. Hidden under the due lens: that view
              wants the plate reading as pure schedule, not competing with
              wash captions. */}
          {!dueLens &&
            Array.from(territories.entries()).map(([root, members]) => {
              const pts = members.map((id) => plate.get(id)).filter((p): p is PlateNode => !!p)
              const centroid = hullCentroid(pts)
              if (!centroid) return null
              return (
                <text
                  key={`territory-label-${root}`}
                  x={centroid.x}
                  y={centroid.y}
                  textAnchor="middle"
                  fontFamily="var(--font-serif)"
                  fontStyle="italic"
                  fontSize={11}
                  fill="var(--color-text-dim)"
                  opacity={0.35}
                  pointerEvents="none"
                >
                  {humanizeNodeId(root)}
                </text>
              )
            })}

          {/* Edges — dimmed off-trail while selected so the promoted
              ancestor/descendant chain reads clearly; unchanged (flat 0.35)
              on bare hover, with nothing active, or under the due lens
              (one lens at a time — see trailEdgesActive above).

              Requires edges render as a filled calligraphic ribbon (taper
              2.2px at the prerequisite end -> 0.8px at the dependent end)
              plus a small screen-space arrowhead at the dependent end;
              every other edge kind keeps the original uniform hairline
              stroke. Both branches read from `visibleEdges` (hub
              suppression already applied via isEdgeVisible above) and apply
              the SAME replay-clip (`visibleNodes`) and trail-dimming
              (`onTrail`/`strokeOpacity`) checks as before — no parallel
              suppression logic, just the existing rules feeding a different
              paint. */}
          {visibleEdges.map((e, i) => {
            const a = drifted.get(e.source)
            const b = drifted.get(e.target)
            if (!a || !b) return null
            // Growth replay: an edge whose source or target hasn't been
            // "inked" yet at this scrub position hides outright, rather than
            // just dimming — the trail should look like it doesn't exist yet.
            if (visibleNodes && (!visibleNodes.has(e.source) || !visibleNodes.has(e.target))) return null
            const style = EDGE_STYLE[e.kind]
            const onTrail = isAncestorTrailEdge(e) || isDescendantTrailEdge(e)
            const opacity = trailEdgesActive ? (onTrail ? 0.5 : 0.08) : 0.35

            if (e.kind === 'requires') {
              const d = calligraphicEdgePath(e.source, e.target, a, b, t)
              const arrowTransform = arrowheadTransform(e.source, e.target, a, b, b.r, t, 1 / view.zoom)
              return (
                <g key={i} pointerEvents="none">
                  <path d={d} fill={style.stroke} fillOpacity={opacity} />
                  <path d={ARROWHEAD_PATH} fill={style.stroke} fillOpacity={opacity} transform={arrowTransform} />
                </g>
              )
            }
            const d = stringEdgePath(e.source, e.target, a, b, 'other', t)
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={style.stroke}
                strokeOpacity={opacity}
                strokeWidth={1.1}
                strokeDasharray={style.dash}
                pointerEvents="none"
              />
            )
          })}

          {/* Dendrite stubs */}
          {graph.order.map((id) => {
            const node = graph.nodes[id]
            const pos = drifted.get(id)
            if (!node || !pos || node.capstone) return null
            const neighborIds = (neighborIdsById.get(id) ?? []).slice(0, 4)
            const dirs = neighborIds.map((nid) => {
              const npos = drifted.get(nid)
              if (!npos) return { x: 1, y: 0 }
              return { x: npos.x - pos.x, y: npos.y - pos.y }
            })
            const stubs = dendriteStubs(id, pos, dirs, pos.r)
            return (
              <g key={id} opacity={nodeOpacity(id)} pointerEvents="none">
                {stubs.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    stroke={STATE_COLOR[node.state]}
                    strokeOpacity={0.45}
                    strokeWidth={1}
                    fill="none"
                  />
                ))}
              </g>
            )
          })}

          {/* Cell bodies */}
          {graph.order.map((id) => {
            const node = graph.nodes[id]
            const pos = drifted.get(id)
            if (!node || !pos) return null
            const r = pos.r
            const isSelected = selected === id

            if (node.capstone) {
              const outerR = r + 4
              const circumference = 2 * Math.PI * outerR
              // The capstone requires every node, so encoded/total IS its prereq
              // progress — plateStats no longer tracks it separately.
              const fraction = stats.total > 0 ? stats.encoded / stats.total : 1
              return (
                <g
                  key={id}
                  transform={`translate(${pos.x} ${pos.y})`}
                  opacity={nodeOpacity(id)}
                  onClick={() => onSelect(id)}
                  onDoubleClick={() => onOpen(id)}
                  onPointerEnter={() => setHovered(id)}
                  onPointerLeave={() => setHovered((h) => (h === id ? null : h))}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Invisible hit disc — outlined shapes otherwise only catch
                      clicks on their thin strokes, not the hollow interior. */}
                  <circle r={outerR + 3} fill="transparent" stroke="none" />
                  <circle r={outerR} fill="none" stroke="var(--color-ink-warm)" strokeWidth={1.2} />
                  <circle
                    r={outerR}
                    fill="none"
                    stroke="var(--color-ink-warm)"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeDasharray={`${fraction * circumference} ${circumference}`}
                    transform="rotate(-90)"
                  />
                  <circle r={r} fill="none" stroke="var(--color-ink-warm)" strokeWidth={1.2} />
                  <path
                    d={cellBodyPath(id, r * 0.55)}
                    fill="var(--color-ink-warm)"
                    fillOpacity={0.25 + 0.75 * fraction}
                  />
                  {isSelected && (
                    <path d={cellBodyPath(id, r)} fill="none" stroke="var(--color-text-primary)" strokeWidth={1.8} />
                  )}
                </g>
              )
            }

            // Due lens recolors by schedule standing and wins over the trail
            // (it's a distinct "show me the schedule" mode); the trail's own
            // ancestor/descendant/selected ink only applies when the due
            // lens is off. Neither touches a node's own encode/consolidate
            // color unless one of them actually claims it.
            const dueStatus = dueLens ? dueStatusFor(node) : null
            const trailRole: 'ancestor' | 'descendant' | 'selected' | null = isTrailMode
              ? id === selected
                ? 'selected'
                : ancestorSet?.has(id)
                  ? 'ancestor'
                  : descendantSet?.has(id)
                    ? 'descendant'
                    : null
              : null
            const color = dueStatus
              ? DUE_LENS_COLOR[dueStatus]
              : trailRole === 'ancestor'
                ? 'var(--color-ink-cool)'
                : trailRole === 'descendant'
                  ? 'var(--color-ink-warm)'
                  : trailRole === 'selected'
                    ? 'var(--color-ink-hot)'
                    : STATE_COLOR[node.state]
            const fillOpacity = 0.35 + 0.65 * (retrievability?.get(id) ?? 1)
            const dash = node.threshold ? '3 2.5' : undefined
            const bodyPath = cellBodyPath(id, r)

            return (
              <g
                key={id}
                transform={`translate(${pos.x} ${pos.y})`}
                opacity={nodeOpacity(id)}
                onClick={() => onSelect(id)}
                onDoubleClick={() => onOpen(id)}
                onPointerEnter={() => setHovered(id)}
                onPointerLeave={() => setHovered((h) => (h === id ? null : h))}
                style={{ cursor: 'pointer' }}
              >
                {/* Invisible hit disc — outlined shapes otherwise only catch
                    clicks on their thin strokes, not the hollow interior. */}
                <circle r={r + 3} fill="transparent" stroke="none" />
                {dueStatus === 'overdue' && (
                  <path
                    d={bodyPath}
                    fill="var(--color-ink-danger)"
                    fillOpacity={0.55}
                    filter="url(#plate-node-glow)"
                    pointerEvents="none"
                  />
                )}
                {node.state === 'new' && (
                  <path d={bodyPath} fill="none" stroke={color} strokeWidth={1.2} strokeDasharray={dash} />
                )}
                {node.state === 'learning' && (
                  <>
                    <path d={bodyPath} fill="none" stroke={color} strokeWidth={1.2} strokeDasharray={dash} />
                    <path d={bodyPath} fill={color} fillOpacity={fillOpacity} clipPath={`url(#half-${id})`} />
                    {/* Stipple engraving — suppressed under the due lens (one
                        lens at a time: the lens's own recolor already owns
                        this node's fill language, see dueStatus above) and
                        clipped to the same half-region as the fill it sits
                        on top of. */}
                    {!dueLens && (
                      <path
                        d={bodyPath}
                        fill="url(#stipple-learning)"
                        fillOpacity={0.9}
                        clipPath={`url(#half-${id})`}
                        pointerEvents="none"
                      />
                    )}
                  </>
                )}
                {node.state === 'review' && (
                  <>
                    <path d={bodyPath} fill={color} fillOpacity={fillOpacity} />
                    {!dueLens && (
                      <path d={bodyPath} fill="url(#hatch-review)" fillOpacity={0.85} pointerEvents="none" />
                    )}
                  </>
                )}
                {isSelected && <path d={bodyPath} fill="none" stroke="var(--color-text-primary)" strokeWidth={1.8} />}
              </g>
            )
          })}

          {/* Hover/selection trails. On bare hover this is still exactly the
              first-order set touching the active node; while selected it's
              every edge along the full ancestor/descendant chain (see
              isAncestorTrailEdge/isDescendantTrailEdge above). Suppressed
              entirely under the due lens — one lens at a time, same as the
              edge dimming above and the territory labels. Drawn after cell
              bodies so they read as an overlay on top of the plate. */}
          {active &&
            !dueLens &&
            edges
              .filter((e) => isAncestorTrailEdge(e) || isDescendantTrailEdge(e))
              .map((e, i) => {
                const a = drifted.get(e.source)
                const b = drifted.get(e.target)
                if (!a || !b) return null
                // Replay clips the trail exactly like the base edge layer —
                // never draw a bright link into a node the time-lapse says
                // hasn't been inked yet.
                if (visibleNodes && (!visibleNodes.has(e.source) || !visibleNodes.has(e.target))) return null
                const isAncestor = isAncestorTrailEdge(e)
                return (
                  <path
                    key={`trail-${i}`}
                    d={stringEdgePath(e.source, e.target, a, b, 'requires', t)}
                    fill="none"
                    stroke={isAncestor ? '#a78bda' : '#e8a857'}
                    strokeWidth={2}
                    opacity={0.9}
                    className="plate-trail"
                    pointerEvents="none"
                  />
                )
              })}

          {/* Rings/decorations */}
          {graph.order.map((id) => {
            const node = graph.nodes[id]
            const pos = drifted.get(id)
            if (!node || !pos || node.capstone) return null
            const r = pos.r
            const lapsed = (node.fsrs.lapses ?? 0) > 0
            const isFrontier = frontierIds.has(id)
            if (!lapsed && !isFrontier) return null
            return (
              <g key={id} transform={`translate(${pos.x} ${pos.y})`} opacity={nodeOpacity(id)} pointerEvents="none">
                {lapsed &&
                  Array.from({ length: 8 }, (_, i) => {
                    const angle = (i / 8) * Math.PI * 2
                    const stippleR = r + 3.5
                    return (
                      <circle
                        key={i}
                        cx={Math.cos(angle) * stippleR}
                        cy={Math.sin(angle) * stippleR}
                        r={0.8}
                        fill="var(--color-ink-danger)"
                        opacity={0.7}
                      />
                    )
                  })}
                {isFrontier && (
                  <circle
                    r={r + 5}
                    stroke="var(--color-ink-warm)"
                    fill="none"
                    className="plate-frontier-ring"
                  />
                )}
              </g>
            )
          })}

          {/* Labels */}
          {graph.order.map((id) => {
            const node = graph.nodes[id]
            const pos = drifted.get(id)
            if (!node || !pos) return null
            const show = view.zoom >= 1.1 || topRadiusIds.has(id) || (relevantIds?.has(id) ?? false)
            if (!show) return null
            const latexLabel = annotations?.[id]?.latexLabel
            const label = latexLabel ? stripMathDelimiters(latexLabel) : humanizeNodeId(id)
            return (
              <g key={id} transform={`translate(${pos.x} ${pos.y})`} opacity={nodeOpacity(id)} pointerEvents="none">
                <text
                  x={pos.r + 6}
                  y={4}
                  fontSize={fontSize}
                  fill={id === selected ? 'var(--color-text-primary)' : 'var(--color-text-dim)'}
                  fontFamily="var(--font-body)"
                >
                  {label}
                </text>
              </g>
            )
          })}
        </g>

        {/* Plate furniture — title, hairline border, corner registration
            ticks. Also OUTSIDE the transform group (fixed to the paper, not
            the drawing) and entirely pointer-events:none. Hidden during
            replay: `visibleNodes` is non-null exactly while the growth
            scrubber is active (see the prop doc above), so it's reused here
            rather than adding a dedicated `replayActive` prop — the caption
            would otherwise misreport an N/M that doesn't match what's
            actually inked on screen mid-scrub. */}
        {!visibleNodes && (
          <g pointerEvents="none">
            <rect
              x={0.5}
              y={0.5}
              width={Math.max(0, plateW - 1)}
              height={Math.max(0, plateH - 1)}
              fill="none"
              stroke="var(--color-hairline)"
              strokeWidth={1}
            />
            {cornerTicks(plateW, plateH).map((d, i) => (
              <path key={i} d={d} fill="none" stroke="var(--color-ink-warm-dim)" strokeWidth={1.2} />
            ))}
            <text
              x={16}
              y={54}
              fontFamily="var(--font-serif)"
              fontSize={13}
              fill="var(--color-text-primary)"
              opacity={0.85}
            >
              {`Fig. — ${graph.title}`}
            </text>
            <text
              x={16}
              y={70}
              fontFamily="var(--font-data)"
              fontSize={10}
              letterSpacing={0.4}
              fill="var(--color-text-dim)"
              opacity={0.75}
            >
              {`${stats.total} cells · ${stats.consolidated} consolidated`}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
