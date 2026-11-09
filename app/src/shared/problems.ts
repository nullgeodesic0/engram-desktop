/**
 * Pack problems: proofs, audits and figure readings. See docs/content-packs.md.
 *
 * A problem is a folder in a content pack with a problem.json (what the
 * learner sees) and a key file (what main grades against, never sent to the
 * renderer before the attempt is in). Its Submit follows the lab order: the
 * answer and the written judgement first, then the confidence pick, and only
 * then the results. What comes out is a signed report and the learner's own
 * production, which the tutor grades in a sitting the learner hands it to.
 *
 * None of this is learning state: the app records attempts; grades, ratings
 * and schedules stay the engine's.
 */

import type { Confidence } from './labs'
import { ManifestError, type Parsed, obj, path, run, slug, str } from './contentPack'

export const PROBLEM_TYPES = ['proof', 'audit', 'figure'] as const
export type ProblemType = (typeof PROBLEM_TYPES)[number]

/** The audit taxonomy: the curriculum map's own list of how machine-written work goes wrong. */
export const AUDIT_CLASSES = [
  { id: 'hallucinated-citation', label: 'Hallucinated citation' },
  { id: 'dropped-assumption', label: 'Dropped assumption' },
  { id: 'wrong-prefactor', label: 'Wrong prefactor or sign' },
  { id: 'wrong-noise-model', label: 'Wrong noise model' },
  { id: 'overfit', label: 'Overfit or cherry-picked result' },
  { id: 'known-as-new', label: 'Known result presented as new' },
  { id: 'sycophantic', label: 'Sycophantic agreement' },
  { id: 'check-that-passes', label: 'A check written so it passes' },
  { id: 'logic-gap', label: 'Logical gap or wrong step' },
] as const
export type AuditClass = (typeof AUDIT_CLASSES)[number]['id']

export function isAuditClass(v: unknown): v is AuditClass {
  return typeof v === 'string' && AUDIT_CLASSES.some((c) => c.id === v)
}

export const MAX_PROOF_STEPS = 30
export const MAX_FLAGS = 20
export const MAX_FIGURE_QUESTIONS = 8
export const STEP_TEXT_MAX = 1200
export const FLAG_NOTE_MAX = 300
export const QUOTE_MAX = 600
export const JUDGEMENT_MAX = 2000

export interface FigureAxis {
  /** Two pixel positions on the image's own pixel grid... */
  px: [number, number]
  /** ...and the data values at them. */
  value: [number, number]
  scale: 'linear' | 'log'
}

export interface FigureQuestion {
  id: string
  prompt: string
  /** Shown after the box, e.g. "%". */
  unit: string
}

interface ProblemCommon {
  id: string
  title: string
  summary: string
  /** Markdown: the task. */
  prompt: string
  /** The tutor topic this problem belongs to, and the node it exercises if the pack knows it. */
  topic: string | null
  node: string | null
  /** Shown in the masthead: no hints, no notes, from a blank page. */
  unaided: boolean
  /** Opened one at a time on request; each one opened is recorded as help. Never for an unaided problem. */
  hints: string[]
  /** The written judgement asked with the answer (audit, figure). Empty for a proof. */
  explainBack: string
  /** The key file inside the problem folder. Main reads it; the renderer never does. */
  key: string
}

export interface ProofProblem extends ProblemCommon {
  type: 'proof'
  /** About how many steps the reference proof takes, shown as a guide. Null: not said. */
  steps: number | null
}

export interface AuditProblem extends ProblemCommon {
  type: 'audit'
  /** The machine-written text to audit, Markdown with math. */
  text: string
}

export interface FigureProblem extends ProblemCommon {
  type: 'figure'
  /** The image, a path inside the problem folder (PNG or JPEG). */
  image: string
  /** Axis calibration, so the crosshair reads data values. Null: the crosshair reads pixels only. */
  axes: { x: FigureAxis; y: FigureAxis } | null
  questions: FigureQuestion[]
}

export type ProblemManifest = ProofProblem | AuditProblem | FigureProblem

