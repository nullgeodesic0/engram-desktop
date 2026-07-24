# Topic Map Rework — "Ink Plate" 2D Cajal Atlas

**Date:** 2026-07-23
**Status:** Approved (design sections approved in brainstorming)

## Problem

The Topic Map's job, per the user, is **progress** — feeling how far along a topic is. Four confirmed obstacles: (1) node states don't read at a glance (cool/warm dots + brightness are too subtle); (2) no sense of territory — dots in space, progress has no shape; (3) no numbers — the graph gives no "12/33 encoded, 5 decaying" readout; (4) the 3D orbit camera, label clutter, and settings knobs are fiddly enough to get in the way of reading anything.

User decision: **replace the 3D WebGL orbit scene with a 2D pan/zoom ink atlas** ("freeform ink plate" variant — organic force layout, not left→right layers). The three.js/bloom stack retires.

## Design

### Rendering and layout

- `GraphView.tsx` is rewritten as a 2D **SVG** scene. One `<svg>` filling the container, with a single transform group for pan/zoom: wheel zooms toward the cursor, background drag pans. No other camera controls.
- SVG rationale: topic graphs are 19–39 nodes; SVG gives CSS-token theming, real DOM hover/click, crisp text labels, and removes WebGL context-loss handling entirely.
- **Layout:** reuse the existing 2D force simulation (`graph3d/layout.ts` already simulates X/Y only). Seeded deterministic initial scatter, run to convergence synchronously on topic load, then frozen — the same topic always draws the same plate. Node dragging and the force/display sliders are removed. The rest of `graph3d/` (three.js scene code) is deleted.
- **Cajal cell glyphs:** each node is an irregular seeded blob body (the `InkNode` technique at map scale, radius scaled by degree as today) with 2–4 short dendrite stubs drawn toward the directions of its actual edges — cells visibly reach toward their connections.
- **Edges:** `requires` = gently curved solid ink strokes; `derives_from` / `contrasts_with` / `analogous_to` keep their existing dash styles and colors. The hub/capstone edge suppression (including the "genuine final requires edge" exception) carries over unchanged.

### Progress encoding

- **State → ink:** outlined = `new` (untouched), half-inked = `learning` (encoding), fully inked = `review` (consolidated). Fill opacity = live FSRS retrievability (fading ink = decaying memory, from the existing `decay()` data). Red stipple ring = lapsed (lapses > 0). Dashed outline = threshold node. Pulsing warm ring = frontier ("learn next", existing `computeFrontierIds` logic).
- **Capstone as seal:** the capstone is not a normal node — it renders as a distinct larger sealed emblem (cartouche) whose border arc fills proportionally to consolidated prerequisites. Its fan-in edges stay hidden per the existing hub suppression.
- **Territory washes:** nodes are grouped by nearest layer-0 (foundational) ancestor; each group gets a soft blurred hull wash drawn behind it, warmth/opacity scaled by the group's consolidated fraction. Territory fills in as the learner progresses.
- **Progress readout:** a fixed panel on the map (fig-caption / StatBlock styling from the Night Atlas foundation): encoded N of M, consolidated %, decaying count (retrievability below threshold), capstone N/M prerequisites unlocked.

### Interaction

Kept, unchanged in semantics: hover/selection first-order purple ancestor + orange descendant trails (as fixed in commits 1aa5ec0/5fd18a2); click → existing node detail drawer; double-click → existing node modal; search dims non-matches; deep-link (`goToNode`) pans/zooms to the node; topic selector pills.

Removed: the Graph Settings panel (filters, force sliders, display sliders, label mode, hub-links toggle — hub suppression becomes always-on), node dragging, Reset/Settle buttons. The legend shrinks to glyph samples (outlined/half/full ink, dashed threshold, frontier ring, lapsed stipple, capstone seal).

Labels: SVG text, zoom-dependent visibility (all labels at close zoom, high-degree + relevant-to-hover labels when zoomed out), replacing the per-frame HTML projection overlay.

## Non-goals

- No changes to graph data, engram.py, IPC surface, or TopicMapView's drawer/modal content.
- No layout editing/persistence; no 3D mode toggle — the 3D scene is fully retired.
- No changes to NeuralField or other WebGL surfaces elsewhere in the app.

## Verification

- Per task: `npm run typecheck && npm run build` clean in `EngramDesktop/app` (no test framework).
- Final interactive pass: open each of the four real topics; confirm states read at a glance, territory washes render, readout numbers match `topic-status`; hover trails are first-order in both directions; capstone renders as seal with no fan-in clutter; search, drawer, modal, and deep-link from the command palette all work; pan/zoom is smooth.
- Packaged rebuild/reinstall via the standard sequence, checking for live learning sessions first.
