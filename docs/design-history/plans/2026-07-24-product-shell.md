# Product Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** App icon + DMG branding, backup/restore, gh-based update check. Spec: `../specs/2026-07-24-product-shell-design.md`.

**Architecture:** SVG icon master through the existing `icons` script; backup via system `tar` in main; update check spawns the user's `gh` CLI and compares an embedded build commit.

**Tech Stack:** existing only; system `tar`; user's `gh`.

## Global Constraints

- Restore: typed `restore` confirmation, pre-restore safety snapshot ALWAYS, refused while `anySessionActive()`; these three are non-negotiable.
- Update check: read-only `gh api`; missing/unauthed gh → quiet degraded copy, never an error banner; no auto-download/install.
- Icon artwork original, derived from the InkNode motif; readable at 16 px.
- Verification per task: `cd app && npm run typecheck && npm run build`; icon/DMG verified on a packaged build at round end.

---

### Task 1: Icon + branding

**Files:**
- Create/replace: the icon source the `icons` script consumes (read `app/package.json`'s `icons` script + electron-builder config first to find expected paths, e.g. `build/icon.png`/`icon.icns` or `resources/icon.svg`), DMG background art file, referenced in electron-builder `dmg` config
- Modify: `app/electron-builder.yml` or the builder config in package.json (dmg background/window), `app/src/main/index.ts` (About panel options: credits line, copyright)

**Interfaces:**
- Consumes: `components/graph2d/plate.ts`'s `cellBodyPath(seed, r)` shape language — generate the icon blob with the same seeded-wobble math (port the few lines into a build-time node script `app/scripts/make-icon.mjs` that writes the SVG/PNG master; commit the generated master so builds don't depend on regeneration).
- Icon composition: single warm-ink cell body with two or three dendrite stubs, centered on the void (#0d0e12) in a rounded-square field sized to Apple's icon grid; 16 px legibility check = the blob silhouette alone.
- DMG background: void, faint dendrite constellation, app icon left, arrow, Applications right; 660×400 @2x.

- [ ] Locate the icons pipeline; write make-icon.mjs; generate masters; run `npm run icons`.
- [ ] Builder config for dmg background; About panel text.
- [ ] Verify typecheck+build (`dist:mac` deferred to round end); commit `feat(shell): ink-node app icon, DMG art, About branding`.

### Task 2: Backup & restore

**Files:**
- Create: `app/src/main/session/backup.ts`
- Modify: `app/src/main/ipc/sessionHandlers.ts` (IPC: `backupNow`, `restoreFromArchive`, `describeArchive`), `app/src/preload/index.ts`, `app/src/shared/types.ts`, `app/src/renderer/src/app/SettingsView.tsx` (Backup section)

**Interfaces:**
- Produces:
  ```ts
  backupNow(destDir?: string) → { ok:true, path:string, bytes:number } | { ok:false, reason:string }
  describeArchive(path) → { ok:true, topics:number, receipts:number, archivedAt:string } | { ok:false, reason }
  restoreFromArchive(path, confirmation:string) → { ok:true, safetyPath:string } | { ok:false, reason }
  ```
- backup: `tar -czf <dest>/engram-backup-<stamp>.tar.gz -C ~ .claude/learning -C <userData> topic-settings.json session-index.json map-annotations.json achievements.json notifier-state.json` (build the file list defensively — skip absent files). Save dialog in main picks destDir on first use; remember in a settings JSON.
- restore: reject unless `confirmation === 'restore'`; reject if `anySessionActive()`; validate archive lists `\.claude/learning/` entries (`tar -tzf`); safety snapshot via backupNow to the archive's directory; then extract over the live locations (`tar -xzf` with the same -C mapping). Renderer Settings flow: file picker → describeArchive summary card → typed confirmation input → result with safety-snapshot path shown.

- [ ] backup.ts + IPC + Settings UI (Back up now / Restore… rows; last-backup timestamp).
- [ ] Verify typecheck+build; round-trip test against a THROWAWAY temp HOME copy in a script (never the real learning dir — simulate with tar to/from temp dirs), transcript of the test in the report; commit `feat(shell): backup and guarded restore of learning state`.

### Task 3: Update check

**Files:**
- Create: `app/src/main/session/updateCheck.ts`
- Modify: `app/electron.vite.config.ts` (define `__BUILD_COMMIT__`/`__BUILD_DATE__` from git at build time), `app/src/main/index.ts` or readHandlers (rewire the existing `checkForUpdate` IPC — read its current implementation first), `app/src/renderer/src/app/SettingsView.tsx` + About surface (status line + how-to-update disclosure)

**Interfaces:**
- Produces: `checkForUpdate() → { state:'current'|'behind'|'unknown', buildCommit:string, buildDate:string, remoteCommit?:string, remoteDate?:string, checkedAt:string, reason?:string }`.
- Mechanism: `execFile('gh', ['api','repos/nullgeodesic0/engram-desktop/commits/main','--jq','{sha:.sha,date:.commit.committer.date}'])` with a timeout; compare sha prefix to `__BUILD_COMMIT__`. Any failure → `unknown` with reason. Cache last result + checkedAt in userData settings JSON; auto-check at most once per app launch (on ready, delayed), manual re-check button.
- Copy: "Up to date — build <short> (<date>)" / "Newer build available — repo at <short> (<date>)" + disclosure listing the three copyable commands (git pull; npm run dist:mac; cp -R … /Applications) / "couldn't check — <reason-in-plain-words>, last checked <when>".

- [ ] Build-time defines; updateCheck.ts; rewire IPC; Settings/About UI.
- [ ] Verify typecheck+build; manual `gh` sanity via a node -e spawn in the report; commit `feat(shell): build-aware update check via gh`.
