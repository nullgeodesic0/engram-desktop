import {
  AUDIT_CLASSES,
  type AuditClass,
  type AuditFlag,
  type ProblemAnswer,
  type ProblemManifest,
  type ProblemResult,
  type ProblemVerdict,
  isAuditClass,
} from '../../shared/problems'

/**
 * A problem's key: what main grades an attempt against. Read only here and
 * in problemStore.ts, and only after the attempt is on disk; the renderer
 * gets the result (and the key's text) once the attempt is unsealed, never
 * before. See docs/content-packs.md for the formats.
 *
 * Doctrine: a pinned answer reader (D4). It reads a pack's key files, never
 * the engine's nodes.
 */

export interface ProofKey {
  type: 'proof'
  steps: { claim: string; justification: string; central: boolean }[]
}

export interface AuditKey {
  type: 'audit'
  errors: { id: string; quote: string; cls: AuditClass; central: boolean; why: string }[]
  /** What a good overall judgement says. */
  judgement: string[]
}

export interface FigureKey {
  type: 'figure'
  answers: Record<string, { value: number; tolerance: number; relative: boolean; tier: 'core' | 'slip' }>
  judgement: string[]
}

export interface OralFollowUp {
  id: string
  prompt: string
  /** The criterion (by index) a gap in which this follow-up probes; null: a general probe. */
  probes: number | null
}

export interface OralKey {
  type: 'oral'
  questions: Record<string, { criteria: string[]; followUps: OralFollowUp[] }>
}

export type ProblemKey = ProofKey | AuditKey | FigureKey | OralKey

function text(v: unknown, where: string, max = 2000): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${where} must be text`)
  return v
}

function textList(v: unknown, where: string): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > 12) throw new Error(`${where} must be a list of up to 12 lines`)
  return v.map((x, i) => text(x, `${where}[${i}]`, 400))
}

/** Validates a key against its problem. Throws a sentence naming what is wrong. */
export function parseKey(p: ProblemManifest, raw: unknown): ProblemKey {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null
  if (!o) throw new Error('the key is not a JSON object')
  if (p.type === 'proof') {
    if (!Array.isArray(o.steps) || o.steps.length === 0 || o.steps.length > 30)
      throw new Error('the key needs 1 to 30 "steps"')
    const steps = o.steps.map((s, i) => {
      const so = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
      return {
        claim: text(so.claim, `steps[${i}].claim`),
        justification: text(so.justification, `steps[${i}].justification`),
        central: so.central === true,
      }
    })
    if (!steps.some((s) => s.central)) throw new Error('mark at least one step "central"')
    return { type: 'proof', steps }
  }
  if (p.type === 'audit') {
    if (!Array.isArray(o.errors) || o.errors.length < 1 || o.errors.length > 10)
      throw new Error('the key needs 1 to 10 planted "errors"')
    const ids = new Set<string>()
    const errors = o.errors.map((e, i) => {
      const eo = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>
      const id = text(eo.id, `errors[${i}].id`, 40)
      if (ids.has(id)) throw new Error(`errors[${i}]: the id ${id} is used twice`)
      ids.add(id)
      const quote = text(eo.quote, `errors[${i}].quote`, 600)
      if (!normalise(p.text).includes(normalise(quote)))
        throw new Error(`errors[${i}]: its "quote" does not appear in the audit text`)
      if (!isAuditClass(eo.class)) throw new Error(`errors[${i}]: "class" must be one of the audit classes`)
      return { id, quote, cls: eo.class, central: eo.central === true, why: text(eo.why, `errors[${i}].why`, 600) }
    })
    return { type: 'audit', errors, judgement: textList(o.judgement, 'judgement') }
  }
  if (p.type === 'oral') {
    const qs = (o.questions && typeof o.questions === 'object' ? o.questions : null) as Record<string, unknown> | null
    if (!qs) throw new Error('the key needs "questions"')
    const questions: OralKey['questions'] = {}
    for (const q of p.questions) {
      const r = (qs[q.id] && typeof qs[q.id] === 'object' ? qs[q.id] : null) as Record<string, unknown> | null
      if (!r) throw new Error(`the key has nothing for ${q.id}`)
      const criteria = textList(r.criteria, `questions.${q.id}.criteria`)
      if (criteria.length === 0) throw new Error(`questions.${q.id} needs at least one criterion`)
      const fu = r.followUps === undefined ? [] : r.followUps
      if (!Array.isArray(fu) || fu.length > 8) throw new Error(`questions.${q.id}.followUps must be a list of up to 8`)
      const ids = new Set<string>()
      const followUps = fu.map((f, i) => {
        const fo = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
        const where = `questions.${q.id}.followUps[${i}]`
        const id = text(fo.id, `${where}.id`, 40)
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
          throw new Error(`${where}.id must be lowercase letters, digits and dashes`)
        if (ids.has(id)) throw new Error(`${where}: the id ${id} is used twice`)
        ids.add(id)
        const probes = fo.probes === undefined || fo.probes === null ? null : fo.probes
        if (
          probes !== null &&
          !(Number.isInteger(probes) && (probes as number) >= 0 && (probes as number) < criteria.length)
        )
          throw new Error(`${where}.probes must be the index of one of the question's criteria`)
        return { id, prompt: text(fo.prompt, `${where}.prompt`, 600), probes: probes as number | null }
      })
      questions[q.id] = { criteria, followUps }
    }
    return { type: 'oral', questions }
  }
  const a = (o.answers && typeof o.answers === 'object' ? o.answers : null) as Record<string, unknown> | null
  if (!a) throw new Error('the key needs "answers"')
  const answers: FigureKey['answers'] = {}
  for (const q of p.type === 'figure' ? p.questions : []) {
    const r = (a[q.id] && typeof a[q.id] === 'object' ? a[q.id] : null) as Record<string, unknown> | null
    if (!r) throw new Error(`the key has no answer for ${q.id}`)
    const value = r.value
    const tolerance = r.tolerance
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`answers.${q.id}.value must be a number`)
    if (typeof tolerance !== 'number' || !(tolerance > 0)) throw new Error(`answers.${q.id}.tolerance must be above 0`)
    const tier = r.tier === undefined ? 'core' : r.tier
    if (tier !== 'core' && tier !== 'slip') throw new Error(`answers.${q.id}.tier must be core or slip`)
    answers[q.id] = { value, tolerance, relative: r.relative !== false, tier }
  }
  return { type: 'figure', answers, judgement: textList(o.judgement, 'judgement') }
}

