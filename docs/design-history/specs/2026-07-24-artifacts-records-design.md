# Artifacts & Records — Explorable Viewer, Lab-Notebook Export, Weekly Digest

**Date:** 2026-07-24
**Status:** Approved design (Project D of the records round)

## Goal

Bring the loop's artifacts and history into first-class surfaces: interactive explorables render inside the app, any sitting exports as a typeset record, and the dashboard narrates the week honestly.

## Constraints (binding)

- Explorable HTML is untrusted content: rendered only in a sandboxed frame — no Node integration, no preload, no IPC reachable from it, and it cannot navigate the host window. "Open in browser" remains available.
- Export is explicitly user-triggered (save dialog); nothing writes without a chosen destination.
- Digest numbers come only from data the app already reads (receiptsHistory, topic graphs, calibration picks) — no new engram surface, no vanity framing (no streak-guilt, no celebration inflation).
- No new npm dependencies. Verification per task: `npm run typecheck && npm run build`.

## Components

### 1. In-app explorable viewer

- `ExplorableViewer` renders an artifact's local HTML file in a sandboxed `<webview>`/`<iframe>` (sandbox: scripts allowed, same-origin/top-navigation/forms denied; implementation picks the strictest Electron mechanism that still runs the explorable's own scripts).
- Opened from: the artifacts gallery (replacing the current external-open as the primary action) and a node's drawer/modal when that node has an explorable (artifact list already carries node association — verify shape; if absent, match by node id in the artifact filename/metadata, and say so in the doc comment).
- Chrome: title, node link, "open in browser" fallback, Esc/close via Modal or a dedicated full-height pane — whichever reads better at typical explorable sizes; keyboard and focus behavior per Modal conventions.

### 2. Lab-notebook export

- From the history drawer and a live session's menu: "Export sitting…" → save dialog → writes either Markdown (`.md`, transcript + ticket + receipts as fenced/quoted blocks) or PDF.
- PDF path: hidden BrowserWindow loads a print document (transcript rendered with the app's fonts, reading measure, KaTeX already-rendered HTML; print stylesheet: light paper background — the Night Atlas inverted onto paper, warm ink on cream) → `printToPDF` → chosen path.
- Content fidelity: same message shaping as the history drawer (shared helper); ephemeral live-only marks excluded, tickets/receipts included; header carries topic, walk/date, engram citation footer.

### 3. Weekly digest (`DashboardView.tsx` section)

- "This week" vs prior week, derived on the renderer from existing data: reviews completed and recall rate delta; nodes newly consolidated (threshold ones called out); calibration drift (overconfident/underconfident share this week vs last); the week's hardest nodes (most `again`/`hard` grades).
- Rendered as a compact figure row + two or three fig-caption sentences in the atlas voice. Weeks with no activity render one quiet line, not an empty dashboard hole.

## Out of scope

Sharing/publishing flows; digest notifications; export of whole topics as books (single sittings only this round); rewriting artifact HTML.

## Verification

- An explorable from grad-quantum-mechanics runs interactively in-app; its frame cannot navigate the host (attempted `window.top` access inert) — reasoning documented.
- A past sitting exports to both .md and .pdf; the PDF is legible, math typeset, receipts present.
- Digest numbers hand-checked against receiptsHistory for the current week in the task report.
