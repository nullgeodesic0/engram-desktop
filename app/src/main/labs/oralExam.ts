import { app } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Confidence, isConfidence } from '../../shared/labs'
import {
  ORAL_ANSWER_MAX,
  ORAL_REQUEST_TTL_MS,
  type OralAskRequest,
  type OralExamRecord,
  type OralExamsView,
  type OralFinishRequest,
  type OralState,
  type OralTurn,
  editShare,
  formatSeconds,
} from '../../shared/oral'
import { MAX_FOLLOW_UPS, type OralProblem } from '../../shared/problems'
import { isValidSlug } from '../../shared/runtime'
import type { OralKey } from './problemKey'
import { type LoadedProblem, findProblem, readKey } from './problemStore'
import { speechReady, transcribe } from './speech'

/**
 * Oral exams, main side. The exam runs in a Learn sitting: the tutor, as
 * examiner, drives it through the oral_exam bridge tool (start, ask, finish),
 * and the learner answers each question aloud on a card the renderer shows.
 * This module holds the exam's state, enforces its order, transcribes each
 * answer through the speech layer, and keeps the record under app userData:
 *
 *   labs/oral/<pack>/<problem>/exams.json     every exam: turns, transcripts, picks
 *   labs/oral/<pack>/<problem>/<seq>/<n>.webm  the recorded answers
 *
 * What it enforces, so the protocol does not rest on the tutor's word alone:
 *   - an exam starts only after the learner pressed Start in Labs, for that problem;
 *   - questions go in the pack's order, each once; follow-ups only on the
 *     current question, from the pack's list, at most two, each once;
 *   - one turn open at a time; the transcript the speech layer produced is
 *     kept beside the one the learner confirmed, with the share of words changed;
 *   - the confidence for every question is picked before any answer goes
 *     back to the tutor for grading.
 *
 * Doctrine: a pinned writer (D2), to app userData only, and an answer reader
 * (D4) of the pack's key through problemKey.ts, whose criteria go to the
 * examiner at start. Nothing here reads or writes the learning home.
 */

type Send = (channel: string, payload: unknown) => void

interface Running {
  record: OralExamRecord
  pack: string
  problem: string
  p: LoadedProblem & { manifest: OralProblem }
  key: OralKey
  send: Send
  /** The turn on screen now, if any. */
  open: {
    requestId: string
    turn: OralTurn
    resolve: (r: Record<string, unknown>) => void
    transcribing: boolean
  } | null
  finishing: { requestId: string; resolve: (r: Record<string, unknown>) => void } | null
}

const pendingStarts = new Map<string, number>()
const running = new Map<string, Running>()

function recordsDir(pack: string, problem: string): string {
  if (!isValidSlug(pack) || !isValidSlug(problem)) throw new Error('That is not a problem.')
  return join(app.getPath('userData'), 'labs', 'oral', pack, problem)
}

async function readExams(dir: string): Promise<OralExamRecord[]> {
  try {
    const f = JSON.parse(await readFile(join(dir, 'exams.json'), 'utf-8')) as { exams?: OralExamRecord[] }
    return Array.isArray(f.exams) ? f.exams : []
  } catch {
    return []
  }
}

const locks = new Map<string, Promise<unknown>>()
function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const next = (locks.get(dir) ?? Promise.resolve()).then(fn)
  locks.set(
    dir,
    next.catch(() => {}),
  )
  return next
}

/** Writes one exam's record into the problem's exams.json. */
async function save(pack: string, problem: string, record: OralExamRecord): Promise<void> {
  const dir = recordsDir(pack, problem)
  await withLock(dir, async () => {
    const exams = await readExams(dir)
    const i = exams.findIndex((e) => e.id === record.id)
    if (i >= 0) exams[i] = record
    else exams.push(record)
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'exams.json')
    const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    await writeFile(tmp, JSON.stringify({ exams }, null, 2), 'utf-8')
    await rename(tmp, path)
  })
}

async function loadOral(pack: string, problem: string): Promise<{ p: Running['p']; key: OralKey }> {
  const p = await findProblem(pack, problem)
  if (p.manifest.type !== 'oral') throw new Error(`${p.manifest.title} is not an oral exam.`)
  const key = await readKey(p)
  if (key.type !== 'oral') throw new Error(`The key of ${p.manifest.title} is not an oral exam's.`)
  return { p: p as Running['p'], key }
}

// ---------------------------------------------------------------------------
// The learner's side (IPC)
// ---------------------------------------------------------------------------

