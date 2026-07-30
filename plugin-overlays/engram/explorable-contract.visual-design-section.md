## Visual design system (house style)

Every explorable is chrome around a thinking tool, not a webpage — it should look like it slid out of the same instrument panel the desktop app renders everything else in. This section is vocabulary, not decoration: clause 4 (Mayer-minimal) still governs — these are the SAME few structural moves reused consistently, not new ornament. An explorable that ignores this section isn't wrong on pedagogy, but it will look like a stray webpage next to the app's own cards, and a learner shouldn't be able to tell an explorable from a chat card by its chrome.

**Geometry — sharp, not rounded.** `border-radius: 0` everywhere except genuinely organic marks (a filled circle standing in for a node, a soft glow). Panels are hairline-bordered rectangles: `border: 1px solid var(--edge)`, never a shadow-only card with no drawn boundary.

**Glass, not solid fills.** Every panel/card fill is translucent over the page background, not opaque: `background: color-mix(in srgb, var(--surface) 72%, transparent); backdrop-filter: blur(10px);` (omit the blur only on tiny chip-scale elements where it costs more than it's worth). The page itself (`--void`) stays a flat solid — only the things sitting ON the page go translucent.

**Color tokens — declare these as CSS custom properties on `:root` and `:root[data-theme='light']` (clause 5's "both themes" requirement is satisfied by exactly this pair; `prefers-color-scheme: light` should map to the light block same as `data-theme='light'`). These are the app's actual production values — reuse them verbatim, don't reinvent nearby colors:**

```css
:root {
  --void: #0d0e12; --surface: #14151c; --surface-2: #1c1e28; --surface-3: #262937;
  --hairline: #262a36; --edge: #3d3e3f;
  --ink-cool: #5b8fa8; --ink-cool-dim: #3a5a6b;
  --ink-warm: #e8a857; --ink-warm-dim: #8a6533; --ink-hot: #f0c24b;
  --ink-danger: #c4685a; --ink-danger-dim: #6b3d36;
  --ink-violet: #a78bda; --ink-violet-dim: #6b5490; /* this agent's own accent — synthesis, not opposed to cool/warm */
  --text-primary: #e6dfd0; --text-dim: #8b8878; --text-faint: #545248;
}
:root[data-theme='light'] {
  --void: #f4efe4; --surface: #e3e4e2; --surface-2: #d2d4d0; --surface-3: #bcbfba;
  --hairline: #a5b2c0; --edge: #a5b2c0;
  --ink-cool: #1f6b86; --ink-cool-dim: #4f8ea3;
  --ink-warm: #8f5416; --ink-warm-dim: #a97a3a; --ink-hot: #7a5a10;
  --ink-danger: #a13527; --ink-danger-dim: #c06452;
  --ink-violet: #6b4fa0; --ink-violet-dim: #8f76b8;
  --text-primary: #2b2016; --text-dim: #6b5c46; --text-faint: #93856c;
}
```
Node-state meaning, if the widget shows state at all: cool = not yet consolidated, warm = the surviving/correct signal, danger = wrong/lapsed, violet = this artifact's own synthesis accent. Never invent a fifth hue for something these four already cover.

**Fonts — system stacks that carry the same voice, never a CDN or embedded font file (clause 5 forbids both).** The app pairs a serif voice for prose/claims with a geometric sans for chrome and a mono for data; approximate each with stacks any OS already has:
```css
--font-serif: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif;   /* the concept's voice — claim text, the reveal */
--font-display: 'Futura', 'Century Gothic', Avenir, ui-sans-serif, sans-serif; /* headings, labels, buttons */
--font-data: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;       /* numbers, sliders' live readout, the header comment */
```
Prose/claim text sits in `--font-serif` italic where it reads as commentary (an aside, a caveat) and roman where it's the claim itself. Labels, section headings, and buttons are `--font-display`, letter-spaced (`0.08–0.2em`) and uppercase for section labels specifically (not body prose). Every number — a slider's live value, a prediction stored for reveal, a probe count — renders in `--font-data` with `font-variant-numeric: tabular-nums`.

**Section labels — tracked-uppercase micro-caps over a hairline, not a `<h2>`.** `font: var(--font-display); font-size: 10px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--text-dim); border-bottom: 1px solid var(--hairline); padding-bottom: 0.4em;` — this is the one heading style the whole artifact uses, for "PREDICT", "THE MODEL", "RECONSTRUCT", whatever clause-driven sections it has.

**Buttons and the prediction-gate control** — sharp rectangle, hairline border at rest, filled with `--ink-warm` (dark theme) / a darkened `--ink-warm` variant with light text (light theme, since a pale warm fill under-contrasts dark text — check your own computed contrast before shipping, don't assume) when it's the primary commit action. Hover/focus: border brightens to `--ink-warm`, no color-shifting the whole button — a visible focus outline is required regardless (keyboard operability, clause 5).

**Micro-motion — felt, not watched, and never during clause-4's protected reading windows.** If you add any hover/idle motion to a panel, it must be: (a) a small tilt (`perspective(900px) rotateX/rotateY`, well under 1 degree idle, a couple degrees max on hover-toward-cursor) applied via a CSS transform on a wrapper div, never obscuring text while it's being read; (b) `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; transform: none !important; } }` — a real, tested override, not an afterthought. This is optional flourish, never load-bearing for the widget's actual manipulation (a slider must work with zero motion enabled) — and it must never run WHILE the reader is inside the prose-before/resolution-after windows clause 4 protects; gate it to idle/hover states on cards, not the running simulation itself.

**What NOT to do:** no gradients-as-decoration, no drop-shadows standing in for a drawn border, no rounded corners "for softness," no font you'd have to embed or fetch, no color outside this palette. If a widget's own domain has a natural visual language (a circuit diagram, a wave plot), let the DATA use whatever encoding is clearest — this house style governs the CHROME around it (panels, labels, buttons, the page background), not scientific/domain-specific visualizations that need their own conventions to be honest.
