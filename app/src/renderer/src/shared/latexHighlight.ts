/** Tint one symbol everywhere it appears inside a LaTeX expression.
 *
 * The FormulaCard's where-clause answers "what does each symbol mean," but the
 * learner still has to find that symbol in the equation by eye — which is
 * precisely the work that stalls someone mid-derivation in a dense expression
 * like $\Omega(E) = \frac{1}{h^{3N}N!}\int d^{3N}q\,d^{3N}p$. Pointing at a
 * gloss row and having its symbol light up in the equation collapses that
 * search to zero.
 *
 * Done by rewriting the LaTeX source with `\textcolor` and re-rendering,
 * NOT by reaching into KaTeX's output DOM. KaTeX supports `\textcolor`
 * natively with no `trust` option (this app renders with `trust` unset — see
 * `renderMath` in MathRenderer.tsx), and a source rewrite degrades safely:
 * `throwOnError: false` means even a rewrite that produced invalid TeX would
 * render as an error node rather than crashing the card, and the un-highlighted
 * source is always still there to fall back to.
 *
 * The whole difficulty is deciding what counts as an occurrence. A naive
 * `String.replaceAll` of `E` would also hit the `E` inside `\Epsilon`, the
 * `E` in `\text{Enc}`, and the `e` of nothing at all — producing
 * `\textcolor{...}{E}psilon`, which is not the same expression. So matching
 * is token-aware, and when it can't be confident it declines. */

/** Escape a string for literal use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build the match pattern for one symbol, or null if the symbol is too
 * ambiguous to match safely.
 *
 * Three shapes, in the order a real where-clause produces them:
 *
 *  1. A control sequence — `\beta`, `\mu`, `\hbar`. Matched exactly, with a
 *     trailing guard so `\be` never matches inside `\beta` and `\beta` never
 *     matches the `\beta` prefix of `\betaX`.
 *  2. A bare identifier — `E`, `T`, `k_B`, `N`. Matched with guards on BOTH
 *     sides: not preceded by a backslash or a letter (which would mean we're
 *     inside a control sequence like `\Epsilon` or a word like `\text{Enc}`),
 *     and not followed by a letter. This is what keeps a one-letter symbol
 *     from shredding every command in the expression.
 *  3. Anything else — a subscripted or braced compound like `Q_{\rm enc}` or
 *     `\vec{E}`. Matched as a literal substring, since its own punctuation
 *     already makes an accidental match vanishingly unlikely.
 */
function occurrenceRe(symbol: string): RegExp | null {
  const sym = symbol.trim()
  if (!sym) return null

  // A lone backslash, a lone brace — nothing to anchor on.
  if (/^[\\{}_^]+$/.test(sym)) return null

  if (/^\\[a-zA-Z]+$/.test(sym)) {
    return new RegExp(`${escapeRe(sym)}(?![a-zA-Z])`, 'g')
  }

  if (/^[A-Za-z][A-Za-z0-9]*(_\{?[A-Za-z0-9]+\}?)?$/.test(sym)) {
    // The leading guard rejects a preceding backslash or letter. A preceding
    // digit is fine (`2E`), as is punctuation or whitespace.
    return new RegExp(`(?<![\\\\A-Za-z])${escapeRe(sym)}(?![A-Za-z])`, 'g')
  }

  return new RegExp(escapeRe(sym), 'g')
}

/** Rewrite `latex` so every occurrence of `symbol` renders in `color`.
 *
 * Returns the source UNCHANGED when the symbol can't be matched safely, when
 * it doesn't occur, or when it occurs so often that tinting it would colour
 * most of the expression (a symbol appearing 12+ times is not a symbol being
 * pointed at — it's the expression's main variable, and lighting all of it up
 * communicates nothing). Never throws.
 *
 * `color` must be a KaTeX-acceptable colour — a `#rgb`/`#rrggbb` literal. A
 * CSS variable would not work: KaTeX resolves the colour at parse time into
 * its own inline style, so the caller reads the computed token first. */
export function highlightLatexSymbol(latex: string, symbol: string, color: string): string {
  if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color)) return latex
  let re: RegExp | null
  try {
    re = occurrenceRe(symbol)
  } catch {
    // A lookbehind-unsupported runtime, or a pathological symbol.
    return latex
  }
  if (!re) return latex

  const matches = latex.match(re)
  if (!matches || matches.length === 0 || matches.length > 12) return latex

  re.lastIndex = 0
  return latex.replace(re, (m) => `\\textcolor{${color}}{${m}}`)
}
