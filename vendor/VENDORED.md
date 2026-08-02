# Vendored dependencies

## engram/ — the Engram learning plugin

| | |
|---|---|
| Upstream | https://github.com/nagisanzenin/engram (`git@github.com:nagisanzenin/engram.git`) |
| Author | Quan Duong (`nagisanzenin`) |
| License | MIT — see `engram/LICENSE`, preserved verbatim |
| Pinned version | **1.10.1** |
| Pinned commit | **c576e9b** ("Merge: v1.10.1 — the plugin directory that was pretending to be two things") |
| Snapshot taken | 2026-08-01, from a clean `~/.claude/plugins/marketplaces/engram` checkout |
| Excluded from snapshot | `.git/`, `node_modules/` — everything else is verbatim |

### Why this exists

Engram Desktop is a window onto this plugin (see `app/scripts/checkDoctrine.ts`,
founding constraint #1) — the plugin is the app's single most important
dependency, and it is third-party. Vendoring converts two risks into
non-events:

- **Upstream abandonment or deletion.** The repo disappearing from GitHub no
  longer matters; the app's engine is preserved here, MIT-licensed for
  continued use and redistribution with attribution intact.
- **Unreviewed drift.** The app is developed and tested against a known
  plugin version. This snapshot pins exactly what that version is.

This is a **cold copy, not a runtime path.** Nothing in the app reads from
`vendor/` — at runtime the app resolves `engram.py` from the *installed*
plugin (`app/src/main/session/pluginResolver.ts`, highest version under
`~/.claude/plugins/cache/engram/engram/`), and `claude` sessions load the
`/engram:*` skills from that same install. Keeping a single runtime source
avoids version skew between the app's engine calls and the CLI's skills.

The snapshot is **pristine upstream**. This repo's local customizations are
deliberately NOT baked in — they live in `plugin-overlays/` and are applied
to whichever version is installed via `npm run apply:plugin-overlay` (see
`plugin-overlays/README.md`).

### Restore procedure (upstream gone, fresh machine, or corrupted install)

Recreate an installed version from this snapshot, then re-apply overlays:

```bash
# 1. Place the snapshot where the plugin cache expects it
mkdir -p ~/.claude/plugins/cache/engram/engram
cp -R vendor/engram ~/.claude/plugins/cache/engram/engram/1.10.1

# 2. Re-apply this repo's local customizations
cd app && npm run apply:plugin-overlay
```

The app's resolver picks up the highest version directory that contains
`scripts/engram.py`, so the copy is live on next launch. If `claude` needs
the marketplace entry too (fresh machine), the snapshot also works as a
local marketplace source: `cp -R vendor/engram <somewhere>` and add it with
`claude plugin marketplace add <somewhere>`.

### Update procedure (pulling a new upstream version)

Upstream remains the source of truth for updates; this snapshot follows,
never leads:

```bash
# 1. Update the installed plugin as usual, review the diff, re-apply overlays
claude plugin update engram@engram
cd app && npm run check:plugin-overlay && npm run apply:plugin-overlay

# 2. Once the new version is validated in daily use, refresh the snapshot
cd ~/.claude/plugins/marketplaces/engram && git log --oneline -1  # note commit
rsync -a --delete --exclude='.git' --exclude='node_modules' \
  ~/.claude/plugins/marketplaces/engram/ <repo>/vendor/engram/

# 3. Update the pinned version + commit in the table above, commit both together
```

Cherry-picking a single upstream fix without taking a whole release: apply
the patch to the installed copy, and either leave the snapshot at the older
pin (note the divergence here) or refresh it from a clean checkout that
includes the pick.
