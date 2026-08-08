/** Keystroke-level editing aids for LaTeX in a plain textarea.
 *
 * Typing an expression is a different motor task from typing prose. Prose is
 * linear; an expression is a tree you build by opening containers and filling
 * them, and the closers are pure bookkeeping — nobody has ever *wanted* to
 * type a `}`. Every rule here removes a piece of that bookkeeping, and each
 * one exists because it fixes a specific, common, silent failure:
 *
 *   · `x^10` renders as x¹0. This is THE classic LaTeX bug and it is silent —
 *     the output is wrong but it is not an error, so it survives into a
 *     graded production. Auto-bracing `^` and `_` makes it structurally hard
 *     to write.
 *   · `\left(` with no `\right)` is a hard parse error, and the fix is
 *     mechanical, so it should be automatic.
 *   · `\begin{pmatrix}` with no `\end` is the same, and matrices are
 *     unavoidable in this app's curricula.
 *   · Wrapping a selection is how you actually write math — you type the
 *     thing, THEN realise it needs to be a fraction's numerator or in math
 *     mode at all.
 *
 * PURE. Every function takes (text, selection, key) and returns the new text
 * and selection, or null to mean "nothing special, let the browser handle
 * it." No DOM, no React — so all of it is testable as data, which matters for
 * rules this fiddly.
 *
 * A NOTE ON RESTRAINT. Auto-formatting that fires when you didn't want it is
 * worse than none: it makes the editor feel possessed. So every rule here is
 * either (a) reversible by one backspace, or (b) conditioned on context tight
 * enough that a false fire is rare. Nothing reformats text you already typed,
 * nothing runs on a timer, and nothing rewrites on blur. */

import { scanLatex } from './latexSyntax'

/** Is the caret inside a math span?
 *
 * THE SCOPE RULE. Every aid below except `$` itself applies only inside
 * maths, for the same reason the highlighting does: outside a span these are
 * ordinary characters. `^` is a caret, `(` is a parenthesis. Missing this
 * turned the sentence "E = mc^2 with no math" into
 * "E = mc^{2 with no math}" — auto-bracing prose, which is far worse than any
 * highlighting fault because it silently corrupts what the learner wrote. */
function inMath(text: string, at: number): boolean {
  const { tokens } = scanLatex(text)
  for (const t of tokens) {
    if (!t.open || t.family !== 'math' || t.partner === null) continue
    if (t.end <= at && at <= tokens[t.partner].start) return true
  }
  // An unterminated span still counts — you are inside it while typing it.
  const last = [...tokens].reverse().find((t) => t.family === 'math' && t.partner === null)
  return last ? last.end <= at : false
}

/** The caret sits between the two halves of an EMPTY inline span, `$|$`.
 * Character peeking cannot answer this — in `$$\frac{a}{b}$|$` the character
 * either side is also `$`, but those are a CLOSING pair, and treating them as
 * an empty span grew `$$\frac{a}{b}$$` into `$$\frac{a}{b}$$$$`. Only the
 * scanner knows which `$` opens. */
function inEmptyInlineSpan(text: string, at: number): boolean {
  // Scanned on the PREFIX, not the whole string. `$|$` is literally `"$$"`,
  // which the scanner reads as one display-math token — so the pair can never
  // be found by looking at the full text. What actually distinguishes the two
  // cases is whether the `$` before the caret OPENED a span:
  //   `$|$`                  prefix `$`               → an unclosed opener
  //   `$$\frac{a}{b}$|$`     prefix `$$\frac{a}{b}$`  → that `$` closed one
  const { tokens } = scanLatex(text.slice(0, at))
  const last = tokens[tokens.length - 1]
  return !!last && last.open && last.family === 'math' && last.text === '$' && last.partner === null && last.end === at
}

export interface EditState {
  text: string
  selStart: number
  selEnd: number
}

/** An applied edit — new text plus where the caret (or selection) lands. */
export interface EditResult {
  text: string
  selStart: number
  selEnd: number
}

/** Openers that auto-close, and what closes them. `$` is here too: it pairs
 * with itself, which is why an unbalanced one is so easy to create by hand. */
const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '$': '$',
}

/** Is the character at `at` escaped by a backslash? Counts the run, so `\\{`
 * (an escaped backslash then a real group opener) is correctly NOT escaped
 * while `\{` is.
 *
 * Needed because `\{` is a literal brace GLYPH in TeX, not a group opener —
 * see the same correction in latexSyntax.ts. Auto-closing it produced `\{}`,
 * and the smart backspace then took both halves and left a dangling `\`. */
