import { describe, it, expect } from 'vitest'
import { handwritingRequestMessage } from './handwritingRequest'

describe('handwritingRequestMessage', () => {
  it('names the files in the order they were picked', () => {
    const m = handwritingRequestMessage({ pages: ['/a/p1.jpg', '/a/p2.jpg'] })!
    expect(m).toContain('/a/p1.jpg, /a/p2.jpg')
    expect(m).toContain('2 pages in order')
  })

  it('says nothing for an empty selection', () => {
    expect(handwritingRequestMessage({ pages: [] })).toBeNull()
  })

  it('always carries the three clauses the doctrine pin rests on', () => {
    const m = handwritingRequestMessage({ pages: ['/x.png'] })!
    // Verbatim, errors included — the clause that stops a tutor which knows
    // the answer from quietly repairing a sign on its way past.
    expect(m).toContain('exactly as written, including any errors')
    // Through a subagent given only the paths.
    expect(m).toContain('subagent given only the image paths')
    // And the attestation gate.
    expect(m).toContain('before it counts as my answer')
  })

  it('never mentions the node, the claim or how to grade', () => {
    const m = handwritingRequestMessage({ pages: ['/x.png'] })!.toLowerCase()
    for (const forbidden of ['rubric', 'claim', 'grade', 'rate', 'correct answer', 'node']) {
      expect(m, forbidden).not.toContain(forbidden)
    }
  })

  it('stays inside the doctrine collector net (single line, no backticks)', () => {
    const m = handwritingRequestMessage({ pages: ['/x.png'] })!
    expect(m).not.toContain('`')
    expect(m).not.toContain('\n')
  })
})
