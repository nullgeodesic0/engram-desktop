---
name: Engram Desktop
description: A study instrument drawn as Cajal's sepia neuron atlas, inverted onto the night.
colors:
  void: "#0d0e12"
  surface: "#14151c"
  surface-2: "#1c1e28"
  surface-3: "#262937"
  hairline: "#262a36"
  ink-cool: "#5b8fa8"
  ink-cool-dim: "#3a5a6b"
  ink-warm: "#e8a857"
  ink-warm-dim: "#8a6533"
  ink-hot: "#f0c24b"
  ink-danger: "#c4685a"
  ink-danger-dim: "#6b3d36"
  ink-violet: "#a78bda"
  ink-violet-dim: "#6b5490"
  ink-lavender: "#a99ef0"
  ink-lavender-dim: "#7d73b8"
  ink-paper: "#e6dfd0"
  text-primary: "#e6dfd0"
  text-dim: "#8b8878"
  text-faint: "#545248"
  nocturne-hi: "#121020"
  nocturne-lo: "#0c0b16"
  accent-cta: "#e8a857"
typography:
  display:
    fontFamily: "'Neue Haas Grotesk Display Pro', 'Neue Haas Grotesk Text Pro', 'Space Grotesk', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'Neue Haas Grotesk Display Pro', 'Space Grotesk', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "normal"
  body:
    fontFamily: "'Futura', 'Futura PT', 'Inter', ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  caption:
    fontFamily: "'EpocaPro', 'Epoca Pro', 'Fraunces', Georgia, serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.01em"
  label:
    fontFamily: "'Futura', 'Futura PT', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  none: "0px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "12px"
  xl: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent-cta}"
    textColor: "{colors.void}"
    rounded: "{rounded.none}"
    padding: "6px 14px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hot}"
    textColor: "{colors.void}"
  control-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "4px 10px"
  control-quiet-hover:
    textColor: "{colors.text-primary}"
  control-filled-warm:
    backgroundColor: "{colors.ink-warm-dim}"
    textColor: "{colors.ink-warm}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "4px 10px"
  control-filled-cool:
    backgroundColor: "{colors.ink-cool-dim}"
    textColor: "{colors.ink-cool}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "4px 10px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    padding: "12px"
  panel-raised:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    padding: "12px"
  panel-plate:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    padding: "12px"
  chip:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "2px 6px"
---

# Design System: Engram Desktop

## Overview

**Creative North Star: "Night Atlas"**

Santiago Ramón y Cajal drew the nervous system in sepia ink on paper — patient, hand-inked figures with numbered captions, made by someone looking down a microscope for a very long time. This system is that atlas inverted onto the night. The void is near-black but warmed slightly toward sepia; the text is warm paper-ink rather than cold white; the accents are the colors ink takes when it is the only bright thing in a dark room. Every card is a specimen plate, every divider is a dendrite, every figure caption reads "Fig. N —".

The metaphor is not decoration. This app is a window onto a spaced-repetition engine and it exists to make a learner sit down for half an hour and retrieve difficult material from memory. An atlas is exactly the right register for that: it is a record made carefully, over time, of something the maker was trying to understand. So the interface behaves like an instrument panel rather than a product tour. It states what it measured, it does not congratulate, and it holds a dense transcript legibly for the length of a real sitting. Density is a feature — this is a surface people read, not glance at.

The system's own tension is that it is simultaneously very dark, very sharp, and very physical. Right angles everywhere, hairline borders, translucent glass over an ambient field, and a card-scale 3D tilt just barely above the threshold of perception. Nothing here is soft. But nothing here shouts either: the whole palette lives in a narrow band of luminance and the loudest thing on screen is usually one amber word.

**Key Characteristics:**
- Warm-black ground (`#0d0e12`), warm paper text (`#e6dfd0`) — never a cold gray/white pairing.
- Zero radius everywhere by decree; `rounded-full` is the single reserved exception for organic marks.
- Semantic ink: color encodes memory state, not visual hierarchy.
- Translucent glass panels (62–82% fill, 12px blur) over an ambient field.
- Near-subliminal card physics — a slow idle drift and a damped pointer-follow tilt.
- Two motion durations for the entire app: 120ms and 200ms.