function isEscaped(text: string, at: number): boolean {
  let n = 0
  let i = at - 1
  while (i >= 0 && text[i] === '\\') {
    n++
    i--
  }
  return n % 2 === 1
}

/** True when the caret sits directly after `\left` (or `\right`), where the
 * NEXT character is that command's delimiter argument rather than an opener
 * in its own right. `onInsert` declines here so `onCompletion` gets the
 * keystroke and can insert the matching `\right` — otherwise auto-close fires
 * first, returns early, and the completion is unreachable. That is exactly
 * why `\left(` stopped auto-wrapping. */
function awaitingSizedTarget(text: string, at: number): boolean {
  return /\\(left|right)\s*$/.test(text.slice(0, at))
}

/** Characters that, when they follow the caret, mean "we're at a boundary" —
 * auto-closing before a letter would produce `(x)yz` when you meant `(xyz)`.
 * Standard editor heuristic: only auto-close at end of line or before
 * whitespace/closers/punctuation. */
function atClosableBoundary(text: string, at: number): boolean {
  if (at >= text.length) return true
  return /[\s)\]}$,.;:&\\]/.test(text[at])
}

/** Typing a printable character. Returns null when nothing special applies. */
export function onInsert(state: EditState, ch: string): EditResult | null {
  const { text, selStart, selEnd } = state
  const hasSelection = selEnd > selStart

  // ── Wrap a selection ────────────────────────────────────────────────────
  // Select `x+1`, press `(` → `(x+1)` with the selection preserved inside, so
  // you can immediately wrap again. This is the single highest-value rule:
  // the alternative is caret gymnastics at both ends.
  if (hasSelection && PAIRS[ch] && (ch === '$' || inMath(text, selStart))) {
    const inner = text.slice(selStart, selEnd)
    const close = PAIRS[ch]
    return {
      text: text.slice(0, selStart) + ch + inner + close + text.slice(selEnd),
      selStart: selStart + ch.length,
      selEnd: selEnd + ch.length,
    }
  }

  // ── `$` — its own case, because it closes with itself ───────────────────
  // A self-closing delimiter can't be handled by the opener/closer rules
  // below: the same keystroke both opens and closes, so "am I opening or
  // closing" has to be answered from context before anything else runs.
  //
  // The bug this replaces: typing `$` inside the freshly-paired `$|$` fell
  // through to the parity check, which correctly said "already inside a
  // span, don't pair" and returned null — so the browser inserted a THIRD
  // dollar, giving `$$$`. Typing again made the parity even, auto-close
  // fired, and it became `$$$$$`.
  if (!hasSelection && ch === '$') {
    const prev = text[selStart - 1]
    const next = text[selStart]

    // Sitting inside an empty inline pair `$|$` — the second `$` means
    // "actually, make this display maths", so grow it to `$$|$$` rather than
    // inserting a stray third delimiter. Asked of the SCANNER, not of the
    // neighbouring characters: see `inEmptyInlineSpan`.
    if (prev === '$' && next === '$' && inEmptyInlineSpan(text, selStart)) {
      return {
        text: text.slice(0, selStart) + '$$' + text.slice(selStart),
        selStart: selStart + 1,
        selEnd: selStart + 1,
      }
    }

    // Closing by hand, with the closer already sitting there — step over it.
    // This is what made "move to the far right and type the last $" the only
    // reliable way to finish a span.
    if (next === '$') {
      return { text, selStart: selStart + 1, selEnd: selStart + 1 }
    }

    // …and step over any closers standing between the caret and that `$`.
    // Typing `$x^2$` straight through leaves the caret inside the `^{}` group
    // when the final `$` arrives, because auto-pairing already supplied both
    // the `}` and the `$`. Without this the keystroke lands INSIDE the group:
    // `$x^{2$}$`. Only closing delimiters are skipped, so this can never jump
    // over content the learner still meant to type into.
    let j = selStart
    while (j < text.length && (text[j] === '}' || text[j] === ')' || text[j] === ']')) j++
    if (text[j] === '$') {
      return { text, selStart: j + 1, selEnd: j + 1 }
    }

    // Opening a span. This lives HERE, above the maths-scope gate below,
    // because `$` is how you get INTO maths — gating it on already being
    // there would make it impossible to start.
    if (!inMath(text, selStart) && atClosableBoundary(text, selStart)) {
      return {
        text: text.slice(0, selStart) + '$$' + text.slice(selEnd),
        selStart: selStart + 1,
        selEnd: selStart + 1,
      }
    }
    return null
  }

  // Everything past this point is a MATHS aid — see `inMath`. In prose these
  // characters mean themselves and the browser's own behaviour is correct.
  if (!inMath(text, selStart)) return null

  // ── Type-over a closer ──────────────────────────────────────────────────
  // Caret sits right before the `)` we auto-inserted and you type `)` — step
  // over it rather than producing `))`. Without this, auto-closing is a net
  // loss for anyone who types closers out of habit.
  if (!hasSelection && (ch === ')' || ch === ']' || ch === '}') && text[selStart] === ch) {
    return { text, selStart: selStart + 1, selEnd: selStart + 1 }
  }

  // ── `^` and `_` always take a group ─────────────────────────────────────
  // `x^{}` with the caret inside. Fixes `x^10` structurally.
  if (!hasSelection && (ch === '^' || ch === '_')) {
    return {
      text: text.slice(0, selStart) + ch + '{}' + text.slice(selEnd),
      selStart: selStart + 2,
      selEnd: selStart + 2,
    }
  }
  // With a selection, `^`/`_` wrap it: select `10`, press `^` → `^{10}`.
  if (hasSelection && (ch === '^' || ch === '_')) {
    const inner = text.slice(selStart, selEnd)
    return {
      text: text.slice(0, selStart) + ch + '{' + inner + '}' + text.slice(selEnd),
      selStart: selStart + 2,
      selEnd: selEnd + 2,
    }
  }

  // ── Auto-close an opener ────────────────────────────────────────────────
  // Two declines first, both of which hand the keystroke to `onCompletion`
  // or to the browser rather than pairing it:
  //   · directly after `\left`/`\right`, where the character is that
  //     command's argument — pairing here shadowed the `\right)` completion
  //   · an escaped `\{`, which is a literal glyph and has no partner
  if (!hasSelection && PAIRS[ch] && awaitingSizedTarget(text, selStart)) return null
  if (!hasSelection && ch === '{' && isEscaped(text, selStart)) return null
  if (!hasSelection && PAIRS[ch] && atClosableBoundary(text, selStart)) {
    return {
      text: text.slice(0, selStart) + ch + PAIRS[ch] + text.slice(selEnd),
      selStart: selStart + 1,
      selEnd: selStart + 1,
    }
  }

  return null
}

