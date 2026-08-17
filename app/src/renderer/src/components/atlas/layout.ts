/** The topic map's geometric model — the shape a WebGL/Canvas2D painter,
 * hit-tester, and label-placer all read.
 *
 * DELIBERATELY THIN. Engram already has a real, tuned, working layout
 * engine for this exact graph — `graph3d/layout.ts` (the force-simulation
 * math: repulsion, spring edges by kind, weak centering) and
 * `graph2d/plate.ts` (the deterministic one-shot settle, including the
 * 2026-07-31 cluster-first region layout: ring-order regions by inter-
 * region edge weight, pack each into a non-overlapping disc, relax members
 * inside it, stack hubs in a central spine). None of that is rewritten
 * here — `buildLayout` below calls it unchanged and just reshapes the
 * result into the `AtlasNode`/`AtlasEdge`/`AtlasRegion` vocabulary the new
 * engine's painter/hit-tester/label-placer consume. `graph3d/layout.ts` and
 * `graph2d/plate.ts` are read-only dependencies of this module: several
 * other surfaces (TopicMapView's Key, `mapToPrintHtml.ts`, `AtlasBirth.tsx`,
 * `pressure.ts`) also call into them directly, so editing their internals
 * to suit this engine would risk regressing surfaces this port never
 * touches.
 *
 * What IS new here: `tickLayout`, a live per-frame relaxation the old SVG
 * renderer never had — it settled once and froze forever. This is the
 * "physics" half of the port: dragging a node now visibly displaces its
 * neighbours through real spring/repulsion forces, the same way Cairn's
 * atlas felt alive, using Engram's OWN force constants (not Cairn's) so the
 * shape of a settled topic is unchanged from before this port — only
 * whether it can still move is new. */

import type { TopicGraph } from '../../../../shared/types'
import {
  buildEdges,
  computeDegree,
  computeForwardAdjacency,
  computeFrontierIds,
  computeHubNodeIds,
  stepSimulation,
  type SimNode3D,
} from '../graph3d/layout'
import { DEFAULT_FORCE_PARAMS, type EdgeKind, type ForceParams, type SimEdge } from '../graph3d/types'
import { regionName, settlePlate, type PlateNode } from '../graph2d/plate'

export interface AtlasNode {
  id: string
  x: number
  y: number
  r: number
  vx: number
  vy: number
  /** Non-null while dragged — pinned in place, exactly like Cairn's `fx/fy`
   * and Engram's own existing `SimNode3D.fx/fy`. */
  fx: number | null
  fy: number | null
  state: TopicGraph['nodes'][string]['state']
  threshold: boolean
  capstone: boolean
  isHub: boolean
  isFrontier: boolean
  lapses: number
  /** `fsrs.due`, carried flat rather than nesting the whole `NodeFsrs`
   * shape — the due lens (`frame.ts`'s `dueStatusFor`) is the only thing
   * that reads it. */
  due: string | null
  /** Requires-edge fan-in + fan-out — the same quantity `settlePlate`
   * already scales node radius by, reused here as the label-priority
   * "burden" (see `labels.ts`). */
  degree: number
}

export interface AtlasEdge {
  source: string
  target: string
  kind: EdgeKind
}

export interface AtlasRegion {
  seed: string
  name: string
  memberIds: string[]
}

export interface AtlasLayout {
  nodes: AtlasNode[]
  edges: AtlasEdge[]
  regions: AtlasRegion[]
  width: number
  height: number
  hubNodeIds: ReadonlySet<string>
  forwardAdjacency: ReadonlyMap<string, string[]>
}

/** The plate's own tuned constants for a 1:1 settle — same values
 * `graph2d/plate.ts`'s `settlePlate` already applies internally for the
 * one-shot settle; kept here too so the LIVE tick (below) relaxes at the
 * same scale rather than snapping back to the 3D-scene-tuned defaults the
 * instant a node is dragged. */
const PLATE_FORCE_PARAMS: ForceParams = {
  ...DEFAULT_FORCE_PARAMS,
  repelForce: 3.2,
  linkDistance: 1.9,
  centerForce: 0.5,
}

/** Build the frozen initial layout for a topic. Deterministic — same inputs,
 * same output — because `settlePlate` is (no Date/Math.random anywhere in
 * the chain).
 *
 * `regionMap` is NOT computed here — it's `TopicMapView`'s own
 * `regionGroups(graph)`, threaded in as a prop the same way it already
 * feeds `NodeTable`'s chip restriction and the Key. Recomputing it inside
 * this engine would give the map and the table two independently-seeded
 * partitions of the same graph that could disagree about which branch a
 * node belongs to. Pass `null` (or an empty map) for the plain settle. */
