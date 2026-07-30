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

Only genuinely additive content — a house-style appendix, a QA checklist
item, anything that adds without changing what a skill teaches or how it
grades. This is the exact same "additive UI/presentation is fine, pedagogy
is not" line `app/scripts/checkDoctrine.ts` draws for the app's own
system-prompt injections — it just isn't mechanically enforced here the way
that one is, since this script operates on the plugin's own files, which
checkDoctrine.ts never reads. Review any new overlay by hand against that
standard before adding it.

## Current overlays

- **`engram/explorable-contract.visual-design-section.md`** +
  **`engram/explorable-contract.qa-checklist-item.md`** — the desktop app's
  house visual-design-system, appended to `skills/_shared/explorable-contract.md`
  (read by the `engram-artifact-smith` subagent) so generated explorables
  match the app's own sharp-glass chrome instead of inventing their own look.
