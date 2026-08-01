# Night Atlas — design tokens & component grammar

A portable reference for reusing Engram Desktop's design system ("Night Atlas") in other projects. Everything here is lifted from the live source of truth (`app/src/renderer/src/index.css`, `shared/controlChrome.ts`, `ritual/GradeChip.tsx`) as of 2026-07-31. Copy the CSS blocks verbatim; the decrees explain the rules that keep surfaces coherent.

## Philosophy

Cajal's sepia-ink neuron atlas inverted onto the night: a warm near-black void, warm "paper ink" text (never cold white), and a two-signal ink duality — **cool = not yet consolidated, warm = the surviving signal** (an oscilloscope-phosphor amber, not a generic accent). Violet is a third semantic (synthesis/creation); danger red is reserved for content the app is already confident is bad news. Glass tile/panel/card language throughout: translucent color-mixed fills over an ambient field, sharp right-angle geometry everywhere, subtle 3D card tilt.

## Core color tokens — dark ("Night Atlas", default)

```css
:root {
  /* Ground */
  --color-void: #0d0e12;
  --color-surface: #14151c;
  --color-surface-2: #1c1e28;
  --color-surface-3: #262937;
  --color-hairline: #262a36;
  /* Card edge ink — panel outlines. Derived, not literal: pulls the cool
     hairline halfway toward the sepia faint text so edges belong to the
     warm atlas. Interior dividers stay on the bare hairline: outer edge >
     inner rule is the hierarchy. */
  --color-edge: color-mix(in srgb, var(--color-hairline) 50%, var(--color-text-faint));

  /* The ink duality + semantics — every ink has a full + -dim pair */
  --color-ink-cool: #5b8fa8;      --color-ink-cool-dim: #3a5a6b;
  --color-ink-warm: #e8a857;      --color-ink-warm-dim: #8a6533;
  --color-ink-hot: #f0c24b;       /* hover/press step above warm */
  --color-ink-danger: #c4685a;    --color-ink-danger-dim: #6b3d36;
  --color-ink-violet: #a78bda;    --color-ink-violet-dim: #6b5490;

  /* Brand-only lavender night (splash/hero/icon; never semantic) */
  --color-nocturne-hi: #121020;   --color-nocturne-lo: #0c0b16;
  --color-ink-lavender: #a99ef0;  --color-ink-lavender-dim: #7d73b8;

  /* Warm paper-ink text ramp */
  --color-text-primary: #e6dfd0;
  --color-text-dim: #8b8878;
  --color-text-faint: #545248;

  /* CTA chrome accent — warm pair by default; light theme redirects it */
  --color-accent-cta: var(--color-ink-warm);
  --color-accent-cta-hover: var(--color-ink-hot);
}
```

## Core color tokens — light ("Atlas by Daylight")

Bright cream paper, dark ink, and one crucial swap: chrome/emphasis (focus rings, dogears, CTAs, selection) moves to a desaturated **slate blue-gray** line color, while the semantic inks stay warm/cool/violet/danger. Fills stay neutral — the blue belongs to LINES, never card bodies.

```css
:root[data-theme='light'] {
  --color-void: #f4efe4;
  --color-surface: #e3e4e2;
  --color-surface-2: #d2d4d0;
  --color-surface-3: #bcbfba;
  --color-hairline: #a5b2c0;          /* slate blue-gray drawn line */
  /* --color-edge re-derives automatically from the mix above */

  --color-ink-cool: #1f6b86;          --color-ink-cool-dim: #4f8ea3;
  --color-ink-warm: #8f5416;          --color-ink-warm-dim: #a97a3a;
  --color-ink-hot: #7a5a10;
  --color-ink-danger: #a13527;       --color-ink-danger-dim: #c06452;
  --color-ink-violet: #6b4fa0;       --color-ink-violet-dim: #8f76b8;

  /* Slate accent pair — line/emphasis only (focus, dogear, selected, CTA) */
  --color-accent-cta: #3d5266;
  --color-accent-cta-hover: #2e3f50;
}
```

Contrast was verified at authoring time: text-primary ≈7.9:1, all full inks ≥4.5:1 against the void; the `-dim` pairs deliberately target the ~3:1 non-text floor (borders/washes only, never body text).

## Type system

Three commercial first-choice faces with graceful open fallbacks. The commercial files are NOT redistributable — don't commit them; load them at runtime only if present (this repo registers whatever exists in a git-ignored fonts directory via the FontFace API, and the stacks land on the open fallbacks otherwise):

| Token | Face | Role |
|---|---|---|
| `--font-display` | Neue Haas Grotesk Display Pro (→ Space Grotesk) | Important text, titles, important numbers, grades |
| `--font-serif` | Epoca Pro Medium (→ Fraunces, Georgia) | Italics, flavor text, descriptions — always weight 500 |
| `--font-body` | Futura (→ Inter) | General text, names |
| `--font-data` | Futura (→ ui-monospace) | Labels, readouts, tracked-uppercase chrome |

