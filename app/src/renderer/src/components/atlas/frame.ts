/** What a node or edge should look like, given the state it's actually in.
 *
 * This is the domain layer the old `GraphView.tsx` had folded directly into
 * its JSX — the due-lens/trail/state colour priority, the hollow/half/filled
 * fill rule, the hub-edge hiding predicate. Pulled out on its own so the
 * painter (`engine/WebGLPainter.ts`) stays a pure "given a frame, draw it"
 * function and every decision about what a frame MEANS lives in one place,
 * testable without a canvas.
 *
 * Ported from the retired `GraphView.tsx` (`STATE_COLOR`, `DUE_LENS_COLOR`,
 * `dueStatusFor`, the `color` priority chain, `isEdgeVisible`) — same
 * semantics, same priority order, ink values unchanged. */

import type { EngramNode } from '../../../../shared/types'
import type { EdgeKind, SimEdge } from '../graph3d/types'
import type { AtlasEdge } from './layout'

export type DueStatus = 'overdue' | 'today' | 'future'

export const DUE_LENS_COLOR: Record<DueStatus, string> = {
  overdue: 'var(--color-ink-danger)',
  today: 'var(--color-ink-warm)',
  future: 'var(--color-ink-cool-dim)',
}

export const STATE_COLOR: Record<EngramNode['state'], string> = {
  new: 'var(--color-ink-cool-dim)',
  learning: 'var(--color-ink-cool)',
  review: 'var(--color-ink-warm)',
}

/** Where a node's own schedule sits relative to today, LOCAL-date compared
 * — matching the exact discipline every other due comparison in this app
 * uses. `null` for a node with nothing to compare yet: `new` has no
 * schedule, and the due lens leaves those untouched.
 *
 * Takes `state`/`due` flat rather than the nested `EngramNode.fsrs.due`
 * shape — `AtlasNode` (this engine's own node type) carries `due` flat for
 * exactly this call, so both it and a raw `EngramNode` can be adapted to
 * this signature with a one-line destructure rather than a `Pick<>` that
 * only one of the two shapes satisfies natively. */
export function dueStatusFor(node: { state: EngramNode['state']; due: string | null }): DueStatus | null {
  if (node.state === 'new' || !node.due) return null
  const today = new Date()
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const d = new Date(`${node.due}T00:00:00`)
  const diffDays = Math.floor((d.getTime() - dayStart.getTime()) / 86400000)
  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  return 'future'
}

export type TrailRole = 'ancestor' | 'descendant' | 'selected' | null

/** The one colour-priority chain the whole plate follows: due lens (if on)
 * beats trail role (if hovering/selecting) beats plain FSRS state. Callers
 * pass whichever inputs apply — `dueStatus` is null when the lens is off or
 * the node has nothing due, `trailRole` is null outside a hover/selection. */
export function nodeInk(state: EngramNode['state'], dueStatus: DueStatus | null, trailRole: TrailRole): string {
  if (dueStatus) return DUE_LENS_COLOR[dueStatus]
  if (trailRole === 'ancestor') return 'var(--color-ink-cool)'
  if (trailRole === 'descendant') return 'var(--color-ink-warm)'
  if (trailRole === 'selected') return 'var(--color-ink-hot)'
  return STATE_COLOR[state]
}

/** Fill opacity fades with retrievability — a node whose recall probability
 * has decayed reads visibly fainter before it is due, not just after. */
export function nodeFillOpacity(retrievability: number | undefined): number {
  return 0.35 + 0.65 * (retrievability ?? 1)
}

export type MarkKind = 'ring' | 'diamond' | 'capstone'

/** Which glyph treatment a node gets. Capstones are their own concentric-
 * ring-plus-progress-arc treatment regardless of `threshold` (a capstone
 * that also happens to be flagged threshold still reads as a capstone —
 * matching `GraphView.tsx`'s own separate capstone render branch, which
 * took priority over the ordinary ring/diamond dispatch). */
export function markKind(node: Pick<EngramNode, 'threshold' | 'capstone'>): MarkKind {
  if (node.capstone) return 'capstone'
  return node.threshold ? 'diamond' : 'ring'
}

export type FillStyle = 'hollow' | 'half' | 'filled'

