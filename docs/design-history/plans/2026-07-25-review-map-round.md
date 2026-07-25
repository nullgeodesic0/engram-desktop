# Review Moments & Map Lenses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the three Review moments and four map lenses per `../specs/2026-07-25-review-map-round-design.md`.

**Architecture:** Review moments follow the engine-moments patterns exactly (mark plumbing, shared derivation where derivable). Map lenses are pure renderer derivations over the graph/decay/provenance data TopicMapView already fetches.

**Tech Stack:** existing only; no new deps.

## Global Constraints

- Advisory/display-only; honest copy; Night Atlas tokens; once-per-trigger animation; reduced-motion safe (global CSS kill-switch; JS-driven motion carries matchMedia, GraphView.tsx:134 pattern).
- Ladder/docket/rite use REAL data only (due(), receiptsHistory dates, rate results) — never fabricate rungs or dates.
- Verification per task: `cd app && npm run typecheck && npm run build`.

---

### Task 1: Review docket + lapse rite

**Files:**
- Create: `app/src/renderer/src/components/ritual/ReviewDocket.tsx`, `ritual/LapseRite.tsx`
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx` (docket at session open; rite after lapsed grades), `app/src/shared/ritualFromTranscript.ts` (derive rite from lapsed rate results — mark kind `{kind:'lapse', node, returnDate?}`), `components/ritual/Marks.tsx` (union + view + doctrine note: docket is one-time, rite is derivable), `components/SessionHistoryDrawer.tsx` inherits via derivation

**Interfaces:**
- Docket: on review session start (where the view calls startSession/resumeSession — fresh sittings only), fetch `window.engram.due()` (read its return shape in preload/types first) → render above the transcript: rows of humanized node + topic tag + `label-data` days-overdue (from fsrs.due vs local today), oldest first, cap 8 with "and N more…". One-time (doctrine comment).
- Rite: in ReviewSessionView's rate-result handler (where parseGradeResult lands), grade === 'lapsed' → push a `lapse` mark after the grade card; returnDate from the result's intervalDays (local date + interval) when present. Derivation mirrors it (rate results are already walked). Copy EXACT: "Filed for relearning — returns <date>." caption "a lapse resets the interval, not the work."

- [ ] Components + wiring + derivation + doctrine comments.
- [ ] Verify + commit `feat(review): opening docket and the lapse rite`.

### Task 2: Interval ladder on grade cards

**Files:**
- Create: `app/src/renderer/src/components/IntervalLadder.tsx`
- Modify: `app/src/renderer/src/components/GradeResultCard.tsx` (revealed face), callers that can supply history (`ReviewSessionView.tsx`, `LearnSessionView.tsx`, `SessionHistoryDrawer.tsx`) — thread a `nodeDates?: string[]` prop or fetch inside the card via a small cached helper (choose: a module-level cached fetch of receiptsHistory shared across cards is simpler than threading through three surfaces — justify choice).

**Interfaces:**
- Ladder input: the node's dated review events from `receiptsHistory().days[].items` (filter by topic+node, unique local dates sorted) + the just-landed interval (result.intervalDays) as the final rung. Rungs = gaps in days between successive dates; render left→right, height ∝ log2(1+days) scaled to ~5-18px, warm ink; a rung whose event graded lapsed renders danger and steps down. Cap 7 rungs (elide oldest with a leading "…"). < 2 dated events → render nothing. Tooltip (title) lists raw day counts. Tabular numerals for any text.
- GradeResultCard: ladder sits under the stability bar, revealed face only; no flip-mechanics changes (same discipline as the return chip).

- [ ] Component + data helper + integration in all three grade-card surfaces.
- [ ] Sanity: spot-check one real node's ladder against its receipts dates (report).
- [ ] Verify + commit `feat(review): interval ladder — the memory's return history on each grade`.

### Task 3: Prerequisite trail + due lens + territory labels

**Files:**
- Modify: `app/src/renderer/src/components/GraphView.tsx` (trail computation + rendering, due-lens coloring, territory labels), `app/src/renderer/src/components/graph2d/plate.ts` (pure helpers: `ancestorClosure(graph, node)`, `descendantPath(graph, node)` — via edges.requires transitive walks, cycle-safe), `app/src/renderer/src/app/TopicMapView.tsx` (due-lens toggle state + legend swap)

**Interfaces:**
- Trail: while `selected` non-null — nodes in ancestor closure ink cool, descendant path toward capstone inks warm, selected stays hot; all others drop to ~0.15 opacity (further than today's dim). First-order hover behavior unchanged when nothing is selected. Capstone-edge suppression rules already in GraphView must keep applying (read the existing first-order path code before touching).
- Due lens: `dueLens` prop; node body stroke/fill switches to schedule palette — overdue (fsrs.due < today, local) danger + a soft glow (existing glow patterns), due-today warm, future cool-dim, state==='new' unchanged. Legend rows swap to explain the three states while active.
- Labels: `territoryGroups` centroids (hull centers already computed for washes — reuse) → faint serif text (fig-caption styling at ~11px, opacity 0.35), pointerEvents none, hidden when dueLens active.

- [ ] plate.ts pure helpers (cycle-safe, unit-reasoned in comments) + GraphView rendering + TopicMapView toggle.
- [ ] Verify + commit `feat(map): prerequisite trail, due lens, territory labels`.

### Task 4: Growth time-lapse

**Files:**
- Create: `app/src/renderer/src/components/GrowthScrubber.tsx`
- Modify: `app/src/renderer/src/app/TopicMapView.tsx` (replay affordance + scrub state), `app/src/renderer/src/components/GraphView.tsx` (accept `visibleNodes?: Set<string> | null` — when set, nodes outside it render at near-zero opacity and their edges hidden; null = live plate)

**Interfaces:**
- Timeline: from the already-fetched `nodeProvenance(topic)` — per node firstEncoded.date (nodes without one appear only at the end, t=1). Scrubber maps [0,1] → [earliest date, today]; `visibleNodes` = nodes whose date ≤ t's date. Date readout in fig-caption ("<Month d> — n of N nodes inked").
- Play: button steps t 0→1 over ~6s via rAF (matchMedia guard: reduced motion jumps to 1). Scrub pauses play. Closing replay (toggle off) restores `visibleNodes=null`.
- Styled range input: Night Atlas track/thumb in index.css (webkit slider pseudo-elements), tokens only.

- [ ] Component + GraphView prop + TopicMapView wiring.
- [ ] Verify + commit `feat(map): growth time-lapse — the atlas redrawn from its own dates`.
