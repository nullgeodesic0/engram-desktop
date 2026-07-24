# Product Maturity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erase the Claude-Code-wrapper tells per `docs/superpowers/specs/2026-07-23-product-maturity-design.md`: native app menu, document-grade transcript, intentional status language, one interaction vocabulary, full skeleton coverage. Learning-loop behavior unchanged.

**Architecture:** Five independent streams, one task each. Tasks 2-5 are survey-first sweeps: the implementer inventories their stream's surface before editing, and their report lists the inventory (the reviewer checks coverage against it).

**Tech Stack:** Electron Menu API (main), React 19 + Tailwind v4 tokens (renderer).

## Global Constraints

- Learning-loop functionality untouched: no changes to message handling, grading, session lifecycle, bridge dispatch, or philosophy-bound copy (grade words, absolve-never-pity).
- Verification per task: `npm run typecheck && npm run build` clean in `app`. `noUnusedLocals: true`. No interactive verification during implementation.
- Night Atlas vocabulary only (tokens, fig-caption, skeleton class); no new colors.
- Commit per task with the given message, on `master`.

---

### Task 1: Native application menu

**Files:**
- Create: `app/src/main/appMenu.ts`
- Modify: `app/src/main/index.ts`
- Modify: `app/src/renderer/src/App.tsx`
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx` (small: openNewTopic prop)

- [ ] **Step 1:** `appMenu.ts` — export `installAppMenu(sendNav: (view: string) => void)`:

```ts
import { app, Menu, shell } from 'electron'

/** The native menu bar — the single loudest "this is a real app" signal on
 * macOS. Actions route through the same sendNav deep-link channel the tray
 * and notifications already use. */
