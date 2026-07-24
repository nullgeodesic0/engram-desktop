# Ink Plate Topic Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3D WebGL orbit Topic Map with a 2D pan/zoom SVG "ink plate" — Cajal cell glyphs, territory washes, capstone seal, progress readout — per `docs/superpowers/specs/2026-07-23-topic-map-ink-plate-design.md`.

**Architecture:** A new pure module `components/graph2d/plate.ts` computes the settled layout, glyph paths, territories, and progress stats. `GraphView.tsx` is rewritten as an SVG renderer consuming it (Task 2 static, Task 3 interaction). `TopicMapView.tsx` drops the settings panel and gains the readout (Task 4). The three.js graph code retires where unshared (Task 5).

**Tech Stack:** React 19 + SVG (no three.js in the map). Reuses `graph3d/layout.ts` pure functions (`buildEdges`, `initSimNodes`, `stepSimulation`, `layersOf`, `computeFrontierIds`, `computeHubNodeIds`, `computeForwardAdjacency`) and `graph3d/types.ts` (`EDGE_STYLE`, `SimEdge`, `EdgeKind`, `DEFAULT_FORCE_PARAMS`).

## Global Constraints

- No changes to graph data, engram.py, IPC, or the drawer/modal content in TopicMapView.
- Interaction semantics preserved exactly: first-order hover trails (purple = direct `requires` prerequisites, orange = direct dependents, hub nodes excluded, every trail edge touches the hovered node — see commits 1aa5ec0/5fd18a2), click → drawer, double-click → modal, search dims non-matches, deep-link pans to node.
- Hub/capstone edge suppression always-on (port the exact predicate from the old GraphView lines ~713-730, including the "genuine final requires edge" exception where the source has ≤1 dependent).
- `three` stays a dependency (NeuralField uses it); `webgl/glowTexture.ts` stays (NeuralField imports it).
- No test framework: every task verifies `npm run typecheck && npm run build` clean in `app`. `noUnusedLocals: true`.
- Colors via CSS variables only. Node-state semantics unchanged: `new` = untouched, `learning` = encoding, `review` = consolidated; retrievability map (`null` → full ink) from `window.engram.decay`.
- Work on `master`; commit per task with the given message.

---

### Task 1: `graph2d/plate.ts` — pure plate computations

**Files:**
- Create: `app/src/renderer/src/components/graph2d/plate.ts`

**Interfaces:**
- Consumes: `graph3d/layout.ts` (`buildEdges`, `initSimNodes`, `stepSimulation`, `layersOf`, `seeded`) and `graph3d/types.ts` (`SimEdge`, `DEFAULT_FORCE_PARAMS`).
- Produces (consumed by Tasks 2-4):
  - `settlePlate(graph: TopicGraph, width: number, height: number): Map<string, PlateNode>` where `PlateNode = { x: number; y: number; r: number }`
  - `cellBodyPath(id: string, r: number): string` (SVG path, blob centered at 0,0)
  - `dendriteStubs(id: string, pos: {x;y}, neighborDirs: {x;y}[], r: number): string[]` (SVG paths in plate coordinates)
  - `territoryGroups(graph: TopicGraph): Map<string, string[]>` (layer-0 root id → member node ids, capstone excluded)
  - `hullPath(points: {x;y}[], padding: number): string`
  - `plateStats(graph: TopicGraph, retrievability: Map<string, number> | null): { total; encoded; consolidated; decaying; capstonePrereqsMet; capstonePrereqsTotal }`

- [ ] **Step 1: Write the module**