const SYMBOLS: Record<string, string> = {
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  ε: 'epsilon',
  ϵ: 'epsilon',
  η: 'eta',
  θ: 'theta',
  κ: 'kappa',
  λ: 'lambda',
  μ: 'mu',
  ν: 'nu',
  π: 'pi',
  ρ: 'rho',
  σ: 'sigma',
  τ: 'tau',
  φ: 'phi',
  ϕ: 'phi',
  χ: 'chi',
  ψ: 'psi',
  ω: 'omega',
  Γ: 'gamma',
  Δ: 'delta',
  Λ: 'lambda',
  Σ: 'sigma',
  Φ: 'phi',
  Ψ: 'psi',
  Ω: 'omega',
  '⊤': 'top',
  '†': 'dagger',
  '⊗': 'otimes',
  '⊕': 'oplus',
  '≤': 'le',
  '≥': 'ge',
  '≠': 'ne',
  '≈': 'approx',
  '∞': 'infty',
  '∑': 'sum',
  '∏': 'prod',
  '∫': 'int',
  '√': 'sqrt',
  '∈': 'in',
  '⟨': 'langle',
  '⟩': 'rangle',
  '∥': '',
  '‖': '',
}

/**
 * How passages are compared: lowercase, letters and digits only, with TeX
 * commands and their typeset symbols folded to the same words ("\\beta" and
 * "β" both read "beta"). A passage selected in the typeset text and the
 * key's TeX source then compare equal; so does one selected in the source.
 */
export function normalise(s: string): string {
  return s
    .replace(/[\u0370-\u03ff\u2020-\u2aff]/g, (c) => SYMBOLS[c] ?? '')
    .toLowerCase()
    .replace(/\\([a-z]+)/g, '$1')
    .replace(/[^a-z0-9]+/g, '')
}

/** Length of the longest common substring. Passages are short (a few hundred characters). */
function commonRun(a: string, b: string): number {
  let best = 0
  let prev = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) best = cur[j]
      }
    }
    prev = cur
  }
  return best
}

/**
 * Does a flag's passage mark a planted error? The two must share a run of
 * text: most of the shorter one, and at least a few characters, so selecting
 * a little more or less than the planted quote still counts.
 */
export function flagMarks(flagQuote: string, plantedQuote: string): boolean {
  const a = normalise(flagQuote)
  const b = normalise(plantedQuote)
  if (!a || !b) return false
  const need = Math.max(Math.min(6, a.length, b.length), Math.min(24, Math.floor(0.6 * Math.min(a.length, b.length))))
  return commonRun(a, b) >= need
}

function within(got: number, want: number, tol: number, relative: boolean): boolean {
  return relative ? Math.abs(got - want) <= tol * Math.abs(want) : Math.abs(got - want) <= tol
}

