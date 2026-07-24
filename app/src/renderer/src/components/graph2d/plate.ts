import type { TopicGraph } from '../../../../shared/types'
import { buildEdges, initSimNodes, stepSimulation, layersOf, seeded } from '../graph3d/layout'
import { DEFAULT_FORCE_PARAMS } from '../graph3d/types'

export interface PlateNode {
  x: number
  y: number
  r: number
}

/** The sim's absolute force scales were tuned for the 3D scene, where the
 * camera framed whatever spread emerged. On the 1:1 SVG plate they crowd —
 * so settle with much stronger repulsion and longer links, then explicitly
 * resolve remaining overlaps, then fit the result to the container. */
const PLATE_FORCE_PARAMS = {
  ...DEFAULT_FORCE_PARAMS,
  repelForce: 3.2,
  linkDistance: 1.9,
  centerForce: 0.5,
}

/** Minimum clear space between two cell rims — room for dendrite stubs,
 * rings, and a label line without collisions. */
const CELL_CLEARANCE = 30

/** Run the existing X/Y force simulation to convergence once and freeze it —
 * the plate is a fixed specimen, not a live sim. Deterministic per topic via
 * the seeded scatter in initSimNodes. */
export function settlePlate(graph: TopicGraph, width: number, height: number): Map<string, PlateNode> {
  const edges = buildEdges(graph)
  const sim = initSimNodes(graph, edges, width / 2, height / 2)
  let alpha = 1
  for (let i = 0; i < 300 && alpha > 0.005; i++) {
    stepSimulation(sim, edges, PLATE_FORCE_PARAMS, alpha, width / 2, height / 2)
    alpha *= 0.985
  }

  const nodes = Array.from(sim.values())

  // Fit-to-bounds FIRST: scale/translate so the settled spread fills the
  // container with a margin — a compact settle spreads out, an overflowing
  // one pulls in. Node radii are screen-fixed, so this runs before the
  // collision pass: clearance is then resolved in final screen space and
  // can't be shrunk away by a scale-down.
  const margin = 70
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r)
    maxX = Math.max(maxX, n.x + n.r)
    minY = Math.min(minY, n.y - n.r)
    maxY = Math.max(maxY, n.y + n.r)
  }
  const spanX = Math.max(1, maxX - minX)
  const spanY = Math.max(1, maxY - minY)
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  for (const n of nodes) {
    n.x = width / 2 + (n.x - cx) * scale
    n.y = height / 2 + (n.y - cy) * scale
  }

  // Collision pass: push any pair closer than rims + clearance directly
  // apart. A few relaxation sweeps converge fine at these node counts.
  for (let sweep = 0; sweep < 24; sweep++) {
    let moved = false
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const minDist = a.r + b.r + CELL_CLEARANCE
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= minDist) continue
        if (d < 0.01) {
          // Coincident nodes: separate along a seeded, stable direction.
          const ang = seeded(a.id + b.id, 7) * Math.PI * 2
          dx = Math.cos(ang)
          dy = Math.sin(ang)
          d = 1
        }
        const push = (minDist - d) / 2
        dx /= d
        dy /= d
        a.x -= dx * push
        a.y -= dy * push
        b.x += dx * push
        b.y += dy * push
        moved = true
      }
    }
    if (!moved) break
  }

  const out = new Map<string, PlateNode>()
  for (const n of nodes) out.set(n.id, { x: n.x, y: n.y, r: n.r })
  return out
}

/** Irregular closed blob path centered at the origin — the InkNode technique
 * at plate scale: 10 points, seeded per-id wobble, quadratic smoothing. */
export function cellBodyPath(id: string, r: number): string {
  const points = 10
  const coords: [number, number][] = []
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2
    const wobble = 1 + (seeded(id, i + 1) - 0.5) * 0.38
    coords.push([Math.cos(angle) * r * wobble, Math.sin(angle) * r * wobble])
  }
  let d = ''
  for (let i = 0; i < points; i++) {
    const curr = coords[i]
    const next = coords[(i + 1) % points]
    const midX = (curr[0] + next[0]) / 2
    const midY = (curr[1] + next[1]) / 2
    d += i === 0 ? `M ${midX.toFixed(2)} ${midY.toFixed(2)}` : ''
    d += ` Q ${curr[0].toFixed(2)} ${curr[1].toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`
  }
  // Close through the final corner so the last segment is also smoothed.
  const last = coords[0]
  const firstMid = [(coords[0][0] + coords[1][0]) / 2, (coords[0][1] + coords[1][1]) / 2]
  d += ` Q ${last[0].toFixed(2)} ${last[1].toFixed(2)} ${firstMid[0].toFixed(2)} ${firstMid[1].toFixed(2)} Z`
  return d
}

