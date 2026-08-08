import { describe, it, expect } from 'vitest'
import { nextStop, prevStop, matchingDelimiter, expandSelection } from './latexNavigation'

/** `|` marks the caret in the fixture; the helpers return an offset, which is
 * rendered back into the string so the assertion reads as what you'd see. */
function at(spec: string): { text: string; caret: number } {
  const i = spec.indexOf('|')
  return { text: spec.slice(0, i) + spec.slice(i + 1), caret: i }
}
function show(text: string, offset: number | null): string | null {
  return offset === null ? null : text.slice(0, offset) + '|' + text.slice(offset)
}
function tab(spec: string): string | null {
  const { text, caret } = at(spec)
  return show(text, nextStop(text, caret))
}
function shiftTab(spec: string): string | null {
  const { text, caret } = at(spec)
  return show(text, prevStop(text, caret))
}

describe('nextStop — Tab walks outward', () => {
  it('escapes the enclosing group', () => {
    expect(tab('$x^{2|}$')).toBe('$x^{2}|$')
  })

  it('then escapes the math span', () => {
    expect(tab('$x^{2}|$')).toBe('$x^{2}$|')
  })

  it('walks all the way out of a nest, one press per level', () => {
    let s: string | null = '$\\frac{a|}{b}$'
    s = tab(s)
    expect(s).toBe('$\\frac{a}|{b}$')
    // Next press leaves the span — `{b}` starts after the caret but is not
    // an empty slot, so it isn't a stop.
    expect(tab(s!)).toBe('$\\frac{a}{b}$|')
  })

  it('jumps into the next empty slot first — the \\frac flow', () => {
    expect(tab('$\\frac{a|}{}$')).toBe('$\\frac{a}{|}$')
  })

  it('does not teleport into an unrelated later expression', () => {
    // The empty `{}` belongs to a different span; Tab must leave THIS one
    // rather than leaping across the prose between them.
    expect(tab('$x^{2|}$ and later $y^{}$')).toBe('$x^{2}|$ and later $y^{}$')
  })

  it('returns null in prose, so Tab still moves focus', () => {
    expect(tab('an ordinary sentence|')).toBeNull()
    expect(tab('with (parens) too|')).toBeNull()
  })

  it('returns null outside any group, even with maths present', () => {
    expect(tab('$x$ and then|')).toBeNull()
  })
})

describe('prevStop — Shift+Tab walks back in', () => {
  it('goes to just before the enclosing opener', () => {
    expect(shiftTab('$x^{2|}$')).toBe('$x^|{2}$')
  })

  it('returns to an earlier empty slot within the same group', () => {
    expect(shiftTab('$\\frac{}{b|}$')).toBe('$\\frac{|}{b}$')
  })

  it('returns null in prose', () => {
    expect(shiftTab('just words|')).toBeNull()
  })
})

describe('matchingDelimiter', () => {
  it('jumps from an opener to inside its closer, and back', () => {
    const text = '$f(x)$'
    // caret just after '(' → lands just before ')'
    expect(show(text, matchingDelimiter(text, 3))).toBe('$f(x|)$')
    // caret just before ')' → lands just after '('
    expect(show(text, matchingDelimiter(text, 4))).toBe('$f(|x)$')
  })

  it('matches \\left with \\right', () => {
    const text = '$\\left( x \\right)$'
    const hit = matchingDelimiter(text, text.indexOf('\\left(') + 6)
    expect(hit).not.toBeNull()
    expect(text.slice(hit!)).toBe('\\right)$')
  })

  it('returns null away from a delimiter, and for an unmatched one', () => {
    const text = '$abc$'
    expect(matchingDelimiter(text, 2)).toBeNull()
    const bad = '$a(b$'
    expect(matchingDelimiter(bad, bad.indexOf('(') + 1)).toBeNull()
  })
})

describe('expandSelection', () => {
  const text = '$\\frac{a+b}{c}$'
  const numer = { start: text.indexOf('a+b'), end: text.indexOf('a+b') + 3 }

  it('takes the enclosing contents first', () => {
    const r = expandSelection(text, numer.start + 1, numer.start + 1)
    expect(text.slice(r!.selStart, r!.selEnd)).toBe('a+b')
  })

  it('then includes the delimiters', () => {
    const r = expandSelection(text, numer.start, numer.end)
    expect(text.slice(r!.selStart, r!.selEnd)).toBe('{a+b}')
  })

  it('then steps outward to the next container', () => {
    const inner = expandSelection(text, numer.start, numer.end)!
    const outer = expandSelection(text, inner.selStart, inner.selEnd)
    expect(text.slice(outer!.selStart, outer!.selEnd)).toBe('\\frac{a+b}{c}')
  })

  it('returns null in prose', () => {
    expect(expandSelection('plain text', 3, 3)).toBeNull()
  })
})
