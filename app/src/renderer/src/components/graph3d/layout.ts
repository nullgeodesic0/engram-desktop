import type { TopicGraph } from '../../../../shared/types'
import type { EdgeKind, SimEdge, ForceParams } from './types'

export interface SimNode3D {
  id: string
  x: number
  y: number
  z: number
  vx: number
  vy: number
  fx: number | null
  fy: number | null
  r: number
  layer: number
}

/** Dependency-depth Z range — foundational nodes (layer 0) sit near the
 * camera, the capstone (deepest layer) sits farthest back. Static per node,
 * set once when the simulation is (re)initialized — never touched by the
 * force simulation, which only ever moves nodes in X/Y. */
export const Z_NEAR = 420
export const Z_FAR = -420

/** Deterministic pseudo-random in [0,1) seeded by a string — keeps the initial
 * scatter stable across re-renders of the same topic instead of jumping around. */
export function seeded(id: string, salt: number): number {
  let h = salt
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 10000) / 10000
}

export function layersOf(graph: TopicGraph): Map<string, number> {
  const depth = new Map<string, number>()
  function depthOf(id: string, seen: Set<string>): number {
    if (depth.has(id)) return depth.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const requires = graph.nodes[id]?.edges.requires ?? []
    const d = requires.length === 0 ? 0 : 1 + Math.max(...requires.map((r) => depthOf(r, seen)))
    depth.set(id, d)
    return d
  }
  for (const id of graph.order) depthOf(id, new Set())
  return depth
}

export function computeZ(layer: number, maxLayer: number): number {
  if (maxLayer <= 0) return Z_NEAR
  const t = layer / maxLayer
  return Z_NEAR + (Z_FAR - Z_NEAR) * t
}

export function buildEdges(graph: TopicGraph): SimEdge[] {
  const list: SimEdge[] = []
  const seen = new Set<string>()
  for (const id of graph.order) {
    const e = graph.nodes[id]?.edges
    if (!e) continue
    for (const r of e.requires ?? []) list.push({ source: r, target: id, kind: 'requires' })
    for (const r of e.derives_from ?? []) list.push({ source: r, target: id, kind: 'derives_from' })
    for (const r of e.contrasts_with ?? []) {
      const key = [id, r].sort().join('::c::')
      if (seen.has(key)) continue
      seen.add(key)
      list.push({ source: id, target: r, kind: 'contrasts_with' })
    }
    for (const r of e.analogous_to ?? []) {
      const key = [id, r].sort().join('::a::')
      if (seen.has(key)) continue
      seen.add(key)
      list.push({ source: id, target: r, kind: 'analogous_to' })
    }
  }
  return list.filter((e) => graph.nodes[e.source] && graph.nodes[e.target])
}

/** Capstone-like "hub" nodes — nodes a large fraction of the topic directly
 * requires-into, whether or not they're flagged `capstone: true`. Some
 * curricula produce a second such node (e.g. a "...-synthesis" node the
 * architect didn't mark as the capstone) that still requires nearly every
 * other node — a real bimodal split in practice (normal nodes: 0-2 requires,
 * hub nodes: 30%+ of the graph), so a fixed fraction threshold reliably tells
 * them apart. These are the nodes whose requires-edges clutter the map with
 * near-universal fan-in and get filtered by the capstone-links toggle. */
export function computeHubNodeIds(graph: TopicGraph): Set<string> {
  const total = graph.order.length
  const threshold = Math.max(6, total * 0.25)
  const hubs = new Set<string>()
  for (const id of graph.order) {
    const node = graph.nodes[id]
    if (!node) continue
    if (node.capstone || (node.edges.requires ?? []).length >= threshold) hubs.add(id)
  }
  return hubs
}

export function computeDegree(edges: SimEdge[]): Map<string, number> {
  const d = new Map<string, number>()
  for (const e of edges) {
    d.set(e.source, (d.get(e.source) ?? 0) + 1)
    d.set(e.target, (d.get(e.target) ?? 0) + 1)
  }
  return d
}

export function computeNeighbors(graph: TopicGraph, edges: SimEdge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const id of graph.order) m.set(id, new Set())
  for (const e of edges) {
    m.get(e.source)?.add(e.target)
    m.get(e.target)?.add(e.source)
  }
  return m
}

/** "Frontier" — not-yet-started nodes whose every prerequisite is already
 * past 'new' — i.e. what /engram:learn would actually teach next. */
