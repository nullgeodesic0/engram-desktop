# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People doing **graduate-level or professional self-study** — a physics qualifying exam, a textbook worked properly, a paper they need to actually hold. They are studying alone, without a course or a cohort, and the thing they lack is not material but a system that makes them retrieve rather than re-read.

The author is the first user, not the only one. Work has to survive a stranger: their topic names, their pace, their first run, their empty states.

A sitting is typically 20–70 minutes at a desk, on a Mac, with the source material to hand and often paper beside the keyboard.

## Product Purpose

A desktop client for the **engram** learning loop. It drives engram's spaced-repetition system by scripting the Claude Code CLI headlessly — one `claude -p` child process per session, running the installed `/engram:learn`, `/engram:review`, and `/engram:coach` skills.

It is **not a learning engine**. The engine is [engram by nagisanzenin](https://github.com/nagisanzenin/engram): it decomposes a topic into a concept graph, teaches by forced retrieval, grades free recall blind, and schedules each concept's return with FSRS. All of that ships in the plugin and `engram.py`, unmodified.

What this app adds is the *environment*: a transcript that understands the dialogue's structure, a living map of what you know, and a shell that treats a study session as something worth sitting down for.

Success is that a learner sits down, does real retrieval, and trusts the record afterwards.

## Positioning

**The app is a window onto the engine, never a second author of its state.** That boundary is enforced mechanically, not by convention, and it is the thing a neighbouring product could not truthfully copy:

- every `engram.py` call goes through a read-only allowlist, with one narrow settings-shaped exception;
- learning state is mutated **only** by a live driven session, so the app never races the engine's lockfile;
- a probe's canonical answer (`claim` / `rubric` / `transfer_probe`) must not reach the learner before their production is graded — the set of files allowed to read those fields is pinned;
- the assessor is deliberately blind to the tutoring dialogue, and the app must never gain a path that feeds it.

A static check (`check:doctrine`) pins all of it, including every byte the app injects into a session. Changing any of it requires re-pinning a hash in the same commit — the edit *is* the audit trail.

## Operating Context

- **The sitting** is the unit of work: open a topic or a review queue, declare a time budget, work through items, close.
- **Free recall** is the mechanism — the learner produces from memory, commits to a confidence pick *before* any correctness signal, and only then sees the answer.
- **Blind grading**: productions are stashed and graded by an assessor subagent that never sees the tutoring dialogue.
- Learning state lives in `~/.claude/learning/`; session transcripts in `~/.claude/projects/` (Claude Code's own NDJSON). UI state is Electron app data. **100% local** — no server, no sync, no telemetry, no Anthropic API key.
- The tutor can drive the UI through an MCP bridge of advisory, never-blocking tools (beats, tickets, figures, contrast cards, step ladders, formulas, plots, citations, handwriting transcription). Every one is a formatting channel for prose the tutor would write anyway.
- Measured from the author's own sittings: a review item costs **~4.6 minutes median**, varying by topic from ~4 to ~14. Budgets are computed from this, not assumed.

## Capabilities and Constraints

- **macOS arm64 today; Windows and Linux are likely later.** Platform-specific chrome (frameless shell, traffic lights, Keychain, menu idioms) must stay contained so a port is not a redesign.
- Builds ship **unsigned** — `notarize: false`, and CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false`. Users clear the quarantine flag by hand. This also rules out a silent auto-updater: Squirrel.Mac only applies updates to a signed app, so the app *notifies* and never pretends to install.
- The app bundles **only open fallback typefaces**. The licensed display faces exist on the author's machine and are git-ignored, so **release assets must come from CI's clean clone** — never a local build.
- The engram plugin is treated as **sacred**: never edited. Adjustments to tutor behaviour go through an additive plugin-overlay system so a plugin update cannot silently revert pedagogy.
- Engine limits the app reports but cannot change: a stored production is capped at 800 characters (`PRODUCTION_MAX`) on both the stash and the receipt.
- The repo is public. It carries no learner data, no credentials, and no account name.

## Brand Commitments

- **Name:** Engram Desktop. Published at `nullgeodesic0/engram-desktop`.
- **Attribution is binding:** engram is nagisanzenin's work and the README says so plainly. This app is a client; it must never present itself as the engine.
- **Voice:** plain, specific, unhurried. It states what happened and what it measured. It does not congratulate, gamify, or dress a number up as an achievement.
- **The record is honest or it is worthless.** The app never mints a receipt the engine did not produce, never claims a measurement it did not take, and says so when a record is partial.

## Evidence on Hand

- Real screenshots of the running app: `docs/media/` (home, topic atlas, learn session, review).
- The author's own corpus: 9 topics, ~155 receipts, ~1,190 session transcripts — the source for the measured pace figures above.
- 412 tests; static doctrine and engine-agreement checks (`check:doctrine`, `check:topic-metrics`, `check:ritual-snapshot`).
- Written design and architecture docs: `docs/design-language.md`, `docs/design-tokens.md`, `docs/architecture.md`, `docs/learning-loop.md`.

**Absences future work must not fabricate:** there are no users besides the author yet, and therefore no testimonials, no case studies, no adoption numbers, no press, and no third-party benchmarks. There is no pricing, no licence tier, and no hosted service.

## Product Principles

1. **A window, never a second author.** Every feature is a way of *seeing* the engine's state or *driving* a live session. When the app wants to change learning state itself, that is the signal the feature is wrong.
2. **Honest or absent.** Show what was measured and say where the number came from. A partial record is labelled, an estimate carries its basis, and a claim the app cannot back is simply not made.
3. **The sitting is the unit.** Design for someone sitting down to do difficult work for half an hour — not for glanceable metrics, streak pressure, or notifications that interrupt.
4. **Protect the retrieval.** Nothing may show a learner the answer before they have produced. Convenience never outranks this; it is what makes every downstream number mean anything.
5. **Built for a stranger.** The author's own workflow is evidence, not a specification. First runs, empty states, unfamiliar topic names, and other people's pace all have to work.

## Accessibility & Inclusion

No formal conformance target. The working discipline stays: `prefers-reduced-motion` is respected app-wide by a global kill-switch, focus is always the one shared focus-ring utility, and interactive affordances carry real labels. Keyboard paths exist for the loop's hot moments (send, confidence picks, navigation).

Treat these as commitments to keep, not a standard to audit against — and do not claim WCAG conformance anywhere.
