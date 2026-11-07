# Plugin overlays

The engram plugin (github:nagisanzenin/engram) is a third-party dependency —
this repo doesn't own it, and `claude plugin update engram@engram` installs
each new version as a completely fresh directory under
`~/.claude/plugins/cache/engram/engram/<version>/`, with none of this repo's
own local customizations carried forward.

This directory holds those customizations as plain content files, applied to
whatever version is currently installed by `app/scripts/applyPluginOverlays.ts`.

## Usage

```bash
cd app
npm run check:plugin-overlay   # dry run — reports drift, writes nothing, exits non-zero if out of date
npm run apply:plugin-overlay   # applies/reapplies every overlay to the currently installed plugin version
```

Run `apply:plugin-overlay` after every `claude plugin update engram@engram` —
the new version has none of these customizations until you do. Applying is
idempotent: running it again (same version or a later one) never duplicates
content, and only rewrites a target file if something actually changed.

## How it works

Each overlay entry (`app/scripts/applyPluginOverlays.ts`'s `OVERLAYS` array)
names a target file relative to the plugin's own install path, and one or
more insertions. Each insertion is a content file here (`engram/*.md`) plus
the exact line its block gets inserted before. The applied block is wrapped
in `<!-- engram-desktop-overlay:<id>:start/end -->` markers, which is what
makes re-running the script safe — it finds its own prior insertion by the
markers and replaces it in place, rather than searching the anchor line
again (which would otherwise still match and cause a duplicate insert).

If the plugin restructures the target file upstream and an anchor line goes
missing, the script fails loudly rather than guessing a new insertion point
— re-read the file, decide where the section belongs now, and update the
insertion's `beforeLine` by hand.

## What NOT to put here

The default rule: only genuinely additive content — a house-style appendix,
a QA checklist item, anything that adds without changing what a skill
teaches or how it grades. This is the exact same "additive UI/presentation
is fine, pedagogy is not" line `app/scripts/checkDoctrine.ts` draws for the
app's own system-prompt injections. Review any new overlay by hand against
that standard before adding it.

**The narrow exception (charter widened 2026-08-03).** A pedagogy overlay is
permitted only when it is opt-in per sitting, hash-pinned by checkDoctrine's
D5 section, and opens with a constitutional-exception header naming exactly
which upstream rule it contradicts and why the learner's election licenses
it. D5 pins every file in this directory by content hash, asserts the
load-bearing sentences of each pedagogy overlay, and verifies the INSTALLED
plugin still carries the applied markers — so a `claude plugin update` that
silently reverts a pedagogy overlay is a gate failure, not a shrug. The
quick-checkpoint protocol (below) was the first such exception; the
mobile-walk and step-sized protocols followed under the same terms.

## Current overlays

- **`engram/explorable-contract.visual-design-section.md`** +
  **`engram/explorable-contract.qa-checklist-item.md`** — the desktop app's
  house visual-design-system, appended to `skills/_shared/explorable-contract.md`
  (read by the `engram-artifact-smith` subagent) so generated explorables
  match the app's own sharp-glass chrome instead of inventing their own look.
- **`engram/review-skill.quick-checkpoint-protocol.md`** — the learner-elected
  checkpoint review style (chains of ≤4-option choices, capped ratings,
  `--source quick-mc` receipts), inserted into `skills/review/SKILL.md` ahead
  of the assessor-audit section. A pedagogy overlay under the widened
  charter above — read its constitutional-exception header before touching it.
- **`engram/review-skill.step-sized-protocol.md`** — the learner-elected
  step-sized review style for derivation-style items (the plan plus one
  pivotal step instead of a full re-derivation; `good` at best,
  `--source step-probe` receipts, and a full-solve floor after two
  step-sized reviews in a row), inserted into `skills/review/SKILL.md` after
  the checkpoint protocol and before the assessor audit. Elected per sitting
  by the review kickoff when the default-on Settings toggle is on. A
  pedagogy overlay under the widened charter — read its header first.
- **`engram/dialogue-grammar.checkpoint-exception.md`** — the one-sentence
  companion inserted after `skills/_shared/dialogue-grammar.md`'s hard-rules
  section, so the model is never left adjudicating a live contradiction
  between the menus rule and the checkpoint protocol.
- **`engram/learn-skill.mobile-walk-protocol.md`** — the learner-elected
  card protocol for the iOS companion surface (step assembly, cloze, picks;
  capped ratings, `mobile-*` receipts, nodes left **provisional** until a
  desk sitting solidifies them), inserted into `skills/learn/SKILL.md`
  between the encode section and the assessor. The second pedagogy overlay
  under the widened charter, and the first to touch **encoding** rather than
  review — which is why it is priced higher than the checkpoint protocol.
  Read its constitutional-exception header before touching it. Note what it
  does *not* do: on `kind: "procedure"` nodes it only says how
  `problem-grammar.md`'s L1–L3 render on glass, and leaves L4 and the
  discrimination naming step exactly as that file defines them.
- **`engram/dialogue-grammar.mobile-walk-exception.md`** — the one-sentence
  companion for the mobile-walk protocol, a sibling of the checkpoint
  sentence rather than an edit to it, so each exception stays paired with
  the one protocol that licenses it and either can be removed without
  stranding the other's sentence.
- **`engram/learn-skill.lecture-notes-protocol.md`** — the learner-elected
  Lecture Notes protocol: for a node the learner has never encoded, the tutor
  writes short notes (published with the `publish_lecture_notes` bridge tool,
  rendered to a PDF the app keeps), waits until the learner has read them,
  then runs all eight beats with PREDICT/STRUGGLE moved to an instance the
  notes did not work and VERIFY cold with the reader closed. Inserted into
  `skills/learn/SKILL.md` ahead of the assessor. The third pedagogy overlay:
  it buys an exception to the commit-before-content rule, so read its
  constitutional-exception header before touching it.
- **`engram/dialogue-grammar.lecture-notes-exception.md`** — the one-sentence
  companion for the lecture-notes protocol, a sibling of the other two.