function axis(raw: unknown, where: string): FigureAxis {
  const o = obj(raw, where)
  const pair = (k: string): [number, number] => {
    const v = o[k]
    if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n)))
      throw new ManifestError(`${where}: "${k}" must be two numbers`)
    return [v[0], v[1]]
  }
  const px = pair('px')
  const value = pair('value')
  const scale = o.scale === undefined ? 'linear' : o.scale
  if (scale !== 'linear' && scale !== 'log') throw new ManifestError(`${where}: "scale" must be linear or log`)
  if (px[0] === px[1]) throw new ManifestError(`${where}: the two pixel positions must differ`)
  if (scale === 'log' && !(value[0] > 0 && value[1] > 0))
    throw new ManifestError(`${where}: a log axis needs positive values`)
  if (value[0] === value[1]) throw new ManifestError(`${where}: the two values must differ`)
  return { px, value, scale }
}

/**
 * Validates a problem.json. `readText` reads a Markdown file named by the
 * manifest (a prompt or an audit text), already checked to stay in the pack.
 */
export function parseProblemManifest(raw: unknown, readText: (p: string) => string): Parsed<ProblemManifest> {
  return run(() => {
    const w = 'problem.json'
    const o = obj(raw, w)
    const type = o.type
    if (!(PROBLEM_TYPES as readonly unknown[]).includes(type))
      throw new ManifestError(`${w}: "type" must be ${PROBLEM_TYPES.join(', ')}`)
    const promptFile = path(o, 'promptFile', w, true)
    const prompt = promptFile ? readText(promptFile) : str(o, 'prompt', w, { max: 6000 })
    if (!prompt.trim()) throw new ManifestError(`${w}: the prompt is empty`)
    const unaided = o.unaided === true
    const hintsRaw = o.hints === undefined ? [] : o.hints
    if (!Array.isArray(hintsRaw) || hintsRaw.length > 8 || !hintsRaw.every((h) => typeof h === 'string' && h.trim()))
      throw new ManifestError(`${w}: "hints" must be a list of up to 8 non-empty strings`)
    if (unaided && hintsRaw.length) throw new ManifestError(`${w}: an unaided problem has no hints`)
    const topic = o.topic === undefined || o.topic === null ? null : slugLike(o.topic, `${w} topic`, 64)
    const node = o.node === undefined || o.node === null ? null : slugLike(o.node, `${w} node`, 64)
    if (node && !topic) throw new ManifestError(`${w}: a "node" needs its "topic"`)
    const common = {
      id: slug(o, 'id', w),
      title: str(o, 'title', w, { max: 160 }),
      summary: str(o, 'summary', w, { optional: true, max: 400 }),
      prompt,
      topic,
      node,
      unaided,
      hints: hintsRaw as string[],
      key: path(o, 'key', w)!,
    }
    if (type === 'proof') {
      const steps = o.steps === undefined || o.steps === null ? null : o.steps
      if (steps !== null && !(Number.isInteger(steps) && (steps as number) > 0 && (steps as number) <= MAX_PROOF_STEPS))
        throw new ManifestError(`${w}: "steps" must be a whole number from 1 to ${MAX_PROOF_STEPS}`)
      return { ...common, type: 'proof' as const, explainBack: '', steps: steps as number | null }
    }
    const explainBack = str(o, 'explainBack', w, { max: 400 })
    if (type === 'audit') {
      const textFile = path(o, 'text', w)!
      const text = readText(textFile)
      if (!text.trim()) throw new ManifestError(`${w}: the audit text is empty`)
      return { ...common, type: 'audit' as const, explainBack, text }
    }
    const image = path(o, 'image', w)!
    if (!/\.(png|jpe?g)$/i.test(image)) throw new ManifestError(`${w}: "image" must be a PNG or JPEG`)
    const axes =
      o.axes === undefined || o.axes === null
        ? null
        : (() => {
            const a = obj(o.axes, `${w} axes`)
            return { x: axis(a.x, `${w} axes.x`), y: axis(a.y, `${w} axes.y`) }
          })()
    const qs = o.questions
    if (!Array.isArray(qs) || qs.length === 0 || qs.length > MAX_FIGURE_QUESTIONS)
      throw new ManifestError(`${w}: "questions" must list 1 to ${MAX_FIGURE_QUESTIONS} questions`)
    const ids = new Set<string>()
    const questions = qs.map((q, i) => {
      const qw = `${w} questions[${i}]`
      const qo = obj(q, qw)
      const id = slug(qo, 'id', qw)
      if (ids.has(id)) throw new ManifestError(`${qw}: the id ${id} is used twice`)
      ids.add(id)
      return { id, prompt: str(qo, 'prompt', qw, { max: 300 }), unit: str(qo, 'unit', qw, { optional: true, max: 20 }) }
    })
    return { ...common, type: 'figure' as const, explainBack, image, axes, questions }
  })
}

