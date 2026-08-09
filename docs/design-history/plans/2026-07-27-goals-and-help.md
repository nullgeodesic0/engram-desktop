# Goals & Help Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the four items in `../specs/2026-07-27-goals-and-help-design.md` (P4 + P5, closing the surfacing round).

**Architecture:** Two renderer-side over data already fetched (Home's grouping, the help sheet). One extends existing app-local storage (`topicSettings.ts`) plus arithmetic over the graph and receipts. One reuses the existing hidden-window `printToPDF` pipeline.

**Tech Stack:** existing only; no new deps.

## Global Constraints

- **No computer control / no launching the app.** Not `npm run dev`, not the packaged app — the user has forbidden screen-driving and live sessions are routinely running. Verification is `cd app && npm run typecheck && npm run build && npm run check:doctrine && npm run check:topic-metrics` plus reading real data on disk. Visual-only questions go to the user in the report.
- **Read-only toward engram; the loop is untouchable.** `main/engramCli/readOnly.ts` must not change. A target date lives in this app's `userData`, never in engram's files. Nothing here influences scheduling or what the loop asks.
- **`npm run check:doctrine` must stay green.** It pins the allowlists, every filesystem writer and its destination, the bridge tools, the session prompt, and the files permitted to read a claim/rubric. If a task legitimately needs to change something the guard pins, **re-pin it in the same commit and say so in the report** — that edit is the audit trail. Never weaken a check to make it pass.
- **State facts, never urge.** No exhortation, no guilt, no alarm colors on a deadline the learner set for themselves.
- Reuse, don't reimplement: `main/session/exportSitting.ts`'s print pipeline, `topicSettings.ts`, `plateStats`, `NodeTable`, `humanizeNodeId`, `shared/nodeDisplay.ts`, the plate's furniture/engraved fills/calligraphic edges.
- Night Atlas vocabulary; hidden-when-empty; no wrapper tells; local-date discipline (`getFullYear/getMonth/getDate`, **never** `toISOString`).

---

### Task 1: Exam / deadline mode

**Files:**
- Modify: `app/src/main/session/topicSettings.ts` (a target-date field), the settings IPC/preload/types
- Create: `app/src/renderer/src/shared/pressure.ts` (the arithmetic), and the surface that renders it
- Modify: wherever a topic's settings are edited today (find it — do not build a second settings surface)

**Interfaces:**
- `targetDate: string | null` (local `YYYY-MM-DD`) on `TopicSettings`. Additive — read `topicSettings.ts`'s doc comment first; it explains why this app never forks the plugin's data model.
- Pressure figures: nodes unencoded (`state === 'new'`), days remaining, required pace, observed pace.
- **The observed pace is where this task succeeds or fails.** Real data is thin and lumpy — `grad-classical-mechanics` has 18 encodes over 8 active days spanning Jul 12–23; `long-form-humanities` has 5 encodes on a single day. Average over **calendar days elapsed**, including empty ones, and **state the window and denominator in words** beside the number. Below a minimum number of active days, render no pace figure at all — say there isn't enough history to project from. One named constant; justify its value in the report.
- Copy states facts only. No urging, no red, no "behind."
- Clearing the date removes the figure and leaves nothing behind.

- [ ] Storage + arithmetic + surface.
- [ ] **Hand-check the math** against one real topic: re-derive nodes remaining, days left, required pace, and observed pace from `~/.claude/learning/graphs/` and `~/.claude/learning/receipts/` with a throwaway script, and paste both your numbers and the code's. State the denominator explicitly.
- [ ] Verify a target date round-trips through app storage and that **no file under `~/.claude/learning/` is touched** — show how you verified that.
- [ ] Verify + commit `feat(goals): a date, and the arithmetic it implies`.

### Task 2: Home shows mature topics

**Files:**
- Modify: `app/src/renderer/src/app/HomeView.tsx`

**Interfaces:**
- `HomeView.tsx:222`'s `inProgress` filter (`states.new > 0 || states.learning > 0`) drops any topic whose nodes are all in `review`. Group instead of filter: actively encoding, fully encoded (maintaining), and not started are three different states and should read as three different things.
- Fix the "Nothing in progress — start a new topic" copy (`:332`) so it cannot appear while the learner has real fully-encoded topics.
- No topic is fully mature on this machine today (`grad-classical-mechanics` is 16 review / 4 learning / 19 new), so **construct the case from real graph data** in a throwaway script rather than waiting for one to occur.

- [ ] Regroup + fix the copy.
- [ ] Verify with a constructed all-review topic derived from real graph data; paste what each group renders.
- [ ] Verify + commit `feat(home): the topics you've already built`.

### Task 3: The map as a printed plate

**Files:**
- Modify: `app/src/main/session/exportSitting.ts` or a sibling (reuse its hidden-window pipeline — read it in full first), `app/src/renderer/src/app/TopicMapView.tsx` (the export entry point)

**Interfaces:**
- Reuse the existing offscreen `BrowserWindow` + `webContents.printToPDF` pattern, including its `try/finally` destroy. Do not build a second print path.
- Reuse the plate's own furniture, engraved fills, and calligraphic edges — the printed plate should be the same figure, not a re-render.
- **Resolve screen-only state deliberately**: hover, transient selection, an active lens. Decide what each becomes on paper and say so in the report; don't capture mid-interaction.
- `check:doctrine` pins every filesystem writer and its destination. A PDF written to a user-picked path is a new writer — re-pin it in the same commit and note it.

- [ ] The export + entry point.
- [ ] Verify a generated PDF exists, is non-trivial in size, and has the intended page geometry — write it to the scratchpad, never into the user's directories. Paste the byte size and page count.
- [ ] Verify + commit `feat(map): the atlas, on paper`.

### Task 4: Help + glossary

**Files:**
- Create: the help surface
- Modify: `app/src/main/appMenu.ts` (a Help menu — note its current doc comment explains why there ISN'T one; update that comment honestly), `App.tsx` (the `?` route)

**Interfaces:**
- **Keyboard reference: only shortcuts that actually work.** The real inventory is 11 menu accelerators plus ⌘K (palette) and ⌘Enter (send), plus contextual Escape/Enter/arrows. **⌘L and ⌘1 both open Learn; ⇧⌘R and ⌘2 both open Review** — present those as aliases, not as four capabilities. Verify every entry against `appMenu.ts` and the renderer's key handlers; **list any working shortcut you found that the sheet doesn't document**, and say why it's omitted or add it.
- **Glossary:** threshold, stability, retrievability, lapse, frontier, encode, consolidate, probe, receipt, capstone. Each definition says what the word means *in this product* and where the learner sees it. **Check every definition against `engram.py` or the FSRS implementation** at `~/.claude/plugins/cache/engram/engram/1.0.7/` — cut anything you can't ground rather than writing a plausible gloss. Report which source grounds each term.
- This is the one surface allowed to be didactic. It is still not allowed to name `engram.py`, a CLI flag, or an internal path.

- [ ] The surface + both entry points.
- [ ] Paste the shortcut table with its verification, and the term→source grounding table.
- [ ] Verify + commit `feat(help): what the words mean, and what the keys do`.
