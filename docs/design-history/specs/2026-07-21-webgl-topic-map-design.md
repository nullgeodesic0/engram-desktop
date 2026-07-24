# WebGL Topic Map — Design

## Context

`GraphView.tsx` (the Topic Map's force-directed dependency graph) has been a plain SVG renderer since M5, with its drag/zoom/pan/hover/force-slider interaction model stabilized and re-verified across several later milestones (M11's frontier/path highlighting, M18's search deep-linking). The plan had explicitly deferred a full WebGL rewrite three times specifically to avoid regressing that interaction model. This spec is that rewrite, scoped to contain the risk to the render layer and camera model only — the physics simulation, drag state machine, search/filter logic, and node-detail modal are reused verbatim.

The goal, per the user's request, is twofold: make the map "beautifully rendered" (leaning into the app's existing neural/consolidation visual language, already established in `NeuralField.tsx` and the boot splash) and make it "more useful for navigation and visualizing understanding and knowledge" — i.e. surface real learning-state data, not just decoration.

## Decisions (from brainstorming Q&A)

- **Rendering ambition:** pseudo-3D depth, not flat 2D-with-WebGL-glow. Chosen over the lower-risk 2D option after the concept was clarified.
- **Z axis meaning:** dependency depth (foundational nodes near camera, capstone farthest), computed from the existing `layersOf()` helper. Not mastery/decay — that would compete with dependency depth for the same axis, since a forgotten foundational node would want to be both "near" (structurally) and "far" (by decay).
- **Camera model:** constrained orbit (drag rotates within a limited range, scroll zooms/dollies), not a free-fly 3D camera. Chosen specifically to preserve precise node-dragging and avoid the camera ever "getting lost."
- **Knowledge visualization depth:** real FSRS-driven retrievability (`r_now` from `engram.py decay`), not just the existing 3-state (new/learning/review) color bucket. This is the actual "visualizing understanding" payoff — glow dims continuously as a node's real memory decays toward its due date, not in three discrete steps.
- **Navigation features in scope:** smooth camera fly-to on select/search, and a richer animated (flowing-pulse) version of the existing path-to-capstone highlight. A cross-topic "universe view" was considered and explicitly **not** chosen — scope stays per-topic, matching today's Topic Map.

## Architecture

### Component boundary

`GraphView.tsx` is fully replaced internally but keeps its existing external contract, plus one additive prop:

```ts
interface GraphViewProps {
  graph: TopicGraph
  selected: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  edgeFilter: Record<EdgeKind, boolean>
  query: string
  params: ForceParams
  retrievability: Map<string, number> | null  // NEW — see "Retrievability data" below
}
```

`TopicMapView.tsx` changes are additive only: fetch decay data alongside the graph, pass it down, no change to the settings panel, search bar, edge-filter checkboxes, or node-detail modal.

### Simulation (reused, unchanged)

The existing per-frame force simulation (`tick()` in current `GraphView.tsx`) — all-pairs repulsion, spring edges with per-edge-kind target distance/strength, weak centering pull, drag-node pinning via `fx`/`fy` — is reused as-is for X/Y. It already writes into a `Map<string, SimNode>` each frame; the only addition is a static `z` field set once per graph load (not touched by the simulation), computed from `layersOf()`:

```
z = lerp(Z_NEAR, Z_FAR, layer / maxLayer)
```

### Camera & controls

A `THREE.PerspectiveCamera` orbiting a fixed look-at target (the graph's centroid, recomputed on reheat/resize):
- **Orbit drag** (pointer down on empty space + move): adjusts azimuth/elevation within clamped ranges (e.g. elevation ±40°, azimuth free 360° — a full spin around the "diorama" is fine, just no flipping over the top/bottom).
- **Scroll**: adjusts orbit radius (dolly), clamped to a min/max distance — replaces today's `transform.k` zoom.
- **Node drag** (pointer down on a node): unchanged in spirit — projects the pointer to the node's *own* depth plane (a plane at that node's current Z, perpendicular to the camera's view direction) and sets `fx`/`fy` in that plane's local X/Y, exactly like today's `screenToWorld`. The node's Z never changes from a drag.
- **Fly-to** (select via click/search/command-palette/deep-link): eases the orbit target and radius toward centering the selected node over ~500ms (a simple cubic-ease tween on target/radius/azimuth/elevation, no physics needed).

This reuses the existing `dragState` ref/pointer-capture pattern from the current implementation; only the math each branch does (2D transform vs. 3D orbit/plane-projection) changes.

### Rendering

- **Nodes**: `THREE.Points` or one sprite per node (topic sizes are small — a few dozen nodes — so individual `THREE.Sprite` objects are simpler than instancing and plenty performant), using the same radial-gradient glow-texture technique as `NeuralField.tsx`'s `makeGlowTexture()`. Color/size logic ports directly from today's `nodeFill()`/radius calc; brightness additionally scales with retrievability (see below).
- **Edges**: `Line2` + `LineSegmentsGeometry` + `LineMaterial` (already a dependency via `NeuralField.tsx` and the three.js examples imports) for real screen-space line width, preserving the current per-edge-kind stroke/dash-equivalent/width styling. True dashing isn't native to `LineMaterial` in a way that matches SVG `stroke-dasharray` — approximate `derives_from`/`contrasts_with`/`analogous_to`'s "lighter/thinner" distinction via opacity and width rather than literal dash patterns; a small, acceptable visual delta from today.
- **Bloom**: `EffectComposer` + `RenderPass` + `UnrealBloomPass` (three.js examples, same import pattern already used for `Line2`) for the actual glow look. Bloom strength/radius/threshold tuned so it reads as "glowing orbs," not a blown-out haze.
- **Labels**: one absolutely-positioned HTML `<div>` per currently-visible label (same visibility rule as today: `showLabels` mode + hover/selected/size threshold), positioned every frame via `camera.project()` on the node's current 3D position mapped to container-relative screen coordinates. Reuses existing typography/CSS tokens directly — no canvas-texture text, no font-atlas work.
- **Path-to-capstone trail**: the existing BFS path computation (`pathToCapstone`) is unchanged; rendering adds an animated flowing-pulse look along the path's edges — a moving bright segment (or a shader-driven scrolling opacity band) traveling from the highlighted node toward the capstone, looping. Implementation detail to nail down during build: simplest viable version is a small bright sprite that animates its position along the path's polyline each frame (t = (elapsed / duration) % 1), which avoids needing a custom shader.
- **Frontier rings**: port directly — a pulsing ring sprite/mesh around frontier nodes, reusing the existing `animate-consolidate-ping`-equivalent timing, now as a three.js object instead of an SVG circle with a CSS animation class.

### Retrievability data

`engram.py decay --topic <t>` already computes real per-node `r_now` (current retrievability, 0–1) from FSRS stability + time-since-last-review — this is read directly rather than reimplemented client-side. `TopicMapView.tsx` calls the already-exposed `window.engram.decay(selectedTopic)` alongside its existing `topicGraph` fetch, builds a `Map<nodeId, number>` from the response's `nodes[].r_now`, and passes it to `GraphView` as the new `retrievability` prop. Nodes with no FSRS history yet (state `new`) have no meaningful `r_now` — `GraphView` treats a missing map entry as "full brightness, no decay effect" (a `new` node's glow is driven by its state color alone, not decay, since it has nothing to decay from yet).

