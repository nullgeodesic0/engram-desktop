# Development

How to build, run, and package Engram Desktop, plus a map of the codebase and where its on-disk state lives. For how the app is architected at runtime, see [Architecture](architecture.md); for the visual system, see [Design language](design-language.md).

## Prerequisites

- Node.js 22 or later (developed on 26)
- The `claude` CLI installed and authenticated
- The engram learning plugin installed in Claude Code

The app never calls a model API directly — it spawns `claude -p` as a child process, so a working, authenticated `claude` CLI with the engram plugin installed is required for any session to run, not just for packaging.

## Commands

All commands run from `app/`.

| Command | What it does |
|---|---|
| `npm run dev` | Starts electron-vite in dev mode — hot-reloading renderer, live-reloading main/preload — and launches the app. |
| `npm run typecheck` | Runs `tsc --noEmit` twice, once against the main/preload project and once against the renderer/web project. |
| `npm run build` | Runs electron-vite's production build (main, preload, renderer) into `out/`, without packaging an app bundle. |
| `npm run dist:mac` | Bundles the MCP bridge worker with esbuild, runs `build`, then runs electron-builder for macOS — produces a signed-or-not `.app` (plus `.dmg`/`.zip`) in `dist/`. |
| `npm run dist` | Same as `dist:mac` but lets electron-builder target whatever platform it's invoked on. |
| `npm run start` | Previews the last `build` output via electron-vite's preview mode, without a dev server. |
| `npm run icons` | Regenerates app icons from source art via `scripts/build-icons.sh`. |

`dist:mac` explicitly runs `bundle:bridge-worker` first: the MCP bridge worker (`src/main/bridge/mcpBridgeWorker.mjs`) is a separate stdio process spawned at runtime, so it has to be esbuild-bundled into `resources/` before electron-builder copies `resources/` into the packaged app as an extra resource. Skipping that step produces a package whose bridge worker is missing or stale.

## Packaged install flow

1. `npm run dist:mac` — produces the `.app` under `app/dist/mac*/`.
2. Quit any running copy of Engram Desktop first. **Quitting mid-session kills the live `claude -p` child process** — but nothing is lost: sessions are driven by the engram plugin's own append-only transcript and receipt files on disk, so a killed session simply resumes from the last completed beat the next time you open that topic.
3. Copy the new `.app` into `/Applications`, replacing the old one.
4. Relaunch.

## Repo layout

```
engram-desktop/
├── README.md
├── app/                        the Electron app
│   └── src/
│       ├── main/                Electron main process (Node context)
│       │   ├── index.ts           app bootstrap, window creation, lifecycle
│       │   ├── appMenu.ts         native macOS application menu
│       │   ├── windowState.ts     persists/restores window position & size
│       │   ├── bridge/            the MCP bridge worker and its HTTP server
│       │   ├── engramCli/         read-only helpers that shell out to engram.py
│       │   ├── ipc/               IPC handlers exposed to the renderer
│       │   └── session/           SessionManager, stream parsing, on-disk stores
│       ├── preload/              contextBridge glue between main and renderer
│       ├── renderer/             the React UI (Vite root)
│       │   └── src/
│       │       ├── App.tsx          top-level view router
│       │       ├── app/             one component per top-level view (Home, Learn, Review, …)
│       │       ├── components/      shared UI components (chat, beats, graphs, dialogs)
│       │       ├── shared/           renderer-only helpers (calibration store, ticket parsing)
│       │       └── webgl/            WebGL texture helpers for the neural-field/graph views
│       └── shared/                types and helpers shared by main and renderer
├── docs/                        this documentation
│   ├── architecture.md
│   ├── development.md            this file
│   ├── design-language.md
│   ├── learning-loop.md
│   ├── media/                    screenshots referenced from the README
│   └── design-history/           specs and plans behind the app's evolution
```

## Data locations (for debugging)

The app stores its own state — separate from the engram plugin's own topic/session/receipt files — under `~/Library/Application Support/Engram Desktop/`:

| File | Purpose |
|---|---|
| `topic-settings.json` | Per-topic app-local customization: a free-text system-prompt addition appended to every session for that topic, and a list of context files the model is told to read at the start of a fresh session (syllabus, reference PDF, etc.). Deliberately kept out of the engram plugin's own schema. |
| `session-index.json` | Append-only index of `{key -> session_id[]}` across app restarts, where `key` is a topic id (for `/learn`) or a session kind like `review`/`coach`. Lets the UI browse past sessions; it's a convenience index only — the plugin's own files remain the source of truth, so deleting it just forgets resume/history, nothing more. |
| `achievements.json` | The list of unlocked achievements. |
| `notifier-state.json` | Review-reminder settings (enabled, cadence in minutes) plus dedup bookkeeping (last notified time, last signature) for the periodic due-review notifier. |
| `window-state.json` | Last-known window bounds, used to restore window position/size on next launch (clamped to a currently attached display). |

Deleting any of these files is safe and non-destructive to learning progress — they reset to defaults and rebuild themselves from the plugin's own data and future app usage.

## Fresh-clone sanity check

```bash
git clone <repo> && cd engram-desktop/app
npm install
npm run build
```

A clean `npm run build` (no `dev` server, no packaging) is the fastest way to confirm a fresh clone's toolchain is sound before diving into `npm run dev`.
