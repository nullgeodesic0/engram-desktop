# Craft Round — Performance, Typography, Motion, Onboarding, Keyboard

**Date:** 2026-07-24
**Status:** Approved design (Project B of the premium-quality round)

## Goal

Make the app feel premium in the hand: faster to start and scroll, finer in type, animated only where meaning lives, welcoming on first run, and fully drivable from the keyboard. No behavioral change to the learning loop.

## Constraints (binding)

- Philosophy untouched; no engram file writes; no new runtime dependencies (except none — code-splitting uses React.lazy and Vite config only).
- Every new animation uses the existing motion tokens (`--dur-fast`, `--dur-base`, `--ease-out-soft`) and respects `prefers-reduced-motion`.
- Verification per task: `npm run typecheck && npm run build`; bundle-size deltas recorded from build output.

## B1 — Performance

- `React.lazy` + `Suspense` for the heaviest leaves: `NeuralField` (pulls `three` out of the entry chunk), `TopicMapView`/`GraphView`, `ArtifactsView`; skeleton-style fallbacks reuse existing patterns.
- Manual vendor chunks (`katex`, `three`) in the electron-vite renderer config.
- Transcript blocks get `content-visibility: auto` + `contain-intrinsic-size` (CSS-only virtualization; marks/KaTeX layout untouched).
- RAF loops (GraphView drift, NeuralField) pause while their view is hidden (KeepMounted hidden state or `document.hidden`).
- Record before/after: entry-chunk size, total JS, cold-launch feel note.

## B2 — Typography & density

- `tabular-nums` on `label-data` and all stat/figure numerals; hairline usage audited to the token; KaTeX display-math margins tuned to the transcript rhythm; punctuation pass (true em dashes and curly quotes in prose-voice copy, straight in mono/data); optical alignment pass on glyph+label rows (beat marks, map legend, sidebar nav).

## B3 — Fitting animations

Only where they carry meaning: palette open (scale-fade, fast), history drawer entrance, chart figures draw-in once on first view, due-count chip single pulse on increase, annotation ink-in when `annotate_node` lands live. No new ambient loops. All honor reduced-motion.

## B4 — Onboarding & environment

- First-run (empty learning home): guided Home empty state with three steps — install CLI, install engram plugin, start first topic — each with copyable command and live re-check via the existing `environmentCheck`.
- Empty states audited across Learn/Review/Map/Coach/Artifacts: each states what will appear and the one action that gets you there; next-due date shown when Review is empty.
- Failure copy for missing CLI/plugin routed through `friendlyError.ts` with actionable fixes.

## B5 — Keyboard & accessibility

- Keyboard traversal: composer ⇥ transcript ⇥ nav; visible `focus-ring` on every interactive element (map legend/controls audited); `aria-label`s on ink glyphs, beat marks, stepper, traffic dots; VoiceOver sanity pass notes for Home + a session view.
- Reduced-motion verification for every B3 site.

## Out of scope

Windowing libraries; new features; any Project A rework.

## Verification

- B1: build output shows `three`/`katex` in separate chunks and a smaller entry; a 40+ message transcript scrolls smoothly.
- B2: numerals align in columns; KaTeX display blocks sit on the rhythm.
- B3: each animation fires once, from tokens, and disappears under reduced-motion.
- B4: with an empty learning home the guided first-run renders (manual QA note); every view has a purposeful empty state.
- B5: tab-only walkthrough documented; VoiceOver reads glyph labels.