```ts
import type { TopicGraph } from '../../../shared/types'
import { buildEdges, initSimNodes, stepSimulation, layersOf, seeded } from '../graph3d/layout'
import { DEFAULT_FORCE_PARAMS } from '../graph3d/types'

export interface PlateNode {
  x: number
  y: number
  r: number
}

/** Run the existing X/Y force simulation to convergence once and freeze it —
 * the plate is a fixed specimen, not a live sim. Deterministic per topic via
 * the seeded scatter in initSimNodes. */
export function settlePlate(graph: TopicGraph, width: number, height: number): Map<string, PlateNode> {
  const edges = buildEdges(graph)
  const sim = initSimNodes(graph, edges, width / 2, height / 2)
  let alpha = 1
  for (let i = 0; i < 300 && alpha > 0.005; i++) {
    stepSimulation(sim, edges, DEFAULT_FORCE_PARAMS, alpha, width / 2, height / 2)
    alpha *= 0.985
  }
  const out = new Map<string, PlateNode>()
  for (const [id, n] of sim) out.set(id, { x: n.x, y: n.y, r: n.r })
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
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(id)
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
  capstonePrereqsMet: number
  capstonePrereqsTotal: number
} {
  let total = 0
  let encoded = 0
  let consolidated = 0
  let decaying = 0
  let capstonePrereqsMet = 0
  let capstonePrereqsTotal = 0
  for (const id of graph.order) {
    const node = graph.nodes[id]
    if (!node) continue
    if (node.capstone) {
      const reqs = node.edges.requires ?? []
      capstonePrereqsTotal = reqs.length
      capstonePrereqsMet = reqs.filter((r) => graph.nodes[r] && graph.nodes[r].state !== 'new').length
      continue
    }
    total++
    if (node.state !== 'new') encoded++
    if (node.state === 'review') consolidated++
    const r = retrievability?.get(id)
    if (r != null && r < 0.7 && node.state !== 'new') decaying++
  }
  return { total, encoded, consolidated, decaying, capstonePrereqsMet, capstonePrereqsTotal }
}
```

- [ ] **Step 2: Check `seeded` is exported from `graph3d/layout.ts`**

It is (`export function seeded`). If any of the imported names differ, match the real exports rather than editing layout.ts.

