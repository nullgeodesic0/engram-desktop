import type { TopicGraph } from '../../../../shared/types'
import {
  buildEdges,
  initSimNodes,
  stepSimulation,
  layersOf,
  seeded,
  computeHubNodeIds,
  computeForwardAdjacency,
} from '../graph3d/layout'
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

/** Minimum clear space between two cell rims — room for rings, halos, and a
 * label line without collisions. */
const CELL_CLEARANCE = 30

/** Same-region attraction strength during settle phase B, as a multiplier on
 * the tick's `alpha` — pulls a node toward its region's running centroid so
 * regions separate into distinct, non-overlapping clusters. */
const REGION_ATTRACTION = 0.09

/** Other-region repulsion strength during settle phase B, applied as
 * `min(8, 900/d) * REGION_REPULSION * alpha` — pushes a node away from every
 * OTHER region's centroid, scaled down at long range like the base repel
 * force so it doesn't fight phase A's already-settled spread. */
const REGION_REPULSION = 0.022

/** Run the existing X/Y force simulation to convergence once and freeze it —
 * the plate is a fixed specimen, not a live sim. Deterministic per topic via
 * the seeded scatter in initSimNodes.
 *
 * Phase A is the original 300-step settle, verbatim — unaffected whether or
 * not `regions` is passed. When `regions` IS passed, phase B runs 120 more
 * steps that pull each node toward its own region's centroid and push it away
 * from every OTHER region's centroid, so the regions separate into visually
 * distinct clusters instead of interleaving. Spine nodes (not a member of any
 * region) feel no group force in either direction — they stay wherever phase
 * A settled them. Centroids are recomputed only every 10 steps (cheap, and a
 * region's shape doesn't need to react every tick). Both phases are pure
 * functions of the seeded initial scatter, so the whole settle stays
 * deterministic. */
export function settlePlate(
  graph: TopicGraph,
  width: number,
  height: number,
  regions?: Map<string, string[]>,
): Map<string, PlateNode> {
  const edges = buildEdges(graph)
  const sim = initSimNodes(graph, edges, width / 2, height / 2)
  let alpha = 1
  for (let i = 0; i < 300 && alpha > 0.005; i++) {
    stepSimulation(sim, edges, PLATE_FORCE_PARAMS, alpha, width / 2, height / 2)
    alpha *= 0.985
  }

  if (regions && regions.size > 0) {
    // memberOf: nodeId -> its region's seed id. Nodes absent from this map
    // are spine — never pulled or pushed by phase B.
    const memberOf = new Map<string, string>()
    for (const [seed, members] of regions) {
      for (const id of members) memberOf.set(id, seed)
    }
    let centroids = new Map<string, { x: number; y: number }>()
    const recomputeCentroids = () => {
      const sums = new Map<string, { x: number; y: number; n: number }>()
      for (const [seed, members] of regions) {
        let sx = 0
        let sy = 0
        let n = 0
        for (const id of members) {
          const node = sim.get(id)
          if (!node) continue
          sx += node.x
          sy += node.y
          n++
        }
        if (n > 0) sums.set(seed, { x: sx / n, y: sy / n, n })
      }
      const next = new Map<string, { x: number; y: number }>()
      for (const [seed, c] of sums) next.set(seed, { x: c.x, y: c.y })
      centroids = next
    }
    recomputeCentroids()

    let phaseBAlpha = 0.5
    for (let i = 0; i < 120 && phaseBAlpha > 0.005; i++) {
      if (i > 0 && i % 10 === 0) recomputeCentroids()
      for (const node of sim.values()) {
        const ownSeed = memberOf.get(node.id)
        if (ownSeed == null) continue
        const own = centroids.get(ownSeed)
        if (own) {
          node.vx += (own.x - node.x) * REGION_ATTRACTION * phaseBAlpha
          node.vy += (own.y - node.y) * REGION_ATTRACTION * phaseBAlpha
        }
        for (const [otherSeed, other] of centroids) {
          if (otherSeed === ownSeed) continue
          let dx = node.x - other.x
          let dy = node.y - other.y
          const d = Math.hypot(dx, dy) || 1
          const force = Math.min(8, 900 / d) * REGION_REPULSION * phaseBAlpha
          dx /= d
          dy /= d
          node.vx += dx * force
          node.vy += dy * force
        }
      }
      for (const node of sim.values()) {
        node.vx *= 0.82
        node.x += node.vx
        node.vy *= 0.82
        node.y += node.vy
      }
      phaseBAlpha *= 0.985
    }
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
    // Clamp every node's center so its full rim (radius included) stays
    // inside [0, width] x [0, height] — a no-op for the vast majority of
    // nodes, a small nudge for the rare one a clash-resolution pushed past an
    // edge (more likely once phase B has pulled a region's members into a
    // tighter cluster near the fitted box's side). Clamping mid-sweep, not
    // just once at the end, lets the remaining sweeps re-resolve any
    // clearance the clamp itself reintroduces.
    for (const n of nodes) {
      n.x = Math.min(width - n.r, Math.max(n.r, n.x))
      n.y = Math.min(height - n.r, Math.max(n.r, n.y))
    }
    if (!moved) break
  }

  const out = new Map<string, PlateNode>()
  for (const n of nodes) out.set(n.id, { x: n.x, y: n.y, r: n.r })
  return out
}

