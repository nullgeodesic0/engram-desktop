import { memo, useMemo } from 'react'
import { scanLatex, pairAtCaret, type DelimToken } from '../shared/latexSyntax'

/** Depth-coloured delimiters painted behind the composer's textarea.
 *
 * A `<textarea>` cannot colour its own contents, so this is the standard
 * mirror technique: an absolutely-positioned `<pre>` renders the same string
 * with the same metrics directly underneath a textarea whose own text is
 * transparent. The caret, selection, scrolling, IME, spellcheck and every
 * other native behaviour stay the browser's — we only paint.
 *
 * The contract that makes it work, and the reason both elements must be
 * edited together: identical font, size, line-height, letter-spacing,
 * padding, border width, and `white-space: pre-wrap` + `overflow-wrap:
 * break-word`. Any divergence shows up as text drifting out of register with
 * its own highlight, which looks broken long before it becomes unreadable.
 * `.latex-mirror` in index.css holds the shared half of that contract.
 *
 * A trailing newline gets a `\n ` guard — a `<pre>` collapses one trailing
 * newline and the textarea does not, so without it the mirror is one line
 * short exactly when you press Enter at the end. */

/** Cycled by nesting depth. Warm is depth 0 (the `$` that opens the span),
 * then cool, violet, lavender — the same four inks MarkFrame's taxonomy uses,
 * so the composer speaks the transcript's colour language rather than
 * inventing an editor palette. */
const DEPTH_INK = [
  'var(--color-ink-warm)',
  'var(--color-ink-cool)',
  'var(--color-ink-violet)',
  'var(--color-ink-lavender)',
]

function inkFor(token: DelimToken): string {
  if (token.partner === null) return 'var(--color-ink-danger)'
  return DEPTH_INK[token.depth % DEPTH_INK.length]
}

export const LatexHighlightOverlay = memo(function LatexHighlightOverlay({
  text,
  caret,
  className = '',
}: {
  text: string
  /** Caret offset, for match emphasis. `null` when the composer isn't focused
   * — an unfocused box shouldn't be glowing at a pair nobody is looking at. */
  caret: number | null
  className?: string
}) {
  const { tokens, focused } = useMemo(() => {
    const scan = scanLatex(text)
    const pair = caret === null ? null : pairAtCaret(scan.tokens, caret)
    return {
      tokens: scan.tokens,
      focused: pair ? new Set([pair.a, pair.b]) : new Set<number>(),
    }
  }, [text, caret])

  const parts = useMemo(() => {
    const out: React.ReactNode[] = []
    let at = 0
    tokens.forEach((t, i) => {
      if (t.start > at) out.push(text.slice(at, t.start))
      const emphasised = focused.has(i)
      // NOTHING HERE MAY CHANGE GLYPH METRICS. The mirror only lines up with
      // the textarea while every character occupies exactly the same advance
      // in both, and the textarea renders at the inherited weight. An earlier
      // version set `fontWeight: 700` on the matched pair (and 500 on every
      // delimiter): bold glyphs are wider, so everything after an emphasised
      // token shifted and the caret drifted off its own highlight —
      // most visibly on multi-character `\left(`/`\right)`. Emphasis is
      // therefore colour, background and an inset ring, all of which paint
      // without occupying space. `latexSyntax.test`'s metrics guard keeps it
      // that way.
      out.push(
        <span
          key={i}
          style={{
            color: inkFor(t),
            background: emphasised ? 'color-mix(in srgb, currentColor 24%, transparent)' : undefined,
            boxShadow: emphasised ? 'inset 0 0 0 1px currentColor' : undefined,
            borderRadius: emphasised ? '2px' : undefined,
          }}
        >
          {text.slice(t.start, t.end)}
        </span>,
      )
      at = t.end
    })
    if (at < text.length) out.push(text.slice(at))
    // Trailing-newline guard, applied ONLY when the text actually ends in a
    // newline: a `<pre>` drops that last empty line and a textarea keeps it,
    // so without this the mirror is one line short exactly when you press
    // Enter at the end. Appending it unconditionally was its own hazard — on
    // a final line that happens to be exactly full, the extra character wraps
    // in the mirror and not in the textarea, making the mirror taller and its
    // scroll range longer.
    if (text.endsWith('\n')) out.push(' ')
    return out
  }, [text, tokens, focused])

  return (
    <pre aria-hidden="true" className={`latex-mirror ${className}`}>
      {parts}
    </pre>
  )
})
