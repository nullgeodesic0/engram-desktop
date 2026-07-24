import { useEffect, useMemo, useRef, useState } from 'react'
import type { TopicGraph, EngramNode, MapAnnotations } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { EDGE_STYLE, type SimEdge } from './graph3d/types'
import { buildEdges, computeForwardAdjacency, computeFrontierIds, computeHubNodeIds, seeded } from './graph3d/layout'
import { settlePlate, cellBodyPath, dendriteStubs, territoryGroups, hullPath, plateStats, type PlateNode } from './graph2d/plate'

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

const STATE_COLOR: Record<EngramNode['state'], string> = {
  new: 'var(--color-ink-cool-dim)',
  learning: 'var(--color-ink-cool)',
  review: 'var(--color-ink-warm)',
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** Edge geometry as a "loose string" — a quadratic bezier whose control
 * point carries both the deterministic per-edge bow (requires edges only)
 * and a slow ambient sway driven by the drift clock `t`, so links ripple
 * like slack threads while their endpoints ride the nodes' own drift.
 * Shared by the base edge layer and the hover/selection trail overlay so
 * trail edges sit exactly on top of their base edge at every instant. */
function stringEdgePath(
  source: string,
  target: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
  kind: 'requires' | 'other',
  t: number,
): string {
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
  const cx = mx + nx * (baseBow + sway)
  const cy = my + ny * (baseBow + sway)
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
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
}

export function GraphView({ graph, selected, onSelect, onOpen, query, retrievability, annotations }: GraphViewProps) {
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

  const plate: Map<string, PlateNode> = useMemo(
    () => settlePlate(graph, size?.w ?? 800, size?.h ?? 600),
    [graph, size],
  )

  // Ambient drift clock — cells wander a couple of pixels around their
  // settled position and links sway like slack threads. ~30fps is plenty for
  // motion this slow; skipped entirely under prefers-reduced-motion (t stays
  // 0, which every consumer treats as "static plate").
  const [t, setT] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      if (now - last >= 33) {
        last = now
        setT(now / 1000)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
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

  const active = hovered ?? selected

  // First-order, hub-excluded trail sets — the exact semantics ported from
  // the retired three.js scene (commits 1aa5ec0/5fd18a2): "come from" is the
  // active node's direct `requires` list, "go next" is its direct forward
  // dependents. Both stay strictly one hop so the trail always reads as
  // "this is what's adjacent to what I'm looking at", never a full path.
  const ancestorSet = useMemo(
    () =>
      active ? new Set((graph.nodes[active]?.edges.requires ?? []).filter((id) => !hubNodeIds.has(id))) : null,
    [active, graph, hubNodeIds],
  )
  const descendantSet = useMemo(
    () => (active ? new Set((forwardAdjacency.get(active) ?? []).filter((id) => !hubNodeIds.has(id))) : null),
    [active, forwardAdjacency, hubNodeIds],
  )
  const relevantIds = useMemo(() => {
    if (!active) return null
    const s = new Set<string>([active])
    ancestorSet?.forEach((id) => s.add(id))
    descendantSet?.forEach((id) => s.add(id))
    return s
  }, [active, ancestorSet, descendantSet])

  // Search-dim and relevance-dim compose via Math.min, not multiplication —
  // a node only needs one good reason (matching the query, or being on the
  // active trail) to stay at full visibility.
  function nodeOpacity(id: string): number {
    const searchOpacity = matchesQuery(id) ? 1 : 0.18
    const relevanceOpacity = relevantIds && !relevantIds.has(id) ? 0.22 : 1
    return Math.min(searchOpacity, relevanceOpacity)
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
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <svg className="h-full w-full">
        <defs>
          <filter id="plate-blur">
            <feGaussianBlur stdDeviation="14" />
          </filter>
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

          {/* Edges */}
          {visibleEdges.map((e, i) => {
            const a = drifted.get(e.source)
            const b = drifted.get(e.target)
            if (!a || !b) return null
            const style = EDGE_STYLE[e.kind]
            const d = stringEdgePath(e.source, e.target, a, b, e.kind === 'requires' ? 'requires' : 'other', t)
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={style.stroke}
                strokeOpacity={0.35}
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
              const fraction = stats.capstonePrereqsTotal > 0 ? stats.capstonePrereqsMet / stats.capstonePrereqsTotal : 1
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

            const color = STATE_COLOR[node.state]
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
                {node.state === 'new' && (
                  <path d={bodyPath} fill="none" stroke={color} strokeWidth={1.2} strokeDasharray={dash} />
                )}
                {node.state === 'learning' && (
                  <>
                    <path d={bodyPath} fill="none" stroke={color} strokeWidth={1.2} strokeDasharray={dash} />
                    <path d={bodyPath} fill={color} fillOpacity={fillOpacity} clipPath={`url(#half-${id})`} />
                  </>
                )}
                {node.state === 'review' && <path d={bodyPath} fill={color} fillOpacity={fillOpacity} />}
                {isSelected && <path d={bodyPath} fill="none" stroke="var(--color-text-primary)" strokeWidth={1.8} />}
              </g>
            )
          })}

          {/* Hover/selection trails — first-order, hub-excluded, always
              touching the active node. Drawn after cell bodies so they read
              as an overlay on top of the plate. */}
          {active &&
            edges
              .filter(
                (e) =>
                  e.kind === 'requires' &&
                  ((e.target === active && ancestorSet?.has(e.source)) ||
                    (e.source === active && descendantSet?.has(e.target))),
              )
              .map((e, i) => {
                const a = drifted.get(e.source)
                const b = drifted.get(e.target)
                if (!a || !b) return null
                const isAncestor = e.target === active
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
      </svg>
    </div>
  )
}
