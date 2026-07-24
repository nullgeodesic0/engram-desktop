# Ship Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Navigation intent fixes, failure-feedback upgrades, first-run/empty states, and the fully-frameless Night Atlas shell, per `docs/superpowers/specs/2026-07-23-ship-polish-design.md`.

**Architecture:** Tasks 1-2 are renderer-only behavior fixes (Learn deep-link switching + error recovery). Task 3 is empty states (Home/Learn). Task 4 is the Topic Map's Learn bridge + empty state. Task 5 is the main-process shell (frameless, window state, window-control IPC) + TitleBar component. Task 6 is packaging (DMG block).

**Tech Stack:** Electron main + preload IPC, React 19, Night Atlas primitives (Button/Card/InkNode/fig-caption).

## Global Constraints

- Loop semantics sacred; no engine/MCP-bridge changes.
- Verification per task: `npm run typecheck && npm run build` clean in `app`. `noUnusedLocals: true`. No interactive verification during implementation.
- Colors/fonts via CSS variables. Commit per task with the given message, on `master`.
- macOS only for shell work.

---

### Task 1: Learn deep-link switching (navigation intent core)

**Files:**
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`

- [ ] **Step 1:** Read the file fully. Extract the ephemeral-reset block shared by `backToTopics` (messages, jobs, nodeCount, contextUsage, currentBeat, currentNodeId, sessionGrades, streakDays, attachedFiles, nextCallsSeen, marks, gradingPending, pendingStashToolUseIds, lastNodeIdRef, ambient level, walkNumber, commitment — exactly the set `backToTopics` and `openTopic` currently reset, WITHOUT `setStarted(false)`/`setActiveTopic(null)`/`refreshTopics()`) into a private helper `resetSessionEphemera()`. Update `backToTopics` and the `openTopic`-preamble resets to call it (behavior identical — pure extraction; `backToTopics` keeps its extra started/activeTopic/viewingHistory/refresh lines).
- [ ] **Step 2:** Replace the deep-link effect's `started` guard:

```tsx
    if (started) {
      if (activeTopic?.topic === deepLinkTopicId) {
        // Already looking at this topic's session — nothing to do.
        onDeepLinkConsumed?.()
        return
      }
      // A DIFFERENT topic was requested while a session is active: park the
      // current session (it keeps running server-side, same as leaving via
      // "All topics") and switch. openTopic below re-resets ephemera, but
      // the explicit reset here also detaches the old session id so no
      // stray events land while the switch is in flight.
      const match = topics.find((t) => t.topic === deepLinkTopicId)
      if (!match) {
        onDeepLinkConsumed?.()
        return
      }
      sessionIdRef.current = null
      setSessionId(null)
      resetSessionEphemera()
      openTopic(match)
      onDeepLinkConsumed?.()
      return
    }
```

(The non-started branch stays exactly as-is.) Verify `sessionIdRef`/`setSessionId` are the real names in the file.
- [ ] **Step 3:** `npm run typecheck && npm run build` clean.
- [ ] **Step 4:** Commit: `git commit -m "feat(ship): continue-learning switches sessions instead of dropping the link"` (LearnSessionView.tsx only).

---

### Task 2: Failure feedback — Learn recovery, friendly errors, dismissals

**Files:**
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx`
- Modify: `app/src/renderer/src/components/CoachSessionPanel.tsx`

- [ ] **Step 1: Shared friendly-error helper.** In LearnSessionView.tsx (top-level, non-exported is fine but both session views need it — put it in `app/src/renderer/src/shared/friendlyError.ts` as a new tiny module):

```ts
/** Human framing for the ugliest failure class — the claude binary not
 * launching at all. Everything else passes through untouched. */
export function friendlyErrorText(message: string): { headline: string; detail: string | null } {
  const lower = message.toLowerCase()
  if (lower.includes('enoent') || lower.includes('spawn') || lower.includes('not found')) {
    return {
      headline: 'Claude CLI could not be launched — check the setup (Settings → environment, or reinstall the claude CLI).',
      detail: message,
    }
  }
  return { headline: message, detail: null }
}
```