```css
--text-display: 1.75rem;  --text-heading: 1.25rem;  --text-body: 0.875rem;
--text-caption: 0.75rem;  --text-data: 0.8125rem;
```

## Geometry & motion

```css
/* EVERY corner is a right angle, by decree — zero the whole radius scale.
   rounded-full survives free (organic dots/rings/pings). */
--radius: 0px; /* …through --radius-4xl: 0px */

/* Two durations cover every micro-interaction */
--dur-fast: 120ms;
--dur-base: 200ms;
--ease-out-soft: cubic-bezier(0.25, 0.8, 0.35, 1);
```

## Glass panels — the three tiers

```css
.panel {          /* base chat/content card */
  background: color-mix(in srgb, var(--color-surface) 62%, transparent);
  border: 1px solid var(--color-edge);
  border-radius: 0;
  box-shadow: inset 0 1px 0 rgba(228,231,237,0.04), 0 8px 20px -12px rgba(0,0,0,0.5);
  backdrop-filter: blur(12px);
  transition: border-color var(--dur-base) var(--ease-out-soft), box-shadow var(--dur-base) var(--ease-out-soft);
}
.panel-raised {   /* popover/menu/backing-plate tier */
  background: color-mix(in srgb, var(--color-surface-2) 68%, transparent);
  /* …same border/shadow/blur/transition */
}
.panel-plate {    /* the "engraved specimen label": full inner warm hairline frame */
  background: color-mix(in srgb, var(--color-surface) 68%, transparent);
  box-shadow: inset 0 0 0 1px var(--color-ink-warm-dim),
              inset 0 1px 0 rgba(228,231,237,0.04), 0 8px 20px -12px rgba(0,0,0,0.5);
}
/* Long-form reading scope: inside transcripts glass steps toward opacity */
.chat-glass .panel        { background: color-mix(in srgb, var(--color-surface) 76%, transparent); }
.chat-glass .panel-raised { background: color-mix(in srgb, var(--color-surface-2) 82%, transparent); }
/* Light theme bumps all alphas (78/84/82/90/93%) and flips shadows to a
   pale top catch-light + soft warm-ink drop. */
```

**Glass rules:** blur only where content genuinely scrolls behind the surface — top-of-frame bars (title bar, nav strips) use the color-mix fill with NO blur. Nested glass never stacks: a framed unit inside a `.panel` carries only a `--color-edge` border, no fill/blur of its own.

## Card tilt physics

All cards tilt on hover via one shared rule + a delegated JS manager (one container ref, delegated pointer listeners, one rAF loop writing `--tilt-rx/--tilt-ry` @property angles per card — never per-card wiring):

```css
.tilt-card, .tilt-card-soft, .tilt-card-rail {
  transform: perspective(1200px) rotateX(var(--tilt-rx)) rotateY(var(--tilt-ry));
}
button.tilt-card:not(:disabled):not(.no-press):active { /* + -soft/-rail */
  transform: perspective(1200px) rotateX(var(--tilt-rx)) rotateY(var(--tilt-ry)) scale(0.97);
}
@media (prefers-reduced-motion: reduce) { /* transform: none; keep the press scale */ }
```

Tiers are JS amplitude multipliers only (the marker classes carry no extra CSS): `.tilt-card` full (idle ≤0.9°, hover ≤3.2°), `.tilt-card-soft` = same as full (chat cards), **`.tilt-card-rail` ×4 — small chrome tilts MORE, by decree.**

## Typography classes

```css
.label-data {      /* every label/readout */
  font-family: var(--font-data);
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}
.fig-caption {     /* "Fig. —" atlas caption: stats, empty states, flavor */
  font-family: var(--font-serif); font-style: italic; font-weight: 500;
  font-size: var(--text-caption); color: var(--color-text-dim);
  letter-spacing: 0.01em;
}
.figure-display {  /* THE one big decision-moment number — one size by decree */
  font-family: var(--font-display); font-size: 3.5rem; line-height: 1;
}
.section-banner {  /* plate divider, not a heading */
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 0.75rem; padding-block: 0.4rem;
  border-top: 1px solid var(--color-hairline);
  border-bottom: 1px solid var(--color-hairline);
  font-family: var(--font-data); font-size: 10px;
  text-transform: uppercase; letter-spacing: 0.4em;
  color: var(--color-text-dim);
}
```

Register title bands (subsection headers inside plates): `label-data 10px uppercase tracking-[0.28em]` in warm ink + an `h-px flex-1` hairline rule running to the plate's edge.

## Detail anatomy (modals, tickets, probe cards, mastheads)

