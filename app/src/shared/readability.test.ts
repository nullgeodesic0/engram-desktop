import { describe, it, expect } from 'vitest'
import { readabilityFindings, proseOnly, MAX_FINDINGS } from './readability'
import { lectureNotesReadabilityHold } from './lectureNotes'

const longSentence =
  'The syndrome that you measure after each round of stabilizer checks, together with the record of which ancilla qubits flipped and when they flipped during the circuit, tells the decoder where the most likely chain of errors sits on the lattice and which correction it should apply.'

describe('readabilityFindings', () => {
  it('passes plain, short prose', () => {
    const md = '# Ladder operators\n\n## The idea\n\nThe operator $a^\\dagger$ raises the energy by one quantum. You can check this on the ground state.'
    expect(readabilityFindings(md)).toEqual([])
  })

  it('flags a very long sentence with its word count', () => {
    const f = readabilityFindings(`## The idea\n\n${longSentence}`)
    expect(f).toHaveLength(1)
    expect(f[0].kind).toBe('long-sentence')
    expect(f[0].advice).toMatch(/\d+ words/)
  })

  it('counts an equation as one word and never splits on its periods', () => {
    const eq = '$$\\langle n | a^\\dagger a | n \\rangle = n. \\quad E_n = \\hbar\\omega(n + 1/2).$$'
    const md = `The number operator counts quanta. ${eq} So each level sits one quantum above the last.`
    expect(readabilityFindings(md)).toEqual([])
    expect(proseOnly(md)).toContain('[math]')
    expect(proseOnly(md)).not.toContain('hbar')
  })

  it('never judges code or inline code as prose', () => {
    const md = 'Run this:\n\n```python\n# simply obviously clearly\nx = 1\n```\n\nThe flag `--simply-clearly` is a name.'
    expect(readabilityFindings(md)).toEqual([])
  })

  it('flags forbidden words and filler frames', () => {
    const md =
      "It's important to note that the commutator vanishes. The rest simply follows. Let's delve into the proof."
    const kinds = readabilityFindings(md).map((f) => f.kind)
    expect(kinds).toEqual(['filler', 'forbidden-word', 'filler'])
  })

  it('flags a dash-heavy paragraph', () => {
    const md = 'The state — once prepared — evolves — and then decays — slowly.'
    expect(readabilityFindings(md).some((f) => f.kind === 'dashes')).toBe(true)
  })

  it('leaves headings, step labels and tables alone', () => {
    const md = '## Clearly the idea\n\n| simply | obviously |\n|---|---|\n\n**Set up:** write the state.'
    expect(readabilityFindings(md)).toEqual([])
  })

  it('does not read dollar amounts as math', () => {
    expect(proseOnly('It costs $5 and $10.')).toBe('It costs $5 and $10.')
  })

  it('returns a short list', () => {
    const md = Array.from({ length: 20 }, () => 'This simply works.').join(' ')
    expect(readabilityFindings(md)).toHaveLength(MAX_FINDINGS)
  })
})

describe('lectureNotesReadabilityHold', () => {
  const flagged = `## The idea\n\n${longSentence}`

  it('holds notes with findings back once, with instructions first', () => {
    const reasons = lectureNotesReadabilityHold({ markdown: flagged }, flagged)
    expect(reasons.length).toBe(2)
    expect(reasons[0]).toMatch(/readability_reviewed: true/)
    expect(reasons[0]).toMatch(/without changing equations, code/)
  })

  it('lets a reviewed call through even when findings remain', () => {
    expect(lectureNotesReadabilityHold({ markdown: flagged, readability_reviewed: true }, flagged)).toEqual([])
  })

  it('lets clean notes through on the first call', () => {
    const clean = '## The idea\n\nThe operator raises the energy by one quantum.'
    expect(lectureNotesReadabilityHold({ markdown: clean }, clean)).toEqual([])
  })
})