/** Short dendrite stubs reaching from the cell body toward up to 4 of the
 * node's real neighbors — drawn in plate coordinates. Each stub is a short
 * 2-segment path with a seeded kink, starting on the body rim. */
export function dendriteStubs(
  id: string,
  pos: { x: number; y: number },
  neighborDirs: { x: number; y: number }[],
  r: number,
): string[] {
  return neighborDirs.slice(0, 4).map((dir, i) => {
    const len = Math.hypot(dir.x, dir.y) || 1
    const ux = dir.x / len
    const uy = dir.y / len
    const start = { x: pos.x + ux * r, y: pos.y + uy * r }
    const reach = r * (0.8 + seeded(id, 20 + i) * 0.7)
    const kink = (seeded(id, 40 + i) - 0.5) * r * 0.6
    const midX = start.x + ux * reach * 0.55 - uy * kink
    const midY = start.y + uy * reach * 0.55 + ux * kink
    const endX = start.x + ux * reach
    const endY = start.y + uy * reach
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} Q ${midX.toFixed(2)} ${midY.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}`
  })
}

/** Group non-capstone nodes by their nearest layer-0 ancestor (breadth-first
 * up the requires edges; a layer-0 node roots its own group). Ties resolve to
 * the first root encountered in BFS order — stable per graph. */
export function territoryGroups(graph: TopicGraph): Map<string, string[]> {
  const layers = layersOf(graph)
  const groups = new Map<string, string[]>()
  for (const id of graph.order) {
    if (graph.nodes[id]?.capstone) continue
    let root: string | null = null
    if ((layers.get(id) ?? 0) === 0) {
      root = id
    } else {
      const queue = [id]
      const seen = new Set<string>([id])
      while (queue.length > 0 && root == null) {
        const cur = queue.shift()!
        for (const req of graph.nodes[cur]?.edges.requires ?? []) {
          if (seen.has(req)) continue
          seen.add(req)
          if ((layers.get(req) ?? 0) === 0) {
            root = req
            break
          }
          queue.push(req)
        }
      }
    }
    if (root == null) root = id
    if (!groups.has(root!)) groups.set(root!, [])
    groups.get(root!)!.push(id)
  }
  // Drop singleton territories — a wash behind one node is noise, not shape.
  for (const [root, members] of [...groups]) {
    if (members.length < 3) groups.delete(root)
  }
  return groups
}

/** Convex hull (Andrew's monotone chain) expanded by `padding`, returned as a
 * smoothed closed SVG path through the hull midpoints. */
export function hullPath(points: { x: number; y: number }[], padding: number): string {
  if (points.length < 3) return ''
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  type Pt = { x: number; y: number }
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: { x: number; y: number }[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: { x: number; y: number }[] = []
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length
  const padded = hull.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const d = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / d) * padding, y: p.y + (dy / d) * padding }
  })
  let d = ''
  for (let i = 0; i < padded.length; i++) {
    const curr = padded[i]
    const next = padded[(i + 1) % padded.length]
    const midX = (curr.x + next.x) / 2
    const midY = (curr.y + next.y) / 2
    d += i === 0 ? `M ${midX.toFixed(2)} ${midY.toFixed(2)}` : ''
    d += ` Q ${curr.x.toFixed(2)} ${curr.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`
  }
  return d + ' Z'
}

/** The readout numbers. decaying = nodes with FSRS history whose current
 * retrievability has fallen below 0.7 (ink visibly fading). Capstone unlock =
 * how many of its requires are past `new`. */
export function plateStats(
  graph: TopicGraph,
  retrievability: Map<string, number> | null,
): {
  total: number
  encoded: number
  consolidated: number
  decaying: number
  thresholdsMet: number
  thresholdsTotal: number
} {
  let total = 0
  let encoded = 0
  let consolidated = 0
  let decaying = 0
  // Threshold concepts (the dashed halos on the plate) rather than capstone
  // prereqs: the capstone requires every node, so its met/total was always
  // identical to encoded/total — a duplicate tile.
  let thresholdsMet = 0
  let thresholdsTotal = 0
  for (const id of graph.order) {
    const node = graph.nodes[id]
    if (!node) continue
    if (node.capstone) continue
    total++
    if (node.state !== 'new') encoded++
    if (node.state === 'review') consolidated++
    if (node.threshold) {
      thresholdsTotal++
      if (node.state === 'review') thresholdsMet++
    }
    const r = retrievability?.get(id)
    if (r != null && r < 0.7 && node.state !== 'new') decaying++
  }
  return { total, encoded, consolidated, decaying, thresholdsMet, thresholdsTotal }
}
