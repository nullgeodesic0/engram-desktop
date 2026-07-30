import { describe, it, expect } from 'vitest'
import { splitAroundProbeHeader, endsWithBareProbeHeader, mergeAssistantText } from './probeHeader'

describe('splitAroundProbeHeader', () => {
  it('parses a real Review header with a threshold dagger and no topic', () => {
    const text = '**[1/1] · commutator-uncertainty-principle †**'
    const split = splitAroundProbeHeader(text)
    expect(split).not.toBeNull()
    expect(split!.header.index).toBe(1)
    expect(split!.header.total).toBe(1)
    expect(split!.header.node).toBe('commutator-uncertainty-principle')
    expect(split!.header.threshold).toBe(true)
    expect(split!.header.topic).toBeNull()
    expect(split!.header.body).toBe('')
  })

  it('returns null for text with no header marker', () => {
    expect(splitAroundProbeHeader('just an ordinary sentence.')).toBeNull()
  })
})

describe('endsWithBareProbeHeader', () => {
  it('is true when the header is the only content', () => {
    expect(endsWithBareProbeHeader('**[1/1] · commutator-uncertainty-principle †**')).toBe(true)
  })

  it('is false once real body text follows the header', () => {
    expect(endsWithBareProbeHeader('**[1/1] · commutator-uncertainty-principle †**\n\nDerive it.')).toBe(false)
  })
})

describe('mergeAssistantText', () => {
  // Regression test for the real /review bug: a bubble ending in a bare
  // header, absorbing the text that arrives after a mark-boundary tool call
  // (render_beat), lost its own question to HEADER_RE's greedy trailing
  // pattern when the two strings were concatenated with no separator.
  it('inserts a paragraph break across the bare-header exception so the header regex terminates correctly', () => {
    const header = '**[1/1] · commutator-uncertainty-principle †**'
    const question =
      'Starting from Cauchy–Schwarz, derive the general form of the uncertainty relation between two observables $\\hat{A}$ and $\\hat{B}$ — and explain what role the commutator plays.\n\nTake your time; write as much of the chain as you can.'
    const merged = mergeAssistantText(header, true, question)

    const split = splitAroundProbeHeader(merged)
    expect(split).not.toBeNull()
    expect(split!.header.body).toBe(question)
  })

  it('never inserts a separator for ordinary mid-stream continuation (breakBubble false)', () => {
    const merged = mergeAssistantText('The answer starts here', false, ' and continues here.')
    expect(merged).toBe('The answer starts here and continues here.')
  })

  it('never inserts a separator when breakBubble is true but the previous text is not a bare header', () => {
    const merged = mergeAssistantText('Some ordinary prose.', true, ' More prose.')
    expect(merged).toBe('Some ordinary prose. More prose.')
  })
})