function slugLike(v: unknown, where: string, max: number): string {
  if (typeof v !== 'string' || !new RegExp(`^[a-z0-9][a-z0-9-]{0,${max - 1}}$`).test(v))
    throw new ManifestError(`${where} must be lowercase letters, digits and dashes`)
  return v
}

/** Pixel to data value on one calibrated axis. */
export function axisValue(a: FigureAxis, px: number): number {
  const t = (px - a.px[0]) / (a.px[1] - a.px[0])
  if (a.scale === 'log') {
    const l0 = Math.log10(a.value[0])
    const l1 = Math.log10(a.value[1])
    return 10 ** (l0 + t * (l1 - l0))
  }
  return a.value[0] + t * (a.value[1] - a.value[0])
}

// ---------------------------------------------------------------------------
// The learner's answer, as the renderer sends it. Field names are the
// learner's ("statement", "because"), not the key's.
// ---------------------------------------------------------------------------

export interface ProofStep {
  statement: string
  because: string
}

export interface AuditFlag {
  /** The passage, as selected in the text. */
  quote: string
  cls: AuditClass
  /** One line: what is wrong. */
  note: string
}

export type ProblemAnswer =
  | { type: 'proof'; steps: ProofStep[] }
  | { type: 'audit'; flags: AuditFlag[] }
  | { type: 'figure'; values: Record<string, number | null> }

/** Checks and trims an answer from the renderer; throws a plain sentence when it is not one. */
export function cleanAnswer(p: ProblemManifest, raw: unknown): ProblemAnswer {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (p.type === 'proof') {
    const steps = Array.isArray(a.steps) ? a.steps : []
    const out = steps
      .map((s) => {
        const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
        return { statement: String(o.statement ?? '').trim(), because: String(o.because ?? '').trim() }
      })
      .filter((s) => s.statement || s.because)
    if (out.length === 0) throw new Error('Write at least one step.')
    if (out.length > MAX_PROOF_STEPS) throw new Error(`Keep the proof to ${MAX_PROOF_STEPS} steps.`)
    for (const [i, s] of out.entries()) {
      if (!s.statement) throw new Error(`Step ${i + 1} has a justification but no statement.`)
      if (s.statement.length > STEP_TEXT_MAX || s.because.length > STEP_TEXT_MAX)
        throw new Error(`Keep step ${i + 1} under ${STEP_TEXT_MAX} characters a field.`)
    }
    return { type: 'proof', steps: out }
  }
  if (p.type === 'audit') {
    const flags = Array.isArray(a.flags) ? a.flags : []
    if (flags.length > MAX_FLAGS) throw new Error(`Keep it to ${MAX_FLAGS} flags.`)
    const out = flags.map((f, i) => {
      const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
      const quote = String(o.quote ?? '').trim()
      const note = String(o.note ?? '').trim()
      if (!quote) throw new Error(`Flag ${i + 1} marks no passage.`)
      if (quote.length > QUOTE_MAX) throw new Error(`Flag ${i + 1} marks too long a passage: select less.`)
      if (!isAuditClass(o.cls)) throw new Error(`Pick a class for flag ${i + 1}.`)
      if (!note) throw new Error(`Write one line on what is wrong for flag ${i + 1}.`)
      if (note.length > FLAG_NOTE_MAX) throw new Error(`Keep flag ${i + 1}'s note under ${FLAG_NOTE_MAX} characters.`)
      return { quote, cls: o.cls, note }
    })
    return { type: 'audit', flags: out }
  }
  const v = (a.values && typeof a.values === 'object' ? a.values : {}) as Record<string, unknown>
  const values: Record<string, number | null> = {}
  for (const q of p.questions) {
    const x = v[q.id]
    values[q.id] = typeof x === 'number' && Number.isFinite(x) ? x : null
  }
  if (Object.values(values).every((x) => x === null)) throw new Error('Read off at least one value.')
  return { type: 'figure', values }
}

