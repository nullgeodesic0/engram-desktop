# Goals & Help — Pressure Without Urging, and a Way In

**Date:** 2026-07-27
**Status:** Approved design (P4 + P5 of the surfacing round)

## Goal

Four items closing out the surfacing round. Two are about what the learner is aiming at: a real deadline the app can do honest arithmetic against, and the topics Home currently hides. Two are about the app being legible: the atlas as something you can print, and the fact that this app has **no help surface anywhere** — no keyboard reference, no glossary for a vocabulary (threshold, stability, retrievability, lapse, frontier) it uses constantly and never defines.

## Evidence gathered before writing this spec

**1. Pace data is thin and lumpy, which sets the whole tone of exam mode.** Measured across all four real topics: `grad-classical-mechanics` has 18 encodes over **8 distinct active days** spanning Jul 12–23; `lenin-what-is-to-be-done` has 5 encodes on a **single day**; `us-academic-labor-rights` has 2 encodes over 2 days. A "you've averaged N/day" figure computed over this is unstable enough to be misleading — a learner who did one good session and nothing since would read either "5/day" or "0.4/day" depending entirely on the denominator. The spec therefore requires the denominator to be stated, and requires a minimum before any pace figure is shown at all.

**2. Home's `inProgress` filter is real, but its worst case isn't live today.** `HomeView.tsx:222` filters to `states.new > 0 || states.learning > 0` — a topic whose nodes are all in `review` disappears from Home entirely, and if it's the only topic, Home says "Nothing in progress — start a new topic." No topic on this machine is currently all-review (`grad-classical-mechanics` is 16 review / 4 learning / 19 new), so this is a latent defect, not an observed one. It is worth fixing precisely because it fires exactly when a learner has invested the most.

**3. The infrastructure for both P5 items already exists.** `main/session/exportSitting.ts` drives `webContents.printToPDF` through a hidden offscreen `BrowserWindow` destroyed in a `finally` — a reusable pattern, not something to rebuild. `topicSettings.ts` is already app-local per-topic storage whose own doc comment says never to fork the plugin's data model — the exact right home for a target date.

**4. The real shortcut inventory is smaller than it looks, and has duplicates.** Eleven menu accelerators, plus ⌘K (palette) and ⌘Enter (send), plus contextual Escape/Enter/arrows. **⌘L and ⌘1 both open Learn; ⇧⌘R and ⌘2 both open Review.** A help sheet that lists those as four distinct capabilities would be padding a reference with duplication.

## Constraints (binding)

- **Read-only toward engram, and the loop is untouchable.** A target date lives in the app's own `userData`, never in engram's files. Exam mode does no scheduling, exerts no influence on the engine, and changes nothing about what or when the loop asks. `npm run check:doctrine` and `npm run check:topic-metrics` must both stay green.
- **The engine is the oracle.** Anything the engine computes, the app reads rather than recomputes.
- **State facts, never urge.** "47 unencoded, 12 days, ~4/day needed; you've averaged 2 over the last 14 days" and nothing more. No exhortation, no streak-guilt, no red, no "you're falling behind." A deadline the learner set is information, not a lever.
- Reuse before building: `exportSitting.ts`'s print pipeline, `topicSettings.ts`, the plate's furniture/engraved fills/calligraphic edges, `plateStats`, `NodeTable`, `humanizeNodeId`, `shared/nodeDisplay.ts`.
- Night Atlas; hidden-when-empty; no wrapper tells; local-date discipline (`getFullYear/getMonth/getDate`, never `toISOString`).
- **No computer control.** Verification is `npm run typecheck && npm run build` plus both checks, plus reading real data on disk. Anything only confirmable by eye is handed to the user.

## 1. Exam / deadline mode

An optional target date per topic, stored in the app's own settings. When set, that topic gains a pressure figure computed from the graph and the receipts: nodes unencoded, days remaining, the pace that would close the gap, and the pace actually observed.

**The honest-arithmetic requirements are the feature.** The observed pace must state its window and its denominator in words — averaging over calendar days elapsed (including days with nothing) and saying so, rather than over active days, which flatters. Below a stated minimum of active days, no pace figure renders at all; it says there isn't enough history to project from. The required pace is arithmetic on what remains, presented as arithmetic, not as a target the learner is failing.

No auto-scheduling. No notification pressure. Clearing the date removes the figure entirely and leaves nothing behind.

## 2. Home shows mature topics

Home stops hiding topics whose nodes are all in review, and distinguishes them from actively-encoding ones rather than mixing them into one undifferentiated grid. A topic you've finished encoding and are now maintaining is a different state from one you're partway through, and both are different from one you haven't started — the display should say which is which. Fix the "Nothing in progress" copy so it can't appear while the learner has real, fully-encoded topics.

## 3. The map as a printed plate

Export the atlas to PDF at print quality through the existing hidden-window pipeline, reusing the plate furniture, engraved fills, and calligraphic edges already built. The design is already a figure; this makes it one on paper.

Whatever the plate renders that depends on the screen — hover state, transient selection, a lens toggle — must resolve to something deliberate on paper rather than being captured mid-interaction. Node labels must be legible at print size, which is the one thing that can only be confirmed by eye; that check goes to the user.

## 4. Help + glossary

A single surface with two halves, reachable from the app menu and from `?`.

**Keyboard reference:** every shortcut that actually works, and nothing that doesn't. Where two accelerators do the same thing (⌘L/⌘1, ⇧⌘R/⌘2), say so rather than listing them as separate capabilities.

**Glossary:** the loop's vocabulary, defined in the app's own voice — threshold, stability, retrievability, lapse, frontier, encode, consolidate, probe, receipt, capstone. Each definition says what the word means *here*, in this product, and where the learner sees it. This is the one place the app is allowed to be didactic, because not knowing what "stability 40d" means is a real barrier to reading every other surface.

Definitions must match what the engine actually does. Where a term's meaning comes from FSRS or from engram's own implementation, check it against the source rather than writing a plausible-sounding gloss.

## Out of scope

Notifications or reminders driven by a target date. Multiple deadlines per topic. Editing the graph from any of these surfaces. Exporting anything other than the map in P5. A tutorial or onboarding tour.

## Verification

- Pressure math hand-checked against one real topic: nodes remaining, days left, required pace, and observed pace all re-derived from `~/.claude/learning/graphs/` and `~/.claude/learning/receipts/` — report the numbers and the denominator used.
- A target date round-trips through app storage and touches no file under `~/.claude/learning/`.
- Mature-only topics appear on Home, distinguished from in-progress ones — construct the case from real graph data rather than waiting for one to occur.
- A generated map PDF exists, is non-trivial in size, and its page geometry is what was asked for; legibility at print size goes to the user.
- **Every keyboard shortcut listed in the help sheet actually works** — verify each against `appMenu.ts` and the renderer's key handlers, and list any that exist but are undocumented.
- Every glossary definition checked against engram.py or the FSRS implementation; anything that can't be grounded is cut rather than guessed.
- `npm run typecheck && npm run build && npm run check:doctrine && npm run check:topic-metrics` all clean.