/** Precise circular mark centered at the origin, as a path (not a <circle>)
 * so every consumer — screen plate, printed plate, legend glyphs — can fill,
 * stroke, and clip node marks through one uniform `d` vocabulary. Two arcs
 * because a single SVG arc with coincident endpoints collapses to nothing. */
export function ringMarkPath(r: number): string {
  const rr = r.toFixed(2)
  return `M ${-rr} 0 A ${rr} ${rr} 0 1 0 ${rr} 0 A ${rr} ${rr} 0 1 0 ${-rr} 0 Z`
}

/** Diamond mark centered at the origin — the threshold glyph. Slightly
 * larger than the circle it replaces (×1.12) so equal-radius circle and
 * diamond read as equal visual weight despite the diamond's smaller area. */
export function diamondMarkPath(r: number): string {
  const k = (r * 1.12).toFixed(2)
  return `M 0 -${k} L ${k} 0 L 0 ${k} L -${k} 0 Z`
}

/** The plate's node-mark chooser: threshold concepts take the diamond,
 * everything else the circular ring/disc. State ink (color, fill vs hollow,
 * half-fill) is applied by the caller — this is geometry only. */
export function nodeMarkPath(threshold: boolean | undefined, r: number): string {
  return threshold ? diamondMarkPath(r) : ringMarkPath(r)
}

/** Irregular closed blob path centered at the origin — the seeded-wobble
 * technique, kept for the AtlasBirth ritual (whose ink-blot birth animation
 * still uses it deliberately). The map plate itself now renders geometric
 * marks (ringMarkPath/diamondMarkPath above) instead. */
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

/** Deterministic seeded partition of a topic into 3-6 conceptual branches —
 * the regions the plate hulls, hovers, and focuses. Unlike `territoryGroups`
 * (nearest-layer-0-ancestor, always produces exactly one region per root),
 * this spreads members across several roughly-balanced branches via a
 * level-synchronous BFS from a handful of foundational seed nodes.
 *
 * Hub nodes (`computeHubNodeIds` — capstone-like near-universal-fan-in nodes,
 * always including any flagged `capstone: true`) are the unregioned SPINE:
 * never a seed, never a member, never hulled. Every other node ends up in
 * exactly one region.
 *
 * Algorithm (no Date/random anywhere — graph-order tie-breaks throughout, so
 * this is bit-identical across renders of the same graph):
 *  1. Seeds = the K0 non-hub nodes with the highest requires-fan-in (how many
 *     OTHER nodes list this node as a prerequisite) — skip a candidate
 *     adjacent (via requires) to an already-picked seed, so seeds spread out
 *     rather than clumping. K0 = clamp(round(n/7), 3, 6), n = graph.order.length.
 *  2. +1 seed (up to 6) for every requires-connected component of >=3 non-hub
 *     nodes that contains none of the seeds picked so far — otherwise an
 *     isolated cluster would have no seed to attach to.
 *  3. Level-synchronous multi-source BFS over requires edges (undirected
 *     adjacency, hub endpoints excluded): all seeds expand one level at a
 *     time; when two seeds' frontiers reach the same unclaimed node in the
 *     SAME level, the higher-ranked seed (earlier in the fan-in ordering)
 *     claims it.
 *  4. Anything the BFS never reaches (isolated by requires) attaches to the
 *     region of its first assigned neighbor — requires-adjacency checked
 *     before the other edge kinds (derives_from/contrasts_with/analogous_to).
 *  5. Any region left with <3 members merges into whichever OTHER region it
 *     has the strongest connection to (score = 2 per requires edge between
 *     the two, 1 per other-kind edge).
 *  6. Adaptive re-seed: if fewer than 3 regions survive, or the largest holds
 *     more than 45% of all regioned nodes, bump the seed count by one (up to
 *     6) and redo steps 1-5 — up to 4 extra attempts, then accept whatever
 *     the last attempt produced (a structurally dominant hub-adjacent branch,
 *     as in some real topics, is accepted rather than forced apart). */
