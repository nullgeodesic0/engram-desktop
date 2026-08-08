import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LatexHighlightOverlay } from './LatexHighlightOverlay'

/** Static-render checks on the mirror. The alignment contract itself can only
 * be verified visually, but everything about WHAT gets coloured is data. */
const render = (text: string, caret: number | null = null) =>
  renderToStaticMarkup(<LatexHighlightOverlay text={text} caret={caret} />)

describe('LatexHighlightOverlay', () => {
  it('reproduces the source text exactly', () => {
    const src = 'For $r<a$ we get $E=\\frac{Ar^2}{4}$ (SI).'
    const html = render(src)
    // Strip tags and the trailing-newline guard; what remains must be the
    // input, or the mirror and the textarea disagree about their contents.
    const text = html.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    expect(text.trimEnd()).toBe(src.trimEnd())
  })

  it('reproduces a real derivation byte for byte, including long unbroken runs', () => {
    // The text that surfaced the wrap-contract bug: ~90-character runs with
    // no space to break at. If the mirror ever drops or adds a character the
    // highlight cannot line up, whatever the CSS says.
    const src = '$$= \\frac{A^{N}}{h^{2N}N!}\\frac{\\pi^{N}}{\\Gamma{\\left(N+1 \\right)}}\\left(2mE \\right)^{N}$$'
    const text = render(src)
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    expect(text).toBe(src)
  })

  it('adds the trailing-line guard only when the text ends in a newline', () => {
    const inner = (src: string) => render(src).replace(/^<pre[^>]*>/, '').replace(/<\/pre>$/, '').replace(/<[^>]*>/g, '')
    // No guard on ordinary text — an unconditional one can wrap on a final
    // line that is exactly full, making the mirror taller than the textarea.
    expect(inner('$x$')).toBe('$x$')
    // With a trailing newline the guard is required: <pre> drops that empty
    // last line, a textarea keeps it.
    expect(inner('$x$\n')).toBe('$x$\n ')
  })

  it('colours nested delimiters by depth', () => {
    const html = render('$\\frac{a}{b(c)}$')
    expect(html).toContain('var(--color-ink-warm)')
    expect(html).toContain('var(--color-ink-cool)')
    expect(html).toContain('var(--color-ink-violet)')
  })

  it('colours an unmatched delimiter as danger', () => {
    expect(render('$a(b$')).toContain('var(--color-ink-danger)')
    expect(render('$a(b)$')).not.toContain('var(--color-ink-danger)')
  })

  it('emphasises the pair at the caret, and only when focused', () => {
    // caret just after the '(' in `$f(x)$`
    expect(render('$f(x)$', 3)).toContain('box-shadow')
    expect(render('$f(x)$', null)).not.toContain('box-shadow')
  })

  it('NEVER emits a style that changes glyph metrics', () => {
    // The mirror aligns with the textarea only while every character takes the
    // same advance in both. Bold emphasis broke this: wider glyphs pushed
    // everything after them and the caret drifted off its own highlight.
    // Any property here that affects advance width is the same bug again.
    const samples = [
      render('$\\left( x \\right)$', 7),
      render('$\\frac{a}{b(c)}$', 8),
      render('$a(b$'),
      render('plain prose'),
    ]
    for (const html of samples) {
      for (const banned of ['font-weight', 'font-size', 'font-family', 'letter-spacing', 'font-style', 'text-transform', 'word-spacing']) {
        expect(html, banned).not.toContain(banned)
      }
    }
  })

  it('colours \\left and \\right including the word', () => {
    const html = render('$\\left( x \\right)$')
    expect(html).toContain('\\left(')
    expect(html).toContain('\\right)')
  })

  it('paints nothing in plain prose', () => {
    const html = render('An ordinary sentence (with an aside).')
    expect(html).not.toContain('var(--color-ink-cool)')
    expect(html).not.toContain('var(--color-ink-danger)')
  })

  it('is hidden from assistive tech — the textarea is the real content', () => {
    expect(render('$x$')).toContain('aria-hidden="true"')
  })
})
