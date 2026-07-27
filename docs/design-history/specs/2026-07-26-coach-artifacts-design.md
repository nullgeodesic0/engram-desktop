# Coach & Artifacts — Reading the Record

**Date:** 2026-07-26
**Status:** Approved design (P3 of the surfacing round)

## Goal

The Coach tab reports the whole learner at once: one retention curve, one calibration scatter, one momentum strip, over every topic together. But learning is per-topic, and the questions a learner actually asks are per-topic — *is my quantum retention worse than my mechanics retention?* Today there is no way to ask. The topic rows are inert text; the charts have no scope control and no date range.

Meanwhile the grader that writes every receipt has been audited twice, in detail, and the app has never shown a single number from it.

Artifacts are a flat wall of tiles: no search, no grouping, no build date, no way back to the sitting that produced one.

## Evidence gathered before writing this spec

Two findings changed the design. Both were verified against real files on disk, not assumed.

**1. The coach's prose has no stable shape — but the engine writes a record that does.**

The plan called for parsing the coach's audit/refit output into cards "the way the review loop's receipts are parsed," evidence-gated on real transcripts. Both real coach sittings were read (`1ad5f2fd…`, 2026-07-19; `952c1376…`, 2026-07-23). The output is free-form prose — bolded verdicts, inline numbers, a different sentence order each time. There is no delimiter, no marker, no stable field order. **A prose detector would be guessing, so none will be written.**

What those transcripts pointed at instead is the real source: the audit writes `~/.claude/learning/audits/YYYY-MM-DD-NN.json`, append-only. Two exist. The schema is rich and stable — `verdict`, `qwk`, `leniency_bias`, `test_retest`, `direction.{graded_up, graded_down, exact, judgments}`, a full `confusion` matrix, `by_case_type` broken out by trap category, `by_run`, `thresholds`, `coverage`, and the engine's own `reasons` and `bias_note`.

Better still: **`grader-health` is already on the read-only allowlist and has zero call sites in the app** — the same "plumbed and never shown" pattern P1 found in `doctor()`. It returns the latest audit's full body. So this item needs no prose parsing, no new engine surface, and no allowlist change.

**2. The engine records no build date for an artifact.** `artifact list` returns `{topic, node, artifact, exists}` and nothing more. Build date must come from the file's own mtime; the originating sitting must come from provenance. Neither is invented.

## Constraints (binding)

- Read-only toward engram. `readOnly.ts` is not modified by this project — `grader-health` is already allowlisted, and the audits directory is read the way `readTopicGraph` reads a graph: a documented, engine-owned, stable file, read and never written.
- No prose detectors for coach output. If a number cannot be traced to a JSON field, it does not render.
- The global Coach view stays. A drilldown is a second scope of the same charts, not a replacement.
- Reuse before building: `charts/RetentionCurve`, `charts/CalibrationScatter`, `charts/StabilityMovement`, `charts/ActivityStrip`, `NodeTable` (P2), `searchIndex.ts`'s matcher, `humanizeNodeId`, `plateStats`, `friendlyErrorText`.
- Night Atlas vocabulary; hidden-when-empty over empty chrome; honest copy — no scolding, and never name `engram.py`, a CLI flag, or an internal path in user-visible text.
- **No computer control.** Verification is `npm run typecheck && npm run build` plus reading real data on disk. Anything only confirmable by eye is handed to the user.

## 1. Per-topic drilldown

Clicking a topic in Coach opens that topic's own page: retention buckets, calibration, and momentum computed over that topic's receipts alone, plus its node table (P2), a provenance summary, and its artifacts.

Every number must be the global number restricted to one topic — computed by the same code path with a filter, never a second implementation. A drilldown that disagrees with the global view is worse than no drilldown.

Small-n is the honest hazard here. A topic with four graded reviews will produce a retention "curve" that is noise. Buckets below a stated minimum render the count instead of a rate, and say so plainly.

## 2. The grader's audit record

A Coach surface for what the audit found, read from `grader-health` (latest) with the audits directory supplying the earlier runs.

Shows: the verdict, the headline numbers against the thresholds the engine itself set (`qwk` vs `qwk_floor`/`qwk_target`, `leniency_bias` vs `bias_max`), the per-case-type table — which is the genuinely useful part, since it names *where* grading is least reliable — and the direction split, `graded_up` foremost, because that is the only direction that can flatter a learner out of a review they need.

**The caveats render as prominently as the numbers.** The engine writes `gold_adjudication: "authored"`, a `bias_note` about the adversarial gold set, and `reasons` that state a QWK this high partly measures the grader agreeing with itself. Both real audits carry that caveat. Showing 0.97 without it would be the app lying by omission, in a product whose whole argument is that evidence beats vibes.

When no audit has run, the surface says the grader has not been checked — it does not imply anything about the grader's quality either way.

## 3. Artifacts: search, grouping, metadata

The gallery gains a search field (reusing `searchIndex.ts`'s matcher, not a second one), grouping by topic, sort by recency, and per-artifact metadata: build date from file mtime, and the originating sitting from provenance where it can be attributed. Where provenance can't attribute one, the field is absent, not guessed.

Missing artifacts (`exists: false`) are shown as missing rather than filtered away silently — a broken tile is information.

## 4. Clickable topics + date filters

Coach's inert topic rows become the drilldown's entry point. The charts gain a date-range control; the receipts history already spans 180 days. The range applies to every chart on the surface at once, and the selected range is stated in words next to the charts so a filtered number is never mistaken for an all-time one.

## Out of scope

Editing anything from these surfaces. Running an audit or a refit from the app (the loop runs those, not a button). Cross-topic comparison in one chart. Exporting the audit.

## Verification

- Drilldown numbers for one real topic match the global numbers filtered to that topic, hand-derived from `~/.claude/learning/receipts/<topic>.jsonl` — report both.
- Every rendered audit number traces to a named field in `~/.claude/learning/audits/2026-07-23-01.json`; the caveats render whenever `gold_adjudication !== "human"`.
- Artifact metadata is checked against real files, including at least one `exists: false` case and one absolute-path entry (`artifact list` returns both forms).
- Date-range filtering changes the rendered numbers, and the stated range matches what was filtered.
- `npm run typecheck && npm run build` clean; visual density questions handed to the user.
