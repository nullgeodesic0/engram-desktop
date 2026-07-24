# Chat Loop Polish — Design

## Context

The `/learn` and `/review` chat loops (`LearnSessionView.tsx`, `ReviewSessionView.tsx`) already have a lot of interaction polish (M6.5/M9: `BeatStepper`, `TypingIndicator`, scroll-follow, copy/edit-resend, Stop button). What's still missing is *information* — the loop doesn't visibly answer "what node am I on," "where am I in the flow," or "what just happened when I got graded." The user wants UI elements that surface these key moments of the loop with real data and graphics, not just prose scrolling by.

Grounding: Engram's CLI already emits everything needed as structured JSON on stdout for both grading paths — confirmed by reading `engram.py`'s `emit()` (prints `json.dumps(obj, indent=2)`), `apply_item()` (the `rate` path, returns `{node, rating, state, due, s_before, s_after, interval_days, days_since_encode, ...}`), and `cmd_receipt()` (Learn's batch-grade path, returns an array of the same shape). This JSON is exactly what lands in the `SessionToolResultEvent.content` the renderer already receives — no new IPC or engine change needed, only client-side parsing of data already in hand.

## Decisions (from brainstorming Q&A)

- Scope: five features, all in — (A) sticky session header, (B) grade-result card, (C) ambient mode-change cue, (D) session-end summary card, (E) confidence-picker visual polish.
- Feel: not the calm/ambient NeuralField direction and not pure gamification — informational graphics tied to real loop state (current node, loop position, grade outcome), in the user's own words.
- C is deliberately scoped down from a full second pub/sub signal path to a CSS transition on the header itself, keyed off the same events B already detects — avoids inventing a duplicate signal for information the app already has.
- No new engine/IPC surface anywhere in this spec — everything is parsed from `tool_result.content` the app already receives, or from `stats()`/`due()` calls the views already make.

## Architecture

### Shared: grade-result parsing (`shared/gradeResult.ts`, new)

```ts
export interface GradeResult {
  node: string
  rating: 'again' | 'hard' | 'good' | 'easy'
  grade: 'lapsed' | 'partial' | 'recalled'   // derived, mirrors engram.py's GRADE_OF_RATING
  state: string
  sBefore: number | null
  sAfter: number | null
  intervalDays: number | null
  daysSinceEncode: number | null
}

export function parseGradeResult(content: unknown): GradeResult | null
export function parseGradeResults(content: unknown): GradeResult[]  // receipt's array shape
```

Tolerant parsing only: `content` is Bash stdout text, JSON.parse wrapped in try/catch, missing/malformed fields fall back to `null` fields rather than throwing. A parse failure means no card renders — same "best-effort, never blocks" discipline as `beatLabelParser.ts`. The `again→lapsed, hard→partial, good/easy→recalled` mapping is a literal port of `engram.py`'s own `GRADE_OF_RATING` table so the UI's language can never drift from the engine's.

### A. Sticky session header

**Review** (`ReviewSessionView.tsx`): the existing in-session node card (currently lines 323-330, shown once per item) gets one addition — `Item {queueIndex} of {sessionTotal}`. `sessionTotal` is captured once when a session starts (`queue.length` at that moment); `queueIndex` is `sessionTotal - queue.length + 1`, recomputed as `refreshQueue()` shrinks the live `queue` array. No new state beyond one `sessionTotal` number set in `startSession`.

**Learn** (`LearnSessionView.tsx`): add the current node's humanized title next to `BeatStepper` in the header. The node id is already extracted by `looksLikeNextNodeCall` (existing regex on the `next --topic` Bash call) — it just isn't stored/displayed today. Store it in existing `currentBeat`-adjacent state as `currentNodeId`, render `humanizeNodeId(currentNodeId)` (already imported) next to the stepper.

Both changes are additive to the existing sticky header — no new scroll region, no new component.

### B. Grade-result card (`components/GradeResultCard.tsx`, new)

```ts
interface GradeResultCardProps { result: GradeResult }
```

Renders: a color-coded grade badge (recalled → `--color-ink-warm`, partial → `--color-ink-cool`, lapsed → `--color-ink-danger-dim`, matching the palette already used for state colors elsewhere), a small horizontal bar animating from `sBefore` to `sAfter` (CSS transition on width, not a chart library — same "no new dependency for a simple bar" precedent as `RetentionTrend.tsx`), and a plain-language next-review line ("back in {intervalDays} days" / "due now" if 0).

**Wiring — Review**: in `handleSessionEvent`'s existing `tool_result` case (where `looksLikeRateCall` already detects the rate tool_use), parse `event.content` with `parseGradeResult` and, if non-null, push a small synthetic entry into the `messages` transcript (a new `ChatMessage` variant `{ role: 'system', kind: 'grade', result }`, rendered by `ChatMessageView` as a `GradeResultCard` instead of a text bubble) rather than only firing `emitPulse` + `refreshQueue` as today.

**Wiring — Learn**: add a new Bash-call detector `looksLikeReceiptCall` (mirrors the existing `looksLikeNextNodeCall`/`looksLikePretestRate` pattern — command includes `receipt` and `--file`). On its `tool_result`, `parseGradeResults` the content and render one `GradeResultCard` per node as a small stack, same transcript-injection mechanism as Review.

### C. Ambient mode-change cue

No new signal path. The sticky header (A) gets a CSS transition (`transition-colors duration-300`, matching the existing pattern already used in `BeatStepper`) that triggers off state changes B/A already produce: `currentBeat` changing (Learn) or a new `GradeResult` landing (Review/Learn). Implemented as a `key`-based remount or a toggled class on the header container — no `neuralFieldBus` involvement, since that bus is for the ambient backdrop, not in-content UI, and reusing it here would be a second signal for the same event.

### D. Session-end summary card

**Review**: when `phase` transitions to `'done'`, replace the current one-line "Queue clear" text with a small panel: total node count for the session (count of `GradeResult`s collected via B), a grade tally (recalled/partial/lapsed counts, derived client-side from those same results — no new fetch), and current streak pulled from `window.engram.stats()` (same call `HomeView.tsx` already makes on mount).

**Learn**: same treatment at the point the batch `receipt` grade cards (B) render — since Learn grades once at session end, B's card stack and D's summary appear together; D just adds the streak line and tally header above the stack.

### E. Confidence-picker visual polish

`AskDialog.tsx`'s existing `isConfidence` branch (currently only a border-color hint on the shared generic layout) gets its own render path: the four confidence options rendered as a row of distinct buttons, each with an icon and a position on a cool→warm gradient (mirrors the grade-badge palette from B, so "confident" and "recalled" read as the same color language). Falls back to today's generic list for every non-confidence `AskDialog` (session logistics, mode choice, amnesty offers) — unchanged.

## Out of scope

- No changes to the underlying session-driving logic, stash/grade timing, or any engine call — purely a rendering layer over data already flowing through the app.
- No new IPC handlers, no new `engram.py` calls.
- `neuralFieldBus`/`NeuralField.tsx` are not modified — C is intentionally self-contained to the chat views.

## Verification

- Run a real `/review` session against actual due items: confirm the sticky header shows correct "Item N of M," confirm a real `rate` call renders a `GradeResultCard` with a grade/stability/due-date that matches the receipt written to `receipts/<topic>.jsonl` for that item, confirm the session-end summary's tally matches the cards shown that session.
- Run a real `/learn` session through at least one full node: confirm the node title appears next to the beat stepper and updates on the next node boundary; confirm the end-of-session `receipt` batch renders one card per graded node with correct grades.
- Trigger the confidence picker during a real session and confirm all four bands render distinctly and still submit the correct answer; confirm a non-confidence `AskDialog` (e.g. mode selection) still renders the unchanged generic layout.
- `npm run typecheck` + `npm run build` clean throughout (per the established no-interactive-verification-during-implementation constraint — see SDD ledger process note); the above bullets are for a final live pass once implementation is complete.