export function installAppMenu(sendNav: (view: string) => void): void {
  const isDev = !app.isPackaged
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => sendNav('settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Session',
      submenu: [
        { label: 'New Topic', accelerator: 'Cmd+N', click: () => sendNav('learn:new-topic') },
        { label: 'Resume Last Learn', accelerator: 'Cmd+L', click: () => sendNav('learn') },
        { label: 'Review Now', accelerator: 'Shift+Cmd+R', click: () => sendNav('review') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Home', accelerator: 'Cmd+0', click: () => sendNav('home') },
        { label: 'Learn', accelerator: 'Cmd+1', click: () => sendNav('learn') },
        { label: 'Review', accelerator: 'Cmd+2', click: () => sendNav('review') },
        { label: 'Topic Map', accelerator: 'Cmd+3', click: () => sendNav('topics') },
        { label: 'Coach', accelerator: 'Cmd+4', click: () => sendNav('dashboard') },
        { label: 'Artifacts', accelerator: 'Cmd+5', click: () => sendNav('artifacts') },
        { type: 'separator' },
        ...(isDev ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as Electron.MenuItemConstructorOptions[]) : []),
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: () => void shell.openExternal('https://github.com/anthropics/claude-code'),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
```

(Replace the Learn More URL with the project's real home if one exists in package.json `homepage`/`repository` — check; otherwise omit the Help menu entirely rather than link somewhere wrong. Note the choice in the report.)
- [ ] **Step 2:** `index.ts` — before `app.whenReady()`: `app.setName('Engram Desktop')`; `app.setAboutPanelOptions({ applicationName: 'Engram Desktop', applicationVersion: app.getVersion(), credits: 'First-principles learning, verified by free recall.' })`. Inside whenReady setup (where other one-time wiring happens): `installAppMenu(sendNav)` — check `sendNav`'s real signature/location; it targets the current window (module-level ref) so passing it is safe. IMPORTANT: `sendNav` must work when no window exists (menu clicked with window closed) — check how `focusOrCreateWindow(navigateTo)` handles that and prefer routing menu clicks through `focusOrCreateWindow` instead of raw `sendNav` so the window is recreated first.
- [ ] **Step 3:** App.tsx `onNavigate` handler: accept `'learn:new-topic'` → `setView('learn')` + set a new state `newTopicRequest` (number, incremented) passed to LearnSessionView as `openNewTopicSignal?: number`; LearnSessionView effect on that prop opens `setNewTopicOpen(true)` when it changes (skip initial). Keep the existing plain view strings working unchanged.
- [ ] **Step 4:** typecheck + build clean.
- [ ] **Step 5:** Commit: `feat(maturity): native application menu, About panel, ⌘N new topic`

---

### Task 2: Transcript as a set document

**Files:**
- Modify: `app/src/renderer/src/index.css` (`.transcript-measure`)
- Modify: `app/src/renderer/src/app/LearnSessionView.tsx`
- Modify: `app/src/renderer/src/app/ReviewSessionView.tsx`

- [ ] **Step 1:** index.css components layer:

```css
  /* The transcript reads as a set page, not a chat log — one reading measure,
     centered when the window is wide. */
  .transcript-measure {
    max-width: 68ch;
    width: 100%;
    margin-inline: auto;
  }
```

- [ ] **Step 2:** Both views: wrap the transcript content INSIDE ChatScrollRegion (the children — plate, marks, messages, indicators) in a `<div className="transcript-measure flex flex-col gap-5">` (one wrapper; ChatScrollRegion's own scroll/stick logic untouched). Survey the current gaps between blocks (ChatMessageView roots, MarkView margins, SessionOpenPlate margins) and normalize onto the wrapper's gap — remove per-block `my-*` where the wrapper's gap-5 now provides the rhythm (BeatMarkCard/NodeCrossingDivider keep their own smaller margins only if visually needed; note decisions in the report).
- [ ] **Step 3:** Review's raw session log: find the `<details>` rendering `log` lines; replace with a ghost "session details" affordance at the transcript foot — a small `fig-caption`-styled `<details><summary>session details</summary>` containing the same log list, `label-data text-[10px]`, closed by default. Nothing else surfaces raw log lines.
- [ ] **Step 4:** typecheck + build clean. Commit: `feat(maturity): transcript reading measure, unified rhythm, quiet session details`

---

### Task 3: Status language pass

**Files (survey-first — expect):**
- `app/src/renderer/src/components/TypingIndicator.tsx`, `ContextGauge.tsx`, `CoachSessionPanel.tsx`, `EnvironmentGate.tsx`
- `app/src/renderer/src/app/TopicMapView.tsx`, `HomeView.tsx`, `DashboardView.tsx`, `LearnSessionView.tsx`, `ReviewSessionView.tsx`

- [ ] **Step 1:** Inventory every user-visible waiting/loading/system state across those files (list them in the report with before/after copy). Apply intentional copy in the fig-caption vocabulary, e.g.: TypingIndicator gains an optional `label` prop (default "the tutor is writing…") rendered beside the animation; map graph loading gets "reading the topic map…" over its skeleton; Home stats skeleton gets no copy (skeletons speak); Coach busy state gets "the coach is thinking…"; EnvironmentGate copy reviewed for tone (fix only awkward phrasing, keep meaning).
- [ ] **Step 2:** ContextGauge: `title="session depth — how much of the model's working memory this conversation has used"` + `role="img"` + `aria-label` same text. Visual unchanged.
- [ ] **Step 3:** Raw-string audit: grep for renders of error/exception/JSON values that bypass `friendlyErrorText` or a `<details>` collapse (`{error}`, `{String(`, `.message}` in JSX). Fix any found; list them in the report (expected: few or none after the Ship Polish round).
- [ ] **Step 4:** typecheck + build clean. Commit: `feat(maturity): intentional status language everywhere; gauge explains itself`

---

### Task 4: Micro-interaction consistency

**Files:**
- Modify: `app/src/renderer/src/index.css` (tokens + vocabulary comment)
- Sweep: renderer components/views (survey-first)

- [ ] **Step 1:** `@theme` additions: `--dur-fast: 120ms; --dur-base: 200ms; --ease-out-soft: cubic-bezier(0.25, 0.8, 0.35, 1);`. Atop the components layer, add a comment block documenting the interaction vocabulary (rows/cards: bg + warm border hover @ dur-base; buttons: global press + variant colors @ dur-fast; icon/ghost: color only @ dur-fast; no scale on non-buttons; focus: the existing focus-ring).
- [ ] **Step 2:** Sweep: grep the renderer for `duration-\d+`, `transition-all`, inline `transition:` styles — migrate durations onto the two tokens (Tailwind arbitrary values `duration-[var(--dur-base)]` or CSS rules). Normalize outliers to the vocabulary (e.g. anything scaling on hover that isn't a button loses the scale; rows missing hover states gain the standard one). List every changed site in the report.
- [ ] **Step 3:** `view-transition` keyframe timing uses `--dur-base`; verify keep-mounted views (Learn/Review/Coach wrappers in App.tsx) do NOT re-run the entrance animation on unhide (the `view-transition` class must only be on the conditional-mount wrappers, not the hidden-toggling ones — check and fix if wrong).
- [ ] **Step 4:** typecheck + build clean. Commit: `feat(maturity): motion tokens and one interaction vocabulary`

---

### Task 5: Skeleton coverage

**Files (survey-first):** all views under `app/src/renderer/src/app/` + `components/Skeleton.tsx`.

- [ ] **Step 1:** Inventory every async surface's pre-data render (report the list): Home (stats header, forecast, flashback, topic grid), Learn topic list, Review loading/ready, TopicMapView, DashboardView sections, ArtifactGalleryView. For each gap, add a skeleton matching the final layout geometry (same grid/heights — SkeletonBar + `.skeleton` class; compose small local skeleton blocks per view rather than one generic).
- [ ] **Step 2:** Verify the rule: skeleton only when the state is null/absent; refresh-in-place must not flash a skeleton (check e.g. Learn's refreshTopics — topics stay populated during refresh; keep it that way).
- [ ] **Step 3:** typecheck + build clean. Commit: `feat(maturity): layout-true skeletons on every async surface`

---

## Final verification (after all tasks + whole-branch review)

1. `npm run typecheck && npm run build` clean.
2. Interactive pass per the spec's Verification section.
3. Packaged rebuild/reinstall (live-session check first).