/** Backspace. Deletes both halves of an empty pair, so an auto-inserted
 * closer is never something you have to clean up by hand — which is what
 * makes every auto-close rule above safe to be wrong about. */
export function onBackspace(state: EditState): EditResult | null {
  const { text, selStart, selEnd } = state
  if (selEnd !== selStart || selStart === 0) return null
  const before = text[selStart - 1]
  const after = text[selStart]
  if (!before || !after) return null
  // `$$|$$` and `$|$` are handled below and are maths by definition; every
  // other pair rule is scoped like the insertion aids.
  if (before !== '$' && !inMath(text, selStart)) return null
  // `x^{}` FIRST — it is a special case of the empty-pair rule below, and the
  // generic branch would otherwise match it and leave a dangling `^`.
  if (before === '{' && after === '}' && selStart >= 2 && (text[selStart - 2] === '^' || text[selStart - 2] === '_')) {
    return { text: text.slice(0, selStart - 2) + text.slice(selStart + 1), selStart: selStart - 2, selEnd: selStart - 2 }
  }
  // `$$|$$` — undo the display upgrade one step, back to `$|$`, so the growth
  // path and the shrink path are symmetric.
  if (before === '$' && after === '$' && text[selStart - 2] === '$' && text[selStart + 1] === '$') {
    return { text: text.slice(0, selStart - 1) + text.slice(selStart + 1), selStart: selStart - 1, selEnd: selStart - 1 }
  }
  // An escaped `\{` is not half of a pair — deleting "both halves" of `\{}`
  // would leave a dangling backslash.
  if (before === '{' && isEscaped(text, selStart - 1)) return null
  if (PAIRS[before] === after) {
    return { text: text.slice(0, selStart - 1) + text.slice(selStart + 1), selStart: selStart - 1, selEnd: selStart - 1 }
  }
  return null
}

/** Completions that fire on a trigger character rather than a keystroke pair.
 * Returns null unless the text immediately before the caret matches. */