/** The learner's Start in Labs. The tutor can open this exam, in any sitting, for the next two hours. */
export async function requestOralExam(pack: string, problem: string): Promise<{ title: string }> {
  const { p } = await loadOral(pack, problem)
  if (!(await speechReady()))
    throw new Error(
      'Install the Speech layer in Settings → Code runtime first: answers are transcribed on this machine.',
    )
  for (const r of running.values())
    if (r.pack === pack && r.problem === problem) throw new Error('This exam is already running in a sitting.')
  pendingStarts.set(`${pack}/${problem}`, Date.now())
  return { title: p.manifest.title }
}

export async function oralExamsView(pack: string, problem: string): Promise<OralExamsView> {
  await loadOral(pack, problem)
  const at = pendingStarts.get(`${pack}/${problem}`)
  return {
    exams: await readExams(recordsDir(pack, problem)),
    speechReady: await speechReady(),
    pending: at !== undefined && Date.now() - at < ORAL_REQUEST_TTL_MS,
  }
}

function turnNumber(r: Running): number {
  return r.record.turns.length
}

/** Saves the recording of the open turn and transcribes it. One recording per turn. */
export async function transcribeOralAnswer(requestId: string, audio: Uint8Array): Promise<{ text: string }> {
  const r = [...running.values()].find((x) => x.open?.requestId === requestId)
  if (!r || !r.open) throw new Error('That question is no longer open.')
  // One recording per turn: a retry is allowed only when the last transcription failed.
  if (r.open.turn.transcript || r.open.transcribing) throw new Error('This answer is already recorded.')
  if (audio.byteLength === 0) throw new Error('The recording is empty.')
  if (audio.byteLength > 60 * 1024 * 1024) throw new Error('The recording is too long to keep.')
  r.open.transcribing = true
  try {
    const dir = join(recordsDir(r.pack, r.problem), String(r.record.seq))
    await mkdir(dir, { recursive: true })
    const name = `${turnNumber(r) + 1}.webm`
    const file = join(dir, name)
    await writeFile(file, audio)
    r.open.turn.audio = name
    const t = await transcribe(file, r.open.turn.prompt.replace(/\$+/g, ''))
    r.open.turn.transcript = t.text
    return { text: t.text }
  } finally {
    if (r.open) r.open.transcribing = false
  }
}

/** The learner confirms the open turn's answer. `confirmed` is the transcript as corrected. */
export async function answerOral(
  requestId: string,
  confirmed: string,
  seconds: number,
  timedOut: boolean,
): Promise<void> {
  const r = [...running.values()].find((x) => x.open?.requestId === requestId)
  if (!r || !r.open) throw new Error('That question is no longer open.')
  if (r.open.transcribing) throw new Error('Wait for the transcript first.')
  const text = String(confirmed ?? '').trim()
  if (text.length > ORAL_ANSWER_MAX) throw new Error(`Keep the answer under ${ORAL_ANSWER_MAX} characters.`)
  const turn = r.open.turn
  turn.confirmed = text
  turn.edited = Math.round(editShare(turn.transcript, text) * 100) / 100
  turn.seconds = Math.max(0, Math.min(turn.limit + 30, Math.round(Number(seconds) || 0)))
  turn.timedOut = timedOut === true
  turn.answeredAt = new Date().toISOString()
  r.record.turns.push(turn)
  const resolve = r.open.resolve
  r.open = null
  await save(r.pack, r.problem, r.record)
  const qi = r.p.manifest.questions.findIndex((q) => q.id === turn.questionId)
  const asked = r.record.turns.filter((t) => t.questionId === turn.questionId && t.followUpId).map((t) => t.followUpId)
  const left = (r.key.questions[turn.questionId]?.followUps ?? []).filter((f) => !asked.includes(f.id))
  resolve({
    ok: true,
    question: turn.questionId,
    followUp: turn.followUpId,
    answer: text || '(no answer given)',
    spokenFor: formatSeconds(turn.seconds),
    timedOut: turn.timedOut,
    followUpsLeft: Math.max(0, MAX_FOLLOW_UPS - asked.length) > 0 ? left.map((f) => f.id) : [],
    nextQuestion: r.p.manifest.questions[qi + 1]?.id ?? null,
  })
}

/** The confidence round. Every question needs a pick. */
export async function pickOralConfidences(requestId: string, picks: Record<string, unknown>): Promise<void> {
  const r = [...running.values()].find((x) => x.finishing?.requestId === requestId)
  if (!r || !r.finishing) throw new Error('That exam is not waiting for confidence picks.')
  const out: Record<string, Confidence> = {}
  for (const q of r.p.manifest.questions) {
    const v = picks?.[q.id]
    if (!isConfidence(v)) throw new Error('Pick a confidence for every question.')
    out[q.id] = v
  }
  r.record.confidences = out
  r.record.status = 'done'
  r.record.endedAt = new Date().toISOString()
  const resolve = r.finishing.resolve
  r.finishing = null
  await save(r.pack, r.problem, r.record)
  end(r)
  resolve(results(r))
}

