import type { TopicGraph } from '../../../../shared/types'
import {
  buildEdges,
  initSimNodes,
  stepSimulation,
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

/** Hard clear gap kept between adjacent region discs (and between the disc
 * ring and the central spine circle) — the non-overlap guarantee's margin. */
const DISC_GAP = 36

/** Settle the plate once and freeze it — the plate is a fixed specimen, not
 * a live sim. Deterministic per topic (no Date/random anywhere; seeded()
 * jitter and graph-order tie-breaks only).
 *
 * WITHOUT `regions` (AtlasBirth): the original generic force settle,
 * verbatim — 300 steps, fit, collision sweeps.
 *
 * WITH `regions`: the cluster-first layout (2026-07-31 redesign — the old
 * soft centroid-nudge phase could never fully unmix clusters the generic
 * settle had interleaved, and did nothing about edge crossings):
 *   1. Regions are ordered around a ring by brute-force minimizing
 *      inter-region edge weight x circular distance (K <= 6, so every
 *      circular ordering is enumerable) — heavily-connected regions sit
 *      adjacent, which is what actually removes long crossing arcs.
 *   2. Each region gets a DISC — anchor on an ellipse, radius from member
 *      count — with the ellipse radius and a global disc scale solved so
 *      adjacent discs are separated by a hard gap BY CONSTRUCTION. Hulls
 *      drawn around members can therefore never overlap.
 *   3. Members lay out INSIDE their disc: seeded by BFS depth from the
 *      region seed, oriented so prerequisite flow runs radially outward
 *      from the map center (cross-region edges converge on the spine, so
 *      pointing depth-0 inward shortens and untangles them), relaxed by a
 *      members-only spring/repel sim, and hard-clamped into the disc every
 *      step.
 *   4. Spine nodes (hubs) stack in a central column, confined to the inner
 *      circle the disc ring leaves free — the trunk the branches surround. */
export function settlePlate(
  graph: TopicGraph,
  width: number,
  height: number,
  regions?: Map<string, string[]>,
): Map<string, PlateNode> {
  const edges = buildEdges(graph)
  const sim = initSimNodes(graph, edges, width / 2, height / 2)

  if (regions && regions.size > 0) {
    return settleClustered(graph, sim, width, height, regions)
  }

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


/** The cluster-first regioned settle — see settlePlate's doc comment for the
 * four stages. `sim` arrives from initSimNodes purely for its per-node radii
 * (degree/capstone-derived); every position here is computed from scratch in
 * screen space, so no fit pass is needed afterwards. Deterministic
 * throughout: graph order, member order, and seeded() jitter only. */
function settleClustered(
  graph: TopicGraph,
  sim: ReturnType<typeof initSimNodes>,
  width: number,
  height: number,
  regions: Map<string, string[]>,
): Map<string, PlateNode> {
  const cx = width / 2
  const cy = height / 2
  const seeds = Array.from(regions.keys())
  const memberOf = new Map<string, string>()
  for (const [seed, members] of regions) for (const id of members) memberOf.set(id, seed)
  const spine = graph.order.filter((id) => !memberOf.has(id))

  // --- 1. Circular ordering by inter-region connection weight. K <= 6 by
  // regionGroups' construction, so every circular ordering (first element
  // fixed) is enumerable: cost = sum over region pairs of
  // weight x circular hop distance. Heavy pairs end up adjacent — the
  // orderings that force a heavy pair across the ring are exactly the ones
  // that produce long crossing arcs. Requires/derives edges count double:
  // they are the drawn trunk lines. ---
  const seedIndex = new Map(seeds.map((sd, i) => [sd, i]))
  const K = seeds.length
  const weight: number[][] = Array.from({ length: K }, () => Array(K).fill(0))
  for (const id of graph.order) {
    const node = graph.nodes[id]
    if (!node) continue
    const a = memberOf.get(id)
    if (a == null) continue
    const ai = seedIndex.get(a)!
    for (const kind of ['requires', 'derives_from', 'contrasts_with', 'analogous_to'] as const) {
      for (const other of node.edges[kind] ?? []) {
        const b = memberOf.get(other)
        if (b == null || b === a) continue
        const bi = seedIndex.get(b)!
        const w = kind === 'requires' || kind === 'derives_from' ? 2 : 1
        weight[ai][bi] += w
        weight[bi][ai] += w
      }
    }
  }
  let bestOrder = seeds.map((_, i) => i)
  if (K > 2) {
    const rest = bestOrder.slice(1)
    let bestCost = Infinity
    const permute = (arr: number[], k: number): void => {
      if (k === arr.length) {
        const order = [0, ...arr]
        let cost = 0
        const pos = Array(K).fill(0)
        order.forEach((seedIdx, ringPos) => {
          pos[seedIdx] = ringPos
        })
        for (let i = 0; i < K; i++) {
          for (let j = i + 1; j < K; j++) {
            if (weight[i][j] === 0) continue
            const hop = Math.abs(pos[i] - pos[j])
            cost += weight[i][j] * Math.min(hop, K - hop)
          }
        }
        if (cost < bestCost) {
          bestCost = cost
          bestOrder = order.slice()
        }
        return
      }
      for (let i = k; i < arr.length; i++) {
        ;[arr[k], arr[i]] = [arr[i], arr[k]]
        permute(arr, k + 1)
        ;[arr[k], arr[i]] = [arr[i], arr[k]]
      }
    }
    permute(rest, 0)
  }

  // --- 2. Disc geometry: raw radii from member count, sector widths
  // proportional to radius, then one scale `s` solved so every adjacent
  // pair's anchor chord clears both discs plus DISC_GAP while the ring plus
  // the largest disc still fits the frame. All in screen space — hulls
  // around members can never meet. ---
  const margin = 64
  const halfW = width / 2 - margin
  const halfH = height / 2 - margin
  const H = Math.min(halfW, halfH)
  const raw = bestOrder.map((seedIdx) => Math.sqrt(regions.get(seeds[seedIdx])!.length))
  const rawSum = raw.reduce((a, b) => a + b, 0)
  const angles: number[] = []
  let acc = -Math.PI / 2
  for (let i = 0; i < K; i++) {
    const w = (raw[i] / rawSum) * Math.PI * 2
    angles.push(acc + w / 2)
    acc += w
  }
  const rawMax = Math.max(...raw)
  let s = Infinity
  if (K === 1) {
    s = (H * 0.9) / rawMax
  } else {
    for (let i = 0; i < K; i++) {
      const j = (i + 1) % K
      const dAng = Math.abs(((angles[j] - angles[i] + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      const sinHalf = Math.max(0.15, Math.sin(dAng / 2))
      // R = H - s*rawMax and 2 R sin(dAng/2) >= s(raw_i+raw_j) + DISC_GAP
      const si = (2 * sinHalf * H - DISC_GAP) / (2 * sinHalf * rawMax + raw[i] + raw[j])
      s = Math.min(s, si)
    }
  }
  // Cap the disc scale so a tiny K doesn't balloon discs past what member
  // counts need (~46px of footprint per member within the disc area).
  const need = raw.map((r) => 46 * r)
  s = Math.max(24, Math.min(s, Math.max(...need.map((n, i) => n / raw[i])) * 1.15))
  const R = Math.max(0, H - s * rawMax)
  const anchors = bestOrder.map((seedIdx, i) => ({
    seed: seeds[seedIdx],
    x: cx + Math.cos(angles[i]) * (R * (halfW / H >= 1.15 ? 1.12 : 1)) * (halfW >= halfH ? 1 : halfH / H),
    y: cy + Math.sin(angles[i]) * R,
    r: s * raw[i],
    angle: angles[i],
  }))

  const out = new Map<string, PlateNode>()

  // --- 3. Members inside their disc: BFS rings from the region seed over
  // intra-region adjacency (requires first, other kinds as fallback), depth
  // 0 facing the MAP CENTER so prerequisite flow runs radially outward and
  // cross-region edges (which converge on the central spine) stay short.
  // Then a members-only spring/repel relax, hard-clamped to the disc every
  // step, and a final in-disc collision resolution. ---
  for (const anchor of anchors) {
    const members = regions.get(anchor.seed)!
    const memberSet = new Set(members)
    const adj = new Map<string, string[]>()
    for (const id of members) adj.set(id, [])
    for (const id of members) {
      const node = graph.nodes[id]
      if (!node) continue
      for (const kind of ['requires', 'derives_from', 'contrasts_with', 'analogous_to'] as const) {
        for (const other of node.edges[kind] ?? []) {
          if (!memberSet.has(other)) continue
          adj.get(id)!.push(other)
          adj.get(other)!.push(id)
        }
      }
    }
    const depth = new Map<string, number>()
    const queue: string[] = []
    if (memberSet.has(anchor.seed)) {
      depth.set(anchor.seed, 0)
      queue.push(anchor.seed)
    }
    while (queue.length > 0) {
      const id = queue.shift()!
      for (const other of adj.get(id) ?? []) {
        if (depth.has(other)) continue
        depth.set(other, (depth.get(id) ?? 0) + 1)
        queue.push(other)
      }
    }
    for (const id of members) if (!depth.has(id)) depth.set(id, 1)
    const maxDepth = Math.max(1, ...depth.values())

    const inward = Math.atan2(cy - anchor.y, cx - anchor.x)
    const byDepth = new Map<number, string[]>()
    for (const id of members) {
      const d = depth.get(id)!
      const list = byDepth.get(d) ?? []
      list.push(id)
      byDepth.set(d, list)
    }
    for (const [d, list] of byDepth) {
      list.sort((a, b) => graph.order.indexOf(a) - graph.order.indexOf(b))
      const ringR = (d / (maxDepth + 0.6)) * (anchor.r * 0.82)
      list.forEach((id, idx) => {
        const node = sim.get(id)
        if (!node) return
        const spread = Math.min(Math.PI * 1.5, list.length * 0.7)
        const ang =
          inward + Math.PI + (list.length === 1 ? 0 : (idx / (list.length - 1) - 0.5) * spread) + (seeded(id, 3) - 0.5) * 0.18
        node.x = anchor.x + Math.cos(ang) * (d === 0 ? 0 : ringR)
        node.y = anchor.y + Math.sin(ang) * (d === 0 ? 0 : ringR)
        node.vx = 0
        node.vy = 0
      })
    }

    const memberNodes = members.map((id) => sim.get(id)!).filter(Boolean)
    // `relax` widens the clamp boundary during the final collision sweeps —
    // a dense region whose disc runs slightly tight would otherwise converge
    // with the clamp fighting the push at a ~2px rim overlap. Bounded at
    // 18px, half the DISC_GAP, so the cross-region guarantee still holds.
    const clampToDisc = (n: (typeof memberNodes)[number], relax = 0): void => {
      const maxDist = Math.max(4, anchor.r - n.r - 10 + relax)
      const dx = n.x - anchor.x
      const dy = n.y - anchor.y
      const d = Math.hypot(dx, dy)
      if (d > maxDist) {
        n.x = anchor.x + (dx / d) * maxDist
        n.y = anchor.y + (dy / d) * maxDist
      }
    }
    let alpha = 1
    for (let step = 0; step < 140 && alpha > 0.01; step++) {
      for (let i = 0; i < memberNodes.length; i++) {
        for (let j = i + 1; j < memberNodes.length; j++) {
          const a = memberNodes[i]
          const b = memberNodes[j]
          let dx = b.x - a.x
          let dy = b.y - a.y
          let d2 = dx * dx + dy * dy
          if (d2 < 1) d2 = 1
          const d = Math.sqrt(d2)
          const f = (1400 / d2) * alpha
          dx /= d
          dy /= d
          a.vx -= dx * f
          a.vy -= dy * f
          b.vx += dx * f
          b.vy += dy * f
        }
      }
      for (const id of members) {
        const a = sim.get(id)
        if (!a) continue
        for (const other of adj.get(id) ?? []) {
          const b = sim.get(other)
          if (!b) continue
          const dx = b.x - a.x
          const dy = b.y - a.y
          const d = Math.hypot(dx, dy) || 1
          const disp = (d - 64) * 0.04 * alpha
          a.vx += (dx / d) * disp
          a.vy += (dy / d) * disp
        }
      }
      for (const n of memberNodes) {
        n.vx += (anchor.x - n.x) * 0.012 * alpha
        n.vy += (anchor.y - n.y) * 0.012 * alpha
        n.vx *= 0.8
        n.vy *= 0.8
        n.x += n.vx
        n.y += n.vy
        clampToDisc(n)
      }
      alpha *= 0.975
    }
    for (let sweep = 0; sweep < 14; sweep++) {
      let moved = false
      for (let i = 0; i < memberNodes.length; i++) {
        for (let j = i + 1; j < memberNodes.length; j++) {
          const a = memberNodes[i]
          const b = memberNodes[j]
          const minDist = a.r + b.r + CELL_CLEARANCE
          let dx = b.x - a.x
          let dy = b.y - a.y
          let d = Math.hypot(dx, dy)
          if (d >= minDist) continue
          if (d < 0.01) {
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
          clampToDisc(a, Math.min(18, sweep * 1.5))
          clampToDisc(b, Math.min(18, sweep * 1.5))
          moved = true
        }
      }
      if (!moved) break
    }
    for (const n of memberNodes) out.set(n.id, { x: n.x, y: n.y, r: n.r })
  }

  // --- 4. Spine: hubs stack down the central column, in graph order,
  // collision-spaced. Confinement is exclusion FROM every region disc (plus
  // a small buffer), never a hard inner circle — when the ring leaves a
  // cramped center, the column stretches vertically through the gaps
  // instead of crushing two capstones into a circle that can't hold them. ---
  const spineNodes = spine.map((id) => sim.get(id)!).filter(Boolean)
  spineNodes.forEach((n, i) => {
    const step = spineNodes.length === 1 ? 0 : i - (spineNodes.length - 1) / 2
    n.x = cx + (seeded(n.id, 5) - 0.5) * 24
    n.y = cy + step * 64
  })
  const pushOutOfDiscs = (n: (typeof spineNodes)[number]): void => {
    for (const anchor of anchors) {
      const minDist = anchor.r + n.r + 12
      let dx = n.x - anchor.x
      let dy = n.y - anchor.y
      let d = Math.hypot(dx, dy)
      if (d >= minDist) continue
      if (d < 0.01) {
        dx = cx - anchor.x
        dy = cy - anchor.y
        d = Math.hypot(dx, dy) || 1
      }
      n.x = anchor.x + (dx / d) * minDist
      n.y = anchor.y + (dy / d) * minDist
    }
  }
  for (let sweep = 0; sweep < 16; sweep++) {
    let moved = false
    for (let i = 0; i < spineNodes.length; i++) {
      for (let j = i + 1; j < spineNodes.length; j++) {
        const a = spineNodes[i]
        const b = spineNodes[j]
        const minDist = a.r + b.r + CELL_CLEARANCE
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= minDist) continue
        if (d < 0.01) {
          dx = 0
          dy = 1
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
    for (const n of spineNodes) pushOutOfDiscs(n)
    if (!moved) break
  }
  for (const n of spineNodes) out.set(n.id, { x: n.x, y: n.y, r: n.r })

  // Defensive frame clamp — geometry should already guarantee this.
  for (const n of out.values()) {
    n.x = Math.min(width - n.r, Math.max(n.r, n.x))
    n.y = Math.min(height - n.r, Math.max(n.r, n.y))
  }
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

/** Deterministic seeded partition of a topic into 3-6 conceptual branches —
 * the regions the plate hulls, hovers, and focuses. Unlike the retired
 * nearest-layer-0-ancestor grouping this replaced (always exactly one region
 * per root), this spreads members across several roughly-balanced branches via a
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
