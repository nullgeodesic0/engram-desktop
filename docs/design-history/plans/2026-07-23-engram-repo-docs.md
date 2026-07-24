# Engram Desktop Repo + Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.` a standalone git repo with portfolio+contributor documentation, pushed private to `nullgeodesic0/engram-desktop`.

**Architecture:** Detach the directory from the home-dir repo, init a fresh repo in place, write five documentation files plus README from the live source tree, then a hygiene-scanned single initial commit pushed via `gh`.

**Tech Stack:** git, gh CLI (authenticated, ssh), Markdown + Mermaid, Node 26 / Electron 36 app (unchanged).

## Global Constraints

- Repo name `engram-desktop`, owner `nullgeodesic0`, **private**, default branch `main`.
- Fresh history: exactly one initial commit (plus any fix commits before push counts as normal follow-ups — but the first push must not contain home-repo history).
- No personal absolute paths (`~/...`) and no secrets in any committed file. Exception: none.
- `spike/` and `.remember/` are never committed.
- App source is NOT modified by this project (docs only, plus the two git-plumbing commits).
- Docs register: plain engineering English; no session-log tone, no marketing fluff; app terminology matches the UI (walk, beat, receipt, ticket, Night Atlas).
- Verification for docs tasks: markdown renders (no broken relative links), facts checked against the named source files.

---

### Task 1: Detach from home repo, init standalone repo, hygiene files

**Files:**
- Modify: home repo index (`git rm -r --cached`), `~/.gitignore` (create if absent)
- Create: `.git` (init), `.gitignore`

**Interfaces:**
- Produces: a standalone repo at `EngramDesktop/` on branch `main` with nothing yet committed; later tasks add files and Task 8 makes the initial commit.

- [ ] **Step 1: Untrack EngramDesktop in the home repo (files stay on disk)**

