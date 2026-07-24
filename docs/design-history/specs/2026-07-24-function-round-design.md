# Function Round — Palette Search, History Browser, Coach Analytics, Dock Presence, Map LaTeX

**Date:** 2026-07-24
**Status:** Approved design (Project A of the premium-quality round)

## Goal

Give the app richer navigation and insight over data engram already produces, without touching the learning loop's mechanics or engram's files. Five streams, all additive and read-only toward engram state.

## Constraints (binding)

- Learning-loop philosophy untouched: advisory-only signals, free recall, honest grades, no auto-send.
- `~/.claude/learning/` is never written by these features; the map-LaTeX layer persists only to the app's own userData.
- No new runtime dependencies (charts are hand-drawn SVG; search is a simple in-memory index).
- Verification per task: `npm run typecheck && npm run build`.

## A1 — Command palette searches everything

Extend the existing `CommandPalette.tsx` (⌘K, App.tsx wiring with `onGoTopic`/`onGoNode`) with a lazily built index over: nodes (`topicGraph` per topic — id, humanized title, claim), receipts (`receiptsHistory().days[].items` as "node · grade · date"), and artifacts (`artifactList`). Result sections: Views / Topics / Nodes / Receipts / Artifacts. Selection: node and receipt hits deep-link to the topic map spotlight (existing `onGoNode`); artifact hits call `openArtifact`. Matching: substring plus subsequence fuzzy; rank exact-prefix > word-boundary > fuzzy. Index lives in a new `renderer/src/shared/searchIndex.ts`; built on first palette open per app run, invalidated when topics refresh.

## A2 — Session history browser

A History affordance in the Learn session masthead and the Review header opens a `Modal.tsx` (`wide`) drawer listing past sittings from `sessionHistoryFor(key)` (newest first): date, walk number when parseable from the transcript, first user line as summary. Selecting a sitting loads `getTranscript(sessionId)` and renders it read-only through the existing components (BeatCard / PlainDialogueBlock / MathRenderer), with tickets and grade receipts reconstructed via `extractTicketFromMessages` / `parseGradeResults`. A banner states "read-only · sitting of <date>". No composer, no session spawn, no claude process.

## A3 — Coach analytics depth

`DashboardView.tsx` gains three hand-drawn SVG figures (new `renderer/src/components/charts/`, Night Atlas ink, no chart library):

1. **Retention curve** — weekly recall rate from `receiptsHistory().weeks` as an ink line with dot markers; weeks with `rate === null` gap the line.
2. **Activity strip** — 180 days of `days[].count` as a seismograph-style tick row (height ∝ count), not a heatmap grid.
3. **Calibration scatter** — localStorage picks (`allPicks()`) joined to receipt grades by topic + node + LOCAL calendar date (reuse the existing calibration-mirror join), confidence index (x) vs outcome (y), one-line caption interpreting the plot.

All figures use `fig-caption` labels and tabular numerals. Skeletons while `receiptsHistory` resolves.

## A4 — Dock badge + actionable notifications

`reviewNotifier.ts`: at each poll and on `checkReviewsNow`, set `app.setBadgeCount(dueCount)` (0 clears). New `dockBadgeEnabled` field (default true) in `notifier-state.json`, exposed through the existing notifier-settings IPC and a Settings toggle. Notifications gain a "Review now" action (macOS `actions`) routing through `focusOrCreateWindow('review')`, same as notification click. Cadence and dedup logic unchanged.

## A5 — Map LaTeX layer + `annotate_node` bridge tool

Two layers, engram files untouched:

1. **Render pass:** node claim / probe / rubric / why-chain text in TopicMapView's drawer and node modal render through `MathRenderer`, so `$...$` already present in engram graphs sets as math. On-plate SVG labels remain plain (`<text>` cannot host KaTeX); a small helper strips `$` delimiters for label display.
2. **Advisory tool:** `annotate_node { topic, node, latex_label?, latex_claim? }` added to `mcpBridgeWorker.mjs` (zod-validated, fire-and-forget via `fireUi`, documented as optional in `APPEND_SYSTEM_PROMPT`). The main process persists annotations to userData `map-annotations.json` via a new `main/session/mapAnnotations.ts` (read/write-on-demand, same pattern as `topicSettings.ts`); the renderer prefers an annotation's LaTeX form in the drawer/modal when present. `graphs/<topic>.json` is never written.

While in the file, the node modal migrates from its hand-rolled scrim to `Modal.tsx` (gains the focus trap; feeds the a11y stream in Project B).

## Out of scope

Project B streams (performance, typography, animations, onboarding, keyboard/a11y); any windowing/virtualization; any engram.py change.

## Verification

- A1: palette finds a node ("poisson"), a receipt, and an artifact; Enter deep-links to the map spotlight.
- A2: a past grad-classical-mechanics sitting opens read-only with ticket and receipts; `ps` shows no new claude process.
- A3: three figures render from real local state; the calibration join keys on local dates.
- A4: badge matches `due` count; toggle clears it; the notification action lands on Review.
- A5: `$...$` in a graph renders in the drawer/modal; `annotate_node` writes only `map-annotations.json` (graph file mtimes unchanged).