- [ ] **Step 3: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/src/components/graph2d/plate.ts
git commit -m "feat(map): graph2d plate module — settled layout, glyphs, territories, stats"
```

---

### Task 2: GraphView SVG rewrite — static plate

**Files:**
- Rewrite: `app/src/renderer/src/components/GraphView.tsx` (full replacement)

**Interfaces:**
- Consumes: everything from Task 1; `graph3d/layout.ts` (`buildEdges`, `computeFrontierIds`, `computeHubNodeIds`, `computeForwardAdjacency`); `graph3d/types.ts` (`EDGE_STYLE`, `EdgeKind`, `SimEdge`); `humanizeNodeId`.
- Produces the NEW props contract (Task 4 updates the caller):
  ```ts
  interface GraphViewProps {
    graph: TopicGraph
    selected: string | null
    onSelect: (id: string) => void
    onOpen: (id: string) => void
    query: string
    retrievability: Map<string, number> | null
  }
  ```
  `edgeFilter` and `params` props are GONE. Keep `export { EDGE_STYLE }` and `export type { EdgeKind }` for TopicMapView's legend; DELETE the `DEFAULT_FORCE_PARAMS`/`ForceParams` re-exports (Task 4 removes their uses).

- [ ] **Step 1: Rewrite the component as SVG**

Full replacement of GraphView.tsx. Requirements, concretely:

1. **Scene structure:** a `<div ref={containerRef} className="relative h-full w-full overflow-hidden">` containing one `<svg className="h-full w-full">` with a single `<g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>`. All plate content inside that group. Measure the container once on mount (`getBoundingClientRect`) for `settlePlate(graph, w, h)`; recompute via `useMemo` on `[graph]` (plus a container-size state set on mount).
2. **Pan/zoom state:** `const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })`. Wheel handler: `zoom *= Math.exp(-e.deltaY * 0.0015)` clamped to `[0.35, 4]`, adjusting `x`/`y` so the point under the cursor stays fixed (standard `newPan = mouse - (mouse - oldPan) * (newZoom / oldZoom)`). Background pointer-drag pans (pointerdown on the svg background rect, move deltas onto `x`/`y`). Attach wheel via a non-passive listener (`useEffect` + `addEventListener('wheel', h, { passive: false })`, `preventDefault()`); pointer events can be React props.
3. **Render order inside the group (bottom to top):** territory washes → edges → dendrite stubs → cell bodies → rings/decorations → labels.
4. **Territory washes:** for each `territoryGroups` entry, `hullPath` over member positions with padding 26, `fill="var(--color-ink-warm)"`, `fillOpacity={0.03 + 0.09 * consolidatedFraction}` (fraction of members with `state === 'review'`), `stroke="none"`, with `filter="url(#plate-blur)"` — define `<filter id="plate-blur"><feGaussianBlur stdDeviation="14" /></filter>` in `<defs>`.
5. **Edges:** for each `SimEdge` (from `buildEdges`), skip when the hub-suppression predicate hides it — port the predicate verbatim from the old file (any edge touching a hub id is hidden EXCEPT `kind === 'requires' && target === hubId && (forwardAdjacency.get(source)?.length ?? 0) <= 1`). `requires` edges render as a quadratic curve bowed 8% of the segment length perpendicular to its midpoint (seeded sign per edge key so the bow is stable); other kinds render straight with their `EDGE_STYLE` dash patterns. Stroke = the `EDGE_STYLE` color for the kind, `strokeOpacity` 0.35, width 1.1 (in plate units — `vector-effect="non-scaling-stroke"` is NOT used, so ink thickens naturally as you zoom, like a real plate).
6. **Cell glyphs per node:** a `<g transform={translate}>` containing `cellBodyPath(id, r)`:
   - `new`: `fill="none"`, `stroke` state color, strokeWidth 1.2.
   - `learning`: same outline PLUS the same path again with `fill` and `clip-path` to its lower half — define per-node `<clipPath id={`half-${id}`}><rect x={-r*1.6} y={0} width={r*3.2} height={r*1.6}/></clipPath>` — the half-inked cell.
   - `review`: solid `fill`.
   - Fill/stroke color: `new` → `var(--color-ink-cool-dim)`, `learning` → `var(--color-ink-cool)`, `review` → `var(--color-ink-warm)`.
   - `fillOpacity = 0.35 + 0.65 * (retrievability.get(id) ?? 1)` — fading ink for decaying memory (applies to the filled portion only).
   - Threshold nodes: `strokeDasharray="3 2.5"` on the outline.
   - Lapsed (`fsrs.lapses > 0`): a stipple ring — 8 tiny circles (`r=0.8`) evenly placed on a circle of radius `r + 3.5`, `fill="var(--color-ink-danger)"`, opacity 0.7.
   - Frontier ids (`computeFrontierIds`): a `<circle r={r + 5}>` with `stroke="var(--color-ink-warm)"`, `fill="none"`, `className="plate-frontier-ring"` — add to index.css a gentle `@keyframes frontier-breathe { 0%,100% { opacity: 0.35 } 50% { opacity: 0.9 } }` + `.plate-frontier-ring { animation: frontier-breathe 2.6s ease-in-out infinite; }`.
   - Dendrite stubs: `dendriteStubs(id, pos, dirsToNeighbors, r)` where dirs are `neighborPos - pos` for up to 4 non-hub neighbors (any edge kind, visible edges only); stroke = the node's state color, opacity 0.45, width 1, `fill="none"`.
7. **Capstone seal:** the capstone node (if `graph.nodes[id].capstone`) renders instead as: a double ring (`r+4` and `r`, stroke `var(--color-ink-warm)`), an unlock arc on the outer ring — `strokeDasharray` computed as `fraction * circumference` / remainder, rotated -90° — where fraction = capstonePrereqsMet/capstonePrereqsTotal from `plateStats`, and a small inner `cellBodyPath(id, r * 0.55)` filled warm at opacity `0.25 + 0.75 * fraction`. No dendrite stubs, and its edges are already suppressed.
8. **Labels:** `<text>` per node, `x={r + 6}`, `fontSize={11 / view.zoom}` clamped to `[8, 13]` so labels stay readable but don't balloon; `fill="var(--color-text-dim)"`, `fontFamily="var(--font-body)"`. Visibility: always when `view.zoom >= 1.1`; below that, only nodes whose `r` is in the top 8 by radius. (`selected`/query relevance forcing arrives with Task 3's interaction pass — at this task's end, labels are zoom/size-driven only.)
9. **Search dim:** nodes (and their labels/stubs) whose id, `humanizeNodeId(id)`, and `claim` all fail a case-insensitive match against non-empty `query` get `opacity={0.18}` on their glyph group. Same match rule as the old file.
10. **Selection:** clicking a cell calls `onSelect(id)`; double-click calls `onOpen(id)`; the selected node gets `stroke="var(--color-text-primary)"` strokeWidth 1.8 on its body outline. (Full hover trails are Task 3.)
11. Delete from the file: all three.js/orbit/bloom/glow imports and code, the context-lost fallback, the HTML label overlay, `retrievabilityBrightness`. Keep the component name and default-style export shape.

- [ ] **Step 2: Temporary caller compatibility**

TopicMapView still passes `edgeFilter`/`params` props until Task 4. To keep typecheck green WITHOUT changing TopicMapView in this task, accept-and-ignore them: add `edgeFilter?: unknown` and `params?: unknown` to the new props interface with a `// removed in Task 4` comment, and do not read them.

