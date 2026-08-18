import { describe, it, expect } from 'vitest'
import { buildPrompt } from './transcribeHandwriting'

describe('transcribeHandwriting buildPrompt', () => {
  it('lists the files in order', () => {
    const p = buildPrompt(['/a/p1.jpg', '/a/p2.jpg'])
    expect(p).toContain('1. /a/p1.jpg')
    expect(p).toContain('2. /a/p2.jpg')
  })

  it('carries every clause the doctrine pin rests on', () => {
    const p = buildPrompt(['/x.png'])
    // Verbatim, errors included — stops the process from quietly repairing
    // a sign on its way past.
    expect(p).toContain('exactly as written')
    expect(p).toContain('including any errors')
    expect(p).toContain('do not correct, complete, or improve anything')
    // Delimiters, so the transcription renders as maths.
    expect(p).toContain('$...$')
    expect(p).toContain('$$...$$')
    // Withholds judgement — this process never sees a rubric to judge by
    // anyway, but the instruction still has to say so.
    expect(p).toContain('no commentary on whether anything is right or wrong')
  })

  it('never mentions a node, a claim, a rubric, or grading — this process gets no topic context at all', () => {
    const p = buildPrompt(['/x.png']).toLowerCase()
    for (const forbidden of ['rubric', 'claim', 'grade', 'correct answer', 'node', 'topic']) {
      expect(p, forbidden).not.toContain(forbidden)
    }
  })
})