(Path note: renderer files import it as `../shared/friendlyError` from `app/` and `./../shared/friendlyError` accordingly — this is `app/src/renderer/src/shared/`, a NEW directory, distinct from `app/src/shared/`.)
- [ ] **Step 2: Learn closed-recovery.** In LearnSessionView's event switch, `case 'closed':` — set new state `const [closedUnexpectedly, setClosedUnexpectedly] = useState(false)`: set true if `started` and the event arrives while `sessionIdRef.current != null`; also `setBusy(false)`. Clear it in `resetSessionEphemera()` (from Task 1) and on any new session start. Render, above the composer when true: a danger-dim panel — "The session process ended unexpectedly. Your progress is stashed on disk — safe to reopen." + `<Button variant="ghost" onClick={() => activeTopic && openTopic(activeTopic)}>Resume session</Button>`.
- [ ] **Step 3: Error banners.** In both session views: render errors through `friendlyErrorText(error)`; headline in the existing danger panel, `detail` (when non-null) in a `<details>` with a dim `raw error` summary. Add a dismiss button (×, ghost, `onClick={() => setError(null)}`) to the banner row in both views.
- [ ] **Step 4: Coach panel.** Replace the bare `text-xs text-[var(--color-ink-danger)]` error line with the same danger panel markup (border-[var(--color-ink-danger-dim)] panel + friendly text + dismiss ×) — match Learn/Review's classes.
- [ ] **Step 5:** typecheck + build clean.
- [ ] **Step 6:** Commit: `git commit -m "feat(ship): session-death recovery, friendly spawn errors, dismissible banners"`.

---

### Task 3: First-run & zero-topic states (Home + Learn)

**Files:**
- Modify: `app/src/renderer/src/app/HomeView.tsx`
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`

- [ ] **Step 1: Home hero.** When the topics list is empty (zero topics overall — use the same data the continue-learning grid uses), replace the current ghost "+" button block with:

```tsx
<div className="flex flex-col items-start gap-3 py-10">
  <div className="fig-caption">Fig. — an unmarked atlas</div>
  <div className="font-[var(--font-serif)] text-[length:var(--text-display)] text-[var(--color-text-primary)]">Begin your atlas</div>
  <p className="text-sm text-[var(--color-text-dim)] max-w-md">
    Engram teaches by making you produce, then verifies what stuck — free recall, honest grades, and a map that fills in as you learn.
  </p>
  <Button variant="primary" onClick={onNewTopic}>Start your first topic</Button>
</div>
```

The existing in-progress grid renders unchanged otherwise.
- [ ] **Step 2: Learn zero-topics.** Replace the "No topics yet — start one below." dim panel with a Card: fig-caption "Fig. — no territories mapped yet", serif line "Every topic starts as a first-principles map.", and keep/emphasize the existing "+ Start a new topic" affordance beneath (primary Button if it isn't already).
- [ ] **Step 3:** typecheck + build clean.
- [ ] **Step 4:** Commit: `git commit -m "feat(ship): first-run hero and inviting zero-topic states"`.

---

### Task 4: Topic Map — Learn bridge + empty state

**Files:**
- Modify: `app/src/renderer/src/app/TopicMapView.tsx`
- Modify: `app/src/renderer/src/App.tsx`

- [ ] **Step 1:** `TopicMapView` props gain `onGoTopic?: (topicId: string) => void` and `onNewTopic?: () => void`. App.tsx passes `onGoTopic={goToTopic}` and `onNewTopic={() => setView('learn')}`.
- [ ] **Step 2: Continue in Learn.** In the node modal footer and the selected-node drawer, add `<Button variant="ghost" onClick={() => onGoTopic?.(selectedTopic!)}>Continue in Learn</Button>` (drawer) / same in the modal using its topic id; render only when `onGoTopic` provided. (Import Button from `../components/ui/Button` — check whether TopicMapView already imports it.)
- [ ] **Step 3: Empty state.** When the topic pills list is empty (zero topics), replace the skeleton branch with:

```tsx
<div className="flex flex-col items-center justify-center h-full gap-3">
  <div className="fig-caption">Fig. — the atlas is unmapped</div>
  <p className="text-sm text-[var(--color-text-dim)]">No territories yet — the map draws itself as you learn.</p>
  <Button variant="ghost" onClick={onNewTopic}>Start your first topic</Button>