export function regionGroups(graph: TopicGraph): Map<string, string[]> {
  const hubs = computeHubNodeIds(graph)
  const order = graph.order
  const nonHub = order.filter((id) => !hubs.has(id))
  const n = order.length

  const reqAdj = new Map<string, Set<string>>()
  const otherAdj = new Map<string, Set<string>>()
  const fanIn = new Map<string, number>()
  for (const id of nonHub) {
    reqAdj.set(id, new Set())
    otherAdj.set(id, new Set())
    fanIn.set(id, 0)
  }

  for (const id of order) {
    const node = graph.nodes[id]
    if (!node) continue
    const idHub = hubs.has(id)
    for (const r of node.edges.requires ?? []) {
      if (!graph.nodes[r]) continue
      const rHub = hubs.has(r)
      if (!idHub && !rHub) {
        reqAdj.get(id)!.add(r)
        reqAdj.get(r)!.add(id)
      }
      // Fan-in of the PREREQUISITE: how many other nodes require it.
      if (!rHub) fanIn.set(r, (fanIn.get(r) ?? 0) + 1)
    }
    for (const kind of ['derives_from', 'contrasts_with', 'analogous_to'] as const) {
      for (const r of node.edges[kind] ?? []) {
        if (!graph.nodes[r]) continue
        if (!idHub && !hubs.has(r)) {
          otherAdj.get(id)!.add(r)
          otherAdj.get(r)!.add(id)
        }
      }
    }
  }

  const byFanInDesc = (a: string, b: string): number => {
    const d = (fanIn.get(b) ?? 0) - (fanIn.get(a) ?? 0)
    if (d !== 0) return d
    return order.indexOf(a) - order.indexOf(b)
  }

  function requiresComponents(): string[][] {
    const seen = new Set<string>()
    const comps: string[][] = []
    for (const id of nonHub) {
      if (seen.has(id)) continue
      const comp: string[] = []
      const queue = [id]
      seen.add(id)
      while (queue.length > 0) {
        const cur = queue.shift()!
        comp.push(cur)
        for (const nb of reqAdj.get(cur) ?? []) {
          if (seen.has(nb)) continue
          seen.add(nb)
          queue.push(nb)
        }
      }
      comps.push(comp)
    }
    return comps
  }

  function pickSeeds(k: number): string[] {
    const ranked = [...nonHub].sort(byFanInDesc)
    const seeds: string[] = []
    for (const cand of ranked) {
      if (seeds.length >= k) break
      const adjacentToSeed = seeds.some((s) => reqAdj.get(cand)?.has(s))
      if (adjacentToSeed) continue
      seeds.push(cand)
    }
    for (const comp of requiresComponents()) {
      if (comp.length < 3) continue
      if (comp.some((id) => seeds.includes(id))) continue
      if (seeds.length >= 6) break
      const best = [...comp].sort(byFanInDesc)[0]
      if (!seeds.includes(best)) seeds.push(best)
    }
    return seeds
  }

  function assign(seeds: string[]): Map<string, string[]> {
    const rank = new Map(seeds.map((s, i) => [s, i]))
    const regionOf = new Map<string, string>()
    for (const s of seeds) regionOf.set(s, s)

    let frontier: { id: string; region: string }[] = seeds.map((s) => ({ id: s, region: s }))
    const visited = new Set<string>(seeds)
    while (frontier.length > 0) {
      const nextCandidates = new Map<string, string>()
      for (const { id, region } of frontier) {
        for (const nb of reqAdj.get(id) ?? []) {
          if (visited.has(nb)) continue
          const existing = nextCandidates.get(nb)
          if (existing == null || (rank.get(region) ?? Infinity) < (rank.get(existing) ?? Infinity)) {
            nextCandidates.set(nb, region)
          }
        }
      }
      const nextFrontier: { id: string; region: string }[] = []
      for (const id of order) {
        const region = nextCandidates.get(id)
        if (region == null) continue
        regionOf.set(id, region)
        visited.add(id)
        nextFrontier.push({ id, region })
      }
      frontier = nextFrontier
    }

    // Unassigned attach via first assigned neighbor — requires-adjacency
    // checked before the other edge kinds. Iterative since one attachment can
    // unblock another on the next pass.
    let changed = true
    let guard = 0
    while (changed && guard < nonHub.length + 1) {
      changed = false
      guard++
      for (const id of nonHub) {
        if (regionOf.has(id)) continue
        let found: string | null = null
        for (const nb of reqAdj.get(id) ?? []) {
          if (regionOf.has(nb)) {
            found = regionOf.get(nb)!
            break
          }
        }
        if (found == null) {
          for (const nb of otherAdj.get(id) ?? []) {
            if (regionOf.has(nb)) {
              found = regionOf.get(nb)!
              break
            }
          }
        }
        if (found != null) {
          regionOf.set(id, found)
          changed = true
        }
      }
    }
    // Fully isolated nodes (no requires/other-kind path to any seed at all):
    // own singleton region, cleaned up by the merge pass below.
    for (const id of nonHub) {
      if (!regionOf.has(id)) regionOf.set(id, id)
    }

    const groups = new Map<string, string[]>()
    for (const id of nonHub) {
      const r = regionOf.get(id)!
      if (!groups.has(r)) groups.set(r, [])
      groups.get(r)!.push(id)
    }

    const connectionScore = (members: string[], otherMembers: string[]): number => {
      const otherSet = new Set(otherMembers)
      let score = 0
      for (const id of members) {
        for (const nb of reqAdj.get(id) ?? []) if (otherSet.has(nb)) score += 2
        for (const nb of otherAdj.get(id) ?? []) if (otherSet.has(nb)) score += 1
      }
      return score
    }
    let mergedSomething = true
    while (mergedSomething) {
      mergedSomething = false
      for (const [seedId, members] of [...groups]) {
        if (members.length >= 3) continue
        if (groups.size <= 1) break
        let bestOther: string | null = null
        let bestScore = -1
        for (const [otherSeed, otherMembers] of groups) {
          if (otherSeed === seedId) continue
          const score = connectionScore(members, otherMembers)
          if (score > bestScore) {
            bestScore = score
            bestOther = otherSeed
          }
        }
        if (bestOther != null) {
          groups.get(bestOther)!.push(...members)
          groups.delete(seedId)
          mergedSomething = true
          break
        }
      }
    }
    return groups
  }

  const total = nonHub.length
  let k = Math.max(3, Math.min(6, Math.round(n / 7)))
  let groups = assign(pickSeeds(k))
  let iterations = 0
  while (iterations < 4) {
    const sizes = [...groups.values()].map((m) => m.length)
    const largest = sizes.length > 0 ? Math.max(...sizes) : 0
    if (groups.size >= 3 && (total === 0 || largest / total <= 0.45)) break
    if (k >= 6) break
    k = Math.min(6, k + 1)
    groups = assign(pickSeeds(k))
    iterations++
  }
  return groups
}

