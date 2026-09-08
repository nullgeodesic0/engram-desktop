import { describe, it, expect } from 'vitest'
import {
  assertCodexImageModel,
  buildCodexTranscriptionInput,
  buildPrompt,
  codexTranscriptionTurnError,
} from './transcribeHandwriting'

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

describe('Codex handwriting input', () => {
  it('passes pages as isolated local-image items in reading order', () => {
    expect(buildCodexTranscriptionInput(['/a/p1.jpg', '/a/p2.jpg'])).toEqual([
      { type: 'text', text: expect.stringContaining('exactly as written'), text_elements: [] },
      { type: 'localImage', path: '/a/p1.jpg' },
      { type: 'localImage', path: '/a/p2.jpg' },
    ])
  })

  it('rejects a selected text-only model before starting a paid turn', () => {
    expect(() => assertCodexImageModel([
      { value: '', label: 'Codex default', description: 'Default', inputModalities: ['text', 'image'] },
      { value: 'gpt-text', label: 'GPT Text', description: 'Text only', inputModalities: ['text'] },
    ], 'gpt-text')).toThrow('does not accept images')
  })

  it('accepts the image-capable server default', () => {
    expect(() => assertCodexImageModel([
      { value: '', label: 'Codex default', description: 'Default', inputModalities: ['text', 'image'] },
    ], '')).not.toThrow()
  })

  it('treats interrupted turns as transcription failures', () => {
    expect(codexTranscriptionTurnError({ status: 'interrupted' })?.message).toContain('interrupted')
    expect(codexTranscriptionTurnError({ status: 'completed' })).toBeNull()
  })
})
