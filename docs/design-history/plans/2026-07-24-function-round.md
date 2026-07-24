# Function Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the five Function streams — palette search, session history browser, coach analytics, dock badge/notifications, map LaTeX + `annotate_node` — per `../specs/2026-07-24-function-round-design.md`.

**Architecture:** All streams are additive over existing IPC (`window.engram`) and the MCP bridge; no engram file writes; charts and search are dependency-free.

**Tech Stack:** existing only — React 19, TypeScript, Tailwind 4, KaTeX (via MathRenderer), zod (bridge), Electron main-process APIs.

## Global Constraints

- Never write to `~/.claude/learning/` — the annotation store lives in Electron userData (`map-annotations.json`).
- No new npm dependencies.
- Advisory-only bridge contract: `annotate_node` is fire-and-forget, degrades to nothing if the UI ignores it, and is documented as optional in `APPEND_SYSTEM_PROMPT`.
- Night Atlas vocabulary: figures/labels use `fig-caption`, `label-data`, motion tokens; no scale-on-hover on non-buttons.
- Verification per task: `cd app && npm run typecheck && npm run build` clean.
- Read-only philosophy surfaces: history browser never spawns a session; no composer in read-only transcripts.

---

### Task 1 (A1): Palette search index

**Files:**
- Create: `app/src/renderer/src/shared/searchIndex.ts`
- Modify: `app/src/renderer/src/components/CommandPalette.tsx`, `app/src/renderer/src/App.tsx` (pass data accessors)

**Interfaces:**
- Produces: `buildSearchIndex(deps): Promise<SearchEntry[]>` where `SearchEntry = { kind: 'view'|'topic'|'node'|'receipt'|'artifact'; title: string; subtitle?: string; topic?: string; node?: string; artifactPath?: string }`, and `searchEntries(index, query): SearchEntry[]` (rank: exact prefix > word boundary > subsequence fuzzy; cap 8 per section).
- Consumes: `window.engram.topics()`, `.topicGraph(topic)`, `.receiptsHistory()`, `.artifactList()`; existing palette callbacks `onGoTopic(topic)`, `onGoNode(topic, node)`; `humanizeNodeId`.

- [ ] Read CommandPalette.tsx and App.tsx wiring first; keep existing nav commands as the 'view' section.
- [ ] Implement `searchIndex.ts`: index built lazily on first palette open (cache in a module-level promise; expose `invalidateSearchIndex()` called where topics refresh in App.tsx).
- [ ] Wire results into the palette grouped by section; Enter on node/receipt → `onGoNode(topic, node)`; artifact → `window.engram.openArtifact(path)`.
- [ ] Verify: typecheck + build; grep no new deps in package.json.
- [ ] Commit `feat(palette): search nodes, receipts, artifacts from ⌘K`.

### Task 2 (A2): Session history browser

