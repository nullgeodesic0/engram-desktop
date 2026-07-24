# Artifacts & Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In-app sandboxed explorable viewer, lab-notebook export (.md/.pdf), weekly digest. Spec: `../specs/2026-07-24-artifacts-records-design.md`.

**Architecture:** Viewer is a sandboxed frame fed a local artifact path; export renders through a hidden print window in main; digest is renderer-side derivation over receiptsHistory.

**Tech Stack:** existing only; no new deps.

## Global Constraints

- Explorable HTML is untrusted: sandboxed frame, no Node/preload/IPC reachable, no host navigation; "open in browser" fallback stays.
- Export only via save dialog; excludes live-only ephemeral marks; includes ticket + receipts; engram credit footer.
- Digest: only existing data (receiptsHistory, graphs, calibration picks); atlas voice, no guilt/celebration framing; empty week = one quiet line.
- Verification per task: `cd app && npm run typecheck && npm run build`.

---

### Task 1: Explorable viewer

**Files:**
- Create: `app/src/renderer/src/components/ExplorableViewer.tsx`
- Modify: `app/src/renderer/src/app/ArtifactGalleryView.tsx` (primary action opens in-app), `app/src/renderer/src/app/TopicMapView.tsx` (node drawer/modal: "open explorable" when the node has one), possibly `app/src/main/index.ts` (webPreferences/webview enablement — investigate first)

**Interfaces:**
- Consumes: `window.engram.artifactList()` (read its shape first — determine how artifacts associate to nodes: explicit field or filename convention; document which in a comment), `openArtifact` (existing external open, kept as fallback), Modal conventions.
- Produces: `<ExplorableViewer path={absPath} title nodeId? onClose />` — full-height Modal-based surface hosting the sandboxed frame.
- Sandbox decision (investigate, then implement the strictest that works): iframe `sandbox="allow-scripts"` with a `file://` src requires webSecurity considerations — check the BrowserWindow's current webPreferences; if `file://` iframes are blocked, register a read-only custom protocol (`explorable://`) in main that serves ONLY files under the artifacts directory (path-validated), and point the iframe at it. NO `allow-same-origin` together with `allow-scripts` unless the custom protocol isolates origin per document; never `webview` with nodeIntegration.

- [ ] Investigate + implement the frame mechanism; document the security reasoning in the component header.
- [ ] Gallery + map wiring; keyboard/Esc/focus per Modal.
- [ ] Verify typecheck+build; commit `feat(artifacts): sandboxed in-app explorable viewer`.

### Task 2: Lab-notebook export

**Files:**
- Create: `app/src/main/session/exportSitting.ts`, `app/src/renderer/src/shared/sittingToMarkdown.ts`
- Modify: `app/src/main/ipc/sessionHandlers.ts` (or readHandlers) + preload + shared/types (IPC `exportSitting`), `app/src/renderer/src/components/SessionHistoryDrawer.tsx` (Export button per sitting), `app/src/renderer/src/app/LearnSessionView.tsx` + `ReviewSessionView.tsx` (Export action for the open sitting), print stylesheet (new `app/src/renderer/print.css` or inline in the print HTML)

**Interfaces:**
- Consumes: the drawer's timeline building (messages + receipts already shaped), `parseTranscriptToMessages`, ticket parsing; `dialog.showSaveDialog` in main; `BrowserWindow` + `webContents.printToPDF`.
- Produces: IPC `exportSitting({ sessionId, format: 'md'|'pdf', title }) → { ok, path } | { ok:false, reason }`. Markdown assembled in the RENDERER (it owns the message shaping) and passed to main as a string; for pdf, renderer passes self-contained print HTML (inline styles + already-rendered KaTeX markup; fonts system-fallback in print), main loads it in a hidden window (`data:` URL or temp file), printToPDF → save path, temp cleaned.
- Print style: cream paper (#f5efe2-ish), warm dark ink text, reading measure, header (topic — sitting date — walk), footer credit "engram · nagisanzenin".

- [ ] Markdown assembly + IPC + save dialog; then the pdf path.
- [ ] Export buttons in the three surfaces (quiet ghost affordances).
- [ ] Verify typecheck+build; export one real past sitting both formats manually via the running dev app if feasible — otherwise document code-path reasoning; commit `feat(records): lab-notebook export of sittings (.md/.pdf)`.

### Task 3: Weekly digest

**Files:**
- Create: `app/src/renderer/src/shared/weekDigest.ts` (pure derivation, exported types), `app/src/renderer/src/components/WeekDigest.tsx`
- Modify: `app/src/renderer/src/app/DashboardView.tsx`

**Interfaces:**
- Consumes: `receiptsHistory()` days/weeks, `allPicks()` + the local-date join (reuse the DashboardView implementation), topic graphs (for threshold flags — reuse the graphs DashboardView/TopicMap already fetch or fetch per topic), `fig-caption`/StatBlock/chart conventions.
- Produces: `computeWeekDigest(input) → { reviews: {thisWeek, lastWeek}, recallRate: {thisWeek, lastWeek} | null, consolidated: {count, thresholds: string[]}, calibrationDrift: {...} | null, hardestNodes: {node, grades}[] }` — weeks are Monday-start LOCAL dates (match receiptsHistory's weekStart convention — verify).
- Copy: two-three sentences max, e.g. "Fig. — 14 recalls at 78%, up from 71%. Two thresholds crossed. Confidence ran hot on 3 of 9." Empty week: "Fig. — a quiet week; earliest return <date>."

- [ ] Pure function + component + Dashboard placement (above or beside the existing Retention section — match its rhythm).
- [ ] Verify typecheck+build; hand-check this week's numbers against receiptsHistory in the report; commit `feat(coach): weekly digest`.
