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
    expect(render('$f(x)$', 3)).toContain('font-weight:700')
    expect(render('$f(x)$', null)).not.toContain('font-weight:700')
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