/** The answer as the text the tutor stashes, verbatim. */
export function answerText(p: ProblemManifest, a: ProblemAnswer): string {
  if (a.type === 'proof')
    return a.steps.map((s, i) => `${i + 1}. ${s.statement}${s.because ? `\n   Because: ${s.because}` : ''}`).join('\n')
  if (a.type === 'audit') {
    if (a.flags.length === 0) return 'No errors flagged.'
    const label = (c: AuditClass) => AUDIT_CLASSES.find((x) => x.id === c)?.label ?? c
    return a.flags.map((f, i) => `${i + 1}. "${f.quote}"\n   ${label(f.cls)}: ${f.note}`).join('\n')
  }
  const qs = p.type === 'figure' ? p.questions : []
  return qs
    .map(
      (q) =>
        `- ${q.prompt} ${a.values[q.id] === null ? '(left blank)' : `${a.values[q.id]}${q.unit ? ` ${q.unit}` : ''}`}`,
    )
    .join('\n')
}

// ---------------------------------------------------------------------------
// Results, shown once the attempt is unsealed.
// ---------------------------------------------------------------------------

/** passed / slip / core as for labs; open: a proof, which only the tutor grades. */
export type ProblemVerdict = 'passed' | 'slip' | 'core' | 'open'

export interface AuditResultError {
  id: string
  quote: string
  cls: AuditClass
  central: boolean
  why: string
  /** The learner's flag that found it, by index, or null. */
  foundBy: number | null
  classRight: boolean | null
}

export type ProblemResult =
  | { type: 'proof'; reference: { statement: string; because: string; central: boolean }[] }
  | { type: 'audit'; errors: AuditResultError[]; falseFlags: number[]; judgement: string[] }
  | {
      type: 'figure'
      answers: {
        id: string
        expected: number
        tolerance: string
        got: number | null
        ok: boolean
        tier: 'core' | 'slip'
      }[]
      judgement: string[]
    }

export interface ProblemAttempt {
  /** `<seq>`, also the folder under the problem's records. */
  id: string
  seq: number
  openedAt: string
  submittedAt: string
  answer: ProblemAnswer
  /** The judgement question asked, and the answer (audit, figure); empty for a proof. */
  explainBackPrompt: string
  explainBack: string
  confidence: Confidence | null
  help: number
  sealed: boolean
  /** Null on the wire while sealed. */
  verdict: ProblemVerdict | null
  score: string | null
  result: ProblemResult | null
  report: string | null
}

export interface ProblemDraft {
  openedAt: string | null
  answer: ProblemAnswer | null
  explainBack: string
  hintsOpen: number
}

export interface ProblemSummary {
  packId: string
  problemId: string
  type: ProblemType
  title: string
  attempts: number
  /** The latest unsealed attempt's verdict. */
  last: ProblemVerdict | null
}

export interface ProblemList {
  problems: (ProblemSummary & { packTitle: string })[]
  errors: { packId: string; packTitle: string; error: string }[]
}

export interface ProblemView {
  packId: string
  packTitle: string
  problem: ProblemManifest
  /** Opened hints, in order. Unopened ones are not on the wire. */
  hints: string[]
  hintCount: number
  draft: ProblemDraft
  attempts: ProblemAttempt[]
  /** A data: URL of a figure problem's image. */
  imageUrl: string | null
}

export function confidenceQuestion(t: ProblemType): string {
  if (t === 'proof') return 'How sure are you that the proof is complete and every step is justified?'
  if (t === 'audit') return 'How sure are you that you found every planted error?'
  return 'How sure are you that your readings are within tolerance?'
}
