# Living Loop — Bridge Tool Expansion + Loop Interaction Features

**Date:** 2026-07-23
**Status:** Approved (all three design sections approved in brainstorming; plan approved via plan mode)

## Problem

The learning loop's live interaction runs on two MCP signals (`ask_user_question`, `render_beat`) and a lot of inference from Bash tool calls. The tutor cannot point at the map, push a figure, offer actions, or report its session plan; the UI cannot show where a beat sits in the node walk, how a beat resolved, or which coarse phase the session is in. Separately, three interaction gaps: the free-recall moment has no focused mode, confidence picks vanish without calibration feedback, and a node's derivation ancestry (`why_chain`) is buried in the map modal.

Philosophy constraints (binding): every new model-driven signal is **advisory and fire-and-forget** — the UI degrades gracefully when signals don't arrive; nothing softens grades or the free-recall discipline; the recall chamber is **invited, not forced** (user decision), with no peek surveillance.

## Design

### 1. Bridge surface expansion

- **New generic route** `^/bridge/([^/]+)/ui$` in `bridgeServer.ts` → IPC `bridge:ui` `{sessionId, tool, payload}`, fire-and-forget (immediate `{ok:true}`). Existing `/ask` and `/beat` routes unchanged (live sessions keep working through an upgrade).
- **Worker tools** (`mcpBridgeWorker.mjs`, zod-validated):
  - `render_beat` extended in place with optional `node: string` and `position: string` ("2/3"); still posts to `/beat`.
  - `session_phase` `{phase: intake|pretest|walk|grading|closing, note?}` → `/ui`.
  - `beat_outcome` `{beat, outcome: confirmed|partial|missed, note?}` → `/ui`.
  - `spotlight_node` `{topic, node, reason?}` → `/ui`.
  - `show_figure` `{title?, body}` (markdown only; never HTML) → `/ui`.
  - `suggest_action` `{actions: [{label, kind: open_explorable|show_on_map|go_review|prefill, arg?}]}` (max 3) → `/ui`.
  - `progress_note` `{text}` → `/ui`.
- `bridgeProtocol.ts` gains `BridgeUiRequest`; `BridgeBeatRequest` gains `node?`/`position?`. Preload gains `onBridgeUi`.
- `APPEND_SYSTEM_PROMPT` (permissionConfig.ts) rewritten: keeps the existing two points, adds documentation of the new advisory tools with the same "optional, never blocks, degrade gracefully" contract plus brief when-to-use guidance (spotlight during CONNECT, session_phase at phase transitions, beat_outcome when a beat closes, ≤3 action chips, progress_note for plan status). `allowedTools` grows to match.

### 2. Renderer consumers

- **Beat trail**: `BeatStepper` gains a `trail` map (beat → visited|confirmed|partial|missed); visited beats stay inked, outcome tints (warm/dim/danger-stipple), current pulses. Learn resets the trail at node crossings. `position` renders beside the node title ("node 2 of 3").
- **`bridge:ui` dispatch** (LearnSessionView, session-id gated):
  - `session_phase` drives opening-plate visibility (intake hides it), grading shimmer, and ceremony fallback — existing Bash-call inference remains as fallback.
  - `beat_outcome` updates the trail.
  - `spotlight_node` lifts to App: on the Map view it selects + pans (no modal — the select-only variant of the deep-link effect); otherwise a warm badge dot on the Topic Map nav item and a pending spotlight consumed on visit. TopicMapView gains `spotlightNode?`/`onSpotlightConsumed?`.
  - `show_figure` renders as a new `figure` RitualMark (serif title + MarkdownPreview body), ephemeral like all marks.
  - `suggest_action` renders ≤3 chips at the transcript foot (new `ActionChips` component); kinds whitelisted in the renderer; `prefill` inserts composer text and never auto-sends; `open_explorable` validates its arg against known artifact paths; chips replaced per call and cleared on user send/session reset.
  - `progress_note` renders as a quiet fig-caption line under the session header, reset per session.

### 3. Interaction features

- **Recall chamber (invited)**: a pulsing ghost "Begin recall" affordance appears in the composer when `currentBeat === 'verify'` (Learn) and is subtly always available in Review. Entering: transcript blurs (CSS filter + pointer-events none + select-none), composer expands (~12 rows) with the caption "recall chamber — nothing to look back at". Exit on submit or an explicit leave button. No exit logging.
- **Calibration mirror**: `answerAsk` in both session views intercepts `askRequest.header === 'Confidence'` and records `{topic, node, label, ts}` to a localStorage ring buffer (`calibrationStore.ts`, ~200 entries). The next `GradeResult` for that node shows a mirror line on its card ("felt ⟨label⟩ → ⟨grade⟩"). Coach (DashboardView) gains a calibration section joining stored picks with `receiptsHistory.days[].items` by topic+node+date (% over/under/calibrated). Grades and engine untouched.
- **Why-chain unfolding**: a "why?" ghost affordance beside the Learn header's node title toggles an inline ink panel listing the current node's `why_chain` (from `topicGraph`, fetched once per topic and cached), each step with a small InkNode glyph. Read-only.

## Non-goals

- No engram.py/engine changes; no changes to grading, scheduling, or skill files.
- No blocking bridge tools beyond the existing `ask_user_question`.
- No raw HTML rendering from model payloads anywhere.

## Verification

- Per task: `npm run typecheck && npm run build` clean (no test framework).
- Final interactive pass (new worker requires fresh sessions after install): model calls the new tools (transcript check); beat trail inks with outcomes; spotlight pans/badges; figure cards and action chips render and act safely; progress note updates; recall chamber enters/exits cleanly during VERIFY; confidence pick → grade shows the mirror line; Coach calibration section renders; why-chain unfolds.
- Packaged rebuild/reinstall via the standard sequence (live-session check first; note live sessions keep the old worker until restarted).