</div>
```

The `!graph && !error` skeleton stays for the topics-exist-but-graph-loading case.
- [ ] **Step 4:** typecheck + build clean.
- [ ] **Step 5:** Commit: `git commit -m "feat(ship): map-to-learn bridge and unmapped-atlas empty state"`.

---

### Task 5: Frameless shell — window state, controls IPC, TitleBar

**Files:**
- Create: `app/src/main/windowState.ts`
- Modify: `app/src/main/index.ts`
- Modify: `app/src/preload/index.ts`
- Create: `app/src/renderer/src/components/TitleBar.tsx`
- Modify: `app/src/renderer/src/App.tsx`
- Modify: `app/src/renderer/src/index.css` (drag-region utility)

- [ ] **Step 1: `windowState.ts`**

```ts
import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = () => join(app.getPath('userData'), 'window-state.json')
const DEFAULTS = { width: 1280, height: 840 }

/** Last-known window bounds, clamped to a currently-attached display so a
 * disconnected monitor can't strand the window off-screen. */
export function restoreWindowState(): { x?: number; y?: number; width: number; height: number } {
  try {
    const saved = JSON.parse(readFileSync(FILE(), 'utf-8')) as Rectangle
    const area = screen.getDisplayMatching(saved).workArea
    const width = Math.min(saved.width, area.width)
    const height = Math.min(saved.height, area.height)
    const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width)
    const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height)
    return { x, y, width, height }
  } catch {
    return { ...DEFAULTS }
  }
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const save = () => {
    if (win.isDestroyed() || win.isFullScreen()) return
    try {
      writeFileSync(FILE(), JSON.stringify(win.getNormalBounds()))
    } catch {
      // Best-effort — a failed save just means default bounds next launch.
    }
  }
  const debounced = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 500)
  }
  win.on('move', debounced)
  win.on('resize', debounced)
  win.on('close', save)
}
```

- [ ] **Step 2: `index.ts`** — in `createWindow`: spread `restoreWindowState()` into the BrowserWindow options (replacing the literal width/height; keep minWidth/minHeight), add `frame: false`, call `trackWindowState(win)` after creation. Register IPC:

```ts
ipcMain.handle('window:close', () => { mainWindow?.close() })
ipcMain.handle('window:minimize', () => { mainWindow?.minimize() })
ipcMain.handle('window:zoom', () => {
  if (!mainWindow) return
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false)
  else if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
```

(match the file's real variable name for the window — the Explore report shows a module-level window reference; adapt). Forward fullscreen state: on `enter-full-screen`/`leave-full-screen`, `webContents.send('window:fullscreen', true/false)`. Register these handlers ONCE at app setup (not per-window-create, or re-creating the window after close would double-register — use the existing pattern for other ipcMain.handle registrations in the file).
- [ ] **Step 3: preload** — add to engramApi:

```ts
  windowClose: (): Promise<void> => ipcRenderer.invoke('window:close'),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  windowZoom: (): Promise<void> => ipcRenderer.invoke('window:zoom'),
  onFullScreenChange: (cb: (fs: boolean) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, fs: boolean) => cb(fs)
    ipcRenderer.on('window:fullscreen', handler)
    return () => ipcRenderer.removeListener('window:fullscreen', handler)
  },
```

- [ ] **Step 4: `TitleBar.tsx`**

```tsx
import { useEffect, useState } from 'react'

