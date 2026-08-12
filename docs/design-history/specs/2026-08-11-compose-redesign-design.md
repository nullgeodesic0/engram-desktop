# The Step Composer, Redesigned

**Date:** 2026-08-11
**Status:** Approved design

## Goal

The mobile compose card — the derivation-writing interaction for SELF-EXPLAIN and a
carved-out VERIFY — feels wrong to use. Three specific complaints, gathered by
brainstorming with the person who uses it:

1. **The palette is too granular.** Twelve clause-sized tokens, each a fragment like
   "meet the employer as," is hard to scan and hard to hold in mind while composing.
2. **The layout is awkward.** A grid of that many similar-looking chips does not read
   well on a 440pt screen.
3. **The flow is too rigid.** Building one line, tapping a separate "Place this line"
   button, watching it lock, then starting the next line — three distinct ceremonies
   per line, and the moment of commit feels premature given how little chance there is
   to reconsider.

This redesign does not touch the underlying evidence model. Compose stays
production-from-a-constrained-vocabulary, still phone-stamped, still rating-capped,
still governed by `learn-skill.mobile-walk-protocol.md`. What changes is the size of
the vocabulary and the ceremony around using it.

## Decisions taken during brainstorming

| Question | Decision |
|---|---|
| What's driving the redesign | The interaction itself feels wrong, not the evidence it produces |
| Palette | Coarsen it — fewer, bigger chunks, not more scaffolding around the existing ones |
| Flow | Flatten it — remove the per-line commit ceremony |
| Locking policy | **Keep it.** A chunk still locks the moment its line completes; no backtracking into an earlier line. Only the CEREMONY of committing goes — not the rule the ceremony enforced |

The locking decision is the one load-bearing trade-off in this spec. The overlay is
explicit about why backtracking is refused: *"Backtracking turns retrieval into
search, and search is not retrieval."* The redesign keeps that property exactly —
every line still locks, irreversibly, the instant it completes. What it removes is the
separate button press that used to make locking feel like a distinct, effortful,
slightly frightening event. Locking becomes ambient: a consequence of finishing a
line, not a decision the learner has to additionally commit to.

## Current state (for contrast)

- **Schema** (`app/src/shared/cardPack.ts` `composeCard`, mirrored in
  `Sources/EngramKit/CardPack.swift` `ComposeCard`): a palette of 6–12
  `{id, label}` tokens, shared across the whole chain; 2–4 steps, each needing 2–3
  tokens drawn from that shared palette.
- **Flow** (`Sources/EngramUI/CardViews.swift` `ComposeCardView`): the learner taps
  palette tokens into a "pen" for the current line, taps **"Place this line"** once
  the line is built, watches the line lock into the page above, and repeats for the
  next line. The primary button swaps roles once every line is placed, becoming
  **"Commit the chain"** — a second, separate, irreversible tap.
- **Distractor floor**: `palette.length >= used.size + max(3, ceil(used.size / 2))` —
  the palette always holds real spare pieces, so the chain cannot be finished by
  elimination alone.

## The redesign

### Palette: coarser, fewer

- **Line length drops from 2–3 tokens to 1–2.** Each token now carries roughly half a
  clause's worth of content — closer to "meet the employer as a stranger who might not
  pay" than today's "meet the employer as" / "a stranger who might not pay" split
  across two taps.
- **Palette size drops from 6–12 to roughly 4–8.** The distractor-floor formula stays
  the same shape (spare pieces scale with tokens actually used), just applied to a
  smaller total.