/** A conceptual branch's short display name, derived from its seed node's id
 * — split on `-`, drop stop-tokens, keep 2 tokens (3 if the first is <=2
 * characters, so short abbreviations like "cm-angular-momentum" still read).
 * All-caps, space-joined: `euler-lagrange-equations` -> EULER LAGRANGE. Pure
 * function of the id, so unique per topic exactly when the seed ids are. */
export function regionName(seedId: string): string {
  const STOP_TOKENS = new Set(['of', 'the', 'a', 'an', 'and', 'as'])
  const tokens = seedId.split('-').filter((t) => t.length > 0 && !STOP_TOKENS.has(t))
  const keep = tokens.length > 0 && tokens[0].length <= 2 ? 3 : 2
  return tokens
    .slice(0, keep)
    .join(' ')
    .toUpperCase()
}

type Pt = { x: number; y: number }

/** Convex hull (Andrew's monotone chain) — shared by `hullPath` (the wash
 * outline) and `hullCentroid` (territory label placement) so both read the
 * exact same shape. */
function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** The convex hull's vertices, each pushed outward from the hull's own
 * center by `padding` — the one padded-geometry computation shared by every
 * consumer that needs the wash's actual outline (`hullPath`'s stroke,
 * `hullTopAnchor`'s bbox) rather than the raw unpadded hull. `[]` below 3
 * points, mirroring `hullPath`/`hullCentroid`'s own too-small-to-hull
 * bailout. */
function paddedHullVertices(points: Pt[], padding: number): Pt[] {
  if (points.length < 3) return []
  const hull = convexHull(points)
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length
  return hull.map((p) => {
    const dx = p.x - cx
    const dy = p.y - cy
    const d = Math.hypot(dx, dy) || 1
    return { x: p.x + (dx / d) * padding, y: p.y + (dy / d) * padding }
  })
}