Brightness formula (tunable during build, not exact from this spec): `finalBrightness = baseBrightnessForState * (0.4 + 0.6 * (retrievability ?? 1))` — so even a fully-decayed review node stays dimly visible (never fully invisible), and a freshly-reviewed node reads clearly brighter than one approaching its due date.

Lapses (`fsrs.lapses > 0`) get a subtle accent (e.g. a thin red-tinted ring or a slight desaturation), read directly from the existing `TopicGraph` node data already being fetched — no new IPC needed for this part.

### Settings panel

`TopicMapView.tsx`'s existing force-slider panel (center/repel/link force, link distance, node size, link thickness, label size, show-labels mode, arrows toggle) is kept as-is; all of those still map onto the X/Y simulation and node/edge sizing exactly as today. The "arrows" toggle's rendering changes from SVG `marker-end` to a small cone/sprite at the edge's target end in 3D, but the toggle's meaning is unchanged.

## Data flow

```
TopicMapView
  ├─ window.engram.topicGraph(topic)   (existing)
  ├─ window.engram.decay(topic)        (existing IPC, newly consumed here)
  │      → Map<nodeId, r_now>
  └─ passes graph + retrievability + existing props → GraphView (three.js scene)
```

No new IPC handlers, no new main-process code — this is a renderer-only change plus one new consumer of an already-exposed read.

## Error handling / fallback

- If `window.engram.decay(topic)` fails or a topic has zero due-relevant history, `GraphView` falls back to `retrievability = null` (or an empty map) and nodes render at full state-driven brightness with no decay dimming — never a hard failure or blank graph.
- WebGL context loss (rare, but possible on some hardware/driver combos): listen for the `webglcontextlost` event on the canvas and show a small inline "Graph rendering paused — reload to restore" notice rather than a silent blank panel, consistent with how the app already surfaces the environment-check screen rather than failing silently.
- Empty/single-node topics: centroid/orbit-target math must not divide by zero or produce NaN camera targets — guard with a minimum bounding-sphere radius.

## Testing / verification

- Visual + interaction smoke test against real in-progress topics (grad-classical-mechanics, grad-quantum-mechanics, Lenin WITBD) covering: drag-to-orbit, scroll-to-zoom, node drag repositioning within its depth plane, click-select, double-click-to-open, hover dimming/neighbor-highlight, search-driven dimming, all four edge-kind filters, every force/display slider, fly-to on search result selection and on command-palette deep-link.
- Cross-check: a node's rendered brightness ordering matches its real `r_now` ordering from a direct `engram.py decay` call for the same topic (spot-check a few nodes, not full automation — same verification style used for M12's streak calendar).
- Confirm frontier rings and the path-to-capstone trail match the same logical set the current SVG implementation would highlight, for a real in-progress topic.
- Confirm typecheck (`npm run typecheck`) and build (`npm run build`) both pass, then a packaged rebuild (`npm run dist:mac`) reinstalled and exercised the same way `npm run dev` was, per the project's established manual-verification pattern for renderer changes.

## Explicitly out of scope

- Cross-topic "universe view" (all topics visible/navigable at once) — considered, not chosen.
- Free-fly 3D camera — constrained orbit only.
- True dashed-line rendering for non-`requires` edge kinds (approximated via opacity/width instead).
- Any change to the node-detail modal, settings panel layout, or edge-filter logic beyond passing through the new `retrievability` prop.