export function buildLayout(
  graph: TopicGraph,
  width: number,
  height: number,
  regionMap: ReadonlyMap<string, string[]> | null,
): AtlasLayout {
  const edges = buildEdges(graph)
  const regionInput: ReadonlyMap<string, string[]> = regionMap ?? new Map<string, string[]>()
  // settlePlate's own signature wants a mutable Map; a shallow copy satisfies
  // it without widening this function's own param back to non-readonly.
  const positions: Map<string, PlateNode> = settlePlate(
    graph,
    width,
    height,
    regionInput.size > 0 ? new Map(regionInput) : undefined,
  )
  const hubNodeIds = computeHubNodeIds(graph)
  const forwardAdjacency = computeForwardAdjacency(edges)
  const degree = computeDegree(edges)
  const frontierIds = computeFrontierIds(graph)

  const nodes: AtlasNode[] = graph.order
    .filter((id) => graph.nodes[id] && positions.has(id))
    .map((id) => {
      const n = graph.nodes[id]
      const p = positions.get(id)!
      return {
        id,
        x: p.x,
        y: p.y,
        r: p.r,
        vx: 0,
        vy: 0,
        fx: null,
        fy: null,
        state: n.state,
        threshold: n.threshold,
        capstone: Boolean(n.capstone),
        isHub: hubNodeIds.has(id),
        isFrontier: frontierIds.has(id),
        lapses: n.fsrs.lapses,
        due: n.fsrs.due,
        degree: degree.get(id) ?? 0,
      }
    })

  const validIds = new Set(nodes.map((n) => n.id))
  const atlasEdges: AtlasEdge[] = edges
    .filter((e) => validIds.has(e.source) && validIds.has(e.target))
    .map((e) => ({ source: e.source, target: e.target, kind: e.kind }))

  const regions: AtlasRegion[] = Array.from(regionInput.entries())
    .map(([seed, memberIds]) => ({
      seed,
      name: regionName(seed),
      memberIds: memberIds.filter((id) => validIds.has(id)),
    }))
    .filter((r) => r.memberIds.length > 0)

  return { nodes, edges: atlasEdges, regions, width, height, hubNodeIds, forwardAdjacency }
}

/** Rebuild a layout's `SimEdge[]` view — the shape `stepSimulation` and
 * `computeForwardAdjacency` expect — from its `AtlasEdge[]`. Cheap and
 * called once per `tickLayout` batch (see `GraphEngine.ts`), not per node. */
function toSimEdges(edges: readonly AtlasEdge[]): SimEdge[] {
  return edges.map((e) => ({ source: e.source, target: e.target, kind: e.kind }))
}

/** The fastest a node may move in one tick, in world units.
 *
 * `graph3d/layout.ts`'s `stepSimulation` has no such ceiling — fine for a
 * one-shot settle that always starts from alpha 1 and cools monotonically,
 * but a LIVE sim can be reheated (a drag lets go with real velocity, or a
 * region change re-seeds alpha) while nodes are still close together, and
 * an unclamped inverse-square repulsion between two coincident nodes is a
 * divide-by-near-zero waiting to happen. Cairn's atlas hit exactly this —
 * an outlier node reached -654,582 within 4 ticks — and fixed it with
 * this same kind of per-tick speed cap; borrowed here for the same reason,
 * without changing `stepSimulation` itself (see this file's own doctrine
 * comment on why that function stays untouched). */
const MAX_SPEED = 48

/** How slow is "at rest" — below this, a node's own motion no longer
 * justifies another paint. Mirrors Cairn's coast-stop threshold in spirit:
 * the number that lets `GraphEngine` stop ticking an idle plate. */
const REST_SPEED = 0.05

/** One live physics tick, in place. Returns whether the layout is still
 * "hot" — any node moving fast enough to be worth another frame — so the
 * caller's RAF loop can stop ticking (and stop painting) once the plate has
 * settled, the same dirty-flag discipline Cairn's `GraphEngine` uses.
 *
 * Reuses Engram's own `stepSimulation` verbatim for the force math (same
 * rest lengths by edge kind, same stiffness split, same repulsion/centering
 * constants a real settled topic is already tuned against) — only the
 * DRIVER differs: where the old settle ran 300 fixed steps from alpha 1 to
 * ~0 and froze, this can be called every frame indefinitely, with the
 * caller controlling `alpha` (a steady low value for ambient life, a
 * reheated high one right after a drag releases or a region focus
 * changes). */
export function tickLayout(layout: AtlasLayout, alpha: number, centerX: number, centerY: number): boolean {
  const sim = new Map<string, SimNode3D>()
  for (const n of layout.nodes) {
    sim.set(n.id, { id: n.id, x: n.x, y: n.y, z: 0, vx: n.vx, vy: n.vy, fx: n.fx, fy: n.fy, r: n.r, layer: 0 })
  }
  stepSimulation(sim, toSimEdges(layout.edges), PLATE_FORCE_PARAMS, alpha, centerX, centerY)

  let hot = false
  for (const n of layout.nodes) {
    const s = sim.get(n.id)
    if (!s) continue
    // Speed clamp — see MAX_SPEED's doctrine comment. Direction is kept;
    // only the magnitude is argued with, same rule camera.ts's `fling`
    // applies to a coast release.
    const speed = Math.hypot(s.vx, s.vy)
    if (speed > MAX_SPEED) {
      const scale = MAX_SPEED / speed
      s.vx *= scale
      s.vy *= scale
      s.x = n.x + s.vx
      s.y = n.y + s.vy
    }
    n.x = s.x
    n.y = s.y
    n.vx = s.vx
    n.vy = s.vy
    if (Math.hypot(n.vx, n.vy) > REST_SPEED) hot = true
  }
  return hot
}

/** Pin a node to a world position (drag) or release it (drag end). Pinning
 * also zeroes velocity so a released, previously-pinned node does not
 * inherit whatever the pointer's last delta happened to be — the pointer's
 * OWN velocity belongs to the camera fling, not to the node. */
export function pinNode(layout: AtlasLayout, id: string, x: number | null, y: number | null): void {
  const n = layout.nodes.find((node) => node.id === id)
  if (!n) return
  n.fx = x
  n.fy = y
  if (x !== null && y !== null) {
    n.x = x
    n.y = y
    n.vx = 0
    n.vy = 0
  }
}