/** Convex hull (Andrew's monotone chain) expanded by `padding`, returned as
 * an ANGULAR closed polygon path — straight segments between padded hull
 * vertices. The territory wash used to smooth this through midpoint
 * quadratics into an organic cloud; the plate's chart idiom keeps the same
 * hull, same padding, same footprint, drawn as a faceted sector boundary
 * instead. */
export function hullPath(points: Pt[], padding: number): string {
  const padded = paddedHullVertices(points, padding)
  if (padded.length === 0) return ''
  return (
    padded
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ') + ' Z'
  )
}

/** Region label anchor: padded-hull bbox top-center, nudged 10px further up
 * so the label clears the hull's own stroke instead of sitting on it. Reads
 * the same padded geometry `hullPath` strokes — never the unpadded hull —
 * so the label is always outside the visible wash, never floating inside it
 * at the member centroid the way the old territory captions did. `null`
 * below 3 points. */
export function hullTopAnchor(points: Pt[], padding: number): Pt | null {
  const padded = paddedHullVertices(points, padding)
  if (padded.length === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  for (const p of padded) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
  }
  return { x: (minX + maxX) / 2, y: minY - 10 }
}

/** The same hull center `hullPath` computes internally before padding —
 * exposed on its own for territory labels, which sit at the wash's true
 * visual center rather than tracing its outline. `null` below 3 points,
 * mirroring `hullPath`'s own too-small-to-hull bailout. */
export function hullCentroid(points: Pt[]): Pt | null {
  if (points.length < 3) return null
  const hull = convexHull(points)
  return {
    x: hull.reduce((s, p) => s + p.x, 0) / hull.length,
    y: hull.reduce((s, p) => s + p.y, 0) / hull.length,
  }
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

/** `plateStats`, scoped to a subset of node ids — a region's own readout
 * (hover tooltip, focus header) rather than the whole topic's. Same field
 * shape and same per-node rules (capstone excluded, decaying = retrievability
 * < 0.7 on an encoded node), just filtered to `memberIds` first. Region
 * membership never includes the capstone/spine, so that exclusion is usually
 * a no-op here — kept for parity with `plateStats` rather than assumed. */
export function plateStatsFor(
  graph: TopicGraph,
  retrievability: Map<string, number> | null,
  memberIds: string[],
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
  let thresholdsMet = 0
  let thresholdsTotal = 0
  for (const id of memberIds) {
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

/** All requires-ancestors of `nodeId`, transitively — the "everything this
 * ultimately depends on" set behind the prerequisite trail. BFS with a
 * `visited` set makes this cycle-safe: a graph edge cycle just means some
 * node's neighbors get skipped the second time they're reached, not infinite
 * recursion. Hub/synthesis nodes (`computeHubNodeIds` — the capstone, or a
 * capstone-like node nearly everything requires-into) are walk-stoppers, not
 * pass-throughs: a hub is neither added to the result nor expanded, so its
 * own (near-universal) requires list never enters the closure. Applied
 * symmetrically to both directions, even though only this side is exposed
 * today — a mid node whose requires includes a hub must not pull ~25% of the
 * graph into its ancestor set. This mirrors `isEdgeVisible`'s intent in
 * GraphView.tsx exactly: that function hides a hub's edges to suppress its
 * fan-in/fan-out clutter on the map; stopping the walk at the hub boundary
 * suppresses the same clutter from ever entering the trail in the first
 * place. */
export function ancestorClosure(graph: TopicGraph, nodeId: string): Set<string> {
  const hubs = computeHubNodeIds(graph)
  const result = new Set<string>()
  const visited = new Set<string>([nodeId])
  const queue = [nodeId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const req of graph.nodes[cur]?.edges.requires ?? []) {
      if (visited.has(req)) continue
      visited.add(req)
      if (hubs.has(req)) continue
      queue.push(req)
      result.add(req)
    }
  }
  return result
}

/** All nodes reachable by walking forward along `requires` edges from
 * `nodeId`, transitively — the "everything downstream of this" path toward
 * mastery. Same cycle-safety and hub-boundary discipline as
 * `ancestorClosure` (see its comment), just walking `computeForwardAdjacency`
 * instead of `edges.requires`. */
export function descendantPath(graph: TopicGraph, nodeId: string): Set<string> {
  const hubs = computeHubNodeIds(graph)
  const forwardAdjacency = computeForwardAdjacency(buildEdges(graph))
  const result = new Set<string>()
  const visited = new Set<string>([nodeId])
  const queue = [nodeId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const next of forwardAdjacency.get(cur) ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      if (hubs.has(next)) continue
      queue.push(next)
      result.add(next)
    }
  }
  return result
}