**Files:**
- Create: `app/src/renderer/src/components/SessionHistoryDrawer.tsx`
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx` (masthead History affordance), `app/src/renderer/src/app/ReviewSessionView.tsx` (header affordance)

**Interfaces:**
- Consumes: `window.engram.sessionHistoryFor(key)` (`{sessionId,key,startedAt}[]` newest first), `window.engram.getTranscript(sessionId)`, existing `ChatMessageView`/`BeatCard`/`PlainDialogueBlock`, `extractTicketFromMessages`, `parseGradeResults`, `Modal` (`wide`).
- Produces: `<SessionHistoryDrawer historyKey={topicId|'review'} open onClose />` — self-contained; list pane + read-only transcript pane; banner "read-only · sitting of <date>".

- [ ] Build the drawer on `Modal.tsx`; list from `sessionHistoryFor`; selection loads transcript and maps entries through the same message-shaping used for live hydration (reuse the existing transcript→ChatMessage conversion — find it where resume hydration happens in LearnSessionView; extract to a shared helper if it is inline).
- [ ] No composer, no session spawn; grade receipts and ticket render as cards.
- [ ] Wire mastheads: Learn masthead's History label opens it; Review header gets the same.
- [ ] Verify: typecheck + build; confirm no `startSession`/`resumeSession` call paths from the drawer.
- [ ] Commit `feat(history): read-only browser for past sittings`.

### Task 3 (A3): Coach analytics figures

**Files:**
- Create: `app/src/renderer/src/components/charts/RetentionCurve.tsx`, `charts/ActivityStrip.tsx`, `charts/CalibrationScatter.tsx`
- Modify: `app/src/renderer/src/app/DashboardView.tsx`

**Interfaces:**
- Consumes: `window.engram.receiptsHistory()` → `{days: {date,count,items:{topic,node,grade}[]}[], weeks: {weekStart,total,recalled,rate}[]}`; `allPicks()` from `renderer/src/shared/calibrationStore.ts` (`{topic,node,label,ts,index?}`); the existing calibration local-date join (find its consumer and reuse the join logic — local `getFullYear/Month/Date`, never `toISOString`).
- Produces: three self-contained SVG components, each `({data}) => JSX`, viewBox-scaled, Night Atlas ink tokens, `fig-caption` beneath.

- [ ] RetentionCurve: weeks as ink polyline, null-rate weeks break the line; dot markers; y-axis 0–100% with two hairline gridlines.
- [ ] ActivityStrip: 180 ticks, height ∝ count (cap), warm ink when count>0; month initials beneath every ~30 ticks.
- [ ] CalibrationScatter: join picks↔grades by topic+node+local-date; x = confidence index (0-3), y = outcome (recalled top / lapsed bottom) with jitter; caption states the read.
- [ ] Compose into DashboardView with skeletons while loading; tabular numerals on all figures.
- [ ] Verify: typecheck + build.
- [ ] Commit `feat(coach): retention curve, activity strip, calibration scatter`.

### Task 4 (A4): Dock badge + notification action

**Files:**
- Modify: `app/src/main/session/reviewNotifier.ts`, `app/src/main/session/notifierState.ts`, `app/src/main/index.ts` (if action routing needs it), Settings UI file that renders notifier toggles, `app/src/preload/index.ts` only if the settings shape type lives there.

**Interfaces:**
- Produces: `notifier-state.json` gains `dockBadgeEnabled: boolean` (default true, merged defensively like existing fields); badge set via `app.setBadgeCount(n)` at every poll + `checkReviewsNow`; Notification constructed with `actions: [{type:'button', text:'Review now'}]` and an `on('action')` handler routing to `focusOrCreateWindow('review')`.
- Consumes: existing poll (`engramRead('due',…)`), existing settings IPC (`getNotifierSettings`/`setNotifierSettings`).

- [ ] Add the field + badge logic; badge cleared (0) when disabled or no dues.
- [ ] Add the Settings toggle beside the reminders toggle (find the existing notifier settings UI; match its row pattern).
- [ ] Verify: typecheck + build.
- [ ] Commit `feat(notify): dock due badge and Review-now notification action`.

### Task 5 (A5): Map LaTeX + annotate_node

**Files:**
- Create: `app/src/main/session/mapAnnotations.ts`
- Modify: `app/src/main/bridge/mcpBridgeWorker.mjs`, `app/src/main/bridge/bridgeServer.ts` + `app/src/shared/bridgeProtocol.ts` (extend the ui payload union), `app/src/main/session/permissionConfig.ts` (APPEND_SYSTEM_PROMPT + allowedTools), `app/src/main/ipc/readHandlers.ts` + `app/src/preload/index.ts` (expose `mapAnnotations(topic)`), `app/src/renderer/src/app/TopicMapView.tsx`, `app/src/renderer/src/components/GraphView.tsx` (label `$`-strip helper only)

**Interfaces:**
- Produces: bridge tool `annotate_node {topic, node, latex_label?, latex_claim?}` (zod; at least one of the two optional fields required); persisted `Record<topic, Record<node, {latexLabel?: string; latexClaim?: string}>>` in userData `map-annotations.json`; renderer accessor `window.engram.mapAnnotations(topic)`; live update via the existing `bridge:ui` event path (new `kind: 'annotate_node'` payload, shape-guarded like the others).
- Consumes: `fireUi` helper, `topicSettings.ts` persistence pattern, `MathRenderer`, `Modal.tsx`.

- [ ] Render pass first: drawer + node modal fields (claim/probe/rubric/why_chain/transfer_probe) through `MathRenderer`; plate `<text>` labels get `stripMathDelimiters()`.
- [ ] Bridge tool + persistence + IPC accessor; main writes annotations when the ui payload arrives (shape-guard: strings, length caps, topic/node id charset).
- [ ] TopicMapView loads annotations per topic; drawer/modal prefer `latexClaim`/`latexLabel`; live `bridge:ui` event refreshes.
- [ ] Migrate the node modal to `Modal.tsx`.
- [ ] Verify: typecheck + build; write a throwaway node script hitting the bridge worker's tool via stdio? No — verify shape-guard by unit reasoning + build; confirm `graphs/*.json` untouched by code inspection (no write path).
- [ ] Commit `feat(map): LaTeX rendering + advisory annotate_node bridge tool`.
