import type { EngramNode, TopicGraph } from '../../../shared/types'
import { seededNodeGlyphValue } from './inkNodeGlyph'

/** Layout for a topic's concept graph drawn as a miniature Cajal figure.
 *
 * The shelf spent every topic's whole structure on a 22px progress ring, and
 * the row's middle — after the measure was bounded — was empty. This puts the
 * real thing there: the actual nodes, the actual `requires` edges, the actual
 * per-node FSRS state.
 *
 * DETERMINISTIC, never a simulation. A force layout would settle differently
 * on every mount, so the same topic would draw a different shape each time you
 * opened the page — which for a figure claiming to depict your knowledge is
 * both unsettling and a lie about what changed. Depth comes from the
 * prerequisite DAG and the jitter comes from `seededNodeGlyphValue`, the same
 * hash InkNode uses, so a given graph always produces the identical figure and
 * only a REAL change to the graph moves anything.
 *
 * Arithmetic only, no React and no I/O — the caller owns fetching and drawing
 * (same split as shared/sittingPace.ts).
 */

export interface ConstellationNode {
  id: string
  x: number
  y: number
  /** Drives the ink: 'review' survived, 'learning' in flight, 'new' not yet. */
  state: string
  threshold: boolean
}

export interface ConstellationEdge {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Constellation {
  nodes: ConstellationNode[]
  edges: ConstellationEdge[]
  /** Radius to draw each node at — shrinks as the graph grows so a 121-node
   * topic stays a legible field rather than a solid bar. */
  r: number
  /** True when the graph exceeded `maxNodes` and the tail was dropped. The
   * caller must say so rather than presenting a partial figure as whole. */
  truncated: boolean
  /** Real `requires` links deliberately not drawn — see the capstone rule in
   * `layoutConstellation`. Surfaced so the caller can say the figure elides
   * them; a count of drawn links presented as the count of real ones would be
   * exactly the quiet mis-measurement this app refuses to make. */
  elidedCapstoneEdges: number
}

/** Above this the figure stops being readable at row scale and the DOM cost
 * stops being worth it. The largest real topic in the author's corpus is 121
 * nodes, so this is headroom, not a routine cut — but when it does bite, the
 * caller is told. */
const MAX_NODES = 200

/** How many prerequisite links a single convergence point may draw. Three
 * reads as "the chain converges here" without becoming a fan; more than that
 * and the terminal region turns back into the hairball this rule exists to
 * prevent. */
const MAX_CAPSTONE_LINKS = 3

/** A node is treated as a convergence point when it DECLARES itself a capstone
 * OR when its in-degree says it is one regardless.
 *
 * Keying only off the `capstone` flag was not enough on real data.
 * grad-classical-mechanics carries two terminal nodes: `capstone`, flagged,
 * requiring 38 of 39 nodes — and `capstone-classical-mechanics-mastery`,
 * requiring 37, NOT flagged. The rule pruned the first and drew all 37 lines
 * into the second, so the figure still had a wedge. The flag records intent;
 * what crowds a drawing is convergence, and that is measurable.
 *
 * Relative, not absolute: a floor of six catches a small topic where six
 * prerequisites is already most of it, and the 15% term scales the test so a
 * 121-node graph is not declared convergent at six. On the real graph above
 * the threshold lands at 6 and separates cleanly — the two terminal nodes sit
 * at 38 and 37, and the next busiest node in the whole topic has 2. */
function convergenceThreshold(nodeCount: number): number {
  return Math.max(6, Math.ceil(nodeCount * 0.15))
}

/** Longest prerequisite chain ending at each node. Memoised, with an
 * in-progress marker so a cyclic `requires` (which the engine should never
 * emit, but this must not hang on) resolves to 0 instead of recursing
 * forever. */
function depths(nodes: Record<string, EngramNode>): Map<string, number> {
  const out = new Map<string, number>()
  const visiting = new Set<string>()
  const walk = (id: string): number => {
    const seen = out.get(id)
    if (seen !== undefined) return seen
    if (visiting.has(id)) return 0
    visiting.add(id)
    const reqs = nodes[id]?.edges?.requires ?? []
    let d = 0
    for (const r of reqs) {
      if (r === id || !nodes[r]) continue
      d = Math.max(d, walk(r) + 1)
    }
    visiting.delete(id)
    out.set(id, d)
    return d
  }
  for (const id of Object.keys(nodes)) walk(id)
  return out
}

export function layoutConstellation(
  graph: Pick<TopicGraph, 'nodes' | 'order'>,
  width: number,
  height: number,
): Constellation {
  const all = Object.keys(graph.nodes)
  // `order` is the engine's own teaching sequence; falling back to key order
  // keeps a graph without it renderable rather than empty.
  const ordered = (graph.order ?? []).filter((id) => graph.nodes[id])
  const ids = ordered.length > 0 ? [...ordered, ...all.filter((id) => !ordered.includes(id))] : all
  const truncated = ids.length > MAX_NODES
  const kept = truncated ? ids.slice(0, MAX_NODES) : ids
  if (kept.length === 0) return { nodes: [], edges: [], r: 0, truncated: false, elidedCapstoneEdges: 0 }

  const depth = depths(graph.nodes)
  const maxDepth = Math.max(1, ...kept.map((id) => depth.get(id) ?? 0))

  // Column per prerequisite depth; a curriculum DAG reads left-to-right as
  // "what you must know first", which is the one spatial claim the data
  // actually supports.
  const pad = 4
  const innerW = Math.max(1, width - pad * 2)
  const innerH = Math.max(1, height - pad * 2)

  // How many share each column, so a fat layer spreads across the full height
  // instead of piling on the centre line.
  const perDepth = new Map<number, string[]>()
  for (const id of kept) {
    const d = depth.get(id) ?? 0
    const list = perDepth.get(d)
    if (list) list.push(id)
    else perDepth.set(d, [id])
  }

  const pos = new Map<string, { x: number; y: number }>()
  for (const [d, members] of perDepth) {
    const x = pad + (maxDepth === 0 ? 0.5 : d / maxDepth) * innerW
    members.forEach((id, i) => {
      // Even spread down the column, then a seeded nudge so the figure reads
      // as drawn by hand rather than plotted on a grid — the same wobble
      // discipline as the InkNode glyph.
      const slot = members.length === 1 ? 0.5 : i / (members.length - 1)
      const jitter = (seededNodeGlyphValue(id, 7) - 0.5) * (innerH / Math.max(3, members.length))
      const y = pad + Math.min(1, Math.max(0, slot)) * innerH + jitter
      pos.set(id, { x, y: Math.min(height - pad, Math.max(pad, y)) })
    })
  }

  const nodes: ConstellationNode[] = kept.map((id) => {
    const p = pos.get(id)!
    const n = graph.nodes[id]
    return { id, x: p.x, y: p.y, state: n.state, threshold: n.threshold === true }
  })

  const inKept = new Set(kept)

  // Every real link between two drawn nodes, before any pruning.
  const candidates: Array<{ from: string; to: string }> = []
  for (const id of kept) {
    for (const req of graph.nodes[id]?.edges?.requires ?? []) {
      if (!inKept.has(req) || req === id) continue
      if (!pos.has(req)) continue
      candidates.push({ from: req, to: id })
    }
  }

  // How connected each node is, counted over the real links — used to decide
  // WHICH of a capstone's predecessors are worth drawing.
  const degree = new Map<string, number>()
  for (const c of candidates) {
    degree.set(c.from, (degree.get(c.from) ?? 0) + 1)
    degree.set(c.to, (degree.get(c.to) ?? 0) + 1)
  }

  // A capstone requires most of the topic by design, so drawing its every
  // prerequisite fans a line in from every layer at once and turns the busiest
  // part of the figure into a hairball — the one node whose position matters
  // most becomes the least readable.
  //
  // Two cuts, because the first alone was not enough. Keeping the whole
  // immediately-preceding layer still fanned when that layer was wide, and the
  // worst offenders were its HUBS: a node that already carries many links sits
  // in the densest part of the figure, so its extra line to the capstone is
  // the one that costs most and says least — that it feeds the capstone is
  // already legible from the chain it anchors. So:
  //
  //   1. only predecessors exactly one depth level below survive at all, and
  //   2. of those, the LEAST connected few are drawn, up to a hard budget.
  //
  // Sorted by degree ascending with the id as a deterministic tie-break, so
  // the same graph always keeps the same links (see the determinism rule at
  // the top of this file). The budget is a floor as well as a ceiling: a
  // capstone with any adjacent predecessor at all keeps at least one link and
  // is never left floating.
  const threshold = convergenceThreshold(kept.length)
  const inDegree = new Map<string, number>()
  for (const c of candidates) inDegree.set(c.to, (inDegree.get(c.to) ?? 0) + 1)
  const capstones = new Set(
    kept.filter((id) => graph.nodes[id]?.capstone === true || (inDegree.get(id) ?? 0) >= threshold),
  )
  const capstoneIncoming = new Map<string, string[]>()
  const keptEdgeKeys = new Set<string>()
  let elidedCapstoneEdges = 0

  for (const c of candidates) {
    if (!capstones.has(c.to)) continue
    const list = capstoneIncoming.get(c.to)
    if (list) list.push(c.from)
    else capstoneIncoming.set(c.to, [c.from])
  }
  for (const [cap, preds] of capstoneIncoming) {
    const capDepth = depth.get(cap) ?? 0
    const adjacent = preds.filter((p) => capDepth - (depth.get(p) ?? 0) === 1)
    const chosen = adjacent
      .slice()
      .sort((a, b) => (degree.get(a) ?? 0) - (degree.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, MAX_CAPSTONE_LINKS)
    for (const p of chosen) keptEdgeKeys.add(`${p}\u0000${cap}`)
    elidedCapstoneEdges += preds.length - chosen.length
  }

  // Rescue pass: a predecessor whose ONLY link is into a convergence point
  // would be stranded as a floating dot by the budget above, and it lost its
  // place on nothing more principled than an alphabetical tie-break. A cell
  // with no line reads as a rendering fault rather than as "this concept
  // connects only to the synthesis", so its one link is always drawn.
  //
  // This cannot reopen the fan it just closed: it only fires for nodes with a
  // single link in the entire graph, so it adds at most one line each and
  // never for the hubs the budget exists to cut. On the author's own
  // grad-classical-mechanics exactly one node qualifies.
  const drawnDegree = new Map<string, number>()
  for (const c of candidates) {
    const isCapEdge = capstones.has(c.to) || capstones.has(c.from)
    const kept =
      !isCapEdge ||
      (capstones.has(c.to)
        ? keptEdgeKeys.has(`${c.from}\u0000${c.to}`)
        : Math.abs((depth.get(c.to) ?? 0) - (depth.get(c.from) ?? 0)) === 1)
    if (!kept) continue
    drawnDegree.set(c.from, (drawnDegree.get(c.from) ?? 0) + 1)
    drawnDegree.set(c.to, (drawnDegree.get(c.to) ?? 0) + 1)
  }
  for (const c of candidates) {
    if (!capstones.has(c.to) || capstones.has(c.from)) continue
    if (keptEdgeKeys.has(`${c.from}\u0000${c.to}`)) continue
    if ((drawnDegree.get(c.from) ?? 0) > 0) continue
    keptEdgeKeys.add(`${c.from}\u0000${c.to}`)
    drawnDegree.set(c.from, 1)
    elidedCapstoneEdges--
  }

  const edges: ConstellationEdge[] = []
  for (const c of candidates) {
    if (capstones.has(c.to)) {
      if (!keptEdgeKeys.has(`${c.from}\u0000${c.to}`)) continue
    } else if (capstones.has(c.from)) {
      // The mirror case — a capstone that is itself a prerequisite for
      // something later. Rare, and the same reasoning applies: only the
      // immediately-following layer is worth a line.
      if (Math.abs((depth.get(c.to) ?? 0) - (depth.get(c.from) ?? 0)) !== 1) {
        elidedCapstoneEdges++
        continue
      }
    }
    const a = pos.get(c.from)!
    const b = pos.get(c.to)!
    edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }

  // Shrink with density so a big graph stays a field of marks, not a smear.
  const r = Math.max(1.1, Math.min(3.2, 3.2 - kept.length / 45))
  return { nodes, edges, r, truncated, elidedCapstoneEdges }
}