## Colors

A narrow-band palette of ink colors on a warmed near-black, where hue carries meaning about a memory rather than about a UI hierarchy.

### Primary
- **Surviving Amber** (`#e8a857`, `--color-ink-warm`): the oscilloscope-phosphor warm that marks a memory that has *survived* — consolidated node state, the focus ring, text selection, the active dogear, the frame-hover accent. This is the app's one loud color and it is used sparingly.
- **Hot Filament** (`#f0c24b`, `--color-ink-hot`): the top of the warm ramp. Reserved for the hottest single point — the `connect` beat accent, the primary-button hover.
- **Warm Ink Shadow** (`#8a6533`, `--color-ink-warm-dim`): selection background, blockquote rule, filled-control border, the inset hairline that makes `.panel-plate` an engraved specimen label.

### Secondary
- **Unconsolidated Cool** (`#5b8fa8`, `--color-ink-cool`): the other half of the consolidation axis — a memory that has *not yet* consolidated. Also the markdown link color, and the environment accent for Review (retrieval under test).
- **Cool Shadow** (`#3a5a6b`, `--color-ink-cool-dim`): dimmed cool, filled-control border in Review chrome.

### Tertiary
- **Synthesis Violet** (`#a78bda`, `--color-ink-violet`): deliberately *between* cool and warm rather than opposed to them, because what it marks isn't a memory state at all — it is synthesis and creation: explorables, threshold concepts, coach insight.
- **Violet Shadow** (`#6b5490`, `--color-ink-violet-dim`).
- **Lapse Rust** (`#c4685a`, `--color-ink-danger`) and **Rust Shadow** (`#6b3d36`): struggle and missed signals. Not a general-purpose error color.
- **Nocturne Lavender** (`#a99ef0` / `#7d73b8`): the sidebar's own nocturne register, sitting on `--color-nocturne-hi` `#121020` / `--color-nocturne-lo` `#0c0b16`.

### Neutral
- **Warmed Void** (`#0d0e12`): the page ground. Warm-shifted off pure black on purpose — it is the night the ink sits on, not a black rectangle.
- **Surface / Surface-2 / Surface-3** (`#14151c` / `#1c1e28` / `#262937`): the three tonal tiers. Base panel, raised panel, and third-tier (scrollbar thumb, code blocks, the `frame-hover` wash).
- **Hairline** (`#262a36`): every border and divider. `--color-edge` mixes it 50% with `--color-text-faint` for the slightly more present card frame.
- **Paper Ink** (`#e6dfd0`): primary text — the warm base of the text ramp.
- **Sepia Dim** (`#8b8878`) and **Sepia Faint** (`#545248`): secondary/caption text, and the least prominent marks (the dendrite-divider node dot).

### Named Rules

**The Consolidation Axis Rule.** Cool and warm are not "accent 1" and "accent 2." Cool means *not yet consolidated*; warm means *survived*. A warm accent on something that has not consolidated is a defect, not a style choice. Nothing may be recolored along this axis for visual balance.

**The Reserved Danger Rule.** Danger ink marks a learner's struggle or a lapsed memory. It is never the color of a validation error, a failed network call, a destructive-action button, or a generic alert. Those need their own treatment — usually text, not hue.

**The Off-Axis Violet Rule.** Violet marks synthesis and creation. It must never become a third station on the consolidation ramp, and it must never be used simply because a surface needs a third color.

**The Two Themes, One Semantics Rule.** The light theme ("Atlas by Daylight", `:root[data-theme='light']`, void `#f4efe4` with `#2b2016` text) re-tunes every token but keeps every meaning. It makes exactly one deliberate split: pure-chrome emphasis — the focus ring, `frame-hover`/`frame-selected`, the dogear, the primary button — routes through `--color-accent-cta` (a grayish blue, `#3d5266`) instead of amber, because on a pale ground amber is emphasis-by-warmth rather than emphasis-by-contrast. Semantic inks (grade colors, threshold violet, danger) never route through that token in either theme.