/** How much of a node's own glyph is filled — geometry, not colour, is what
 * carries FSRS state at the base level (state colour still applies on top):
 * new is an outline only, learning is half-filled, review is solid. */
export function fillStyleFor(state: EngramNode['state']): FillStyle {
  if (state === 'review') return 'filled'
  if (state === 'learning') return 'half'
  return 'hollow'
}

/** Hides any edge touching a hub (a capstone, or a capstone-like
 * "synthesis" node nearly everything requires into) except a genuine
 * "final" requires edge — the hub's only dependent is this source, i.e.
 * the natural last step before mastery. Ported from `GraphView.tsx`, with
 * one deliberate change: a CAPSTONE specifically drops that exception too
 * and hides unconditionally. A capstone requires nearly every other node by
 * definition, so even the "only dependent" carve-out still let a real
 * capstone accumulate one converging line per near-finished branch — on a
 * topic with several branches that reads as a hairball fanning into one
 * point, which is exactly the clutter a reader has to see PAST to read the
 * rest of the map. A non-capstone structural hub (a node that merely has a
 * lot of requires, `computeHubNodeIds`'s other qualifying case) keeps the
 * old exception — it isn't the thing every branch of the topic converges
 * on, so its "one real last step" edge still carries real information. */
export function isEdgeVisible(
  e: Pick<SimEdge, 'source' | 'target' | 'kind'>,
  hubNodeIds: ReadonlySet<string>,
  forwardAdjacency: ReadonlyMap<string, string[]>,
  capstoneIds: ReadonlySet<string> = new Set(),
): boolean {
  if (capstoneIds.has(e.source) || capstoneIds.has(e.target)) return false
  if (hubNodeIds.size === 0) return true
  const touchesHub = hubNodeIds.has(e.source) || hubNodeIds.has(e.target)
  if (!touchesHub) return true
  if (e.kind === 'requires' && hubNodeIds.has(e.target)) {
    const dependents = forwardAdjacency.get(e.source)
    return (dependents?.length ?? 0) <= 1
  }
  return false
}

/** Per-edge-kind stroke spec — same values `graph3d/types.ts`'s `EDGE_STYLE`
 * already defines (re-exported there for the Key/legend); mirrored here as
 * the shape the painter actually consumes (dash lengths as numbers, not an
 * SVG `stroke-dasharray` string, since WebGL has no native dashing — the
 * painter walks each dashed edge through `geometry.ts`'s `flowDashes` at a
 * fixed phase instead). */
export interface EdgeInkSpec {
  color: string
  width: number
  dash: [number, number] | null
}

const EDGE_INK: Record<EdgeKind, EdgeInkSpec> = {
  requires: { color: 'var(--color-ink-cool)', width: 1.3, dash: null },
  derives_from: { color: 'var(--color-ink-cool-dim)', width: 1, dash: [1, 3] },
  contrasts_with: { color: 'var(--color-ink-danger-dim)', width: 1, dash: [5, 3] },
  analogous_to: { color: 'var(--color-ink-warm-dim)', width: 1, dash: [1, 4] },
}

export function edgeInk(kind: EdgeKind): EdgeInkSpec {
  return EDGE_INK[kind]
}

/** Trail-overlay stroke colour — cool-violet for the ancestor half of a
 * hover/selection trail, warm-amber for the descendant half. Literal hex
 * (not the CSS var), matching the exact values `GraphView.tsx` used. */
export const TRAIL_ANCESTOR_COLOR = '#a78bda'
export const TRAIL_DESCENDANT_COLOR = '#e8a857'

/** Whether an `AtlasEdge` survives the current hub-hiding rule — the
 * `AtlasEdge`-shaped convenience wrapper `WebGLPainter.ts` actually calls,
 * since its edges come from `layout.ts` rather than `graph3d/types.ts`. */
export function atlasEdgeVisible(
  e: AtlasEdge,
  hubNodeIds: ReadonlySet<string>,
  forwardAdjacency: ReadonlyMap<string, string[]>,
  capstoneIds: ReadonlySet<string> = new Set(),
): boolean {
  return isEdgeVisible(e, hubNodeIds, forwardAdjacency, capstoneIds)
}