/** The learner ends the exam early. What was answered is kept; nothing is graded. */
export async function abandonOralExam(exam: string): Promise<void> {
  const r = running.get(exam)
  if (!r) return
  r.record.status = 'abandoned'
  r.record.endedAt = new Date().toISOString()
  await save(r.pack, r.problem, r.record)
  const reply = {
    ok: false,
    abandoned: true,
    reason: 'The learner ended the exam. Grade nothing from it; ask how they would like to go on.',
  }
  r.open?.resolve(reply)
  r.finishing?.resolve(reply)
  r.open = null
  r.finishing = null
  end(r)
}

function end(r: Running): void {
  running.delete(r.record.id)
  r.send('oral:state', {
    sessionId: r.record.sessionId,
    exam: null,
    title: r.p.manifest.title,
    pack: r.pack,
    problem: r.problem,
  } satisfies OralState)
}

/** A sitting's process died: its exam cannot go on. */
export function dropOralSession(sessionId: string): void {
  for (const r of [...running.values()]) if (r.record.sessionId === sessionId) void abandonOralExam(r.record.id)
}

// ---------------------------------------------------------------------------
// The examiner's side (the oral_exam bridge tool)
// ---------------------------------------------------------------------------

const CONFIDENCE_VALUE: Record<Confidence, number> = {
  Certain: 90,
  'Pretty sure': 70,
  'Half unsure': 50,
  'Just guessing': 25,
}

function results(r: Running): Record<string, unknown> {
  const m = r.p.manifest
  return {
    ok: true,
    done: true,
    exam: r.record.id,
    pack: r.pack,
    problem: r.problem,
    title: m.title,
    topic: m.topic,
    node: m.node,
    submission: r.record.seq,
    questions: m.questions.map((q) => {
      const turns = r.record.turns.filter((t) => t.questionId === q.id)
      const lines = [`[oral-check ${r.pack}/${r.problem} exam ${r.record.seq} ${q.id}]`]
      for (const t of turns) {
        lines.push(t.followUpId ? `Follow-up: ${t.prompt}` : `Question: ${t.prompt}`)
        lines.push(`My answer, spoken (${formatSeconds(t.seconds)}${t.timedOut ? ', cut off at the time limit' : ''}):`)
        lines.push(t.confirmed || '(no answer given)')
      }
      const conf = r.record.confidences?.[q.id]
      return {
        question: q.id,
        prompt: q.prompt,
        production: lines.join('\n'),
        criteria: r.key.questions[q.id]?.criteria ?? [],
        confidence: conf ? CONFIDENCE_VALUE[conf] : null,
        followUps: turns.filter((t) => t.followUpId).length,
        edited: Math.max(0, ...turns.map((t) => t.edited)),
        timedOut: turns.some((t) => t.timedOut),
      }
    }),
  }
}

function examFor(sessionId: string, exam: unknown): Running {
  const r = running.get(String(exam ?? ''))
  if (!r || r.record.sessionId !== sessionId) throw new Error('No exam with that id is running in this sitting.')
  return r
}

async function start(sessionId: string, body: Record<string, unknown>, send: Send): Promise<Record<string, unknown>> {
  const pack = String(body.pack ?? '')
  const problem = String(body.problem ?? '')
  const at = pendingStarts.get(`${pack}/${problem}`)
  if (at === undefined || Date.now() - at > ORAL_REQUEST_TTL_MS)
    throw new Error(
      'The learner has not started this exam in Labs. An oral exam opens only from their own Start: do not begin one.',
    )
  for (const r of running.values())
    if (r.record.sessionId === sessionId) throw new Error('An exam is already running in this sitting.')
  const { p, key } = await loadOral(pack, problem)
  pendingStarts.delete(`${pack}/${problem}`)
  const dir = recordsDir(pack, problem)
  const seq = (await readExams(dir)).reduce((n, e) => Math.max(n, e.seq), 0) + 1
  const record: OralExamRecord = {
    id: randomUUID(),
    seq,
    sessionId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: 'running',
    turns: [],
    confidences: null,
  }
  const r: Running = { record, pack, problem, p, key, send, open: null, finishing: null }
  running.set(record.id, r)
  await save(pack, problem, record)
  send('oral:state', { sessionId, exam: record.id, title: p.manifest.title, pack, problem } satisfies OralState)
  return {
    ok: true,
    exam: record.id,
    title: p.manifest.title,
    topic: p.manifest.topic,
    node: p.manifest.node,
    intro: p.manifest.prompt,
    questions: p.manifest.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      seconds: q.seconds,
      criteria: key.questions[q.id].criteria,
      followUps: key.questions[q.id].followUps.map((f) => ({
        id: f.id,
        prompt: f.prompt,
        probes: f.probes === null ? null : key.questions[q.id].criteria[f.probes],
      })),
    })),
  }
}

