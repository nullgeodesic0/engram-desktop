# Craft Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the five Craft streams — performance, typography, fitting animations, onboarding/environment, keyboard/a11y — per `../specs/2026-07-24-craft-round-design.md`.

**Architecture:** No new features; all changes are rendering/UX-layer. Code-splitting via React.lazy + Vite manualChunks; the rest is CSS, copy, and attribute work.

**Tech Stack:** existing only.

## Global Constraints

- No new npm dependencies. No engram file writes. No learning-loop behavior change.
- New animations: motion tokens only (`--dur-fast`, `--dur-base`, `--ease-out-soft`), each fires once per trigger, all honor `prefers-reduced-motion` (global CSS kill-switch exists at index.css:79 — JS-driven animation needs its own matchMedia check, following GraphView.tsx:134).
- Verification per task: `cd app && npm run typecheck && npm run build` clean.
- Night Atlas vocabulary throughout; interaction-vocabulary comment in index.css governs hover/press behavior.

---

### Task 1 (B1): Performance pass

**Files:**
- Modify: `app/electron.vite.config.ts` (renderer `build.rollupOptions.output.manualChunks` for `katex`, `three`), `app/src/renderer/src/main.tsx` + `app/src/renderer/src/App.tsx` + `app/src/renderer/src/app/LearnSessionView.tsx` (React.lazy/Suspense for NeuralField, TopicMapView, ArtifactsView), `app/src/renderer/src/index.css` (transcript `content-visibility`), `app/src/renderer/src/components/GraphView.tsx` + `components/NeuralField.tsx` (pause RAF when hidden)

**Interfaces:**
- Consumes: KeepMounted wrapper in App.tsx (hidden views stay mounted — lazy import must not break that; a lazy component inside KeepMounted loads once on first visibility); existing skeleton components for Suspense fallbacks.
- Produces: recorded bundle numbers (before/after) in the task report and ledger.

- [ ] Record the current build's chunk sizes first (`npm run build` output) — the "before".
- [ ] manualChunks: `three` → `vendor-three`, `katex` → `vendor-katex`.
- [ ] React.lazy: NeuralField (both mount sites), TopicMapView, ArtifactsView; Suspense fallbacks reuse skeleton patterns; verify KeepMounted still works (lazy resolves once, then stays mounted).
- [ ] `.transcript-measure > *` (or the message-block wrapper class): `content-visibility: auto; contain-intrinsic-size: auto 120px;` — confirm no anchor-scroll jumpiness with ChatScrollRegion's stick-to-bottom (test reasoning in report; if jumpy, scope to all but the last N blocks via `:not(:nth-last-child(-n+6))`).
- [ ] RAF pause: GraphView's drift loop and NeuralField's loop check an `active` flag driven by visibility (IntersectionObserver on the svg/canvas root, or the KeepMounted hidden attribute via `offsetParent === null` check per frame — pick the cheapest reliable signal).
- [ ] Verify typecheck + build; record "after" numbers; commit `perf(renderer): code-split heavy views, CSS-virtualize transcript, pause hidden RAF loops`.

### Task 2 (B2): Typography & density pass

**Files:**
- Modify: `app/src/renderer/src/index.css` (tabular-nums on `.label-data`; KaTeX display margins; hairline audit), sweep of components with numeric displays (StatBlock, GradeTally, DueForecast, charts, TicketCard, BeatStepper) and prose-voice copy files for punctuation.

**Interfaces:** none new — pure presentation.

- [ ] `.label-data { font-variant-numeric: tabular-nums; }` plus removal of any per-component `fontVariantNumeric` inline styles that become redundant (charts added them — consolidate).
- [ ] `.katex-display` margin tuned to the transcript gap token (visually ~0.75em top/bottom, aligned with the gap-5 rhythm).
- [ ] Punctuation sweep in user-visible copy: `--` → `—`, straight quotes → curly in Fraunces-voice strings only (grep renderer for `"` in JSX text and `'` contractions; leave mono/label-data/code untouched; leave engram-authored content untouched — only app copy).
- [ ] Optical alignment: beat-mark rows, map legend rows, sidebar nav rows — consistent icon column width and baseline (verify the glyph svgs share size/alignment classes).
- [ ] Verify + commit `style(type): tabular numerals, math rhythm, punctuation, optical alignment`.

