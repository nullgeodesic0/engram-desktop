# Product Shell — Icon & Branding, Backup & Restore, Update Check

**Date:** 2026-07-24
**Status:** Approved design (Project E of the records round)

## Goal

The last mile of being a real macOS product: an identity in the dock and installer, protection for months of learning state, and a way to know a newer build exists — without an Apple Developer membership (signing deferred; decided with user).

## Constraints (binding)

- Backup restore is the one destructive-capable flow in the app: it must take an explicit typed/confirmed action, and always writes a pre-restore safety snapshot first. Restore never runs while a session is live (guard on `anySessionActive`).
- Update check uses the user's authenticated `gh` CLI (same trust boundary as sessions themselves); when `gh` is missing or unauthenticated it degrades to a quiet "checked manually" state — never an error banner. No auto-download, no auto-install.
- Icon artwork is original (ink-node motif from the app's own design language), produced as SVG master → all sizes via the existing `icons` script; no third-party artwork.
- Verification per task: `npm run typecheck && npm run build`; packaged build for the icon/DMG check.

## Components

### 1. Icon + branding

- SVG master: a seeded ink-node blob (the app's InkNode language) in warm ink on the void, readable at 16 px; exported through `npm run icons` to `icon.icns`/iconset. macOS Tahoe prefers a slightly inset squircle-friendly composition — follow current Apple HIG icon grid.
- DMG: electron-builder `dmg.background` art (void background, ink dendrite, arrow to /Applications), window size/pos configured.
- About panel: version, the engram credit line, icon art (app.setAboutPanelOptions already exists — extend).

### 2. Backup & restore (Settings section)

- **Back up now**: archives `~/.claude/learning` + the app's userData JSON files (topic-settings, session-index, map-annotations, achievements, notifier-state) into `engram-backup-<yyyy-mm-dd-hhmm>.tar.gz` at a user-chosen destination (save dialog). Shows resulting size + path. Optionally remembers the destination for one-click next time.
- **Restore…**: picks an archive, validates its shape (contains `learning/` and recognizable JSON), shows a summary (topics, receipts count, archive date) and requires typing `restore` to proceed. Then: safety-snapshot current state to a sibling archive → replace. Blocked with clear copy while any session is live.
- Implementation in main (`backup.ts`): `tar` via the system binary (present on macOS) — no new deps.

### 3. Update check

- `checkForUpdate` (existing IPC surface — extend or replace its implementation): runs `gh api repos/nullgeodesic0/engram-desktop/commits/main --jq .sha` (or the releases endpoint if releases start existing) and compares against the build's embedded commit (injected at build time via electron-vite define).
- Settings row + About panel line: "Up to date" / "Newer build available — built <date>, current <date>" with a "how to update" disclosure that shows the three rebuild commands (clone/pull, dist:mac, copy) — copyable, not executed.
- Graceful states: no gh / no auth / offline → "couldn't check — last checked <when>" in fig-caption voice.

## Out of scope

Code signing/notarization and electron-updater (revisit with an Apple Developer ID); backup scheduling/automation; cloud backup destinations; Windows/Linux packaging.

## Verification

- Packaged app shows the new icon in dock/Finder/DMG; About panel branded.
- A backup archive round-trips: back up → restore into place → app state identical (topics/settings spot-checked); restore refused while a session runs; safety snapshot created.
- Update check: with `gh` authed reports correctly against the repo; with `gh` renamed away, degrades quietly.
