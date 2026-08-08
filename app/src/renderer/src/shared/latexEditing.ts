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
  if (hasSelection && PAIRS[ch]) {
    const inner = text.slice(selStart, selEnd)
    const close = PAIRS[ch]
    return {
      text: text.slice(0, selStart) + ch + inner + close + text.slice(selEnd),
      selStart: selStart + ch.length,
      selEnd: selEnd + ch.length,
    }
  }

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
  if (!hasSelection && PAIRS[ch] && atClosableBoundary(text, selStart)) {
    // `$` is special: only auto-pair when opening a span, never when the
    // caret is already inside one — otherwise closing a span by hand gives
    // you `$$`. Cheap parity check on the dollars before the caret, ignoring
    // escaped ones.
    if (ch === '$') {
      const before = text.slice(0, selStart).replace(/\\\$/g, '')
      const open = (before.match(/\$/g) ?? []).length % 2 === 1
      if (open) return null
    }
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
  // `x^{}` FIRST — it is a special case of the empty-pair rule below, and the
  // generic branch would otherwise match it and leave a dangling `^`.
  if (before === '{' && after === '}' && selStart >= 2 && (text[selStart - 2] === '^' || text[selStart - 2] === '_')) {
    return { text: text.slice(0, selStart - 2) + text.slice(selStart + 1), selStart: selStart - 2, selEnd: selStart - 2 }
  }
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