export function onCompletion(state: EditState, justTyped: string): EditResult | null {
  const { text, selStart, selEnd } = state
  if (selEnd !== selStart) return null
  const before = text.slice(0, selStart)

  // `\left(` → `\left( \right)`, caret between. Also `\left[`, `\left\{`.
  const sized = /\\left\s*(\\?[([{|.])$/.exec(before)
  if (sized) {
    const open = sized[1]
    const CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}', '\\{': '\\}', '|': '|', '.': '.' }
    const close = CLOSE[open] ?? ')'
    const ins = ` \\right${close}`
    return { text: before + ins + text.slice(selStart), selStart, selEnd: selStart }
  }

  // `\begin{pmatrix}` → matching `\end{pmatrix}` on the next line.
  const env = /\\begin\{([a-zA-Z*]+)\}$/.exec(before)
  if (env && justTyped === '}') {
    const ins = `\n\n\\end{${env[1]}}`
    return { text: before + ins + text.slice(selStart), selStart: selStart + 1, selEnd: selStart + 1 }
  }

  return null
}

/** Unicode math a PDF paste drags in, and the LaTeX it should have been.
 *
 * The app's own system prompt already tells the TUTOR to "prefer LaTeX
 * delimiters over unicode approximation (ħ, ∂, ≥, etc.) anywhere you'd
 * otherwise reach for one, so the app can actually set it as math." The
 * learner's side had no equivalent help, which is backwards — the learner is
 * the one pasting out of a qual paper. */
const UNICODE_LATEX: [RegExp, string][] = [
  [/α/g, '\\alpha'], [/β/g, '\\beta'], [/γ/g, '\\gamma'], [/δ/g, '\\delta'],
  [/ε/g, '\\epsilon'], [/ζ/g, '\\zeta'], [/η/g, '\\eta'], [/θ/g, '\\theta'],
  [/ι/g, '\\iota'], [/κ/g, '\\kappa'], [/λ/g, '\\lambda'], [/μ/g, '\\mu'],
  [/ν/g, '\\nu'], [/ξ/g, '\\xi'], [/π/g, '\\pi'], [/ρ/g, '\\rho'],
  [/σ/g, '\\sigma'], [/τ/g, '\\tau'], [/υ/g, '\\upsilon'], [/φ/g, '\\phi'],
  [/χ/g, '\\chi'], [/ψ/g, '\\psi'], [/ω/g, '\\omega'],
  [/Γ/g, '\\Gamma'], [/Δ/g, '\\Delta'], [/Θ/g, '\\Theta'], [/Λ/g, '\\Lambda'],
  [/Ξ/g, '\\Xi'], [/Π/g, '\\Pi'], [/Σ/g, '\\Sigma'], [/Φ/g, '\\Phi'],
  [/Ψ/g, '\\Psi'], [/Ω/g, '\\Omega'],
  [/ħ/g, '\\hbar'], [/∂/g, '\\partial'], [/∇/g, '\\nabla'], [/∞/g, '\\infty'],
  [/∫/g, '\\int'], [/∮/g, '\\oint'], [/∑/g, '\\sum'], [/∏/g, '\\prod'],
  [/√/g, '\\sqrt'], [/±/g, '\\pm'], [/∓/g, '\\mp'], [/×/g, '\\times'],
  [/÷/g, '\\div'], [/·/g, '\\cdot'], [/≈/g, '\\approx'], [/≠/g, '\\neq'],
  [/≡/g, '\\equiv'], [/≤/g, '\\leq'], [/≥/g, '\\geq'], [/≪/g, '\\ll'],
  [/≫/g, '\\gg'], [/∝/g, '\\propto'], [/∈/g, '\\in'], [/∉/g, '\\notin'],
  [/⊂/g, '\\subset'], [/⊆/g, '\\subseteq'], [/∪/g, '\\cup'], [/∩/g, '\\cap'],
  [/→/g, '\\to'], [/←/g, '\\leftarrow'], [/↔/g, '\\leftrightarrow'],
  [/⇒/g, '\\Rightarrow'], [/⇔/g, '\\Leftrightarrow'], [/∀/g, '\\forall'],
  [/∃/g, '\\exists'], [/⟨/g, '\\langle'], [/⟩/g, '\\rangle'],
  [/†/g, '^\\dagger'], [/′/g, "'"], [/…/g, '\\dots'],
]

/** How many convertible unicode characters are in the text. Drives whether
 * the offer appears at all — the conversion is never applied silently. */
export function countUnicodeMath(text: string): number {
  let n = 0
  for (const [re] of UNICODE_LATEX) {
    const m = text.match(re)
    if (m) n += m.length
  }
  return n
}

/** Apply the conversion. Deliberately NOT math-scoped: someone pasting `∂ψ/∂t`
 * as bare prose meant it as math and hasn't wrapped it yet, and converting
 * only inside `$…$` would help exactly the people who least need help. */
export function unicodeToLatex(text: string): string {
  let out = text
  for (const [re, tex] of UNICODE_LATEX) out = out.replace(re, tex)
  return out
}
