# Product Maturity — Erasing the Wrapper Tells

**Date:** 2026-07-23
**Status:** Approved (all five streams selected in brainstorming; plan approved via plan mode)

## Problem

The user's direction (a deliberate pivot away from gamification): the app should read as a developed, thought-through product rather than a Claude Code wrapper — while the learning loop's functionality stays exactly as it is. The current wrapper tells: Electron's default menu bar, chat-shaped transcript with visible machinery (Review's raw session log), generic/absent waiting copy, inconsistent hover/transition behavior across views, and async surfaces that flash blank before data.

## Streams

### EE. Real application menu

Native `Menu.setApplicationMenu` (new `src/main/appMenu.ts`): **Engram Desktop** (About panel via `app.setAboutPanelOptions`, Settings… ⌘, → nav `settings`, Hide/Quit roles), **Session** (New Topic ⌘N → new nav payload `learn:new-topic` that opens the NewTopicModal, Resume Last Learn ⌘L → nav `learn`, Review Now ⇧⌘R → nav `review`), **View** (nav items mirroring ⌘0-6, Toggle Full Screen, reload in dev only), **Window** (role), **Help** (Learn More → repo). `app.setName('Engram Desktop')` early so dev builds stop saying "Electron". App.tsx's `onNavigate` handles `learn:new-topic` by switching to Learn and opening the modal (new optional prop into LearnSessionView).

### FF. Transcript as a set document

Reading measure `.transcript-measure` (~68ch, centered) on the message column in both session views; one vertical-rhythm gap token across transcript blocks/marks/plate; Review's raw `log` `<details>` becomes a single quiet "session details" ghost affordance at the transcript foot (closed by default, same data). No message-handling changes.

### GG. Status language pass

Every waiting/system state gets intentional copy in the established fig-caption/skeleton vocabulary (tutor writing, assessor grading, map reading, stats loading, coach thinking, environment checking). ContextGauge gains a tooltip + aria-label ("session depth — how much of the model's working memory this conversation has used"). Audit: no raw error/errno/JSON strings user-visible by default (collapsed details acceptable); everything routes through friendlyErrorText or equivalent.

### HH. Micro-interaction consistency

Motion tokens in `@theme`: `--dur-fast: 120ms`, `--dur-base: 200ms`, `--ease-out-soft`. One interaction vocabulary, documented in index.css and applied by sweep: interactive rows/cards = background + warm border on hover; buttons = existing press rule + variants; icon/ghost = color shift only; no scale on non-buttons. `view-transition` uses the tokens; keep-mounted views must not re-fire entrance animations on unhide.

### II. Skeleton coverage

Every async surface shows a purpose-built skeleton matching the final layout's geometry (Home stats/forecast/cards, Learn topic list, Review ready state, Map, Dashboard sections, Artifacts — several exist; close the gaps). Skeletons only when data is absent (null), never on refresh-in-place.

## Non-goals

- No learning-loop behavior changes; no engine/bridge changes; no new reward mechanics.
- No Windows/Linux menu work.

## Verification

Per task `npm run typecheck && npm run build`. Final interactive pass: menu bar reads Engram Desktop everywhere with working items (⌘N opens the modal from any view); wide-window transcript reads as a centered page; no raw machinery visible by default; hover/transition behavior uniform; first-loads show layout-true skeletons. Packaged rebuild/reinstall (live-session check first).
