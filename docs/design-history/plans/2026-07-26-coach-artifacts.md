# Coach & Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the four items in `../specs/2026-07-26-coach-artifacts-design.md`.

**Architecture:** Three of the four are renderer-side over data the app already fetches (`receiptsHistory`, `topicGraph`, `artifactList`, `nodeProvenance`). One needs two new read-only IPCs: `graderHealth` (the subcommand is already on the allowlist and has zero call sites) and an audits-history read that walks `~/.claude/learning/audits/` the way `readTopicGraph` walks `graphs/`.

**Tech Stack:** existing only; no new deps.

## Global Constraints

- **No computer control / no launching the app.** Not `npm run dev`, not the packaged app — the user has forbidden screen-driving and live sessions are routinely running. Verification is `cd app && npm run typecheck && npm run build` plus reading real data on disk and read-only `engram.py` calls. Visual-only questions go to the user in the report.
- Read-only toward engram. **`main/engramCli/readOnly.ts` must not change in this project** — if a task thinks it needs an allowlist edit, stop and report instead.
- **No prose detectors.** Coach transcript output was inspected (both real sittings) and is free-form. Every rendered number traces to a named JSON field or it does not render.
- Reuse, don't reimplement: `charts/{RetentionCurve,CalibrationScatter,StabilityMovement,ActivityStrip}`, `NodeTable`, `searchIndex.ts`'s matcher, `humanizeNodeId`, `plateStats`, `friendlyErrorText`, `shared/nodeDisplay.ts`.
- Local-date discipline: `getFullYear/getMonth/getDate`, **never** `toISOString`.
- Night Atlas vocabulary; hidden-when-empty; no wrapper tells in user-visible copy.

---

### Task 1: Per-topic drilldown

**Files:**
- Create: `app/src/renderer/src/app/TopicDrilldownView.tsx`
- Modify: `app/src/renderer/src/app/DashboardView.tsx` (topic rows become the entry point), `App.tsx` (routing)

**Interfaces:**
- Read `DashboardView.tsx` in full first. Its per-bucket retention, calibration join (`allPicks` × receipts), and momentum are the code paths to **restrict by topic**, not to reimplement. Extract the shared computation into a helper both the global view and the drilldown call with an optional topic filter; a second implementation that disagrees with the global view is the failure mode this task exists to avoid.
- Composes: retention buckets, calibration scatter, momentum/activity, `NodeTable` (P2 — it takes a `TopicGraph`, which `topicGraph(topic)` supplies), a provenance summary, and that topic's artifacts.
- Small-n honesty: a retention bucket below a stated minimum renders its count, not a rate, and says why in the app's own voice. Pick the minimum, state it in the report, and make it one constant, not a scattered literal.
- Back to Coach; the drilldown is a view, not a modal.

- [ ] Extract the topic-filterable computation; build the drilldown; wire the topic rows.
- [ ] **Reconcile:** for grad-classical-mechanics, hand-derive retention buckets and the calibration join from `~/.claude/learning/receipts/grad-classical-mechanics.jsonl` and compare against what the drilldown computes AND against the global view filtered the same way. Paste all the numbers. A mismatch means one is wrong — find out which before proceeding.
- [ ] Verify + commit `feat(coach): a topic's own numbers`.

### Task 2: The grader's audit record

**Files:**
- Modify: `app/src/main/ipc/readHandlers.ts` (two handlers), `app/src/preload/index.ts`, `app/src/shared/types.ts`
- Create: `app/src/renderer/src/components/GraderAudit.tsx`
- Modify: `app/src/renderer/src/app/DashboardView.tsx` (place it)

**Interfaces:**
- `graderHealth()` → `engramRead('grader-health')`. Already allowlisted; **do not touch `readOnly.ts`**. Real output verified on disk: `{audited, ts, grader, n, runs, qwk, exact_agreement, leniency_bias, test_retest, direction{graded_up,graded_down,exact,judgments,note}, confusion{}, by_case_type{}, by_run[], thresholds{}, coverage{}, verdict, reasons[], gold_adjudication, bias_note, …}`. When no audit has run the shape differs — **check what `audited: false` actually returns before writing the type**; do not guess it.
- Audit history: read `~/.claude/learning/audits/*.json` from main, newest-first, same discipline as `readTopicGraph` (documented engine-owned file, read never written). Two real files exist (`2026-07-19-01.json`, `2026-07-23-01.json`).
- Renders: verdict; headline numbers **against the engine's own `thresholds`** (`qwk_floor`/`qwk_target`, `bias_max`) so a number is never shown without its bar; the `by_case_type` table (the useful part — it names where grading is least reliable); and the direction split with `graded_up` foremost.
- **Caveats render at the same weight as the numbers** whenever `gold_adjudication !== 'human'` — surface the engine's own `reasons` and `bias_note` rather than paraphrasing them into something softer.
- Unaudited state: says the grader hasn't been checked. It does not imply the grader is bad, and it does not imply it's fine.

- [ ] Both IPCs + the component + placement.
- [ ] **Trace every rendered number to its field** in the real `2026-07-23-01.json` and paste the mapping. Confirm the caveats render for both real audits (both are `gold_adjudication: "authored"`).
- [ ] Verify + commit `feat(coach): what the audit found`.

### Task 3: Artifacts — search, grouping, metadata

**Files:**
- Modify: `app/src/renderer/src/app/ArtifactGalleryView.tsx`, and the main-side artifact list handler for mtime

**Interfaces:**
- Search reuses `searchIndex.ts`'s matcher. Do not write a second matching function.
- Group by topic; sort by recency. Build date comes from the file's own mtime — **the engine records none** (`artifact list` returns `{topic, node, artifact, exists}` only, verified). Originating sitting comes from provenance where attributable; absent, not guessed, where not.
- `artifact list` mixes absolute and learning-home-relative paths (both forms exist in the real output; `engramArtifactList` already resolves them) — stat the resolved path.
- `exists: false` entries render as missing rather than being filtered away.

- [ ] Search + grouping + metadata.
- [ ] Verify against the real list: report the count, at least one absolute-path entry, and what a missing artifact renders. If no `exists: false` entry exists today, say so and describe the path you exercised instead.
- [ ] Verify + commit `feat(artifacts): find one, and know where it came from`.

### Task 4: Date range across the coach charts

**Files:**
- Modify: `app/src/renderer/src/app/DashboardView.tsx`, `app/src/renderer/src/app/TopicDrilldownView.tsx`

**Interfaces:**
- One range control governing every chart on the surface, in both the global and drilldown scopes. Receipts history spans 180 days.
- The active range is **stated in words** beside the charts, so a filtered number can't be mistaken for an all-time one.
- Local-date discipline in every boundary comparison.
- An empty range renders the honest blank, not a zeroed chart implying zero learning.

- [ ] The control + wiring in both scopes.
- [ ] Verify: pick a range and hand-derive the receipt count inside it from the real jsonl; confirm the rendered numbers change and the stated range matches what was filtered. Paste both.
- [ ] Verify + commit `feat(coach): the range you're looking at`.
