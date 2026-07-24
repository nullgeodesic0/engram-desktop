# Engram Desktop — Private GitHub Repo + Professional Documentation

**Date:** 2026-07-23
**Status:** Approved design, pre-implementation

## Goal

Give Engram Desktop its own standalone, professionally documented git repository, pushed private to GitHub (`Deltatacoman/engram-desktop`). The documentation serves two jobs: a portfolio-grade README that presents the project at a glance, and contributor-grade internals docs so a developer (or future us) can understand, run, and extend the app.

## Decisions (locked with user)

1. **Scope:** app code + docs in one repo (not docs-only).
2. **History:** fresh start — one clean initial commit. The existing history stays in the home-directory repo and is not extracted (it interleaves personal files and paths).
3. **Audience:** portfolio + contributor.
4. **Visibility:** private for now; write everything as if it may later be public (no personal paths, no secrets).

## Repo mechanics

- `git init` in `.` — the working copy becomes the repo root; no duplicate checkout.
- Detach from the home-directory repo: `git rm -r --cached` every EngramDesktop path it tracks, add `EngramDesktop/` to the home repo's `.gitignore`, commit that in the home repo. Files on disk are untouched.
- Default branch `main`. Create with `gh repo create Deltatacoman/engram-desktop --private --source . --push` (account already authenticated; ssh protocol).
- Single initial commit after all docs and hygiene files are in place.

## Contents

**Included**

- `app/` — full Electron app source.
- `docs/` — the new documentation set (below).
- `docs/design-history/` — the existing SDD specs and plans from `docs/superpowers/{specs,plans}`, moved there verbatim. They are genuine design records; the directory README states they are working documents, less polished than the top-level docs.
- `README.md`, `.gitignore`, `docs/media/` (screenshot assets).

**Excluded** (via `.gitignore` or simply not added)

- `node_modules/`, `app/out/`, `app/build/` outputs, `dist/` artifacts.
- `.remember/` (session handoff notes), `.DS_Store`.
- `spike/` — pre-architecture prototype; excluded from the repo entirely.
- No LICENSE file for now (private, all rights reserved). Revisit before any public release.

## Documentation set

All docs written in a professional, plain-English engineering register — no marketing fluff, no session-log tone. Consistent terminology with the app's own UI language.

1. **`README.md`** — the portfolio face.
   - What it is: a native macOS learning environment that drives the engram spaced-repetition learning loop by scripting the Claude Code CLI headlessly (never the Anthropic API directly).
   - Screenshots section (see Media below).
   - Feature tour: /learn, /review, /coach loops; beat-aware chat transcript; ink-plate topic atlas; session tickets, grade receipts, calibration; Night Atlas design language.
   - Architecture at a glance: one diagram (Mermaid) — renderer ⇄ preload ⇄ main ⇄ claude CLI child processes ⇄ MCP bridge worker.
   - Quick start (prereqs + three commands), tech stack list, pointer to `docs/`.
2. **`docs/architecture.md`** — process model (main/renderer/preload, IPC surface), SessionManager and the headless `claude` invocation (flags, permission config, append-system-prompt), MCP bridge (stdio worker → loopback HTTP relay → IPC events), transcript-derived hydration (banner, ticket, last-walk), data locations (`userData` files, engram plugin state as the single source of truth).
3. **`docs/learning-loop.md`** — the philosophy constraints and how the UI honors them: free recall composer-first, honest grading (no pity passes), advisory-only bridge signals with graceful degradation, no auto-send, momentum opt-out. The dialogue beat grammar (open_gap → predict → struggle → resolve → self_explain → connect, plus verify) and how beats map to UI (stepper, beat cards, marks).
4. **`docs/design-language.md`** — Night Atlas: palette tokens, type roles (Fraunces voice, Space Grotesk chrome, mono data), ink node glyphs and dendrite motifs, motion tokens and the interaction vocabulary.
5. **`docs/development.md`** — prerequisites (Node version, `claude` CLI installed and authenticated, engram plugin), commands (`npm run dev`, `typecheck`, `build`, `dist:mac`), the packaged rebuild/reinstall flow, repo layout map, where per-topic settings and session indexes live.

## Media

`docs/media/` holds README screenshots with fixed expected filenames (`home.png`, `learn-session.png`, `topic-atlas.png`, `review.png`). The README references them; until captures are dropped in, a brief note in the screenshots section says captures are pending. Claude does not capture screenshots itself (no computer control) unless the user grants it explicitly.

## Hygiene gate (before first push)

- Grep the entire staged tree for personal home-directory paths, `Deltatacoman` outside intended context, Anthropic/GitHub credential prefixes, `api[_-]?key`-style assignments, and other secret patterns; fix or exclude any hit.
- Confirm `gh repo view` reports the repo as private after creation.
- Fresh-clone sanity: documented in `docs/development.md` (clone → `npm install` → `npm run build`), executed once as verification.

## Out of scope

- Docs site (Docusaurus/wiki), CI, license selection, public release checklist, extracting old git history.