function label(c: AuditClass): string {
  return AUDIT_CLASSES.find((x) => x.id === c)?.label ?? c
}

/** Grades an answer against its key: the verdict, a score for the report, and the result to show. */
export function grade(
  p: ProblemManifest,
  key: ProblemKey,
  answer: ProblemAnswer,
): { verdict: ProblemVerdict; score: string; falseFlags: number; result: ProblemResult } {
  if (key.type === 'oral' || p.type === 'oral') throw new Error('An oral exam is graded by the tutor, in the sitting.')
  if (key.type === 'proof' || answer.type === 'proof') {
    const steps = key.type === 'proof' ? key.steps : []
    return {
      verdict: 'open',
      score: '-',
      falseFlags: 0,
      result: {
        type: 'proof',
        reference: steps.map((s) => ({ statement: s.claim, because: s.justification, central: s.central })),
      },
    }
  }
  if (key.type === 'audit' && answer.type === 'audit') {
    const flags: AuditFlag[] = answer.flags
    const used = new Set<number>()
    const errors = key.errors.map((e) => {
      const i = flags.findIndex((f, k) => !used.has(k) && flagMarks(f.quote, e.quote))
      if (i >= 0) used.add(i)
      return {
        id: e.id,
        quote: e.quote,
        cls: e.cls,
        central: e.central,
        why: e.why,
        foundBy: i >= 0 ? i : null,
        classRight: i >= 0 ? flags[i].cls === e.cls : null,
      }
    })
    // A second flag on a passage that is already found is a duplicate, not a false alarm.
    const falseFlags = flags
      .map((f, k) => ({ f, k }))
      .filter(({ f, k }) => !used.has(k) && !key.errors.some((e) => flagMarks(f.quote, e.quote)))
      .map(({ k }) => k)
    const found = errors.filter((e) => e.foundBy !== null).length
    const verdict: ProblemVerdict = errors.some((e) => e.central && e.foundBy === null)
      ? 'core'
      : found < errors.length || falseFlags.length > 0 || errors.some((e) => e.classRight === false)
        ? 'slip'
        : 'passed'
    return {
      verdict,
      score: `${found}/${errors.length}`,
      falseFlags: falseFlags.length,
      result: { type: 'audit', errors, falseFlags, judgement: key.judgement },
    }
  }
  if (key.type === 'figure' && answer.type === 'figure' && p.type === 'figure') {
    const answers = p.questions.map((q) => {
      const k = key.answers[q.id]
      const got = answer.values[q.id] ?? null
      return {
        id: q.id,
        expected: k.value,
        tolerance: k.relative ? `±${Math.round(k.tolerance * 100)}%` : `±${k.tolerance}`,
        got,
        ok: got !== null && within(got, k.value, k.tolerance, k.relative),
        tier: k.tier,
      }
    })
    const ok = answers.filter((x) => x.ok).length
    const verdict: ProblemVerdict = answers.some((x) => x.tier === 'core' && !x.ok)
      ? 'core'
      : answers.some((x) => !x.ok)
        ? 'slip'
        : 'passed'
    return {
      verdict,
      score: `${ok}/${answers.length}`,
      falseFlags: 0,
      result: { type: 'figure', answers, judgement: key.judgement },
    }
  }
  throw new Error('The key and the answer are for different kinds of problem.')
}

/** What the assessor grades the production against: the key, as criteria. Given to the tutor only after unseal. */
export function keyCriteria(p: ProblemManifest, key: ProblemKey): string[] {
  if (key.type === 'proof')
    return [
      ...key.steps.map(
        (s, i) => `Step ${i + 1}${s.central ? ' (central)' : ''}: ${s.claim} Justified by: ${s.justification}`,
      ),
      'A central step stated without its justification does not count as shown.',
    ]
  if (key.type === 'audit')
    return [
      ...key.errors.map((e) => `Flags "${e.quote}" as ${label(e.cls)}${e.central ? ' (central)' : ''}: ${e.why}`),
      ...key.judgement.map((j) => `The overall judgement: ${j}`),
    ]
  if (key.type === 'oral') return []
  const qs = p.type === 'figure' ? p.questions : []
  return [
    ...qs.map((q) => {
      const k = key.answers[q.id]
      const tol = k.relative ? `within ${Math.round(k.tolerance * 100)}%` : `within ${k.tolerance}`
      return `Reads ${q.prompt} as ${k.value}${q.unit ? ` ${q.unit}` : ''}, ${tol}`
    }),
    ...key.judgement.map((j) => `The judgement: ${j}`),
  ]
}
