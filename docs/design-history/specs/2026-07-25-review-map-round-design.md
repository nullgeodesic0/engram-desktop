# Review Moments & Map Lenses

**Date:** 2026-07-25
**Status:** Approved design (user-selected slate)

## Goal

Bring the engine-moments treatment to the Review loop (docket, interval ladder, lapse rite) and give the topic map four lenses over data the app already holds (prerequisite trail, due lens, territory labels, growth time-lapse).

## Constraints (binding)

- Advisory/display-only; no engram writes; honest copy (absolve-never-pity governs the lapse rite); Night Atlas + motion tokens, once-per-trigger, reduced-motion safe.
- Map lenses are read-only over the graph/decay/provenance data already fetched; no new engine surface.
- Verification per task: `npm run typecheck && npm run build`.

## Review moments

**1. Review docket.** When a review sitting starts, `window.engram.due()` renders an opening specimen card: each due node (humanized, topic tag, days overdue in tabular mono), oldest first, capped with "and N more" past ~8 rows. Live-computed at session open — a one-time mark (the due list isn't in the transcript; doctrine comment says so). Renders above the transcript's first exchange, same mark plumbing as Learn.

**2. Interval ladder.** The revealed grade card (Review AND Learn receipts) gains a small rung ladder of the node's actual return intervals, derived from the gaps between that node's REAL review dates in receiptsHistory (append the just-landed interval from the grade result). Rungs climb left→right, height ∝ log(days); a lapse rung drops and inks danger. Max ~7 rungs (oldest elided). Tooltip lists the raw day counts. If the node has fewer than 2 dated events, no ladder (never fabricate).

**3. Lapse rite.** When a rate result lands `lapsed`, a quiet dedicated card follows the grade card: hairline panel, danger spine, "Filed for relearning — returns <date>." + one fig-caption line "a lapse resets the interval, not the work." No animation beyond the standard entrance; no pity, no exclamation. Derivable from transcripts (rate results), so history sittings show it too.

## Map lenses

**4. Prerequisite trail.** Selecting a node inks its FULL ancestor chain (transitive `requires` closure) back to the roots and its forward descendant path toward the capstone; everything else dims further than today. Replaces/extends the current first-order orange/purple highlight while a node is selected; deselecting restores. Edge walk is pure graph derivation.

**5. Due lens.** A toggle in the legend ("due lens"): recolors node bodies by schedule state — overdue (fsrs.due < today) danger-ink glow, due today warm, scheduled cool-dim, unencoded unchanged. Uses each node's fsrs.due already in the graph. Toggle state is view-local; the legend swaps to explain the lens while active.

**6. Territory labels.** The territory groups already driving the background washes gain faint serif region names (humanized group key), centered over each territory's hull, non-interactive, pointer-events none, hidden while the due lens is active (one lens at a time keeps the plate legible).

**7. Growth time-lapse.** A "replay" affordance on the map: a scrubber (range input, Night Atlas styled) whose position t maps to a date between the topic's first encode and today, derived from provenance first-encode dates (already fetched per topic) — nodes ink in as t passes their date, consolidation state approximated by their current state once inked. Play button steps t over ~6 seconds (rAF, reduced-motion: jumps to end). Purely visual; scrubbing never mutates anything; closing the lens restores the live plate.

## Out of scope

Audit crossings in review (declined); any FSRS math invention (ladder uses real dates only); persisting lens states.

## Verification

- Docket lists the actual due queue at a review's start; ladder rungs match a spot-checked node's real review dates; a lapsed node shows the rite with the correct return date (and in history).
- Trail: a mid-graph node inks ancestors to the roots and descendants to the capstone; due lens recolors correctly against `due` output; labels sit over their washes; time-lapse replays encode order matching provenance dates.