const DOTS: { key: 'close' | 'min' | 'zoom'; color: string; glyph: string; label: string }[] = [
  { key: 'close', color: 'var(--color-ink-danger)', glyph: 'M3.5 3.5 8.5 8.5 M8.5 3.5 3.5 8.5', label: 'Close window' },
  { key: 'min', color: 'var(--color-ink-warm)', glyph: 'M3 6 H9', label: 'Minimize window' },
  { key: 'zoom', color: 'var(--color-ink-cool)', glyph: 'M6 3 V9 M3 6 H9', label: 'Zoom window' },
]

/** Fully-frameless custom chrome: drag region + hand-drawn ink traffic dots.
 * Dots hide in fullscreen (macOS supplies its own reveal-on-hover controls
 * there). Double-click on the bar zooms, matching native title bars. */
export function TitleBar() {
  const [fullscreen, setFullscreen] = useState(false)
  const [hovered, setHovered] = useState(false)
  useEffect(() => window.engram.onFullScreenChange(setFullscreen), [])

  function act(key: 'close' | 'min' | 'zoom') {
    if (key === 'close') window.engram.windowClose()
    else if (key === 'min') window.engram.windowMinimize()
    else window.engram.windowZoom()
  }

  return (
    <div
      className="app-drag shrink-0 h-9 flex items-center px-3 gap-3 border-b border-[var(--color-hairline)] bg-[var(--color-surface)]"
      onDoubleClick={() => window.engram.windowZoom()}
    >
      {!fullscreen && (
        <div
          className="app-no-drag flex items-center gap-2"
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
        >
          {DOTS.map((d) => (
            <button
              key={d.key}
              aria-label={d.label}
              onClick={() => act(d.key)}
              className="focus-ring no-press h-3.5 w-3.5 rounded-full flex items-center justify-center"
              style={{ background: 'transparent', border: `1.2px solid ${d.color}` }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ opacity: hovered ? 1 : 0 }}>
                <path d={d.glyph} stroke={d.color} strokeWidth="1.3" strokeLinecap="round" fill="none" />
              </svg>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 pointer-events-none select-none">
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-ink-warm)]" />
        </span>
        <span className="font-[var(--font-serif)] text-xs text-[var(--color-text-dim)] tracking-wide">Engram</span>
      </div>
    </div>
  )
}
```

Add to index.css `@layer components`: `.app-drag { -webkit-app-region: drag; } .app-no-drag { -webkit-app-region: no-drag; }`.
- [ ] **Step 5: App.tsx** — wrap the current root `<div className="flex h-full relative">` in a column: `<div className="flex flex-col h-full"><TitleBar /><existing flex row with h-full → flex-1 min-h-0>…`. Ensure the sidebar and main still fill remaining height (change the row's `h-full` to `flex-1 min-h-0`).
- [ ] **Step 6:** typecheck + build clean.
- [ ] **Step 7:** Commit: `git commit -m "feat(ship): frameless Night Atlas shell — TitleBar, window controls, bounds memory"`.

---

### Task 6: DMG packaging block

**Files:**
- Modify: `app/package.json`

- [ ] **Step 1:** Add to the `"build"` object:

```json
    "dmg": {
      "title": "Engram Desktop",
      "window": { "width": 540, "height": 380 },
      "contents": [
        { "x": 140, "y": 190, "type": "file" },
        { "x": 400, "y": 190, "type": "link", "path": "/Applications" }
      ]
    }
```

- [ ] **Step 2:** typecheck + build clean (unchanged code; confirms JSON validity via the build tooling).
- [ ] **Step 3:** Commit: `git commit -m "chore(ship): DMG window layout"`.

---

## Final verification (after all tasks + whole-branch review)

1. `npm run typecheck && npm run build` clean.
2. Interactive pass per the spec's Verification section (session switching via Home/palette/map, recovery banner, frameless chrome behaviors, bounds persistence, DMG).
3. Packaged rebuild/reinstall (live-session check first).
