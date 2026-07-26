# Surfaced — Making Already-Plumbed Capability Visible

**Date:** 2026-07-26
**Status:** Approved design (P1 of the surfacing round)

## Goal

Four capabilities are fully wired to the engine and rendered nowhere. This project surfaces them. No new engine concepts, no new mutations — every item below reads data the app already fetches or can fetch through an existing read path.

## Constraints (binding)

- **The read-only contract is the hard one here.** `main/engramCli/readOnly.ts` gates by *command name* (`READ_ONLY_COMMANDS.has(command)`), so `misconception` cannot be added wholesale: `add` and `resolve` share that subcommand and both write. The allowlist must gain action-awareness, and `misconception add|resolve` must be provably unreachable through it.
- The app never resolves a misconception. They're resolved by the loop, through a live session. The ledger is a reading surface.
- Learner-model edits go through the existing `modelSet`/`modelAddInterest` path (the narrow pre-existing mutate allowlist) — no new mutation surface.
- Night Atlas vocabulary; honest copy; verification `npm run typecheck && npm run build`.

## 1. Misconception ledger

**Engine access.** `engram.py`'s `cmd_misconception` (CLI at :7681) supports `list`, which performs no write and emits `[{id, ts, topic, node, description, status}]`. Extend `readOnly.ts` with an action-aware allowance — a `READ_ONLY_SUBCOMMANDS: Map<string, Set<string>>` consulted when a command isn't in the flat set, requiring `args[0]` to be in the permitted action set. `misconception` maps to `{'list'}` only. A call with `add`/`resolve`, or with no action, is refused exactly as an unknown command is.

**Surface.** A ledger reachable from (a) the Coach count that currently dead-ends, and (b) a node's map drawer when that node has open misconceptions. Rows grouped by topic: the node (humanized, clickable to its map entry), the description, and when it was logged. Open ones only by default, with resolved ones behind a disclosure — seeing what you've since corrected is the encouraging half, and it costs nothing to keep.

**Copy discipline.** A misconception is a recorded fact about a model of the world, not a failure. No danger ink for the list itself, no counts framed as debt.

## 2. Diagnostics + version

A Settings "Diagnostics" panel: a button running `doctor()` (plumbed, zero call sites) with its findings rendered as rows, plus the app version from `getVersion()` (also unused) and the build commit/date already carried in `UpdateCheckResult`. Diagnostics runs on demand, never on mount — it shells out to the engine and shouldn't tax every Settings open.

## 3. Experiment banner

`EngramStats.active_experiment` is typed, fetched, and rendered nowhere; a coach-run n-of-1 experiment is currently invisible. Surface it on Home and Coach: what's being tested, since when, and what would settle it.

**Implementer must first verify** what `active_experiment` actually contains in this user's real `stats` output — if it's too thin to describe an experiment, back the detail with `experiment status` (also read-only, same action-aware allowance as above) and record the finding. If no experiment has ever run, say so rather than building against a guessed shape.

## 4. Learner model completion

Settings fetches `model()` on every load and renders only interests. Add `goals`, `accessibility`, and `rhythms` beside it, mirroring the existing Interests editor's row pattern (`SettingsView.tsx:579-609`). Read-and-edit through the existing model mutation path. Each gets a one-line fig-caption saying what the engine does with it, since none of them are self-explanatory.

## Out of scope

Resolving misconceptions from the app; starting/settling experiments from the app; any new mutation path.

## Verification

- **Contract:** `engramRead('misconception', ['add', …])` and `engramRead('misconception', [])` both refuse; only `['list', …]` passes. This is the test that matters most.
- Ledger lists real entries from `~/.claude/learning/misconceptions.json` (the ket-ln one from 2026-07-24 should appear), grouped and linked.
- Diagnostics renders real `doctor` output; version matches `package.json`.
- The experiment banner appears only when an experiment is genuinely active, and is absent (not empty-chrome) otherwise.
- Goals/accessibility/rhythms render and round-trip an edit.