- [ ] **Step 3: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/src/components/GraphView.tsx app/src/renderer/src/index.css
git commit -m "feat(map): rewrite GraphView as 2D SVG ink plate (static render)"
```

---

### Task 3: Plate interaction — hover trails, pan-to-selected

**Files:**
- Modify: `app/src/renderer/src/components/GraphView.tsx`

**Interfaces:**
- Consumes Task 2's structure. No props changes.

- [ ] **Step 1: Hover state + first-order trails**

1. `const [hovered, setHovered] = useState<string | null>(null)`; cell `<g>` gets `onPointerEnter`/`onPointerLeave`. `const active = hovered ?? selected`.
2. Trail sets (exact semantics from the old file, commits 1aa5ec0/5fd18a2):
   ```ts
   const ancestorSet = active ? new Set((graph.nodes[active]?.edges.requires ?? []).filter((id) => !hubIds.has(id))) : null
   const descendantSet = active ? new Set((forwardAdjacency.get(active) ?? []).filter((id) => !hubIds.has(id))) : null
   ```
3. Trail rendering: re-draw the matching `requires` edges ON TOP (after cell bodies) with `stroke="#a78bda"` (ancestor: edges where `target === active && ancestorSet.has(source)`) and `stroke="#e8a857"` (descendant: `source === active && descendantSet.has(target)`), width 2, opacity 0.9, `className="plate-trail"` — add `@keyframes trail-breathe { 0%,100% { opacity: 0.5 } 50% { opacity: 1 } }` + `.plate-trail { animation: trail-breathe 1.6s ease-in-out infinite; }` to index.css. Use the same curved geometry as the base edge.
4. Dim non-relevant while `active`: glyph groups not in `{active} ∪ ancestorSet ∪ descendantSet` get opacity 0.22 (compose with search dim: `Math.min` of the two).
5. Label relevance: labels for `active ∪ ancestorSet ∪ descendantSet` are always visible regardless of zoom; and the `selected` node's label uses `fill="var(--color-text-primary)"`.

- [ ] **Step 2: Pan-to-selected**

When `selected` changes to a non-null id (deep-link or drawer navigation), animate `view` over ~450ms (ease-out cubic via `requestAnimationFrame`) so the node centers at zoom `max(view.zoom, 1.3)`. Cancel any in-flight animation on user pan/zoom input or a newer selection.

- [ ] **Step 3: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 4: Commit**

```bash
git add app/src/renderer/src/components/GraphView.tsx app/src/renderer/src/index.css
git commit -m "feat(map): plate hover trails, relevance dimming, pan-to-selected"
```

---

### Task 4: TopicMapView — readout panel, settings removal, new legend

**Files:**
- Modify: `app/src/renderer/src/app/TopicMapView.tsx`
- Modify: `app/src/renderer/src/components/GraphView.tsx` (drop the temporary `edgeFilter?`/`params?` props)

**Interfaces:**
- Consumes: `plateStats` (Task 1), `StatBlock` (`../components/ui/StatBlock`), `.fig-caption`.

- [ ] **Step 1: Remove the settings machinery**

In TopicMapView.tsx: delete the Graph Settings collapsible panel JSX, `edgeFilter` state, `forceParams` state, `GRAPH_SETTINGS_KEY` localStorage load/save effect and `loadStoredGraphSettings`, the `DEFAULT_FORCE_PARAMS`/`ForceParams` imports, and the Reset/Settle buttons if present. Update the `<GraphView>` call site to the new 6-prop contract. Then in GraphView.tsx remove the temporary `edgeFilter?`/`params?` props and, if now unused, the `EDGE_STYLE`/`EdgeKind` re-exports (keep them only if the legend below still imports them).

- [ ] **Step 2: Progress readout panel**

Floating panel, top-right (where Graph Settings sat): compute `const stats = useMemo(() => (graph ? plateStats(graph, retrievability) : null), [graph, retrievability])`, render when non-null:

```tsx
<div className="panel absolute top-4 right-4 z-10 p-3 w-52 flex flex-col gap-2">
  <div className="fig-caption">Fig. — state of the territory</div>
  <div className="grid grid-cols-2 gap-2">
    <StatBlock label="Encoded" value={`${stats.encoded}/${stats.total}`} tone="cool" />
    <StatBlock label="Consolidated" value={`${Math.round((stats.consolidated / Math.max(1, stats.total)) * 100)}%`} tone="warm" />
    <StatBlock label="Decaying" value={String(stats.decaying)} tone={stats.decaying > 0 ? 'violet' : 'neutral'} />
    <StatBlock label="Capstone" value={`${stats.capstonePrereqsMet}/${stats.capstonePrereqsTotal}`} tone="neutral" />
  </div>
