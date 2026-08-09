import { describe, it, expect } from 'vitest'
import {
  splitAroundProbeHeader,
  endsWithBareProbeHeader,
  bareProbeHeaderExceptionApplies,
  mergeAssistantText,
  parseAllProbeHeaders,
} from './probeHeader'

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

  // These two previously asserted the OPPOSITE — that merging never inserts a
  // separator — on the premise that a merge joins mid-stream continuations of
  // one sentence. That premise was wrong, and it cost a real sitting three
  // bugs at once (see mergeAssistantText's own comment). SessionManager emits
  // one `text` event per assistant content BLOCK, never per token or partial
  // word, and the replay walk likewise merges whole blocks — so a merge always
  // joins two complete pieces of prose, and a paragraph break is what belongs
  // between them.
  it('separates two ordinary blocks with a paragraph break', () => {
    expect(mergeAssistantText('The answer starts here.', false, 'A second block.')).toBe(
      'The answer starts here.\n\nA second block.',
    )
  })

  it('separates regardless of breakBubble', () => {
    expect(mergeAssistantText('Some ordinary prose.', true, 'More prose.')).toBe(
      'Some ordinary prose.\n\nMore prose.',
    )
  })
})

describe('mergeAssistantText — blocks are paragraphs', () => {
  it('separates two blocks so a header keeps its line start', () => {
    // The 2026-08-08 regression, verbatim: bare concatenation produced
    // "close.**[2/5] · …", which parseProbeHeader cannot see.
    const merged = mergeAssistantText(
      'Back tomorrow. Stashed for the blind audit at the close.',
      false,
      '**[2/5] · interaction-picture** *(grad-quantum-mechanics)*\n\nWhy is it constructed that way?',
    )
    expect(merged).toContain('close.\n\n**[2/5]')
    expect(parseAllProbeHeaders(merged).map((h) => h.node)).toEqual(['interaction-picture'])
  })

  it('does not double up when the text already ends at a boundary', () => {
    expect(mergeAssistantText('a\n\n', false, 'b')).toBe('a\n\nb')
    expect(mergeAssistantText('a\n', false, 'b')).toBe('a\nb')
  })

  it('returns the new text unchanged when there is nothing to merge into', () => {
    expect(mergeAssistantText('', false, 'first')).toBe('first')
  })

  it('still separates after a bare probe header', () => {
    const merged = mergeAssistantText('**[1/3] · some-node**', true, 'The question body.')
    expect(merged).toBe('**[1/3] · some-node**\n\nThe question body.')
  })
})

describe('bareProbeHeaderExceptionApplies', () => {
  const BARE = '**[1/7] · scattering-cross-sections-central-force** *(grad-classical-mechanics)*'
  const one = { count: 1, interactive: false }

  it('applies to the shape it exists for — one boundary, no learner action', () => {
    // A tutor posts the header, calls render_beat once, then writes the
    // question. The question must fold back into the header's own bubble.
    expect(bareProbeHeaderExceptionApplies(BARE, one)).toBe(true)
  })

  it('does not apply once the learner has answered something', () => {
    // The checkpoint-review bug: four ask_user_question calls sat between the
    // header and the next text, and the exception merged the post-grade
    // verdict into the bubble ABOVE the checkpoint cards — so the learner
    // read the result of a question above the question itself.
    expect(bareProbeHeaderExceptionApplies(BARE, { count: 4, interactive: true })).toBe(false)
    // Interactive alone is enough, even for a single boundary.
    expect(bareProbeHeaderExceptionApplies(BARE, { count: 1, interactive: true })).toBe(false)
  })

  it('does not apply across a run of several tutor boundaries', () => {
    // More than one boundary means the tutor did several things in the gap;
    // that is not a probe posting itself.
    expect(bareProbeHeaderExceptionApplies(BARE, { count: 2, interactive: false })).toBe(false)
  })

  it('still requires the bubble to actually end with a bare header', () => {
    expect(bareProbeHeaderExceptionApplies('Just some prose.', one)).toBe(false)
    // A header that already carries its body is not "bare" — nothing to fold.
    expect(bareProbeHeaderExceptionApplies(`${BARE}\n\nThe question body.`, one)).toBe(false)
  })
})
