# Engine Moments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Durable beat marks + five styled engine-event moments per `../specs/2026-07-25-engine-moments-design.md`.

**Architecture:** One shared transcript-derivation module powers both live-resume hydration and the history drawer (the same derivation the provenance scanner pioneered); stream detectors mirror it for live sessions. Components live in `components/ritual/`.

**Tech Stack:** existing only; no new deps.

## Global Constraints

- Advisory/display-only; nothing blocks input or auto-sends; no engram writes.
- Reconstruction and live detection MUST share extraction logic (one module — `renderer/src/shared/ritualFromTranscript.ts`) so history and live never drift.
- Night Atlas + motion tokens; new animations once-per-trigger, reduced-motion safe (global kill-switch covers CSS).
- Verification per task: `cd app && npm run typecheck && npm run build`.
- Detector discipline: CLI-call detectors match assistant Bash `tool_use` commands (the receipt/rate detector patterns in LearnSessionView are the reference); parsed payloads are shape-guarded.

---

### Task 1: Durable beat marks + crossings

**Files:**
- Create: `app/src/renderer/src/shared/ritualFromTranscript.ts`
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx` (resume hydration populates marks), `app/src/renderer/src/components/SessionHistoryDrawer.tsx` (timeline gains marks), `app/src/renderer/src/components/ritual/Marks.tsx` (doctrine comment update only)

**Interfaces:**
- Produces: `deriveRitualMarks(entries: unknown[]): { atIndex: number; kind: 'beat'; beat: string; content: string }[] & crossings` — walks transcript entries for `render_beat` bridge-tool `tool_use` blocks (mcp bridge tool calls appear as tool_use with the tool name — verify the exact shape against a real transcript and against `shared/bannerFromTranscript.ts`, which already reads them for the banner; REUSE its extraction internals, refactor it to sit on the shared module rather than duplicating). `atIndex` must align with `parseTranscriptToMessages`'s message indexing (the same skip/merge rules — derive both from one walk or share index bookkeeping explicitly).
- Crossings: derived from `render_beat` node changes (same rule the live `crossToNode` uses — first beat naming a new node).
- Consumes: existing `RitualMark` union, `MarkView`, live `marks` state.

- [ ] Shared module + bannerFromTranscript refactor onto it (no behavior change to the banner).
- [ ] Learn resume hydration: populate `marks` from the derivation (only when marks state is empty — a live session keeps its own).
- [ ] History drawer: interleave derived marks into the timeline (render via `MarkView`).
- [ ] Doctrine comment in Marks.tsx: derivable marks replay; one-time marks (figure/atlas/stamp) don't.
- [ ] Verify + commit `feat(ritual): beat marks and crossings survive reopen and show in history`.

### Task 2: Phase frontispieces + diagnostic plate

**Files:**
- Create: `app/src/renderer/src/components/ritual/Frontispiece.tsx`, `ritual/DiagnosticPlate.tsx`
- Modify: `shared/ritualFromTranscript.ts` (session_phase + pretest-rate derivation), `LearnSessionView.tsx` (live detection + mark kinds), `Marks.tsx` (extend RitualMark union: `{kind:'phase', phase}`, `{kind:'diagnostic', items}`), `SessionHistoryDrawer.tsx` (inherits via Task 1 plumbing)

**Interfaces:**
- Phase copy map (exact): intake "Taking measure" · pretest "The diagnostic" · walk "The walk begins" · grading "The assessor sits" · closing "Closing the loop". Dendrite hairlines flank a small ink glyph + serif title.
- DiagnosticPlate: `{ items: { node: string; verdict: 'held'|'partial'|'unknown' }[] }` — verdict mapping from pretest rate grades (recalled→held, partial→partial, lapsed/none→unknown); caption "Fig. — the frontier this sets". Plate emitted when phase leaves pretest OR first walk beat arrives (whichever first; live and derivation use the same rule in the shared module).
- Consumes: existing pretest rate detector (live), session_phase bridge events (live) — reconstruction reads the same calls from transcripts.

- [ ] Components (static render, one entrance animation each from tokens).
- [ ] Shared-module derivation + live wiring; both surfaces show them.
- [ ] Verify + commit `feat(ritual): phase frontispieces and the pretest diagnostic plate`.

### Task 3: Misconception pinned + explorable forged

**Files:**
- Create: `app/src/renderer/src/components/ritual/MisconceptionPin.tsx`, `ritual/ExplorableForged.tsx`
- Modify: `shared/ritualFromTranscript.ts`, `LearnSessionView.tsx`, `Marks.tsx` (union: `{kind:'misconception', text, node?}`, `{kind:'explorable', title, path?, node?}`)

**Interfaces:**
- Misconception detector: assistant Bash tool_use whose command invokes engram's misconception logging — FIRST verify the real command shape by grepping actual transcripts (`grep -l misconception ~/.claude/projects/*/*.jsonl` and inspect; the grad-quantum sitting of 2026-07-24 logged the ket-ln one). Parse the text/node args from the command string; shape-guard lengths.
- Explorable detector: verify the reliable signal the same way (the artifact-register/`visuals` call or the artifact-smith Task result carrying the path); document the chosen signal and its failure mode in the module. Card's Open button: resolve via the existing openExplorable IPC path when the file exists; else "Open in browser" fallback; else caption "artifact no longer on disk".
- MisconceptionPin: danger-ink specimen label (hairline border, small pin glyph, serif text, node fig-caption). ExplorableForged: violet-ink card, title + Open.

- [ ] Grep-verify both signals against real transcripts BEFORE coding detectors; record findings in the report.
- [ ] Detectors in the shared module + live wiring + components.
- [ ] Verify + commit `feat(ritual): misconception pins and explorable-forged cards`.

### Task 4: Return chip + verify seal

**Files:**
- Modify: `app/src/renderer/src/components/GradeResultCard.tsx` (revealed face chip), `components/ritual/Marks.tsx` (seal mark `{kind:'verify-seal'}` + view), `LearnSessionView.tsx` (beat_outcome verify/confirmed → seal mark), `shared/ritualFromTranscript.ts` (derive seals from beat_outcome calls)

**Interfaces:**
- Return chip: when the parsed receipt carries scheduling (`intervalDays`/`sBefore`/`sAfter` — all optional in `shared/gradeResult.ts`, render only what exists): `returns in <n> day(s) · s <b> → <a>`, `label-data` tabular, toned by grade (warm recalled / neutral partial / danger lapsed). On the revealed face only; no change to flip mechanics.
- Verify seal: the existing verify glyph (Marks.tsx BEAT_GLYPHS) in a filled warm roundel, small, right-aligned on its own row; ONLY for outcome `confirmed`.

- [ ] Chip + seal + live and derived wiring.
- [ ] Verify + commit `feat(ritual): return chips on grade reveals; verify seals`.