export function computeFrontierIds(graph: TopicGraph): Set<string> {
  const s = new Set<string>()
  for (const id of graph.order) {
    const node = graph.nodes[id]
    if (!node || node.state !== 'new') continue
    const requires = node.edges.requires ?? []
    if (requires.every((r) => graph.nodes[r]?.state !== 'new')) s.add(id)
  }
  return s
}

/** Forward-only adjacency (prerequisite -> the node that requires it) for the
 * "path to mastery" highlight — direction matters here, unlike `computeNeighbors`. */
export function computeForwardAdjacency(edges: SimEdge[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const e of edges) {
    if (e.kind !== 'requires') continue
    if (!m.has(e.source)) m.set(e.source, [])
    m.get(e.source)!.push(e.target)
  }
  return m
}

/** All nodes reachable by walking backward along `requires` edges from
 * `start` — its prerequisites, and their prerequisites, transitively. Never
 * includes `start` itself. This is the full "come from" set for a node,
 * which can legitimately branch (multiple prerequisites merging in). */
export function ancestorsOf(start: string, graph: TopicGraph): Set<string> {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const requires = graph.nodes[cur]?.edges.requires ?? []
    for (const r of requires) {
      if (seen.has(r)) continue
      seen.add(r)
      queue.push(r)
    }
  }
  return seen
}

/** All nodes reachable by walking forward along `requires` edges from
 * `start` — nodes that require it, directly or transitively. Never includes
 * `start` itself. This is the full "go next" set, which can also branch. */
export function descendantsOf(start: string, forwardAdjacency: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const next of forwardAdjacency.get(cur) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

export function initSimNodes(graph: TopicGraph, edges: SimEdge[], centerX: number, centerY: number): Map<string, SimNode3D> {
  const layers = layersOf(graph)
  const maxLayer = Math.max(0, ...Array.from(layers.values()))
  const degree = computeDegree(edges)
  const sim = new Map<string, SimNode3D>()
  for (const id of graph.order) {
    const layer = layers.get(id) ?? 0
    const angle = seeded(id, 1) * Math.PI * 2
    const radiusBand = 60 + (layer / Math.max(1, maxLayer)) * Math.min(centerX, centerY) * 0.7
    const jitter = seeded(id, 2) * 40
    sim.set(id, {
      id,
      x: centerX + Math.cos(angle) * (radiusBand + jitter),
      y: centerY + Math.sin(angle) * (radiusBand + jitter),
      z: computeZ(layer, maxLayer),
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      r: 5 + Math.min(10, degree.get(id) ?? 0) * 1.4 + (graph.nodes[id]?.capstone ? 3 : 0),
      layer,
    })
  }
  return sim
}

/** One force-simulation tick — repulsion, spring edges, weak centering pull.
 * Mutates `sim` in place. Only ever touches x/y/vx/vy — z is set once by
 * `initSimNodes` and never moves. Identical math to the current SVG
 * GraphView's `tick()`, just extracted so it's usable outside a React effect. */
export function stepSimulation(
  sim: Map<string, SimNode3D>,
  edges: SimEdge[],
  params: ForceParams,
  alpha: number,
  centerX: number,
  centerY: number,
): void {
  const nodes = Array.from(sim.values())
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let d2 = dx * dx + dy * dy
      if (d2 < 1) d2 = 1
      const d = Math.sqrt(d2)
      const force = ((900 * params.repelForce) / d2) * alpha
      dx /= d
      dy /= d
      a.vx -= dx * force
      a.vy -= dy * force
      b.vx += dx * force
      b.vy += dy * force
    }
  }
  for (const e of edges) {
    const a = sim.get(e.source)
    const b = sim.get(e.target)
    if (!a || !b) continue
    const target = (e.kind === 'requires' || e.kind === 'derives_from' ? 90 : 130) * params.linkDistance
    let dx = b.x - a.x
    let dy = b.y - a.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    const strength = (e.kind === 'requires' ? 0.06 : 0.02) * params.linkForce * alpha
    const disp = (d - target) * strength
    dx /= d
    dy /= d
    a.vx += dx * disp
    a.vy += dy * disp
    b.vx -= dx * disp
    b.vy -= dy * disp
  }
  for (const n of nodes) {
    n.vx += (centerX - n.x) * 0.003 * params.centerForce * alpha
    n.vy += (centerY - n.y) * 0.003 * params.centerForce * alpha
    if (n.fx != null) {
      n.x = n.fx
      n.vx = 0
    } else {
      n.vx *= 0.82
      n.x += n.vx
    }
    if (n.fy != null) {
      n.y = n.fy
      n.vy = 0
    } else {
      n.vy *= 0.82
      n.y += n.vy
    }
  }
}

export type { EdgeKind }