### Task 3 (B3): Fitting animations

**Files:**
- Modify: `app/src/renderer/src/index.css` (new keyframes from tokens), `components/CommandPalette.tsx` (open scale-fade), `components/SessionHistoryDrawer.tsx` (entrance), `components/charts/*.tsx` (draw-in once), Home due chip component (single pulse on increase), `app/src/renderer/src/app/TopicMapView.tsx` (annotation ink-in on live event)

**Interfaces:**
- Consumes: motion tokens; `seeded()`/existing keyframe style; charts render statically today.

- [ ] Palette: scale(0.98→1)+fade over `--dur-fast` on open (CSS animation on the panel; Modal-style pattern if palette has its own overlay).
- [ ] History drawer: content fade-rise over `--dur-base` (Modal already animates? check — if Modal has an entrance, inherit it and skip).
- [ ] Charts: RetentionCurve path draw-in via stroke-dasharray once on mount (JS matchMedia guard; skip entirely under reduced motion — render final state); ActivityStrip ticks stagger-fade (CSS, capped total < 400ms); CalibrationScatter dots fade in as one group.
- [ ] Due chip: track previous count in a ref; on increase add a one-shot `pulse-once` class (removed on animationend).
- [ ] Annotation ink-in: when the live annotate_node event refreshes annotations, the drawer/modal claim block gets a brief warm-ink fade (class toggled on annotations change for the selected node only).
- [ ] Every new keyframe defined in index.css with tokens; verify reduced-motion kills each (global CSS covers CSS animations; JS draw-in has its own guard).
- [ ] Verify + commit `feat(motion): purposeful entrances for palette, history, charts, due chip, annotations`.

### Task 4 (B4): Onboarding & environment

**Files:**
- Modify: `app/src/renderer/src/app/HomeView.tsx` (guided first-run empty state), `LearnSessionView.tsx` (topic-list empty state why), `ReviewSessionView.tsx` (empty = next-due date via `window.engram.due()`), `TopicMapView.tsx` (no-topics state exists? audit), `DashboardView.tsx`, `ArtifactsView.tsx`, `app/src/renderer/src/shared/friendlyError.ts` (CLI/plugin-missing actionable copy)

**Interfaces:**
- Consumes: `window.engram.environmentCheck()` (existing — read its return shape in preload/types first), `window.engram.due()`, existing empty-state/fig-caption patterns.

- [ ] Home first-run: when topics list is empty AND environmentCheck reports missing pieces, render the three-step guided card (step rows: status glyph, one-line instruction, copyable command via the existing CopyButton pattern, re-check button calling environmentCheck).
- [ ] When environment is healthy but no topics: single invitation card → Start a new topic (routes to learn:new-topic path).
- [ ] Review empty: "Nothing due — earliest return <date>" from due()/stats; Map/Coach/Artifacts empty states audited to state-what-will-appear + one action.
- [ ] friendlyError: patterns for `claude: command not found` / plugin-missing map to the same copy as the guided steps.
- [ ] Verify + commit `feat(onboard): guided first-run, purposeful empty states, actionable environment errors`.

### Task 5 (B5): Keyboard & accessibility

**Files:**
- Modify: sweep — `components/ritual/Marks.tsx`, `BeatStepper.tsx`, `components/ui/InkNode.tsx` consumers, `TitleBar.tsx`, `GraphView.tsx` legend/controls, `App.tsx` nav, session composers.

**Interfaces:** none new.

- [ ] aria-labels: beat glyphs (`aria-label` = beat label, or `aria-hidden` where a text label sits adjacent — avoid double-reading), stepper positions (`aria-current="step"`), traffic dots (close/minimize/zoom), InkNode decorative instances `aria-hidden`.
- [ ] focus-ring audit: every button/clickable in GraphView overlays, map legend, palette rows, drawer rows has the `focus-ring` class and is reachable (no positive tabindex; natural order).
- [ ] Composer ⇥ transcript ⇥ nav traversal: confirm no focus traps outside modals; Escape paths documented.
- [ ] Reduced-motion re-verification of every B3 site (list each in the report with its guard mechanism).
- [ ] VoiceOver pass notes for Home + Learn session (static reasoning: roles/labels present; note anything needing a live check).
- [ ] Verify + commit `a11y: labels, focus audit, keyboard traversal`.
