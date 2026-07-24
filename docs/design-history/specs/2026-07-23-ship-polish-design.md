# Ship Polish — Navigation Intent, Failure Feedback, Empty States, Frameless Shell

**Date:** 2026-07-23
**Status:** Approved (all four design sections approved in brainstorming; plan approved via plan mode)

## Problem

Four ship-readiness gaps confirmed by exploration:

1. **Navigation intent bugs.** Clicking a Home "continue learning" card (or a palette "Continue:" entry) while a *different* Learn session is active silently does nothing — the deep-link guard drops links that arrive mid-session. There is also no path at all from the Topic Map into a Learn session.
2. **Failure feedback.** Learn has no recovery UI when the session process dies (Review does); spawn failures surface as raw errno strings; Coach's error line is a bare red string; no error banner is dismissible.
3. **First-run & empty states.** Zero-topic states are bare ("No topics yet — start one below."); the Topic Map shows an infinite skeleton with no topics; Home's first-run is a ghost button.
4. **App shell.** Default macOS title bar; no window size/position memory; plain default DMG.

## Design

### 1. Navigation intent

- **Deep-link topic switching** (`LearnSessionView` deep-link effect): same-topic link → consume, no-op. Different-topic link while a session is active → perform the backToTopics-equivalent ephemeral reset (extract the shared reset into a helper used by both paths) then `openTopic(match)`. The parked topic's claude session keeps running server-side — identical semantics to leaving via "All topics".
- **Map → Learn bridge**: `TopicMapView` gains `onGoTopic?: (topicId: string) => void`; a ghost "Continue in Learn" Button renders in the node modal footer and the selected-node drawer; `App.tsx` passes `goToTopic`.
- Palette "Continue:" entries inherit the fix (same path).

### 2. Failure feedback

- **Learn closed-recovery**: on a `closed` SessionEvent while a session was started, show a calm panel — "The session process ended unexpectedly. Your progress is stashed on disk — safe to reopen." with a Resume button (existing `openTopic` resume path). Mirrors Review's `closed-unexpectedly` phase.
- **Friendly spawn errors**: error banners detect `ENOENT`/`spawn`/`not found` substrings → "Claude CLI could not be launched — check the setup." with the raw message collapsed beneath; plus a setup affordance where cheap.
- **Coach** error line adopts the standard danger panel; **all error banners get a dismiss ×**.

### 3. First-run & empty states

- **Home first-run hero** (zero topics): serif display "Begin your atlas", one philosophy line ("Engram teaches by making you produce, then verifies what stuck."), primary Button → new-topic intake.
- **Learn zero-topics**: inviting Card (fig-caption + serif line + emphasized "+ Start a new topic").
- **Topic Map zero-topics**: real empty state — fig-caption "Fig. — the atlas is unmapped" + ghost "Start your first topic" Button (callback from App) — replacing the infinite skeleton.
- Review/Artifacts empty copy unchanged (already good).

### 4. Frameless shell

- **Fully frameless window** (user's explicit choice over hiddenInset): `frame: false`; custom `TitleBar.tsx` (~38px, `-webkit-app-region: drag`, interactive children `no-drag`): three hand-drawn ink traffic dots (danger/warm/cool; hover reveals ×/−/+), Engram wordmark + streak dot, double-click zooms. Traffic dots hidden in fullscreen (enter/leave-full-screen events forwarded via preload). New IPC: `window:close|minimize|zoom` + fullscreen events.
- **Window memory**: bounds persisted (debounced ~500ms on move/resize) to `userData/window-state.json`, restored on create, clamped to the nearest display workArea.
- **Packaging**: `dmg` config block (window size, icon positions, title). No code signing (no identity available).

## Non-goals

- No engine/MCP-bridge changes (the Live Bridge Tools project is queued separately).
- No Windows/Linux chrome work (macOS only).
- No code signing/notarization.

## Verification

- Per task: `npm run typecheck && npm run build` clean (no test framework).
- Final interactive pass: topic-A session → Home → topic-B card lands in B's session; palette Continue same; Map "Continue in Learn" jumps; killed claude process → recovery banner + Resume; frameless drag/zoom/minimize + traffic dots; bounds persist across relaunch; DMG builds with layout.
- Packaged rebuild/reinstall via the standard sequence (live-session check first).
