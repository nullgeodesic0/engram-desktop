/** What the pointer is over, in world space.
 *
 * Hit-testing is geometry, not painting: it reads node positions and region
 * membership and touches no drawing context at all. Keeping it out of the
 * painter is what lets the renderer be swapped (GL ↔ Canvas2D) without
 * putting the pointer at risk, and what lets these two functions be tested
 * in a plain node environment — there is no canvas here to mock.
 *
 * `screenToWorld` lives on `GraphEngine`, since it needs the canvas rect and
 * the camera; by the time coordinates reach this module they are already
 * world units.
 *
 * Adapted from CairnDesktop's atlas engine
 * (app/src/renderer/src/app/atlas/engine/hit.ts) — the region-hull caching
 * strategy is ported verbatim; `hitNode` drops Cairn's per-node "figure"
 * reveal concept, which has no Engram analogue. */

import { hullPath } from '../../graph2d/plate'
import type { AtlasLayout, AtlasNode } from '../layout'

/** The nearest node whose disc contains the point, with a few pixels of
 * slack so small marks stay clickable. */
export function hitNode(layout: AtlasLayout, wx: number, wy: number): AtlasNode | null {
  let best: AtlasNode | null = null
  let bestD = Infinity
  for (const n of layout.nodes) {
    const d = Math.hypot(n.x - wx, n.y - wy)
    const pad = n.r + 4
    if (d <= pad && d < bestD) {
      best = n
      bestD = d
    }
  }
  return best
}

/** Which region wash the point falls in, front-most first.
 *
 * The test is the drawn hull, not a bounding circle — `hullPath` gives the
 * same padded polygon the painter fills, so what you can hit is what you
 * can see. */
export function hitRegion(layout: AtlasLayout, wx: number, wy: number): string | null {
  const hulls = hullsFor(layout)
  for (let i = layout.regions.length - 1; i >= 0; i--) {
    const poly = hulls[i]
    if (poly && pointInPolygon(poly, wx, wy)) return layout.regions[i].seed
  }
  return null
}

/** The padded hulls of a layout's regions, as flat `[x, y, …]` rings.
 *
 * This is the pointer's hottest path — it runs on every pointermove — so
 * the geometry (a pure function of node positions) is computed once and
 * reused rather than rebuilding a convex hull and round-tripping it
 * through path-string formatting on every move.
 *
 * Keyed weakly on the layout so a session that walks many topics cannot
 * accumulate rings for layouts nobody is looking at any more.
 *
 * `layout.ts`'s `tickLayout` mutates node `x`/`y` in place on this SAME
 * layout object (live physics, not a frozen settle), so the cache would
 * otherwise go stale while nodes are moving — `GraphEngine`'s tick loop
 * calls `invalidateHullCache` whenever a tick actually moved anything,
 * which is the coarse-but-correct invalidation a plate that is usually at
 * rest wants: free while settled, recomputed only on the frames where it
 * would otherwise be wrong. */
const HULLS = new WeakMap<AtlasLayout, { regions: AtlasLayout['regions']; rings: (number[] | null)[] }>()

export function invalidateHullCache(layout: AtlasLayout): void {
  HULLS.delete(layout)
}

function hullsFor(layout: AtlasLayout): (number[] | null)[] {
  const cached = HULLS.get(layout)
  if (cached && cached.regions === layout.regions) return cached.rings
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  const rings = layout.regions.map((region) => {
    const pts = region.memberIds.map((id) => byId.get(id)).filter((n): n is AtlasNode => Boolean(n))
    if (pts.length < 3) return null
    return ringOf(hullPath(pts, 40))
  })
  HULLS.set(layout, { regions: layout.regions, rings })
  return rings
}

/** The vertices of an `M x y L x y … Z` path. `hullPath` emits exactly that
 * grammar — straight segments only, one closed ring — so a full SVG path
 * parser would be answering a question this never asks. */
function ringOf(d: string): number[] | null {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)
  if (!nums || nums.length < 6) return null
  const n = nums.length - (nums.length % 2)
  const ring = new Array<number>(n)
  for (let i = 0; i < n; i++) ring[i] = Number(nums[i])
  return ring
}

/** Ray casting over a flat `[x, y, …]` ring. */
function pointInPolygon(ring: readonly number[], x: number, y: number): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i]
    const yi = ring[i + 1]
    const xj = ring[j]
    const yj = ring[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
