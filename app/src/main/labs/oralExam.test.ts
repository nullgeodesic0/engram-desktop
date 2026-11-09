import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'engram-oral-'))
const userData = join(root, 'userData')
const packDir = join(root, 'example-pack')
const EXAMPLE = resolve(__dirname, '../../../../examples/example-pack')

vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false } }))
vi.mock('./speech', () => ({
  speechReady: async () => true,
  transcribe: async () => ({ text: 'the residual is orthogonal to the columns', duration: 4 }),
}))

const { addPackFolder } = await import('./packStore')
const oral = await import('./oralExam')

beforeAll(async () => {
  cpSync(EXAMPLE, packDir, { recursive: true })
  await addPackFolder(packDir)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const PACK = 'example-pack'
const PROBLEM = 'least-squares-oral'
const SID = 'sitting-1'

type Sent = { channel: string; payload: Record<string, unknown> }
const sent: Sent[] = []
const send = (channel: string, payload: unknown) => sent.push({ channel, payload: payload as Record<string, unknown> })
const tool = (body: Record<string, unknown>) => oral.handleOralTool(SID, body, send, () => {})

async function nextAsk(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const s = sent.find((x) => x.channel === 'oral:ask' && !x.payload.seen)
    if (s) {
      s.payload.seen = true
      return String(s.payload.requestId)
    }
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('no question reached the card')
}

async function nextFinish(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const s = sent.find((x) => x.channel === 'oral:finish')
    if (s) return String(s.payload.requestId)
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('no confidence round reached the card')
}

describe('oral exams', () => {
  let exam = ''

  it('refuses a start the learner did not make in Labs', async () => {
    const r = await tool({ action: 'start', pack: PACK, problem: PROBLEM })
    expect(r.ok).toBe(false)
    expect(String(r.reason)).toContain('has not started this exam')
  })

  it('opens after the learner starts it, with the examiner’s criteria and follow-ups', async () => {
    await oral.requestOralExam(PACK, PROBLEM)
    expect((await oral.oralExamsView(PACK, PROBLEM)).pending).toBe(true)
    const r = await tool({ action: 'start', pack: PACK, problem: PROBLEM })
    expect(r.ok).toBe(true)
    exam = String(r.exam)
    const qs = r.questions as { id: string; criteria: string[]; followUps: { id: string; probes: string }[] }[]
    expect(qs.map((q) => q.id)).toEqual(['normal-equations', 'uniqueness'])
    expect(qs[0].followUps[0].probes).toBe(qs[0].criteria[1])
    expect((await oral.oralExamsView(PACK, PROBLEM)).pending).toBe(false)
    expect(sent.some((s) => s.channel === 'oral:state' && s.payload.exam === exam)).toBe(true)
    // The start is used up: a second one is refused.
    expect((await tool({ action: 'start', pack: PACK, problem: PROBLEM })).ok).toBe(false)
  })

  it('asks in order, and only the pack’s follow-ups, at most two', async () => {
    expect(String((await tool({ action: 'ask', exam, question: 'uniqueness' })).reason)).toContain('in order')
    expect(String((await tool({ action: 'finish', exam })).reason)).toContain('not yet asked')

    const first = tool({ action: 'ask', exam, question: 'normal-equations' })
    const id1 = await nextAsk()
    expect((await tool({ action: 'ask', exam, question: 'normal-equations', followUp: 'geometry' })).ok).toBe(false)
    expect((await oral.transcribeOralAnswer(id1, new Uint8Array([1, 2, 3]))).text).toContain('orthogonal')
    await expect(oral.transcribeOralAnswer(id1, new Uint8Array([1]))).rejects.toThrow('already recorded')
    await oral.answerOral(id1, 'The residual is orthogonal to the columns of A.', 75, false)
    const a1 = await first
    expect(a1.answer).toBe('The residual is orthogonal to the columns of A.')
    expect(a1.followUpsLeft).toEqual(['geometry', 'minimum'])
    expect(a1.nextQuestion).toBe('uniqueness')

    expect(
      String((await tool({ action: 'ask', exam, question: 'normal-equations', followUp: 'mine' })).reason),
    ).toContain("ask only the pack's own")
    const f1 = tool({ action: 'ask', exam, question: 'normal-equations', followUp: 'geometry' })
    await oral.answerOral(await nextAsk(), 'Every column of A.', 20, false)
    expect((await f1).followUpsLeft).toEqual(['minimum'])
    expect(
      String((await tool({ action: 'ask', exam, question: 'normal-equations', followUp: 'geometry' })).reason),
    ).toContain('asked already')
    const f2 = tool({ action: 'ask', exam, question: 'normal-equations', followUp: 'minimum' })
    await oral.answerOral(await nextAsk(), 'It is convex.', 15, false)
    expect((await f2).followUpsLeft).toEqual([])
    expect(
      String((await tool({ action: 'ask', exam, question: 'normal-equations', followUp: 'minimum' })).reason),
    ).toContain('At most')

    const second = tool({ action: 'ask', exam, question: 'uniqueness' })
    const id2 = await nextAsk()
    // No recording: the answer was typed, so every word counts as changed.
    await oral.answerOral(id2, 'When the columns are independent.', 130, true)
    const a2 = await second
    expect(a2.nextQuestion).toBeNull()
    expect(String((await tool({ action: 'ask', exam, question: 'uniqueness', followUp: 'mine' })).reason)).toBeTruthy()
  })

  it('collects every confidence, blind, before the answers go back for grading', async () => {
    const done = tool({ action: 'finish', exam })
    const id = await nextFinish()
    await expect(oral.pickOralConfidences(id, { 'normal-equations': 'Certain' })).rejects.toThrow('every question')
    await oral.pickOralConfidences(id, { 'normal-equations': 'Certain', uniqueness: 'Half unsure' })
    const r = await done
    expect(r.ok).toBe(true)
    expect(r.submission).toBe(1)
    const qs = r.questions as Record<string, unknown>[]
    expect(qs[0]).toMatchObject({ question: 'normal-equations', confidence: 90, followUps: 2, timedOut: false })
    expect(String(qs[0].production).split('\n')[0]).toBe(`[oral-check ${PACK}/${PROBLEM} exam 1 normal-equations]`)
    expect(String(qs[0].production)).toContain('Follow-up: You found a stationary point.')
    // The worst turn counts: the follow-ups were typed, with no recording.
    expect(qs[0].edited).toBe(1)
    expect(qs[1]).toMatchObject({ question: 'uniqueness', confidence: 50, followUps: 0, edited: 1, timedOut: true })

    const view = await oral.oralExamsView(PACK, PROBLEM)
    expect(view.exams).toHaveLength(1)
    expect(view.exams[0].status).toBe('done')
    expect(view.exams[0].turns).toHaveLength(4)
    expect(view.exams[0].turns[0].transcript).toContain('orthogonal')
    expect(view.exams[0].turns[0].edited).toBe(0.22)
    const onDisk = readFileSync(join(userData, 'labs', 'oral', PACK, PROBLEM, '1', '1.webm'))
    expect([...onDisk]).toEqual([1, 2, 3])
    expect(sent.some((s) => s.channel === 'oral:state' && s.payload.exam === null)).toBe(true)
  })

  it('grades nothing from an exam the learner ends early', async () => {
    await oral.requestOralExam(PACK, PROBLEM)
    const r = await tool({ action: 'start', pack: PACK, problem: PROBLEM })
    const pending = tool({ action: 'ask', exam: r.exam, question: 'normal-equations' })
    await nextAsk()
    await oral.abandonOralExam(String(r.exam))
    expect(await pending).toMatchObject({ ok: false, abandoned: true })
    const view = await oral.oralExamsView(PACK, PROBLEM)
    expect(view.exams.map((e) => [e.seq, e.status])).toEqual([
      [1, 'done'],
      [2, 'abandoned'],
    ])
  })
})