## Typography

**Display Font:** Neue Haas Grotesk Display Pro (fallback: Space Grotesk)
**Body Font:** Futura (fallback: Inter)
**Caption / Flavor Font:** Epoca Pro Medium Italic (fallback: Fraunces, Georgia)
**Data Font:** Futura, tabular figures (fallback: SF Mono, Menlo)

**Character:** A grotesque for anything that carries weight — titles, grades, numbers — set against Futura's geometric calm for everything else, with an italic serif reserved entirely for flavor. The pairing is deliberately unsentimental: Neue Haas is what a measurement should look like, Futura is what a label should look like, and the Epoca italic is the only place the system is allowed to have a voice.

The licensed faces **are the design.** They live on the author's machine and are git-ignored, so shipped builds fall back to Space Grotesk / Inter / Fraunces. That fallback stack is an honest degradation path, not a second legitimate look — it exists so a machine without the commercial fonts lands on the app's own earlier appearance rather than on browser defaults. Futura ships with macOS, so the body/label bucket always activates. Design to the licensed mapping; verify nothing *breaks* in fallback.

### Hierarchy
- **Display** (`--text-display`, 1.75rem, Neue Haas, semibold): page-level titles and the largest single numbers.
- **Headline** (`--text-heading`, 1.25rem, Neue Haas): section headings, topic titles, grade letters.
- **Body** (`--text-body`, 0.875rem, Futura, 1.6 line-height): all prose, including the transcript.
- **Caption** (`--text-caption`, 0.75rem, Epoca Pro Medium Italic, `--color-text-dim`): the `.fig-caption` utility — the "Fig. N —" atlas caption, used for stats, empty states, and any line that comments on the interface rather than being it.
- **Label** (`--text-data`, 0.8125rem, Futura with `font-variant-numeric: tabular-nums`, `letter-spacing: 0.02em`): the `.label-data` utility. All chrome controls, chips, and figures. In control chrome it drops to 10px uppercase with `0.16em` tracking.

### Named Rules

**The Tabular Rule.** Every number that can change in place uses `.label-data`. Tabular figures mean a counter or a timer never makes the layout twitch.

**The Caption-Is-Commentary Rule.** Italic serif is not for emphasis inside prose. It marks text that is *about* the interface — a measurement's basis, an empty state, a figure label. If it could be a sentence the tutor said, it is body, not caption.

**The Math-Renders-Everywhere Rule.** Learner content is graduate-level and routinely contains LaTeX. Any slot that can hold learner or tutor text — including titles, chips, labels and captions, not just prose bodies — passes through the math renderer. A raw `$` on screen is a bug.

## Layout

The shell is a frameless macOS window: a left navigation rail in its own nocturne register, a command strip, and a single content column. Content is centered with a bounded measure — the transcript in particular is capped so a line of graduate prose stays readable rather than spanning a wide display, and transcript cards cap at `92%` of their column so the reader always sees which side a message came from.

Spacing is Tailwind's default scale used at the tight end: `gap-1`/`gap-1.5` inside cards, `gap-2`/`gap-3` between them, `px-3 py-2.5` as the standard card padding, `px-2.5 py-1` for chrome controls. The rhythm is dense on purpose. This is a reading surface for long sittings, and generous whitespace here would mean less of the transcript on screen and more scrolling during work that requires holding context.

Responsiveness is a desktop concern rather than a mobile one — this is a macOS-only Electron app today. Surfaces adapt by dropping optional chrome (`hidden sm:inline` on hint text, wrapping control rows with `flex-wrap`) rather than by reflowing into a different layout. Platform-specific chrome — the frameless shell, traffic-light insets, menu idioms — stays contained so a future Windows/Linux port is a port and not a redesign.

## Elevation & Depth

Hybrid, and unusually literal about it. Depth comes from four stacked mechanisms, all four of which are signature:

1. **Tonal layering** — three surface tiers (`surface` / `surface-2` / `surface-3`) establish rank before any shadow does.
2. **Glass** — panels are translucent (`color-mix` at 62% for `.panel`, 68% for `.panel-raised`) over `backdrop-filter: blur(12px)`, so the app's ambient field reads through every card as weather behind text. Inside the transcript (`.chat-glass`) the fill steps up to 76/82% so long-form reading sits on steadier ground. The light theme raises every alpha (78/84/82/90/93%) because a pale field behind the blur gives a card less to differentiate against.
3. **Shadow** — a single two-part recipe: a hairline top catch-light plus a soft, high-offset drop. Direction is theme-aware: a near-black bruise on the dark ground, a low-alpha warm-ink lift on the pale one.
4. **Card physics** — card-scale surfaces sit in shallow 3D through `perspective(1200px)`, with two motions that are both meant to sit just under conscious notice: a slow idle drift (≤0.9°, half-minute periods, per-card phase so the surface breathes rather than marches) and a damped pointer-follow tilt (≤3.2° at the edges) where the corner under the cursor dips *away*, as if pressed.

### Shadow Vocabulary
- **Panel rest** (`inset 0 1px 0 rgba(228,231,237,0.04), 0 8px 20px -12px rgba(0,0,0,0.5)`): every `.panel`. The inset is a catch-light on the top edge, not a border.
- **Raised** (`inset 0 1px 0 rgba(228,231,237,0.05)`, same drop): `.panel-raised`.
- **Plate** (`inset 0 0 0 1px var(--color-ink-warm-dim)` plus the rest recipe): `.panel-plate` — a full-frame inset hairline instead of a left-edge accent bar, marking a *published* answer (the canonical reveal) rather than one item in a column.
- **Light theme** substitutes `rgba(255,252,244,0.55)` for the catch-light and `rgba(43,32,22,0.22)` for the drop.

### Named Rules

**The Three Tilt Tiers Rule.** `.tilt-card` (full) is for coach and dashboard surfaces — topic cards, stat blocks, chart hosts, artifact tiles. `.tilt-card-soft` is for every transcript card. `.tilt-card-rail` is for nav rows and small chrome controls by standing decree. These are the same physics at three amplitudes, not three tunings.

**The Edge-Throw Rule.** A rotation's felt strength is not its angle but how far it throws the edge it pivots about — `(width / 2) · sin(rotateY)` and `(height / 2) · sin(rotateX)`. Edge throw, not angle, is what the physics tunes: every tier's multiplier is a ceiling, and each axis solves its own angle from the element's measured size so throw stays roughly constant. Below the cap a surface keeps every degree it had, so small elements are untouched and only large ones settle. Transcript cards carry the tightest budget of the three — that surface is being read. Idle drift is held far tighter than pointer tilt, because a card that moves because you moved is feedback while a card that moves on its own as you read is interference. Scrolling stills the surface entirely. A new tilt surface never needs a new tier; the throw budget already covers it.

**The Chart Doesn't Tilt Rule.** A chart's SVG never tilts. The panel hosting it does.

## Shapes

**Every corner in the app is a right angle.** The entire `@theme` radius scale is zeroed, which sharpens all `rounded*` utilities app-wide from a single block. The one deliberate survivor is `rounded-full`, which Tailwind compiles to `calc(infinity*1px)` rather than a theme value — it is reserved for the app's *organic* marks: dots, rings, pings, the brand glyph. The result is a hard-edged instrument grammar with a small vocabulary of round biological marks inside it.

Borders are hairlines: `1px solid var(--color-edge)` on panels, `--color-hairline` on dividers. There is no thick-border or heavy-outline register at all.

Three named form devices carry state:

- **Frame** (`.frame-hover` / `.frame-selected`): a hairline drawn by a `::after` pseudo-element at `inset: -3px`, *outside* the element's own border. Never `outline` — `.focus-ring` owns that channel, and a 2px focus outline must always read as stronger than a 1px hover frame. **Hard rule: never apply a frame class to an `overflow-hidden` host** — the inset-negative `::after` is clipped and silently vanishes. Give it an unclipped wrapper or skip the frame on that surface.
- **Dogear** (`.dogear`): a 9px border-triangle folding the top-right corner, marking "this is the one you're in" — the continuing topic, the current probe, the active nav item. Border-triangle over clip-path for crisper anti-aliasing and no content clipping.
- **Ink glyphs**: `InkNode.tsx` draws a hand-drawn neuron cell body as an 8-point closed blob whose vertex wobble comes from a `seeded(id, salt)` hash, so a given node id always redraws the identical lumpy outline instead of a fresh random shape each render. Filled = consolidated, outlined = new, dashed = threshold. `DendriteDivider.tsx` replaces horizontal rules with a branching hairline — one axon, two short dendrites, a node dot — at fixed geometry, with a flexible `h-px flex-1` span filling the remaining width so the branch never distorts.

### Named Rules

**The Scarce Dogear Rule.** ACTIVE ONLY, by decree. A dogear on every card in a list is wallpaper; it means something *because* most cards don't have one.

**The Right Angle Rule.** Do not reintroduce a radius, at any value, on any surface. If a shape needs softening, it is the wrong shape. `rounded-full` on an organic mark is the only exception.

## Components

### Buttons
- **Shape:** hard right angle (`0px`), hairline border.
- **Primary:** `--color-accent-cta` fill (amber in dark, `#3d5266` grayish blue in light) on void text, `px-4 py-3` for the composer's send action. Hover moves to `--color-accent-cta-hover`.
- **Hover / Focus:** color transitions at `--dur-fast` (120ms) via a global `button { transition }` rule, plus the app-wide press transform (`button:active` → `scale(0.97)`). Focus is always `.focus-ring` — a 2px `--color-ink-warm` outline at `2px` offset, never a bespoke treatment.
- **Chrome controls (`CTRL`):** the app-wide idiom for page-level controls — `.label-data` at 10px uppercase, `0.16em` tracking, `px-2.5 py-1`, hairline border, rail-tier tilt. Transparent at rest (`CTRL_QUIET`, dim text → primary text on hover). The **filled** variant marks importance — an active toggle, a lens, a primary action — as a 16% wash of the environment accent with a dim-ink border.

### The Environment Accent
Shared chrome carries a per-environment identity: **Learn accents warm** (encoding new ground), **Review accents cool** (retrieval under test). It travels as an explicit `EnvAccent` prop on shared components, never a context provider, and `ctrlFilled()` returns one of two *static* template strings so Tailwind's JIT sees both literal class lists. **Semantic inks — grade colors, threshold violet, danger — never route through the environment accent.**

The split also governs the doors: Home's main menu inks Learn warm and Review cool, so the one screen that opens both environments states which is which. Coach and Artifacts take violet there — the definition of violet names those surfaces. Grades, Topic Map and Settings stay neutral, because a section with no true ink must not be given one; the palette's rules only hold their force while nothing wears an ink it has not earned.

### Chips
- **Style:** `.label-data` at 10px, `px-1.5 py-0.5`, hairline border, a 68% `surface-3` wash, dim text.
- **State:** selected chips take the environment accent's filled treatment; a removable chip carries an inline dismiss that turns `--color-ink-danger` on hover.

### Cards / Containers
- **Corner style:** `0px`.
- **Background:** `.panel` (surface, 62%), `.panel-raised` (surface-2, 68%), `.panel-plate` (surface with a warm inset frame). Inside `.chat-glass` the first two step up to 76% / 82%.
- **Shadow strategy:** see Elevation — catch-light plus soft drop, `backdrop-filter: blur(12px)`.
- **Border:** `1px solid var(--color-edge)`.
- **Internal padding:** `px-3 py-2.5` standard; `gap-1` tight, `gap-1.5` default.

