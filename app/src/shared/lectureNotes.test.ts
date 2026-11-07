import { describe, it, expect } from 'vitest'
import { validateLectureNotes, countPdfPages, isValidNotesId, lectureNotesPrintHtml } from './lectureNotes'
import { lectureNotesElectedInTranscript, LECTURE_NOTES_ON, LECTURE_NOTES_OFF, lectureNotesReadMessage } from './lectureNotesKickoff'
import { bridgeUiIntent } from './bridgeUiIntents'
import { deriveRitualMarks } from './ritualFromTranscript'

const body = '# Limits\n\n*Calculus · concept 2 of 9*\n\n## The idea\n\n' + 'You read a limit as the value $f(x)$ approaches. '.repeat(8)

describe('validateLectureNotes', () => {
  it('accepts well-formed notes', () => {
    const r = validateLectureNotes({ topic: 'calculus', node: 'limits', title: 'Limits', markdown: body })
    expect(r.ok).toBe(true)
  })

  it('refuses ids that could escape the store directory', () => {
    for (const node of ['../etc', 'a/b', 'Limits', '', 'x'.repeat(200)]) {
      expect(isValidNotesId(node)).toBe(false)
      const r = validateLectureNotes({ topic: 'calculus', node, title: 'Limits', markdown: body })
      expect(r.ok).toBe(false)
    }
  })

  it('refuses empty, too-short or too-long notes with reasons', () => {
    for (const markdown of ['', 'short', 'x'.repeat(30000)]) {
      const r = validateLectureNotes({ topic: 'calculus', node: 'limits', title: 'Limits', markdown })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reasons.length).toBeGreaterThan(0)
    }
  })

  it('never throws on garbage', () => {
    for (const g of [null, undefined, 42, 'x', [], { topic: 1 }]) {
      expect(() => validateLectureNotes(g)).not.toThrow()
      expect(validateLectureNotes(g).ok).toBe(false)
    }
  })
})

describe('countPdfPages', () => {
  it('counts page objects, not the page tree', () => {
    const pdf = '<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type /Page /Parent 1 0 R >>'
    expect(countPdfPages(pdf)).toBe(2)
  })
})

describe('lectureNotesPrintHtml', () => {
  it('renders the notes, the topic header and math', () => {
    const html = lectureNotesPrintHtml({ title: 'Limits', markdown: body, writtenAt: '2026-11-07T00:00:00Z' }, 'Calculus', '')
    expect(html).toContain('Calculus')
    expect(html).toContain('<h1')
    expect(html).toContain('katex')
  })
})

describe('lecture-notes election in the transcript', () => {
  const user = (text: string) => ({ type: 'user', message: { content: [{ type: 'text', text }] } })

  it('is null when the learner never said anything about it', () => {
    expect(lectureNotesElectedInTranscript([user('/learn calculus')])).toBeNull()
  })

  it('the latest declaration wins', () => {
    expect(lectureNotesElectedInTranscript([user(`/learn calculus\n\n${LECTURE_NOTES_ON}`)])).toBe(true)
    expect(lectureNotesElectedInTranscript([user(LECTURE_NOTES_ON), user(`${LECTURE_NOTES_OFF}\n\nok`)])).toBe(false)
  })

  it('ignores the tutor quoting the sentence back', () => {
    const assistant = { type: 'assistant', message: { content: [{ type: 'text', text: LECTURE_NOTES_ON }] } }
    expect(lectureNotesElectedInTranscript([assistant])).toBeNull()
  })

  it('the read message names the notes', () => {
    expect(lectureNotesReadMessage('Limits')).toContain('Limits')
  })
})

describe('publish_lecture_notes in the UI router and the replay', () => {
  it('routes to a lecture-notes intent without the markdown', () => {
    expect(bridgeUiIntent('publish_lecture_notes', { topic: 'calculus', node: 'limits', title: 'Limits' })).toEqual({
      kind: 'lecture-notes', topic: 'calculus', node: 'limits', title: 'Limits',
    })
    expect(bridgeUiIntent('publish_lecture_notes', { topic: 'calculus' })).toBeNull()
  })

  const call = (id: string) => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'mcp__engram-ui-bridge__publish_lecture_notes', input: { topic: 'calculus', node: 'limits', title: 'Limits', markdown: body } }] },
  })
  const result = (id: string, accepted: boolean) => ({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify({ accepted, reasons: accepted ? [] : ['too short'] }) }] },
  })

  it('replays an accepted call as a notes card', () => {
    const marks = deriveRitualMarks([call('t1'), result('t1', true)])
    const m = marks.find((x) => x.kind === 'lecture-notes')
    expect(m).toMatchObject({ kind: 'lecture-notes', node: 'limits', accepted: true })
  })

  it('marks a refused call so no card is drawn for it', () => {
    const marks = deriveRitualMarks([call('t2'), result('t2', false)])
    expect(marks.find((x) => x.kind === 'lecture-notes')).toMatchObject({ accepted: false })
  })
})