async function ask(sessionId: string, body: Record<string, unknown>, onClose: (fn: () => void) => void) {
  const r = examFor(sessionId, body.exam)
  if (r.open || r.finishing) throw new Error('A question is already open. Wait for its answer.')
  const qs = r.p.manifest.questions
  const mains = r.record.turns.filter((t) => !t.followUpId).map((t) => t.questionId)
  const question = String(body.question ?? '')
  const followUp = body.followUp === undefined || body.followUp === null ? null : String(body.followUp)
  const qi = qs.findIndex((q) => q.id === question)
  if (qi < 0) throw new Error(`There is no question ${question} in this exam.`)
  let prompt: string
  if (followUp === null) {
    const next = qs[mains.length]
    if (!next) throw new Error('Every question has been asked. Call finish.')
    if (next.id !== question) throw new Error(`Ask the questions in order: the next one is ${next.id}.`)
    prompt = next.prompt
  } else {
    if (mains[mains.length - 1] !== question)
      throw new Error('A follow-up goes on the question just answered, and only before the next question.')
    const asked = r.record.turns.filter((t) => t.questionId === question && t.followUpId).map((t) => t.followUpId)
    if (asked.length >= MAX_FOLLOW_UPS) throw new Error(`At most ${MAX_FOLLOW_UPS} follow-ups on one question.`)
    if (asked.includes(followUp)) throw new Error('That follow-up has been asked already.')
    const f = r.key.questions[question].followUps.find((x) => x.id === followUp)
    if (!f) throw new Error(`Question ${question} has no follow-up ${followUp}: ask only the pack's own.`)
    prompt = f.prompt
  }
  const requestId = randomUUID()
  const turn: OralTurn = {
    questionId: question,
    followUpId: followUp,
    prompt,
    askedAt: new Date().toISOString(),
    answeredAt: null,
    seconds: 0,
    limit: qs[qi].seconds,
    timedOut: false,
    transcript: '',
    confirmed: '',
    edited: 0,
    audio: null,
  }
  const reply = await new Promise<Record<string, unknown>>((resolve) => {
    r.open = { requestId, turn, resolve, transcribing: false }
    onClose(() => {
      if (r.open?.requestId === requestId) {
        r.open = null
        r.send('oral:ask-dropped', { sessionId, requestId })
      }
    })
    void speechReady().then((ready) =>
      r.send('oral:ask', {
        sessionId,
        requestId,
        exam: r.record.id,
        title: r.p.manifest.title,
        kind: followUp ? 'follow-up' : 'question',
        questionId: question,
        followUpId: followUp,
        index: qi + 1,
        total: qs.length,
        prompt,
        seconds: qs[qi].seconds,
        speechReady: ready,
      } satisfies OralAskRequest),
    )
  })
  return reply
}

async function finish(sessionId: string, body: Record<string, unknown>, onClose: (fn: () => void) => void) {
  const r = examFor(sessionId, body.exam)
  if (r.open || r.finishing) throw new Error('A question is still open.')
  const mains = new Set(r.record.turns.filter((t) => !t.followUpId).map((t) => t.questionId))
  const missing = r.p.manifest.questions.filter((q) => !mains.has(q.id)).map((q) => q.id)
  if (missing.length) throw new Error(`Ask every question first: ${missing.join(', ')} not yet asked.`)
  const requestId = randomUUID()
  return new Promise<Record<string, unknown>>((resolve) => {
    r.finishing = { requestId, resolve }
    onClose(() => {
      if (r.finishing?.requestId === requestId) {
        r.finishing = null
        r.send('oral:ask-dropped', { sessionId, requestId })
      }
    })
    r.send('oral:finish', {
      sessionId,
      requestId,
      exam: r.record.id,
      title: r.p.manifest.title,
      questions: r.p.manifest.questions.map((q) => ({ id: q.id, prompt: q.prompt })),
    } satisfies OralFinishRequest)
  })
}

/**
 * The bridge's entry point. `onClose` registers what to do if the tool call's
 * connection dies before the learner answers (the worker or the sitting is gone).
 */
export async function handleOralTool(
  sessionId: string,
  body: Record<string, unknown>,
  send: Send,
  onClose: (fn: () => void) => void,
): Promise<Record<string, unknown>> {
  try {
    if (body.action === 'start') return await start(sessionId, body, send)
    if (body.action === 'ask') return await ask(sessionId, body, onClose)
    if (body.action === 'finish') return await finish(sessionId, body, onClose)
    throw new Error('action must be start, ask or finish.')
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
