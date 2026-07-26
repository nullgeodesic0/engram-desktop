# Review Tab — The Sitting, End to End

**Date:** 2026-07-25
**Status:** Approved design (user-selected slate, all eight items)

## Goal

The Review tab's in-sitting machinery got rich this round (docket, rite, ladders); its *edges* did not. The ready room is a bare probe and a button, the empty state is one grey line, and the close of a sitting lists numbers it never draws. This round finishes the surface: a real ready room, a probe that stays put, a horizon worth landing on, an honest way to blank, and four engine-moment figures.

## Constraints (binding)

- The engine still owns the queue: the skill picks items, caps the sitting, and grades. Nothing here selects, reorders, skips, or re-grades.
- No priming: nothing may reveal an answer, a difficulty signal, or an upcoming node's identity before that node is asked.
- Honest blank PREFILLS, never sends — the composer's no-auto-send rule is absolute.
- Absolve-never-pity governs all copy; no streak-guilt, no exclamation marks, no celebration inflation.
- Read-only toward engram state; Night Atlas vocabulary; motion tokens, once-per-trigger, reduced-motion safe.
- Verification per task: `npm run typecheck && npm run build`.

## A. Ready room plate

Replaces the `phase === 'ready'` panel (currently: topic label, the first probe's raw text, two buttons). New plate:

- **Shape of the sitting:** `N due across K topics`, oldest overdue by `D` days, from the already-fetched queue. Per-topic breakdown as compact rows (topic, count) when K > 1.
- **Estimated length:** derived from the engine's own cap heuristic already encoded here (`totalDue > 24` amnesty mirrors SKILL.md's ~12 standard cap) — state it as "a normal sitting covers about 12, most-overdue first," never a countdown timer.
- **The amnesty line** keeps its current wording and position when `totalDue > 24`.
- **The first probe's text is removed** from this surface. Seeing the question before you've chosen to sit down starts the retrieval clock early and lets you rehearse; the plate names the node's *topic*, not its probe.
- Start / Resume actions unchanged.

## B. Pinned probe

While a sitting runs, the current item's card can be pinned to stay visible as the transcript scrolls (same thumb-tack grammar and `PinTackIcon` as the masthead/ticket). Default unpinned; state resets per sitting. Purely a viewport convenience — the card's content is unchanged.

## C. Horizon figure

Replaces the one-line `phase === 'empty'` state (and appears under the ceremony at `done`):

- 14-day tick figure of upcoming returns (day ticks, height ∝ count) built from topic graphs' `fsrs.due` — the same local-date discipline as the due lens. Reuse `DueForecast`'s data path if it already computes this; otherwise derive alongside it.
- One fig-caption reading the plot honestly: "Fig. — the next wave lands <date>" / "nothing scheduled inside two weeks."
- A line for what's holding: count of nodes at stability ≥ 21d, stated plainly.

## D. Honest blank

A ghost affordance beside the composer, appearing only after **45 seconds** on the current item (you get time to actually try). Clicking it prefills the composer with `I can't retrieve this one.` and focuses it — the learner still presses send. Copy under it: nothing. No explanation, no absolution text; the rite and the assessor handle that. Disappears once the composer has content.

## E. Schedule delta card

At `done`, beside/above the ceremony: what the sitting bought.

- Per node: `3d → 8d` interval movement (from each `GradeResult`'s intervalDays vs the node's prior interval, derived from receipts the same way the ladder does — real dates only, omit a row when the prior is unknowable).
- Summary line: earliest return before vs after, and how many nodes moved past the 21-day horizon.
- No row when nothing moved (a sitting of pure lapses says so plainly).

## F. Queue rail

A thin rail above the transcript during a sitting: one ink mark per item — completed (filled, grade-toned), current (hot, larger), remaining (hollow, **unlabeled**). Hovering a completed mark names its node and grade; remaining marks name nothing, ever (no priming). Replaces/absorbs the current "Item N of M" text.

## G. Stability figure

The ceremony's stability rows become a paired-bar figure: per node, a before bar and an after bar (cool → grade-toned), sorted by movement, with the node name in the gutter. Total durability gained stated once beneath in tabular mono. Rows with no `sBefore`/`sAfter` are omitted, not zero-filled.

## H. Assessor audit card

The engram assessor can re-check its own grading (`engram-assessor` is invoked for `/review` audits). The implementer **must first verify the real in-stream signal** by inspecting actual review transcripts (same discipline as the misconception/explorable detectors: grep for the audit invocation, record the verbatim shape in the report) and implement only what is genuinely detectable. When found: a card naming what was audited and whether the verdict held — the engine's self-check made visible. If no reliable signal exists in real transcripts, implement nothing and say so; this item is contingent on evidence.

## Out of scope

Queue filtering/reordering by the user; per-item difficulty display before answering; any change to grading, capping, or scheduling.

## Verification

- Ready room shows the real queue shape and no probe text; amnesty still fires above 24.
- Probe pin holds through scrolling; resets next sitting.
- Empty state draws the 14-day figure from real due dates; caption matches the data.
- Honest blank appears at 45s, prefills without sending, vanishes when the composer has text.
- Delta and stability figures match a spot-checked sitting's receipts; queue rail never names an unreached item; audit card either matches a verified transcript signal or is absent with the finding recorded.
