# Design language: Night Atlas

Engram Desktop's visual system is named after Santiago Ramón y Cajal's ink
neuron atlases — sepia ink on paper, redrawn here as sepia-warm ink on a
near-black void. The palette, type roles, motion tokens, and interaction
rules below are declared once, in `app/src/renderer/src/index.css`'s
`@theme` block and the interaction-vocabulary comment above `@layer
components`, and used everywhere else in the renderer. This page describes
that system; it does not repeat the beat-glyph table in
[learning-loop.md](learning-loop.md), which documents the `Marks.tsx`
glyphs as part of the beat grammar rather than as visual design.

## Palette

All values below are copied verbatim from the `@theme` block in
`index.css`.

| Token | Hex | Role |
|---|---|---|
| `--color-void` | `#0d0e12` | Page background — the "night" the ink sits on. |
| `--color-surface` | `#14151c` | Base panel background (`.panel`). |
| `--color-surface-2` | `#1c1e28` | Raised panel background (`.panel-raised`), skeleton shimmer. |
| `--color-surface-3` | `#262937` | Third-tier surface — scrollbar thumb, code blocks, skeleton shimmer highlight. |
| `--color-hairline` | `#262a36` | Borders, dividers, dendrite-divider stroke. |
| `--color-ink-cool` | `#5b8fa8` | "Not yet consolidated" node state; markdown link color. |
| `--color-ink-cool-dim` | `#3a5a6b` | Dimmed variant of the cool signal. |
| `--color-ink-warm` | `#e8a857` | "Surviving signal" — the oscilloscope-phosphor amber for consolidated state, focus ring, text selection. |
| `--color-ink-warm-dim` | `#8a6533` | Dimmed warm — selection background, blockquote rule. |
| `--color-ink-hot` | `#f0c24b` | Hottest point on the warm ramp (e.g. the `connect` beat accent). |
| `--color-ink-danger` | `#c4685a` | Struggle/missed-state signal. |
| `--color-ink-danger-dim` | `#6b3d36` | Dimmed danger. |
| `--color-ink-violet` | `#a78bda` | Third signal — synthesis/creation (explorables, coach insight); deliberately between cool and warm rather than opposed to them. |
| `--color-ink-violet-dim` | `#6b5490` | Dimmed violet. |
| `--color-ink-paper` | `#e6dfd0` | Warm "paper ink" — the base of the text ramp. |
| `--color-text-primary` | `#e6dfd0` | Primary text color (same value as `--color-ink-paper`). |
| `--color-text-dim` | `#8b8878` | Secondary/caption text. |
| `--color-text-faint` | `#545248` | Least prominent text, dendrite-divider node dot. |

The cool/warm duality is the palette's organizing idea: cool ink marks a
memory that hasn't consolidated yet, warm ink marks one that has survived.
Violet sits apart from that axis for synthesis-type content that isn't
either state. Danger is reserved for missed or struggling signals, not used
as a generic error color elsewhere.

## Type roles

Four font tokens are declared in `@theme`:

| Token | Stack | Role |
|---|---|---|
| `--font-serif` | `'Fraunces', Georgia, serif` | The tutor's voice and display: assistant prose (`.voice-serif`), the "Fig. N —" atlas captions (`.fig-caption`), and serif display headings (`.font-serif-display`). |
| `--font-display` | `'Space Grotesk', ui-sans-serif, system-ui, sans-serif` | Chrome: headings inside serif-voice blocks and markdown preview (`h1`–`h3`), UI structure generally. |
| `--font-body` | `'Inter', ui-sans-serif, system-ui, sans-serif` | Default body font, set on `<body>`. |
| `--font-data` | `ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace` | Data: the `.label-data` utility and inline code / code blocks in markdown preview. |

A companion type scale (`--text-display` through `--text-data`) gives five
sizes — `1.75rem`, `1.25rem`, `0.875rem`, `0.75rem`, `0.8125rem` — for
headings and captions; ordinary body copy can still use Tailwind's
utilities directly.

## The ink motif

Two small components carry the Cajal-atlas motif into the UI:

- **`InkNode.tsx`** draws a hand-drawn neuron cell-body glyph: an 8-point
  closed blob whose vertex wobble comes from a `seeded(id, salt)` hash
  (the same trick used for graph layout elsewhere in the app) so the same
  node id always redraws the identical lumpy outline rather than a fresh
  random shape each render. The glyph's three variants map to node state —
  filled for consolidated, outlined for new, dashed for threshold — with
  color passed in as a prop (typically one of the ink tokens above).
- **`DendriteDivider.tsx`** replaces plain horizontal rules under section
  headers with a small branching hairline: one axon line with two short
  dendrite branches and a node dot, drawn at a fixed size and stroked in
  `--color-hairline` / `--color-text-faint`, with a flexible `h-px flex-1`
  div stretching the rest of the divider to the container width so the
  branch geometry itself never distorts.

Beat glyphs (`Marks.tsx`'s `BEAT_GLYPHS`) extend the same hand-drawn-stroke
idea to inline transcript markers; see the beat-glyph table in
[learning-loop.md](learning-loop.md) for that mapping rather than
duplicating it here.

## Motion

Two duration tokens cover every micro-interaction in the app:

- `--dur-fast` — `120ms`, used for buttons and icon/ghost-button color
  transitions.
- `--dur-base` — `200ms`, used for panel border/shadow transitions, row and
  card hover, and view-transition fades.
- `--ease-out-soft` — `cubic-bezier(0.25, 0.8, 0.35, 1)`, the shared easing
  for `--dur-base` transitions.

### Interaction vocabulary

The interaction-vocabulary comment above `@layer components` in `index.css`
states the rules these tokens serve, and they hold across the renderer:

- **Rows and cards** (interactive `.panel` surfaces, list rows): hover is a
  background-color and warm-dim border shift, timed at `--dur-base`
  (200ms).
- **Buttons**: the app-wide press transform (`button:active` scales to
  `0.97`) plus each variant's own color transitions, timed at `--dur-fast`
  (120ms) via the global `button { transition: ... }` rule.
- **Icon/ghost buttons**: a color shift only — no background or border
  choreography beyond the button rule already gives them — timed at
  `--dur-fast`.
- **Scale is button-only.** Nothing that isn't a real `<button>` scales on
  hover or press, so scale never competes with the border/background cues
  used on rows and cards.
- **Focus** is always the shared `.focus-ring` utility (a `--color-ink-warm`
  outline on `:focus-visible`), never a bespoke hover-only or
  transition-based focus treatment.