```bash
cd ~
git rm -r -q --cached EngramDesktop
printf 'EngramDesktop/\n' >> .gitignore
git add .gitignore
git commit -m "chore: move EngramDesktop to its own repository

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Expected: commit succeeds; `git ls-files EngramDesktop | wc -l` prints `0`.
Note: do NOT use `git add -A` anywhere in the home repo — it scans the entire home directory and hangs.

- [ ] **Step 2: Init the standalone repo**

```bash
cd .
git init -b main
```

Expected: `Initialized empty Git repository in .git/`

- [ ] **Step 3: Write `.gitignore`**

```gitignore
node_modules/
out/
dist/
build/
*.log
.DS_Store
.remember/
spike/
```

Write that content to `.gitignore`.
Note: `app/build/` contains electron-builder resources tracked in some projects — here `build/` matches only generated output; confirm with `git status --short | grep -c build` after Task 8 staging that nothing needed vanished (expected: `app/build` absent from disk or ignorable).

- [ ] **Step 4: Verify ignore behavior**

```bash
cd .
git status --porcelain | grep -E 'spike/|\.remember/|node_modules' | wc -l
```

Expected: `0`. No commit yet — Task 8 owns the initial commit.

### Task 2: Move SDD docs to design-history

**Files:**
- Move: `docs/superpowers/specs/*` → `docs/design-history/specs/*`, `docs/superpowers/plans/*` → `docs/design-history/plans/*`
- Create: `docs/design-history/README.md`
- Delete: empty `docs/superpowers/`

**Interfaces:**
- Produces: `docs/design-history/` tree referenced by README (Task 3) and development.md (Task 7).

- [ ] **Step 1: Move the trees**

```bash
cd docs
mkdir -p design-history
mv superpowers/specs design-history/specs
mv superpowers/plans design-history/plans
rmdir superpowers
```

- [ ] **Step 2: Write `docs/design-history/README.md`**

```markdown
# Design history

Working design documents from the app's development — feature specs in `specs/`
and their implementation plans in `plans/`, named by date. These are internal
working records: rougher than the top-level docs, kept because they explain why
the architecture looks the way it does.
```

- [ ] **Step 3: Verify**

```bash
ls docs/design-history/specs | wc -l
```

Expected: same count as before the move (non-zero); `docs/superpowers` no longer exists.

### Task 3: README.md

**Files:**
- Create: `README.md`, `docs/media/` (dir, with `.gitkeep`)
- Read for facts: `app/package.json`, `app/src/main/session/SessionManager.ts`, `app/src/main/session/permissionConfig.ts`, `app/src/main/bridge/mcpBridgeWorker.mjs`, `app/src/renderer/src/index.css`

**Interfaces:**
- Consumes: `docs/design-history/` (Task 2).
- Produces: README links to `docs/architecture.md`, `docs/learning-loop.md`, `docs/design-language.md`, `docs/development.md` and images `docs/media/{home,learn-session,topic-atlas,review}.png` — Tasks 4–7 must use exactly those filenames.

- [ ] **Step 1: Write README.md** with these sections, written fresh against the source files above (no boilerplate):
  1. Title + one-paragraph definition: a native macOS learning environment that drives the [engram](https://github.com/anthropics/claude-code) learning plugin's spaced-repetition loop by scripting the Claude Code CLI headlessly — the app never calls a model API directly.
  2. **Screenshots** — a 2×2 table of the four `docs/media/*.png` images; if a file is missing, keep the table and add one italic line: *Screenshots pending.*
  3. **Features** — /learn (dialogue-grammar beats with a live beat stepper, free-recall composer, grade receipts), /review (spaced audits, honest grading with reveal cards), /coach, the 2D ink-plate topic atlas, session tickets and calibration, the Night Atlas design language, native macOS shell (frameless title bar, real app menu, ⌘N/⌘L/⇧⌘R).
  4. **Architecture at a glance** — Mermaid flowchart: Renderer (React) ⇄ preload IPC ⇄ Main (Electron) → spawns `claude` CLI child processes → MCP bridge worker (stdio) → loopback HTTP → back to Main → IPC events to Renderer. One sentence per hop under the diagram.
  5. **Quick start** — prerequisites (Node ≥ 22, `claude` CLI authenticated, engram plugin installed), then `cd app && npm install && npm run dev`.
  6. **Tech stack** — Electron 36, React, TypeScript, electron-vite, Tailwind 4, KaTeX, zod (bridge), esbuild (worker bundle).
  7. **Documentation** — linked list of the four docs + design-history.
- [ ] **Step 2: Create media dir**: `mkdir -p docs/media && touch docs/media/.gitkeep`
- [ ] **Step 3: Verify** — every relative link target in README exists on disk (except the four png files); no `/Users/` string in the file: `grep -c '/Users/' README.md` → `0`.

### Task 4: docs/architecture.md

**Files:**
- Create: `docs/architecture.md`
- Read for facts: `app/src/main/session/SessionManager.ts`, `app/src/main/session/permissionConfig.ts`, `app/src/main/ipc/sessionHandlers.ts`, `app/src/main/ipc/readHandlers.ts`, `app/src/main/bridge/bridgeServer.ts`, `app/src/main/bridge/mcpBridgeWorker.mjs`, `app/src/shared/bridgeProtocol.ts`, `app/src/shared/bannerFromTranscript.ts`, `app/src/main/session/topicSettings.ts`, `app/src/main/session/sessionIndex.ts`, `app/src/preload/index.ts`

**Interfaces:**
- Consumes: README's architecture diagram (Task 3) — this doc is the long-form version and must not contradict it.

- [ ] **Step 1: Write `docs/architecture.md`** covering, each grounded in the file that implements it:
  - Process model: main / preload / renderer, the typed IPC surface exposed as `window.engram`.
  - Session engine: how a learn/review/coach session spawns `claude` with `--print`-style streaming flags, tool allowlist, and `--append-system-prompt` (quote the actual flags from SessionManager/permissionConfig); stdin/stdout protocol; crash detection and resume.
  - MCP bridge: per-session stdio MCP server (`mcpBridgeWorker.mjs`, bundled by esbuild at build time), its 8 tools listed with one-line purposes, fire-and-forget UI channel via loopback HTTP (`bridgeServer.ts` routes `/ask`, `/beat`, `/ui`) relayed to the renderer as IPC events; advisory-only contract and shape-guarding of untrusted payloads.
  - Transcript hydration: reopening a session reconstructs the banner (render_beat/beat_outcome), last-walk recap, and ticket from the JSONL transcript rather than replaying UI events.
  - Data locations: Electron `userData` files (`topic-settings.json`, `session-index.json`, `achievements.json`, `notifier-state.json`, window state) as UI conveniences; the engram plugin's own files remain the single source of truth for learning state. Use `~/Library/Application Support/Engram Desktop` as the written example path (no `/Users/<name>`).
- [ ] **Step 2: Verify** — every named file path in the doc exists (`grep -o 'app/src[^ )`]*' docs/architecture.md | sort -u | xargs ls` succeeds); no `/Users/` string.

### Task 5: docs/learning-loop.md

**Files:**
- Create: `docs/learning-loop.md`
- Read for facts: `app/src/main/session/permissionConfig.ts` (APPEND_SYSTEM_PROMPT), `app/src/main/bridge/mcpBridgeWorker.mjs` (BEATS array, tool schemas), `app/src/renderer/src/components/BeatCard.tsx`, `app/src/renderer/src/components/ritual/Marks.tsx`, `app/src/renderer/src/components/BeatStepper.tsx`, the engram plugin's dialogue-grammar doc if present under `~/.claude/plugins` (read-only)

**Interfaces:**
- Consumes: beat names exactly as defined in `mcpBridgeWorker.mjs`: `open_gap`, `predict`, `struggle`, `resolve`, `self_explain`, `connect`, plus outcome-only `verify`.

- [ ] **Step 1: Write `docs/learning-loop.md`**:
  - The philosophy constraints as first-class rules the UI must honor: free recall before recognition (composer-first, no answer reveals), honest grading (no pity passes; grades come from a blind assessor), advisory-only bridge signals (every MCP tool call degrades gracefully to plain text if the UI ignores it), no auto-send (suggested actions only prefill the composer), momentum opt-out honored.
  - The beat grammar: table of the six prose beats + verify, each with its UI treatment (BeatCard accent, stepper position, mark glyph).
  - The session shapes: learn walk (intake → pretest → walk → grading → closing), review audit, coach — and which UI surfaces (stepper, ticket, ceremony, receipts) appear in each.
- [ ] **Step 2: Verify** — beat names in the doc match the BEATS array verbatim; no `/Users/` string.

### Task 6: docs/design-language.md

**Files:**
- Create: `docs/design-language.md`
- Read for facts: `app/src/renderer/src/index.css` (@theme tokens, motion tokens, interaction-vocabulary comment), `app/src/renderer/src/components/ui/InkNode.tsx`, `app/src/renderer/src/components/ui/DendriteDivider.tsx`

**Interfaces:** none beyond README link.

- [ ] **Step 1: Write `docs/design-language.md`** — Night Atlas: the palette as a token table (name, hex, role) copied from `@theme`; type roles (Fraunces = the tutor's voice and display, Space Grotesk = chrome, mono = data); the ink motif (seeded InkNode blobs, dendrite dividers, hand-drawn beat glyphs); motion tokens (`--dur-fast` 120ms, `--dur-base` 200ms, `--ease-out-soft`) and the interaction vocabulary rules (hover = background+border shift on rows/cards, color-only on ghost buttons, scale reserved for buttons).
- [ ] **Step 2: Verify** — every hex value and token name in the doc appears verbatim in `index.css`; no `/Users/` string.

### Task 7: docs/development.md

**Files:**
- Create: `docs/development.md`
- Read for facts: `app/package.json` (scripts), `app/electron.vite.config.ts`, memory of the packaged-rebuild sequence (documented in project memory; restate from `package.json` scripts, not from memory paths)

**Interfaces:**
- Consumes: `docs/design-history/` (Task 2), media filenames (Task 3).

- [ ] **Step 1: Write `docs/development.md`**:
  - Prerequisites: Node ≥ 22 (developed on 26), `claude` CLI installed and authenticated, engram plugin installed in Claude Code.
  - Commands table from `app/package.json`: `npm run dev`, `npm run typecheck`, `npm run build`, `npm run dist:mac` (auto-bundles the bridge worker) — with one line on what each does.
  - Packaged install flow: `npm run dist:mac`, quit the running app, copy the built `.app` into `/Applications`, relaunch. Warn: quitting kills live learning sessions; they resume from disk.
  - Repo layout map: two-level tree of `app/src` (main/preload/renderer/shared) with one-line responsibilities, plus `docs/` including `design-history/` and `media/`.
  - Data locations for debugging: `~/Library/Application Support/Engram Desktop/` files listed with purposes.
  - Fresh-clone sanity check: `git clone <repo> && cd engram-desktop/app && npm install && npm run build`.
- [ ] **Step 2: Verify** — each documented script exists in `app/package.json`; no `/Users/` string.

### Task 8: Hygiene scan, initial commit, create private repo, push, verify

**Files:**
- Create: git history (initial commit), GitHub repo `nullgeodesic0/engram-desktop`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Stage and hygiene-scan**

```bash
cd .
git add .
git diff --cached --name-only | wc -l
git grep --cached -nE '<home-path>|<anthropic-key-prefix>|<gh-oauth-prefix>|<gh-pat-prefix>|api[_-]?key\s*[:=]' -- . ':!app/package-lock.json' || echo CLEAN
```

Expected: non-zero file count; final line `CLEAN`. If hits appear, fix each file (relative paths / example paths) and re-run until CLEAN. Absolute paths inside `docs/design-history/` are acceptable ONLY if scrubbing would falsify the record — prefer scrubbing to `~`.

- [ ] **Step 2: Initial commit**

```bash
git commit -m "Engram Desktop — native learning environment for the engram loop

Initial import: Electron app, documentation set, design history.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Create private repo and push (ask user before this step if not already authorized — publishing action)**

```bash
gh repo create nullgeodesic0/engram-desktop --private --source . --push
```

Expected: repo URL printed; push succeeds.

- [ ] **Step 4: Verify private + contents**

```bash
gh repo view nullgeodesic0/engram-desktop --json visibility,defaultBranchRef -q '.visibility + " " + .defaultBranchRef.name'
```

Expected: `PRIVATE main`.

- [ ] **Step 5: Fresh-clone sanity build**

```bash
cd "$(mktemp -d)"
git clone --quiet git@github.com:nullgeodesic0/engram-desktop.git
cd engram-desktop/app && npm install --no-audit --no-fund && npm run build
```

Expected: build completes (`✓ built`). Delete the temp clone afterward.