- This is a change to what the *tutor* writes, not merely how the phone renders it.
  `composeCard`'s zod schema (min/max bounds on `palette` and `sealed.steps[].tokens`)
  and the `emit_card_pack` bridge tool's own authoring instructions
  (`mcpBridgeWorker.mjs`'s system-prompt text) both need the new bounds, or the tutor
  keeps writing twelve fragments into a palette sized for four.

### Flow: one continuous build, ambient locking

- The palette is visible as a single grid from the moment the card opens — not
  revealed per-line.
- Tapping a token appends it to the current line's pen, exactly as today.
- **The moment a line reaches its true token count, it locks and the view advances to
  the next line automatically.** No "Place this line" tap. The learner's last tap for
  a line is the same tap that starts the next one.
- Only the in-progress line is editable — tapping a placed token in the CURRENT line
  removes it, same as today. A line that has already auto-advanced past is locked,
  full stop.
- The existing "reopen the last line while the new one is still empty" escape hatch
  survives unchanged: if the pen for the new line is empty, tapping the just-locked
  line above still takes it back, exactly as `reopenLast()` does today. This is the
  one deliberate crack in "locks are locks" that already existed, and nothing about
  this redesign asks to close it.
- The **final line still ends in an explicit "Commit the chain" button.** That one
  action cannot become ambient — it is the graded, irreversible submission of the
  whole answer, and an accidental last-tap auto-submitting a derivation would be a
  much worse failure than one extra tap.

### What does not change

- Grading (`Sources/EngramKit/MobileWalk.swift`'s `.compose` case): still compares the
  learner's committed token-id sequence, line by line, to `sealed.steps[].tokens` — no
  change, since correctness was always by id, never by palette position or token size.
- Rating cap, phone source stamp, provisional status: untouched. This is a UI and
  authoring-granularity change, not a change to what compose is worth as evidence.
- The "shared alphabet across the whole chain" property: still shared, still not
  per-step, for the same reason as today — a per-step palette leaks the shape of each
  line.

## Files

**EngramMobile:**
- `Sources/EngramKit/CardPack.swift` — `ComposeCard.Sealed.Step.tokens` bound (2–3 →
  1–2); `ComposeCard.palette` bound (6–12 → ~4–8, exact figure set during
  implementation against the real distractor-floor formula).
- `Sources/EngramKit/ComposeChain.swift` (or wherever `ComposeChain` actually lives —
  confirm during implementation) — the per-line auto-advance-on-completion behavior;
  today's `commitStep()` becomes implicit rather than caller-invoked once a line's
  token count is reached.
- `Sources/EngramUI/CardViews.swift` `ComposeCardView` — remove the "Place this line"
  button entirely; keep "Commit the chain" as the sole remaining action, shown only
  once the whole chain is complete; keep the existing `reopenable` affordance as-is.
- `Tests/*` — `ComposeChain`'s existing unit tests need new cases for auto-advance
  behavior; `overlayParityTests()`/`ReceiptsTests.swift` fixtures using `composeCard`
  need their `tokens` arrays resized to the new 1–2 bound.

**EngramDesktop:**
- `app/src/shared/cardPack.ts` `composeCard` schema — same bound changes, kept in
  lockstep with the Swift side (this is exactly the kind of drift the shared-fixture
  discipline elsewhere in this codebase exists to catch; consider whether compose
  needs the same treatment or whether the existing zod/Swift pair of hand-written
  schemas is sufficient here, matching how the other card kinds are handled today).
- `app/src/main/bridge/mcpBridgeWorker.mjs` — the `emit_card_pack` tool's own
  authoring guidance (the inline doc text the tutor reads) needs the new palette-size
  and per-line-token-count numbers, or every pack it writes fails the new schema on
  the first attempt.
- `app/src/shared/cardPack.test.ts` — bound tests for the new min/max.
- `app/scripts/checkDoctrine.ts` — if the `emit_card_pack` tool description is a
  pinned load-bearing string anywhere in D5, it needs re-pinning in the same commit.

## Verification

- `./Scripts/test.sh` (EngramMobile) and `npm run typecheck && npx vitest run src &&
  npm run check:doctrine` (EngramDesktop) — both green, as established practice
  throughout this codebase.
- A real tutoring sitting authors at least one compose card under the new bounds and
  it is accepted by `validateAgainstOverlay`/`overlayViolations()` without a refusal.
- On-device: walk a compose card on the simulator, confirm auto-advance fires exactly
  when a line's token count is reached, confirm the reopen-last-line affordance still
  works, confirm "Commit the chain" only appears once every line is complete and still
  requires its own explicit tap.

## Open, deliberately deferred

- **Exact palette-size number within the 4–8 range**, and exact per-line token count
  within 1–2 — left for implementation to settle against the real distractor-floor
  arithmetic and a few real authored examples, rather than picked in the abstract here.
- **Visual redesign of the palette grid itself** (approach C from brainstorming — a
  carousel or grouped/progressive reveal) — not pursued, since coarsening the unit
  already addresses the scanning complaint this would have targeted. Revisit only if a
  coarser palette still reads as crowded in practice.
