# Review Tab + Plate Beautification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the eight Review-tab items and the four plate-beautification passes per `../specs/2026-07-25-review-tab-design.md` and `../specs/2026-07-25-plate-beautification-design.md`.

**Architecture:** Review work is renderer-side over data already fetched (`due()`, topic graphs, receipts, `GradeResult`s) plus the established ritual-mark plumbing. Plate work is pure SVG rendering — static `<defs>` referenced by existing shapes, no changes to layout, hit-testing, or the drift path.

**Tech Stack:** existing only; no new deps.

## Global Constraints

- The engine owns the queue: nothing selects, reorders, skips, caps, or re-grades. Read-only toward engram state.
- **No priming:** never reveal an answer, a difficulty signal, or an unreached node's identity before it is asked.
- Honest blank PREFILLS only — the no-auto-send rule is absolute.
- Copy: absolve-never-pity, no exclamation marks, no streak-guilt, no celebration inflation.
- Night Atlas vocabulary; motion tokens; once-per-trigger; reduced-motion via the global kill-switch (JS-driven motion carries its own matchMedia, `GraphView.tsx:134` pattern).
- Plate effects must be **static defs applied by reference** — no new work inside the ~30fps drift render path.
- Verification per task: `cd app && npm run typecheck && npm run build`.

---

### Task 1: Ready room plate + horizon figure

**Files:**
- Create: `app/src/renderer/src/components/ritual/ReadyRoomPlate.tsx`, `components/ReviewHorizon.tsx`
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx` (the `phase === 'ready'` panel ~l.523 and `phase === 'empty'` ~l.500; horizon also under the ceremony at `done`)

**Interfaces:**
- Consumes: the already-fetched `queue`/`totalDue`/`earliestDue` state in ReviewSessionView; `window.engram.topics()` + `topicGraph()` for the 14-day buckets (see `DueForecast.tsx` — it takes `buckets: number[]` and is written generically enough to extend past 7; find HomeView's bucket derivation and REUSE it, extending the horizon to 14 rather than duplicating the walk. If DueForecast's day-label logic assumes a week, generalize it or build ReviewHorizon beside it and say which in the report).
- Produces: `<ReadyRoomPlate dueItems, totalDue, onStart, onResume, hasPriorSession, blocked />` and `<ReviewHorizon buckets, holdingCount />`.
- Ready room content per spec §A: `N due across K topics`, oldest overdue by `D` days (local-date math — reuse `daysOverdueLocal` already in this file), per-topic rows when K > 1, the "a normal sitting covers about 12, most-overdue first" line, the existing amnesty panel when `totalDue > 24`, Start / Resume actions.
- **Remove the first probe's text from the ready surface** (spec §A) — the plate names topics, never the probe.
- Horizon: 14 day-ticks, height ∝ count; caption "Fig. — the next wave lands \<date\>" or "nothing scheduled inside two weeks"; a plain line counting nodes at stability ≥ 21d.

- [ ] Build both components; wire into the three phase branches.
- [ ] Verify + commit `feat(review): ready room plate and the 14-day horizon`.

### Task 2: Pinned probe + honest blank

**Files:**
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx` (current-item card ~l.557; composer area), `app/src/renderer/src/components/MessageComposer.tsx` (new optional affordance slot)

**Interfaces:**
- Pin: reuse `components/ui/PinTackIcon.tsx` and the ticket's grammar (bottom-right tack, warm-filled when pinned). Pinned → the current-item card sticks (position: sticky within the scroll parent, or hoisted above the scroll region — pick whichever preserves the existing layout exactly and say which). Default unpinned; resets per sitting alongside the other ephemera.
- Honest blank: a new optional prop on MessageComposer, e.g. `assist?: { label: string; onUse: () => void } | null`, rendered as a ghost button beside the existing controls. ReviewSessionView owns the 45s timer: starts when the current item changes, clears on item change/unmount/when `production` is non-empty; `onUse` sets the composer text to `I can't retrieve this one.` and focuses it. **It must not submit.** No explanatory copy beneath it.
- Timer must not leak across items (clear in the same effect that starts it) and must not fire in `done`/`ready` phases.

- [ ] Implement both; verify the composer's existing callers are unaffected (the prop is optional).
- [ ] Verify + commit `feat(review): pinned probe and the honest blank`.

### Task 3: Schedule delta card + stability figure

