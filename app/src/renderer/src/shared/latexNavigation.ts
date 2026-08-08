/** Caret navigation over the delimiter tree.
 *
 * `latexSyntax.ts` answers "what is here"; this answers "where would I want to
 * go next". Kept separate because they fail differently: a scanner bug shows
 * up as a wrong colour, a navigation bug shows up as the caret leaping
 * somewhere baffling, and the two are worth testing apart.
 *
 * The premise: the closers are bookkeeping (see latexEditing.ts), and so is
 * *getting past* them. Typing `\frac{a}{b}` by hand means reaching for `→`
 * three times to escape a brace you never wanted to type — or worse, reaching
 * for the mouse. An expression is a tree, so the caret should be able to move
 * through it as a tree.
 *
 * ACCESSIBILITY CONSTRAINT, load-bearing: every function here returns `null`
 * when the caret is not inside maths, and the composer only preventDefaults
 * on a non-null result. Tab therefore still moves focus out of the textarea
 * whenever you are writing prose, which is the overwhelmingly common case and
 * the only way a keyboard-only learner can leave the composer at all. A
 * navigation aid that traps focus is not an aid. */

import { scanLatex, pairAtCaret, type DelimToken } from './latexSyntax'

/** The innermost matched pair strictly containing `caret`, or null. */
function enclosingPair(tokens: DelimToken[], caret: number): { open: DelimToken; close: DelimToken } | null {
  let best: { open: DelimToken; close: DelimToken } | null = null
  for (const t of tokens) {
    if (!t.open || t.partner === null) continue
    const close = tokens[t.partner]
    if (t.end <= caret && caret <= close.start) {
      // Innermost wins: a later-starting container is nested deeper.
      if (!best || t.start > best.open.start) best = { open: t, close }
    }
  }
  return best
}

/** The math span containing `caret`, which is the boundary for "the current
 * expression". Sibling groups inside one span (`\frac{a}{b}`'s two arguments)
 * are the same expression and Tab should move between them; a different `$…$`
 * later in the message is not, and jumping there reads as the caret
 * teleporting. Using the enclosing GROUP as the boundary — the first attempt
 * — was too tight and broke exactly the `\frac` flow this exists for. */
function enclosingSpan(tokens: DelimToken[], caret: number): { open: DelimToken; close: DelimToken } | null {
  for (const t of tokens) {
    if (!t.open || t.family !== 'math' || t.partner === null) continue
    const close = tokens[t.partner]
    if (t.end <= caret && caret <= close.start) return { open: t, close }
  }
  return null
}

/** Empty groups — `{}`, `()`, `$$` with nothing between them. These are the
 * slots the editing aids leave behind (`x^{}`, `\frac{}{}`), so they are the
 * natural next stop, exactly like a snippet's tab stops. */
function emptySlots(tokens: DelimToken[]): { at: number; from: number }[] {
  const out: { at: number; from: number }[] = []
  for (const t of tokens) {
    if (!t.open || t.partner === null) continue
    const close = tokens[t.partner]
    if (t.end === close.start) out.push({ at: t.end, from: t.start })
  }
  return out
}

/** Where Tab should land, or null to let Tab do its normal job.
 *
 * The cascade, in priority order:
 *   1. the next empty slot — `\frac{a}{|}` after filling the numerator, which
 *      is the flow the auto-completions set up
 *   2. out of the enclosing group — past its closer
 *   3. out of the enclosing math span
 * Each step is "outward or onward", never backward, so repeated Tabs walk
 * predictably out of an expression and never cycle. */
export function nextStop(text: string, caret: number): number | null {
  const { tokens } = scanLatex(text)
  if (tokens.length === 0) return null

  const span = enclosingSpan(tokens, caret)
  const slot = emptySlots(tokens)
    .filter((s) => s.from >= caret)
    // Same expression only — see `enclosingSpan`.
    .filter((s) => span !== null && s.from < span.close.start)
    .sort((a, b) => a.from - b.from)[0]

  if (slot) return slot.at
  const enclosing = enclosingPair(tokens, caret)
  if (enclosing) return enclosing.close.end
  return null
}

/** Where Shift+Tab should land — the mirror image: to just before the
 * enclosing opener, or back to the previous empty slot inside it. */
export function prevStop(text: string, caret: number): number | null {
  const { tokens } = scanLatex(text)
  if (tokens.length === 0) return null

  const span = enclosingSpan(tokens, caret)
  const slot = emptySlots(tokens)
    .filter((s) => s.at < caret)
    .filter((s) => span !== null && s.from >= span.open.end)
    .sort((a, b) => b.from - a.from)[0]

  if (slot) return slot.at
  const enclosing = enclosingPair(tokens, caret)
  if (enclosing) return enclosing.open.start
  return null
}

/** The other end of the delimiter the caret is against — an editor's
 * go-to-matching-bracket. Returns null when the caret isn't on a delimiter or
 * the delimiter has no partner (nothing to jump to, and pretending otherwise
 * would move the caret somewhere arbitrary). */
export function matchingDelimiter(text: string, caret: number): number | null {
  const { tokens } = scanLatex(text)
  const pair = pairAtCaret(tokens, caret)
  if (!pair || pair.a === pair.b) return null
  const partner = tokens[pair.b]
  // Land INSIDE the expression in both directions: after an opener, before a
  // closer. Landing outside would make a second press bounce you further out
  // rather than back where you came from.
  return partner.open ? partner.end : partner.start
}

/** Progressive selection: the contents of the enclosing group, then that
 * group including its delimiters, then outward. Returns null when there is
 * nothing left to expand to.
 *
 * This is the one navigation aid that is genuinely faster than a mouse for
 * the thing people actually do to expressions — "take this subterm and wrap
 * it / replace it / cut it". Pair it with `onInsert`'s wrap-selection and
 * `\frac{a+b}{c}` becomes: expand, `(`, done. */
export function expandSelection(
  text: string,
  selStart: number,
  selEnd: number,
): { selStart: number; selEnd: number } | null {
  const { tokens } = scanLatex(text)
  if (tokens.length === 0) return null

  const enclosing = enclosingPair(tokens, selStart)
  if (!enclosing) return null

  // Already holding exactly the contents? Take the delimiters too.
  if (selStart === enclosing.open.end && selEnd === enclosing.close.start) {
    return { selStart: enclosing.open.start, selEnd: enclosing.close.end }
  }
  // Already holding the whole group? Step outward to the next container.
  if (selStart === enclosing.open.start && selEnd === enclosing.close.end) {
    const outer = enclosingPair(tokens, enclosing.open.start)
    if (!outer) return null
    return { selStart: outer.open.end, selEnd: outer.close.start }
  }
  return { selStart: enclosing.open.end, selEnd: enclosing.close.start }
}