```css
.detail-title-band {   /* opaque plate band — deliberately NOT glass */
  background: var(--color-surface-3);
  border-bottom: 1px solid var(--color-hairline);
}
.detail-subtitle {     /* italic serif in-band subtitle */
  font-family: var(--font-serif); font-style: italic; font-weight: 500;
  color: var(--color-text-dim);
}
.detail-footer {       /* hairline-topped action register */
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem; border-top: 1px solid var(--color-hairline);
}
.kbd-hint {            /* "esc — close" key chip */
  font-family: var(--font-data); font-size: 10px; letter-spacing: 0.02em;
  color: var(--color-text-dim); border: 1px solid var(--color-hairline);
  padding: 0.1em 0.4em; white-space: nowrap;
}
```

Environment mastheads add a 2px accent top rule via `box-shadow: inset 0 2px 0 <accent-dim>` on the band, plus a tracked eyebrow (`label-data 9px uppercase tracking-[0.28em]` in the accent ink) above a serif title.

## Marks & chrome atoms

```css
.focus-ring { outline: none; }
.focus-ring:focus-visible { outline: 2px solid var(--color-ink-warm); outline-offset: 2px; }
/* light theme: outline-color: var(--color-accent-cta) */

.dogear { position: relative; }   /* "you are here" — ACTIVE ITEM ONLY, by decree */
.dogear::before {
  content: ''; position: absolute; top: 0; right: 0; width: 0; height: 0;
  border-top: 9px solid var(--color-ink-warm);   /* light: accent-cta */
  border-left: 9px solid transparent; pointer-events: none;
}
```

Corner brackets (⌐ crop marks, 8 background-image hairline ticks) exist but are reserved for at most a few large host surfaces — never a default.

## Control chrome — buttons, toggles, tabs

The one idiom for small page-level controls (from `shared/controlChrome.ts`):

```
CTRL        = focus-ring tilt-card-rail label-data text-[10px] uppercase
              tracking-[0.16em] px-2.5 py-1 border transition-colors dur-fast
CTRL_QUIET  = CTRL + border-[--color-edge] text-dim hover:text-primary
ctrlFilled(accent) = CTRL + border-[<accent>-dim]
              + bg-[color-mix(in srgb, <accent> 16%, transparent)]
              + text-[<accent>]
```

Quiet at rest; FILLED marks importance (active toggle, primary action). **Environment accent identity:** Learn chrome = warm, Review chrome = cool, passed as an explicit prop — semantic inks (grade colors, threshold violet, danger) never route through it. Global shell chrome is always warm.

## The chip formula

One bordered chip recipe everywhere (grade badges, walk badges, position chips, filled controls):

```
color: <ink>;
border: 1px solid <ink-dim>;
background: color-mix(in srgb, <ink> 16%, transparent);
/* label-data, 9-10px, uppercase-tracked where it's chrome */
```

Grade→ink table: recalled = warm, partial = cool, lapsed = danger. Letter grades: S violet · A/B warm · C/D blue-cool · F danger.

## Interaction grammar (the signature moves)

- **Edge reveal (peek/tuck/pin):** chrome floats OVER content on a screen edge; a 2px hairline nub hints at rest; pointer-at-edge reveals via a 0fr↔1fr grid-row animation (reveal `--dur-base` ease-out-soft, hide 340ms `cubic-bezier(0.45,0.05,0.25,1)` — reads as a settle); a 400ms **clear-and-rearm** tuck timer means motion defers the deadline, so nothing folds under a cursor mid-flight; direct hover on the revealed chrome is authoritative; a pin tack holds it out (pinned card gets the dogear).
- **Bordered rows over cards** for dense lists; whole-row link buttons take the quiet control treatment, not their own tilt when stacked (many small rows each leaning reads as jitter — the enclosing card carries the physics).
- **Document-plate composition** for decision surfaces: one `figure-display` number said once and big → warm amnesty prose (when warranted) → hairline-divided registers of rows → `fig-caption` → action row.

## Decrees (the rules that keep it coherent)

1. Right angles everywhere; `rounded-full` only for organic marks.
2. `--color-edge` for panel outlines; bare `--color-hairline` for interior rules only.
3. Warm = consolidated/primary signal; cool = open/unproven; violet = synthesis/threshold; danger = confirmed bad news. Never repurpose.
4. One `figure-display` size — a smaller version is a stat block, which is its own thing.
5. Dogear = the single active item, never decoration.
6. Small chrome tilts more (rail ×4); text-bearing input surfaces never tilt.
7. Blur only over scrolling content; nested glass never stacks fills.
8. Two durations (120/200ms) + one easing for all micro-motion; honor `prefers-reduced-motion` with a hard transform override.
9. Chrome copy is tracked-uppercase `label-data`; flavor copy is serif italic 500; numbers that matter are display-face with tabular figures.
```
