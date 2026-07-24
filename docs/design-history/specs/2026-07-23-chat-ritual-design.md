# Chat Ritual — Premium Treatment of the Recurring Learning Loop

**Date:** 2026-07-23
**Status:** Approved (both design sections approved in brainstorming)

## Problem

The learning loop's *recurring, topic-independent* moments — dialogue beats, session open/close, grading waits, node transitions, who-is-speaking — all render as undifferentiated markdown in the chat surfaces. The structure that makes Engram's loop a ritual is invisible in the transcript. Six approved features give those global moments dedicated UI.

Key untapped signal: the model reliably calls the `mcp__engram-ui-bridge__render_beat` MCP tool with `{beat, content}` on every loop transition; today only `beat` is consumed (BeatStepper). The `content` payload is discarded.

## Features

### A. Beat cards (Learn transcript)

`onBridgeBeat` also appends a *beat mark* pinned to the current transcript position: compact card with a per-beat ink glyph (open_gap = open ring, predict = arrow, struggle = tangle, resolve = untied knot, self_explain = mirror, connect = bridge, verify = seal), the beat name in mono caps, and `content` (first ~140 chars) in serif italic. Unknown beat strings are ignored. Live-session-only, not reconstructed on history replay — same ephemeral-overlay pattern as grade cards and JobsRail.

### B. Session bookends

- **Opening plate (Learn):** rendered as the transcript's first element when a session view is active: topic title in serif display, "Walk N" (N = prior session count via existing `sessionHistoryFor` + 1), current node position from the prefetched banner data (`nextNode`), date. Skipped for the new-topic intake flow (no topic yet).
- **Closing ceremony (Learn):** when a `receipt` batch lands (existing `parseGradeResults` moment): ceremony card with grade tally, per-node stability movements, next-due line, and the return-commitment cue (from the learner model's existing commitment settings if present) framed as a signed ledger entry.
- **Closing ceremony (Review):** the existing done-phase summary panel upgraded to the same ceremony chrome (serif headline, fig-caption stats, GradeTally retained).

### C. Living waits

1. **Grading shimmer:** while `pendingReceiptToolUseId` is set (assessor grading in flight), a "specimen under examination" shimmer card shows at the transcript foot; replaced by the ceremony when results land. Review's `rate` calls are near-instant and get nothing.
2. **Node-transition divider:** when `currentNodeId` changes from one non-null value to a different one, an animated dendrite divider grows across the transcript with the new node's humanized name.
3. **Stash stamp:** a successful `stash` Bash tool result renders a small ink-seal chip ("production filed") in the transcript flow.

### D. Voice identity

Assistant markdown in chat renders in Fraunces serif at reading size (`.md-preview-voice`); user messages stay Inter; tool/system chips recede further (opacity/size). Markdown headings inside assistant prose stay Space Grotesk. Applies to Learn, Review, and Coach chat surfaces (shared ChatMessageView).

### E. Ambient atmosphere

Via the existing `neuralFieldBus`: warm pulse on a `resolve` beat, violet flicker when an explorable job completes, and a slow ambient intensity lift scaled by the session grade tally (recalled count). Pure atmosphere; no information carried. Extend the bus's event kinds only if its current API cannot express these.

### F. Sender identity marks

Each message group in ChatMessageView gets a small ink glyph (InkNode-style seeded blob, fixed ids so shapes are stable): filled warm = assistant/tutor, outlined cool = user, faint tiny glyph on tool/system chips.

## Constraints

- **Loop semantics are sacred**: free recall flow, grading honesty, beat interactions, confidence picker — no behavioral changes anywhere.
- No engine (engram.py), IPC-schema, or MCP-bridge changes; everything consumes signals that already reach the renderer.
- Ephemeral overlays (beat cards, dividers, stamps, shimmer) are live-session-only; history replay is unchanged.
- All styling via Night Atlas tokens/primitives (`--font-serif`, `.fig-caption`, InkNode technique, DendriteDivider, GradeTally).

## Verification

- Per task: `npm run typecheck && npm run build` clean (no test framework).
- Final interactive pass: run a real Learn session — opening plate correct, beat cards appear at beat transitions with content lines, node transition draws the divider, stash stamps, grading shimmer during receipt, closing ceremony on results; Review end-of-queue shows the ceremony; serif voice + sender glyphs on all three chat surfaces; NeuralField pulses on resolve/job-complete.
- Packaged rebuild/reinstall via the standard sequence (live-session check first).
