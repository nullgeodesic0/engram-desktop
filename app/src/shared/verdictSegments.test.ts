import { describe, it, expect } from 'vitest'
import { segmentVerdictText, parseVerdictHint } from './verdictSegments'

describe('segmentVerdictText', () => {
  it('classifies a marker-led canonical reveal via the regex path (no hints needed)', () => {
    const segments = segmentVerdictText('Canonical: the answer is 42.')
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('canonical')
  })

  it('leaves a marker-less reveal as plain prose when no hint is given — the corpus-measured 66% recall miss this module\'s doctrine comment documents', () => {
    const segments = segmentVerdictText('The answer, as it turns out, is 42.')
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('prose')
  })

  it('reclassifies that same marker-less paragraph as canonical when report_verdict supplied a matching hint', () => {
    const text = 'The answer, as it turns out, is 42.'
    const segments = segmentVerdictText(text, [{ kind: 'canonical', text }])
    expect(segments).toHaveLength(1)
    expect(segments[0].kind).toBe('canonical')
    if (segments[0].kind === 'canonical') {
      expect(segments[0].body).toBe(text)
    }
  })

  it('never lets a hint override a paragraph the regex already classified differently', () => {
    // A rating declaration with a (mismatched) canonical hint attached —
    // the regex match must win; hints only ever promote an otherwise-prose
    // paragraph, never reclassify an already-recognized one.
    const text = 'Rating **good**'
    const segments = segmentVerdictText(text, [{ kind: 'canonical', text }])
    expect(segments[0].kind).toBe('rating')
  })

  it('is byte-conservative regardless of hints (the invariant every caller relies on)', () => {
    const text = 'Some prose.\n\nMore prose that happens to match a hint.'
    const hints = [{ kind: 'confidence' as const, text: 'More prose that happens to match a hint.' }]
    const segments = segmentVerdictText(text, hints)
    expect(segments.map((s) => s.raw).join('')).toBe(text)
  })
})

describe('parseVerdictHint', () => {
  it('accepts a well-formed report_verdict payload', () => {
    const hint = parseVerdictHint({ kind: 'canonical', text: 'the answer is 42' })
    expect(hint).toEqual({ kind: 'canonical', text: 'the answer is 42' })
  })

  it('rejects an unknown kind', () => {
    expect(parseVerdictHint({ kind: 'bogus', text: 'x' })).toBeNull()
  })

  it('rejects missing/empty text', () => {
    expect(parseVerdictHint({ kind: 'canonical', text: '' })).toBeNull()
    expect(parseVerdictHint({ kind: 'canonical' })).toBeNull()
  })

  it('rejects non-object input', () => {
    expect(parseVerdictHint(null)).toBeNull()
    expect(parseVerdictHint('canonical')).toBeNull()
  })
})
