import { describe, it, expect } from 'vitest'
import { highlightLatexSymbol } from './latexHighlight'

const C = '#e8a857'
const wrap = (s: string) => `\\textcolor{${C}}{${s}}`

describe('highlightLatexSymbol — control sequences', () => {
  it('tints every occurrence of a command', () => {
    expect(highlightLatexSymbol('Z = \\sum e^{-\\beta E}, \\beta > 0', '\\beta', C)).toBe(
      `Z = \\sum e^{-${wrap('\\beta')} E}, ${wrap('\\beta')} > 0`,
    )
  })

  it('does not match a longer command that starts with the same letters', () => {
    // `\be` must not fire inside `\beta`.
    expect(highlightLatexSymbol('\\beta + \\be', '\\be', C)).toBe(`\\beta + ${wrap('\\be')}`)
  })
})

describe('highlightLatexSymbol — bare identifiers', () => {
  it('tints a standalone letter', () => {
    expect(highlightLatexSymbol('E = mc^2', 'E', C)).toBe(`${wrap('E')} = mc^2`)
  })

  it('never matches inside a control sequence', () => {
    // The regression this guard exists for: a naive replace produces
    // `\textcolor{..}{E}psilon`, which is a different expression.
    expect(highlightLatexSymbol('\\Epsilon + \\exp(E)', 'E', C)).toBe(`\\Epsilon + \\exp(${wrap('E')})`)
  })

  it('never matches inside a word', () => {
    expect(highlightLatexSymbol('Q_{\\text{Enc}} + E', 'E', C)).toBe(`Q_{\\text{Enc}} + ${wrap('E')}`)
  })

  it('allows a preceding digit or operator', () => {
    expect(highlightLatexSymbol('2E + 3E', 'E', C)).toBe(`2${wrap('E')} + 3${wrap('E')}`)
  })

  it('handles a subscripted identifier', () => {
    expect(highlightLatexSymbol('k_B T', 'k_B', C)).toBe(`${wrap('k_B')} T`)
  })
})

describe('highlightLatexSymbol — declines rather than guesses', () => {
  it('leaves the source alone when the symbol is absent', () => {
    const src = 'E = mc^2'
    expect(highlightLatexSymbol(src, '\\mu', C)).toBe(src)
  })

  it('leaves the source alone for an unanchorable symbol', () => {
    const src = 'a + b'
    for (const sym of ['', '   ', '\\', '{', '_']) {
      expect(highlightLatexSymbol(src, sym, C)).toBe(src)
    }
  })

  it('leaves the source alone when the symbol saturates the expression', () => {
    // 13 occurrences — tinting all of them says nothing.
    const src = Array.from({ length: 13 }, () => 'x').join(' + ')
    expect(highlightLatexSymbol(src, 'x', C)).toBe(src)
    // 12 is still a legitimate pointing gesture.
    const twelve = Array.from({ length: 12 }, () => 'x').join(' + ')
    expect(highlightLatexSymbol(twelve, 'x', C)).toContain('\\textcolor')
  })

  it('rejects a colour KaTeX would not accept', () => {
    const src = 'E = mc^2'
    for (const bad of ['var(--color-ink-warm)', 'red', '#12', 'rgb(1,2,3)', '#e8a85']) {
      expect(highlightLatexSymbol(src, 'E', bad)).toBe(src)
    }
    expect(highlightLatexSymbol(src, 'E', '#fff')).toContain('\\textcolor{#fff}')
  })

  it('never throws on adversarial input', () => {
    const nasty = ['\\frac{1}{2}', '(((', '$$$', '\\begin{pmatrix}a\\end{pmatrix}', 'a'.repeat(5000)]
    for (const s of nasty) for (const sym of nasty) {
      expect(() => highlightLatexSymbol(s, sym, C)).not.toThrow()
    }
  })
})