**Files:**
- Create: `app/src/renderer/src/components/ritual/ScheduleDelta.tsx`, `components/charts/StabilityMovement.tsx`
- Modify: `app/src/renderer/src/components/ritual/Bookends.tsx` (SessionCeremony's stability rows → the figure), `app/src/renderer/src/app/ReviewSessionView.tsx` (delta card at `done`)

**Interfaces:**
- Delta input: the sitting's `sessionGrades: GradeResult[]` plus each node's prior interval derived from receipts — **reuse `IntervalLadder`'s data path** (`components/IntervalLadder.tsx` already fetches+caches receiptsHistory and computes per-node dated gaps; extract or import rather than re-fetching). Rows: `<node> 3d → 8d`; omit any row whose prior interval is unknowable (never fabricate). Summary: earliest return before vs after; count moved past 21 days. Renders nothing when no row survives, with one honest line if the sitting was all lapses.
- Stability figure: paired before/after bars per node from `sBefore`/`sAfter` (cool → grade-toned), sorted by movement magnitude, node name in the gutter, total durability gained beneath in tabular mono. Rows lacking either value are omitted, not zero-filled. It REPLACES the current text rows inside `SessionCeremony` — Learn's ceremony uses the same component, so verify both surfaces still read correctly.

- [ ] Build both; wire; check Learn's ceremony too.
- [ ] Sanity: spot-check one real sitting's numbers against receipts (report).
- [ ] Verify + commit `feat(review): schedule delta and the stability movement figure`.

### Task 4: Queue rail + assessor audit card (contingent)

**Files:**
- Create: `app/src/renderer/src/components/ritual/QueueRail.tsx`, and `ritual/AuditCard.tsx` **only if** the signal is verified
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx`, `app/src/shared/ritualFromTranscript.ts` + `components/ritual/Marks.tsx` (audit mark, if implemented)

**Interfaces:**
- Rail: one mark per sitting item — completed (filled, grade-toned), current (hot, larger), remaining (hollow). Completed marks carry a `title` naming node + grade; **remaining marks carry no identifying text, ever** (no priming — this is a spec constraint, not a preference). Absorbs the existing "Item N of M" readout (remove it once the rail carries the same information).
- Audit card: **evidence-gated.** FIRST grep real review transcripts for the assessor's audit invocation (`grep -l audit ~/.claude/projects/*/*.jsonl`, inspect the matching assistant Bash/Task tool_use shapes; the engram-assessor subagent is documented as handling `/review` audits). Record the verbatim shape in your report. If a reliable signal exists → detector in the shared module + live wiring + card naming what was audited and whether the verdict held, following the misconception/explorable pattern exactly. **If no reliable signal exists in real transcripts, implement nothing, delete the stub, and say so plainly in the report** — do not invent a detector against a guessed shape.

- [ ] Rail first (unconditional), then the audit investigation.
- [ ] Verify + commit `feat(review): queue rail` (+ audit card only if evidenced).

### Task 5: Plate grain, vignette, and furniture

**Files:**
- Modify: `app/src/renderer/src/components/GraphView.tsx` (defs + background layers + furniture), `app/src/renderer/src/app/TopicMapView.tsx` (legend framed as a key)

**Interfaces:**
- Grain: one `<feTurbulence>` filter in `<defs>`, applied to a single full-plate `<rect>` behind all content, opacity ~0.035 (tune by eye; state the final value and why in the report). Vignette: a `<radialGradient>` rect above the grain, below the drawing.
- **Both belong to the plate, not the drawing:** they must NOT live inside the pan/zoom transform group — the specimen moves across the paper, the paper stays put. Verify by reading how the transform group is structured before placing them.
- Furniture: plate title upper-left inside the plate (`Fig. — <topic title>` serif + mono sub-line `<N> cells · <M> consolidated` from `plateStats`), hairline border with corner registration ticks, all `pointer-events: none`; legend gains a `Key` label and hairline rules between rows. All furniture hides while `replayActive` (pass the existing flag through if GraphView doesn't already know it — it receives `visibleNodes`, which is non-null exactly during replay; prefer that over a new prop and note the choice).
- Zero new per-frame work: everything static defs or fixed-position overlays outside the drift path.

- [ ] Implement; confirm drift smoothness is unchanged (state how you verified).
- [ ] Verify + commit `feat(map): plate grain, vignette, and figure furniture`.

### Task 6: Engraved fills + calligraphic edges

**Files:**
- Modify: `app/src/renderer/src/components/GraphView.tsx`

**Interfaces:**
- Fills: static `<pattern>` defs — fine diagonal hatch (warm) for `state === 'review'`, sparse stipple (cool) for `'learning'`, nothing for `'new'`. Applied as the node body `fill` alongside the existing color; hatch spacing constant in screen space (`patternUnits="userSpaceOnUse"` interacts with the zoom transform — verify which unit space keeps spacing stable and say so). **Suppressed under the due lens** so the schedule reading stays clean (one lens at a time).
- Edges: requires-edges become filled tapered paths — build the outline by offsetting the existing `stringEdgePath` spine perpendicular by a width that ramps ~2.2px → ~0.8px from prerequisite to dependent, so the ink lifts as it travels. The spine is the SAME curve function, so sway/drift is unchanged. Non-requires edges keep their uniform hairline. Small ink arrowheads at the dependent end, screen-space sized, following every existing suppression rule (hub-suppression via `isEdgeVisible`, replay clipping via `visibleNodes`, due-lens/trail gating) — read those code paths and mirror them exactly rather than adding parallel logic.
- Trail overlay edges keep their current uniform bright stroke (annotation, not drawing).

- [ ] Implement; verify a spot-checked pair's arrow points prerequisite → dependent.
- [ ] Verify + commit `feat(map): engraved node fills and calligraphic edges`.
