# App-Wide Polish — "Night Atlas" Design Language + Session Continuity

**Date:** 2026-07-22
**Status:** Approved (design sections approved individually in brainstorming; plan approved via plan mode)

## Problem

Three pain points, confirmed with the user:

1. **The app "forgets" state on navigation.** `App.tsx` conditionally renders views, so switching from Learn to another tab and back unmounts `LearnSessionView` and destroys all session UI state (transcript scroll, composer draft, beat/node banner) — even though the underlying claude session keeps running in the main process. The user expects leaving the Learn tab to be non-destructive, with an explicit button as the only way back to the topic list.
2. **Flat visual identity.** The app works but doesn't read as a designed product.
3. **Inconsistent components.** Buttons, cards, and modals are styled ad-hoc per view.

## Visual direction (user-selected from mockups)

**"Night Atlas":** the existing dark "deep consolidation" base fused with Cajal-atlas hand-drawn rendering — Santiago Ramón y Cajal's ink neuron drawings as the reference language, inverted onto the night background.

- Keep the three-signal color semantics: cool `#5b8fa8` = still-encoding, warm amber `#e8a857` = consolidated, violet `#a78bda` = synthesis (+ `-dim` variants, danger red).
- Warm the void slightly (sepia-tinted near-black) and replace the cold near-white text with a warm ink off-white (`#e6ddcc`-family) — Cajal's sepia ink, inverted.
- Serif display face (Fraunces or Source Serif 4, self-hosted) for display headings and italic "figure caption" moments; Space Grotesk stays for UI chrome; mono stays for data.
- Hand-drawn motif primitives used app-wide: irregular ink-drawn node glyphs, branching dendrite dividers, "Fig. N —" caption styling.

## Hard constraint: the learning loop is sacred

Nothing in this project may soften the loop's demands. Free recall stays composer-first with no answer-peeking affordances. Grades stay honest (no gamified softening of "lapsed"). The beat stepper and confidence picker keep their exact interaction semantics. Polish improves the *legibility* of the loop, never dilutes it.

## Design

### Phase A: Design foundation

**Tokens** (`index.css` `@theme`): warmer void surface ramp; warm ink text neutral; a real type scale (display / heading / body / caption / data); existing semantic colors preserved.

**Ink motif primitives** (new, SVG-based, in `components/ui/`):

- `InkNode` — irregular, slightly asymmetric cell-body glyph. Variants: filled (consolidated), outlined (new), dashed outline (threshold). Irregularity is deterministic per id (seeded hash, same approach as `seeded()` in `graph3d/layout.ts`) so a given node always draws the same shape. Consumers: topic cards, legends, search results, command palette.
- `DendriteDivider` — branching hairline SVG replacing straight rules on section headers and empty states.
- `.fig-caption` — italic serif "Fig. N —" caption class for stats and empty states.

**Unified components** (`components/ui/`): `Button` (primary/ghost/danger), `Card`, `Modal` (one shell with `useFocusTrap`, adopted by AskDialog, TopicSettingsModal, NewTopicModal, SessionHistoryModal), `SegmentedControl` (Settings toggle rows, label-mode pickers), `StatBlock`.

### Phase B: Session continuity

- **Keep stateful views mounted.** Learn, Review, and Coach mount on first visit and stay mounted, hidden via CSS instead of unmounted. Home, Topic Map, Artifacts, Settings keep unmount-on-switch (cheap to rebuild; the Map's WebGL scene must not run hidden).
- **Visibility discipline.** Hidden-but-mounted views pause animations/timers via a `visible` prop (the NeuralField pattern).
- **Explicit exit.** The Learn session header's `← Topics` becomes a clearly-labeled "All topics" button — the only way to leave a session's UI state. Review's explicit end stays as-is.
- **Sidebar live-session indicator.** A small pulsing ink-dot on a rail item whose hidden view has an active session; the dot also reflects busy (model responding) state. Clicking Learn with an active session returns to the session, not the topic list.

### Phase C: Application pass (priority order)

1. **HomeView** — the notebook's "morning page": figure-caption stats, InkNode topic cards, dendrite dividers. Arrangement unchanged; restyle only.
2. **Learn/Review chat surfaces** — layout untouched (fresh from Chat Loop Polish); migrate to shared Modal/Button/Card, add the "All topics" exit.
3. **Sidebar + CommandPalette** — restyled rail with live dots; the palette gets flagship treatment (ink glyphs for node results, serif headers).
4. **Dashboard/Coach, Settings, Artifacts** — token/component migration, figure-caption stat styling; structurally unchanged.

The topic-map rework (Cajal rendering inside the WebGL graph + usefulness features) is a separate follow-up project that inherits this foundation.

## Non-goals

- No changes to session-driving logic, engram.py, IPC surface, or the MCP bridge.
- No light mode.
- No new navigation structure (the rail stays; it is restyled, not rethought).

## Verification

- Per task: `npm run typecheck && npm run build` clean in `EngramDesktop/app` (no test framework in this project).
- Final interactive pass: visit every view; start a Learn session, switch to Map and back — session, scroll position, and composer draft intact; sidebar dot pulses while a hidden session is busy; all four modals render via the shared shell; confidence picker and beat stepper behave identically to before.
- Packaged rebuild/reinstall via the standard sequence, checking for live learning sessions first.