### Inputs / Fields
- **Style:** the composer is a `.panel` surface with a hairline-bordered wrapper (`border border-[var(--color-edge)] p-3`) holding the attachment chip row, the editable surface, an optional side-by-side markdown preview (`grid grid-cols-2 gap-3`), and a footer control row.
- **Focus:** `.focus-ring` only.
- **Drop state:** a dashed `--color-ink-warm` border over an 8% warm wash, with an uppercase `.label-data` prompt centered in it.
- **Hints:** keyboard affordances live in `.fig-caption` and collapse at narrow widths (`hidden sm:inline`).

### Navigation
The left rail is its own **nocturne** register — a distinct near-black-violet ground (`--color-nocturne-hi` / `-lo`) with lavender ink, so navigation reads as a different plane from content rather than as a lighter panel. Items are `.label-data`, tilt at rail scale, and mark the current destination with a dogear. The light theme overrides the rail explicitly rather than inheriting.

### Transcript Marks (signature)
The chat transcript is the app's densest and most characteristic surface. A shared card skeleton (`MarkFrame`) provides the geometry — `.tilt-card-soft`, `ritual-mark-in` entry, `max-w-[92%]`, hairline border, `px-3 py-2.5` — and a four-ink taxonomy (warm / cool / violet / danger) colors it by meaning. On top of that sit roughly twenty structured card kinds driven by MCP bridge tools: comparisons, step ladders, formulas with symbol highlighting, citations, checklists, timelines, definitions, and SVG plots that draw themselves in via `stroke-dashoffset` and carry a crosshair readout.

**These cards are a formatting channel, never a new authority.** Every bridge tool formats prose the tutor would have written anyway — advisory, non-blocking, never load-bearing for the learning loop. A card that the loop *depends on* is a design error, not a richer card.

**Density over ceremony.** Cards stay compact and scannable. No mark may grow into a full-width panel that breaks the transcript's rhythm; the `92%` cap and the tight padding scale are what make twenty kinds of card feel like one surface.

## Do's and Don'ts

### Do:
- **Do** encode state in ink: cool for unconsolidated, warm for survived, violet for synthesis, danger for lapse.
- **Do** route every learner- or tutor-authored string through the math renderer, including titles, chips, labels, and captions.
- **Do** use the two motion tokens — `--dur-fast` 120ms for buttons and color shifts, `--dur-base` 200ms with `--ease-out-soft` for panels, rows, cards, and view transitions.
- **Do** reach for `.panel`, `.panel-raised`, `.panel-plate`, `.label-data`, `.fig-caption`, `.focus-ring`, and the `CTRL` recipes before writing new chrome. The idioms exist; a new one is a claim that all of them are wrong.
- **Do** pass `EnvAccent` explicitly on shared components, and keep semantic inks out of it.
- **Do** give a `.frame-hover` or `.frame-selected` element its own unclipped wrapper when the natural host is `overflow-hidden`.
- **Do** respect `prefers-reduced-motion` — the app-wide kill-switch covers idle drift, pointer tilt, and entry animations, and any new motion must fall under it.
- **Do** keep the transcript dense. It is read for thirty minutes at a stretch.

### Don't:
- **Don't** reintroduce a corner radius anywhere. `rounded-full` on organic marks (dots, rings, pings, the brand glyph) is the only exception.
- **Don't** use danger ink for validation errors, failed requests, or destructive-action buttons. It belongs to the learner's struggle.
- **Don't** promote violet to a third consolidation state, or add a fifth ink because a surface needs another color.
- **Don't** scale anything that isn't a real `<button>` on hover or press — scale is a button-only affordance so it never competes with the border and background cues rows and cards use.
- **Don't** scatter dogears. Active only.
- **Don't** build a bridge card the learning loop depends on. Cards format; they never carry authority.
- **Don't** invent a bespoke focus treatment. `.focus-ring` owns `outline`; the frame vocabulary deliberately uses `::after` so a 2px focus ring always outranks a 1px hover frame.
- **Don't** tilt a chart's SVG. Tilt the panel that hosts it.
- **Don't** treat the open fallback typefaces as an alternate design. They are a degradation path; the licensed mapping is the system.
