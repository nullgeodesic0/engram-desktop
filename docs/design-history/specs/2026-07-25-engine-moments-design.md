# Engine Moments — Durable Beat Marks + Styled Event Cards

**Date:** 2026-07-25
**Status:** Approved design (user-selected slate)

## Goal

Make the engine's own events visible as designed moments in the chat loop — and make the loop's existing beat marks durable across close/reopen and in the history browser. The sitting should read as an instrumented ritual, not a chat with a system prompt.

## Constraints (binding)

- Advisory/display-only: nothing here steers the loop, blocks input, or auto-sends.
- Everything reconstructs from data that already exists (transcript tool calls, receipts, engram CLI invocations in-stream) — no new engine surface, no engram file writes.
- Night Atlas vocabulary throughout; every new animation from motion tokens, once per trigger, reduced-motion safe.
- Verification per task: `npm run typecheck && npm run build`.

## 1. Durable beat marks (user addition — doctrine change)

Beat marks and node-crossing dividers become **reconstructible**: on session resume, hydration derives them from the transcript's `render_beat` bridge calls (same source `extractBannerFromTranscript` already reads) with correct `atIndex` interleaving; the history drawer's `buildHistoryTimeline` does the same so past sittings show their beat structure. Ephemeral-only remains true for figures, atlas births, stash stamps, and suggestions (not deterministically derivable or intentionally one-time). The RitualMark doc comment is updated to state the new rule: *derivable marks replay; one-time marks don't.*

## 2. Diagnostic plate (pretest)

When pretest `rate --kind pretest` results land (detector exists), accumulate them; when the pretest phase ends (session_phase leaves 'pretest', or the first walk beat arrives), render a specimen plate card: each probed node with held / partial / unknown ink glyphs, one caption line stating the frontier it sets. Also reconstructed in history/resume from the same transcript calls.

## 3. Phase frontispieces

On `session_phase` boundaries, a full-width serif divider marks the act: intake → "Taking measure", pretest → "The diagnostic", walk → "The walk begins", grading → "The assessor sits", closing → "Closing the loop". Dendrite hairlines left/right, small ink glyph. Reconstructible (session_phase calls are in the transcript), so history shows chapters too.

## 4. Misconception pinned

Detect the tutor's `log-misconception` engram CLI invocations in-stream (Bash tool_use pattern, same detector discipline as receipt/rate). Render a danger-ink specimen label card: "Misconception pinned — <text>", with the node it's filed under. Reconstructible.

## 5. Explorable forged

Detect artifact registration in-stream (the `visuals`/artifact-register CLI call or artifact-smith Task completion — implementer verifies which signal is reliable in real transcripts and documents it). Violet-ink card: "Explorable forged — <title>" with an Open button into the in-app viewer (D1) when the artifact path resolves, browser fallback otherwise. Reconstructible; the Open button re-validates the path at click time.

## 6. Return chip on grade reveal

The revealed face of `GradeResultCard` gains the scheduling consequence when the receipt carries it: "returns in <n> days · s <before> → <after>" in tabular mono, toned by grade. No new data — receipts already parse intervalDays/sBefore/sAfter.

## 7. Verify seal

When a `beat_outcome` lands with beat `verify` and outcome `confirmed`, stamp the exchange with a small wax-seal ink mark (the existing verify glyph in a filled roundel) — distinct from ordinary beat marks. Partial/missed verify outcomes get no seal (honesty: the seal means confirmed). Reconstructible.

## Out of scope

Beat-aware composer (declined); persisting figures/atlas/stamps; any Review-view equivalent beyond what already renders there (receipts/ceremony unchanged).

## Verification

- Reopen a live sitting: beat marks and crossings reappear at correct positions; history drawer shows them for past sittings.
- A sitting with a pretest shows the plate (live and in history); phases read as chapters.
- The ket-ln misconception sitting (grad-quantum, 2026-07-24) shows a pinned card in history.
- A sitting that forged an explorable shows the card; Open lands in the viewer.
- Grade reveals show return chips when receipts carry scheduling; verify-confirmed exchanges show the seal.
