# Plate Beautification — The Map as a Printed Specimen

**Date:** 2026-07-25
**Status:** Approved design (user-selected slate, all four passes)

## Goal

The ink plate draws correct ink on a flat canvas. Night Atlas's premise is a Cajal specimen plate — printed, engraved, framed. Four rendering passes close the gap between the idea and what's on screen. No data, no interaction, no layout changes.

## Constraints (binding)

- Pure rendering: node positions, hit targets, pan/zoom, drift, lenses, and every existing interaction behave identically.
- Performance: the plate re-renders at ~30fps under drift. Every effect must be static SVG defs (filters/patterns applied by reference), never per-frame recomputation. Measure: no new work inside the drift render path.
- Reduced motion and the existing lens/replay gating are untouched.
- Verification: `npm run typecheck && npm run build`, plus a rendered screenshot inspected by the controller before the round closes.

## 1. Plate grain + vignette

- A `<feTurbulence>`-based vellum grain as a single static `<defs>` filter, applied to one full-plate `<rect>` behind everything at very low opacity (target: perceptible at 100% zoom, invisible as texture noise — start ~0.035 and tune by eye).
- A radial vignette (`<radialGradient>`, transparent center → void at the rim) over the plate's outermost layer, below the overlays, so the specimen sits in a lit field rather than a flat one.
- Both live in the SVG's own coordinate space so pan/zoom moves the specimen *across* the plate rather than dragging the paper with it — the grain and vignette belong to the plate, not the drawing.

## 2. Engraved node fills

Real plates carry state in ink density, not hue alone:

- **Consolidated** (`state === 'review'`): a fine diagonal hatch `<pattern>` in warm ink over the existing fill, hatch spacing constant in screen space.
- **Encoding** (`state === 'learning'`): a sparse stipple pattern in cool ink.
- **Unencoded** (`state === 'new'`): unchanged — hollow outline, the absence of ink is the point.
- Patterns are static defs referenced by `fill`; the seeded blob path is untouched. Under the due lens, schedule color still wins (one lens at a time) — the hatch/stipple layer suppresses so the lens reads clean.

## 3. Plate furniture

- **Plate title**, upper-left inside the plate: `Fig. — <topic title>` in serif, with a mono sub-line `<N> cells · <M> consolidated`. Non-interactive, faint.
- **Hairline plate border** with corner ticks (the engraver's registration marks) just inside the container edge.
- **Legend framed as a key**: the existing legend panel gains a `Key` label and hairline rules between its rows, so it reads as figure apparatus rather than a floating tooltip.
- All furniture hides during replay (the plate is being drawn; its frame shouldn't claim it's finished) and is `pointer-events: none` except the legend's existing controls.

## 4. Calligraphic edges

- **Tapered weight**: requires-edges render as a filled path (two offset curves joined) rather than a stroked line, thick at the prerequisite end (~2.2px) thinning toward the dependent (~0.8px) — the ink leaves the pen heavy and lifts. Non-requires edges keep their current uniform hairline.
- **Arrowheads**: a small ink arrowhead at the dependent end of requires-edges, sized in screen space, suppressed on hub-suppressed edges and during replay-clipped states exactly as the current edge logic does.
- The existing `stringEdgePath` sway/drift geometry drives the taper's spine — the taper is a rendering of the same curve, so edges keep swaying identically.
- Trail overlay edges keep their current uniform bright stroke (they're an annotation on top of the drawing, not part of it).

## Out of scope

Node shape changes, layout/force changes, label typography changes (a separate concern), any new interaction.

## Verification

- Screenshot at rest and mid-drift: grain reads as paper, not noise; vignette doesn't crush the rim nodes; hatch/stipple distinguishes state at a glance and at 50% zoom.
- Arrowheads point from prerequisite to dependent on a spot-checked pair, and vanish with their edges under hub suppression and replay clipping.
- Drift stays smooth (no new per-frame path math beyond the taper, which replaces the existing stroke).
- Every lens/replay/trail combination still renders per the state matrix established last round.