</div>
```

- [ ] **Step 3: New legend**

Replace the old legend's swatch rows with glyph samples rendered as small inline SVGs using `cellBodyPath` (import from `graph2d/plate`): outlined cell "not started", half-inked "encoding", filled "consolidated", dashed outline "threshold", ring "learn next", stippled "lapsed", double-ring "capstone seal". Keep the `double-click to open` hint line.

- [ ] **Step 4: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/renderer/src/app/TopicMapView.tsx app/src/renderer/src/components/GraphView.tsx
git commit -m "feat(map): progress readout, glyph legend, settings panel removed"
```

---

### Task 5: Retire the unshared 3D machinery

**Files:**
- Delete: `app/src/renderer/src/components/graph3d/orbitCamera.ts`
- Possibly modify: `app/src/renderer/src/components/graph3d/types.ts` (only if `ForceParams`/`DEFAULT_FORCE_PARAMS` became unused — check first)

**Interfaces:** none produced.

- [ ] **Step 1: Delete orbitCamera.ts** — first `grep -rn "orbitCamera" app/src` to confirm zero remaining imports; then delete.

- [ ] **Step 2: Check types.ts and layout.ts for dead exports**

`grep -rn "DEFAULT_FORCE_PARAMS\|ForceParams\|stepSimulation" app/src` — `plate.ts` still uses `DEFAULT_FORCE_PARAMS` and `stepSimulation`, so they stay. Remove only exports with zero remaining importers (likely none — in that case this step is a no-op; say so in the report). Do NOT touch `webgl/glowTexture.ts` (NeuralField imports it) or the `three` dependency.

- [ ] **Step 3: Verify** — `npm run typecheck && npm run build` clean.

- [ ] **Step 4: Commit**

```bash
git add -A app/src/renderer/src/components/graph3d
git commit -m "chore(map): retire orbit camera; 3D scene fully replaced by ink plate"
```

---

## Final verification (after all tasks + whole-branch review)

1. `npm run typecheck && npm run build` clean.
2. Interactive pass: open all four real topics (grad-classical-mechanics, grad-quantum-mechanics, lenin-what-is-to-be-done, us-academic-labor-rights); states read at a glance; territory washes present on multi-branch topics; readout matches `python3 engram.py topic-status`; hover trails first-order both directions; capstone renders as seal without fan-in clutter; search/drawer/modal/deep-link (⌘K → node) work; pan/zoom smooth.
3. Packaged rebuild/reinstall via the standard sequence (check live sessions first).
