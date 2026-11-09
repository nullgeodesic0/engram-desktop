import { app } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { realpathSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isValidSlug } from '../../shared/runtime'
import { type Confidence, confidenceToken, isConfidence } from '../../shared/labs'
import {
  type ProblemAttempt,
  type ProblemDraft,
  type ProblemList,
  type ProblemManifest,
  type ProblemView,
  JUDGEMENT_MAX,
  answerText,
  cleanAnswer,
  parseProblemManifest,
} from '../../shared/problems'
import { isProblemReport, signProblemReport, verifyProblemReport } from './checkReport'
import { checkKey } from './labStore'
import { type LoadedPack, loadedPacks, resolveInside } from './packStore'
import { type ProblemKey, grade, keyCriteria, parseKey } from './problemKey'

/**
 * Pack problems, main side: proofs, audits and figure readings. A pack's
 * problem folders are read where they sit. What this module writes is the
 * learner's own record under app userData/labs/problems/<pack>/<problem>/:
 *
 *   draft.json      the answer in progress, when the problem was opened, hints opened
 *   attempts.json   every Submit: the answer, the judgement, the pick, the
 *                   result (sealed until the pick), and the signed report
 *
 * The order is the lab's: answer and judgement, then the confidence pick,
 * then the result. The key is read here at Submit and graded at once, but
 * nothing of the result leaves main until the pick is made.
 *
 * Doctrine: a pinned writer (D2), to app userData only, and a pinned answer
 * reader (D4) of the pack's key files through problemKey.ts. Nothing here
 * reads or writes the learning home.
 */

interface StoredAttempt extends ProblemAttempt {
  falseFlags: number
}

interface AttemptsFile {
  attempts: StoredAttempt[]
}

interface LoadedProblem {
  pack: LoadedPack
  dir: string
  manifest: ProblemManifest
}

const IMAGE_MAX = 5 * 1024 * 1024

function problemDir(packId: string, problemId: string): string {
  if (!isValidSlug(packId) || !isValidSlug(problemId)) throw new Error('That is not a problem.')
  return join(app.getPath('userData'), 'labs', 'problems', packId, problemId)
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, text, 'utf-8')
  await rename(tmp, path)
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}

const locks = new Map<string, Promise<unknown>>()

/** One read-modify-write at a time per problem. */
function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(dir) ?? Promise.resolve()
  const next = prev.then(fn)
  locks.set(
    dir,
    next.catch(() => {}),
  )
  return next
}

function emptyDraft(): ProblemDraft {
  return { openedAt: null, answer: null, explainBack: '', hintsOpen: 0 }
}

async function readDraft(dir: string): Promise<ProblemDraft> {
  const d = await readJson<Partial<ProblemDraft>>(join(dir, 'draft.json'), {})
  return {
    openedAt: typeof d.openedAt === 'string' ? d.openedAt : null,
    answer: d.answer && typeof d.answer === 'object' ? d.answer : null,
    explainBack: typeof d.explainBack === 'string' ? d.explainBack : '',
    hintsOpen: typeof d.hintsOpen === 'number' && d.hintsOpen >= 0 ? Math.floor(d.hintsOpen) : 0,
  }
}

async function readAttempts(dir: string): Promise<StoredAttempt[]> {
  const f = await readJson<Partial<AttemptsFile>>(join(dir, 'attempts.json'), {})
  return Array.isArray(f.attempts) ? f.attempts : []
}

async function write(dir: string, name: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeAtomic(join(dir, name), JSON.stringify(value, null, 2))
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadProblem(pack: LoadedPack, rel: string): Promise<LoadedProblem> {
  const root = pack.root!
  const dir = await resolveInside(root, root, rel)
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(dir, 'problem.json'), 'utf-8'))
  } catch (e) {
    throw new Error(`${rel}/problem.json could not be read: ${e instanceof Error ? e.message : String(e)}`)
  }
  const parsed = parseProblemManifest(raw, (p) => {
    let real: string
    try {
      real = realpathSync(resolve(dir, ...p.split('/')))
    } catch {
      throw new Error(`${rel}: ${p} is missing`)
    }
    const inside = real === root || real.startsWith(root.endsWith('/') ? root : `${root}/`)
    if (!inside) throw new Error(`${rel}: ${p} points outside the pack`)
    return readFileSync(real, 'utf-8').slice(0, 40_000)
  })
  if (!parsed.ok) throw new Error(`${rel}: ${parsed.error}`)
  await resolveInside(root, dir, parsed.value.key)
  if (parsed.value.type === 'figure') await resolveInside(root, dir, parsed.value.image)
  return { pack, dir, manifest: parsed.value }
}

async function readKey(p: LoadedProblem): Promise<ProblemKey> {
  const file = await resolveInside(p.pack.root!, p.dir, p.manifest.key)
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(file, 'utf-8'))
  } catch {
    throw new Error(`The key of ${p.manifest.title} is not valid JSON.`)
  }
  try {
    return parseKey(p.manifest, raw)
  } catch (e) {
    throw new Error(`The key of ${p.manifest.title}: ${e instanceof Error ? e.message : String(e)}.`)
  }
}

async function findProblem(packId: string, problemId: string): Promise<LoadedProblem> {
  const pack = (await loadedPacks()).find((p) => p.manifest?.id === packId && p.root)
  if (!pack) throw new Error(`No added content pack has the id ${packId}.`)
  for (const rel of pack.manifest!.problems) {
    const last = rel.split('/').pop()
    const p = await loadProblem(pack, rel).catch(() => null)
    if (p?.manifest.id === problemId) return p
    if (!p && last === problemId) await loadProblem(pack, rel) // throws the reason
  }
  throw new Error(`The pack ${pack.manifest!.title} has no problem ${problemId}.`)
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function redact(a: StoredAttempt): ProblemAttempt {
  const { falseFlags: _f, ...out } = a
  if (!a.sealed) return out
  return { ...out, verdict: null, score: null, result: null, report: null }
}

export async function listProblems(): Promise<ProblemList> {
  const out: ProblemList = { problems: [], errors: [] }
  for (const pack of await loadedPacks()) {
    if (!pack.manifest || !pack.root) continue
    for (const rel of pack.manifest.problems) {
      try {
        const p = await loadProblem(pack, rel)
        // An author's mistake in a key shows here, not at the learner's first Submit.
        await readKey(p)
        const attempts = await readAttempts(problemDir(pack.manifest.id, p.manifest.id))
        const last = [...attempts].reverse().find((a) => !a.sealed)
        out.problems.push({
          packId: pack.manifest.id,
          packTitle: pack.manifest.title,
          problemId: p.manifest.id,
          type: p.manifest.type,
          title: p.manifest.title,
          attempts: attempts.length,
          last: last?.verdict ?? null,
        })
      } catch (e) {
        out.errors.push({
          packId: pack.manifest.id,
          packTitle: pack.manifest.title,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }
  return out
}

async function imageUrl(p: LoadedProblem): Promise<string | null> {
  if (p.manifest.type !== 'figure') return null
  const file = await resolveInside(p.pack.root!, p.dir, p.manifest.image)
  if ((await stat(file)).size > IMAGE_MAX) throw new Error(`${p.manifest.image} is over 5 MB.`)
  const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${(await readFile(file)).toString('base64')}`
}

async function viewOf(p: LoadedProblem, draft: ProblemDraft, attempts: StoredAttempt[]): Promise<ProblemView> {
  const m = p.manifest
  return {
    packId: p.pack.manifest!.id,
    packTitle: p.pack.manifest!.title,
    problem: m,
    hints: m.hints.slice(0, draft.hintsOpen),
    hintCount: m.hints.length,
    draft,
    attempts: attempts.map(redact),
    imageUrl: await imageUrl(p),
  }
}

/** The problem, the learner's draft and attempts. Opening it starts the clock if it is not running. */
export async function problemView(packId: string, problemId: string): Promise<ProblemView> {
  const p = await findProblem(packId, problemId)
  const dir = problemDir(packId, problemId)
  return withLock(dir, async () => {
    const draft = await readDraft(dir)
    if (!draft.openedAt) {
      draft.openedAt = new Date().toISOString()
      await write(dir, 'draft.json', draft)
    }
    return viewOf(p, draft, await readAttempts(dir))
  })
}

/** Keeps the answer in progress. Not checked beyond its shape: that happens at Submit. */
export async function saveProblemDraft(
  packId: string,
  problemId: string,
  answer: unknown,
  explainBack: string,
): Promise<void> {
  await findProblem(packId, problemId)
  const dir = problemDir(packId, problemId)
  const text = JSON.stringify(answer ?? null)
  if (text.length > 200_000) throw new Error('The draft is too long to keep.')
  await withLock(dir, async () => {
    const draft = await readDraft(dir)
    draft.answer = answer && typeof answer === 'object' ? (JSON.parse(text) as ProblemDraft['answer']) : null
    draft.explainBack = String(explainBack ?? '').slice(0, JUDGEMENT_MAX)
    draft.openedAt ??= new Date().toISOString()
    await write(dir, 'draft.json', draft)
  })
}

/** Opens the next hint. Each one opened is recorded as help on the next Submit. */
export async function openProblemHint(packId: string, problemId: string): Promise<ProblemView> {
  const p = await findProblem(packId, problemId)
  if (p.manifest.unaided) throw new Error('This problem is unaided: it has no hints.')
  const dir = problemDir(packId, problemId)
  return withLock(dir, async () => {
    const draft = await readDraft(dir)
    const attempts = await readAttempts(dir)
    if (attempts.some((a) => a.sealed)) throw new Error('Pick a confidence for the attempt already in first.')
    draft.hintsOpen = Math.min(p.manifest.hints.length, draft.hintsOpen + 1)
    await write(dir, 'draft.json', draft)
    return viewOf(p, draft, attempts)
  })
}

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 12)
}

/**
 * Submits the answer and the judgement together. The key is read and the
 * attempt graded now, but the result stays sealed until the confidence pick.
 */
export async function submitProblem(
  packId: string,
  problemId: string,
  answer: unknown,
  explainBack: string,
): Promise<ProblemAttempt> {
  const p = await findProblem(packId, problemId)
  const clean = cleanAnswer(p.manifest, answer)
  const eb = String(explainBack ?? '').trim()
  if (p.manifest.type !== 'proof') {
    if (!eb) throw new Error('Write the judgement first.')
    if (eb.length > JUDGEMENT_MAX) throw new Error(`Keep the judgement under ${JUDGEMENT_MAX} characters.`)
  }
  const key = await readKey(p)
  const graded = grade(p.manifest, key, clean)
  const dir = problemDir(packId, problemId)
  return withLock(dir, async () => {
    const attempts = await readAttempts(dir)
    if (attempts.some((a) => a.sealed)) throw new Error('Pick a confidence for the attempt already in first.')
    const draft = await readDraft(dir)
    const seq = attempts.reduce((n, a) => Math.max(n, a.seq), 0) + 1
    const now = new Date().toISOString()
    const attempt: StoredAttempt = {
      id: String(seq),
      seq,
      openedAt: draft.openedAt ?? now,
      submittedAt: now,
      answer: clean,
      explainBackPrompt: p.manifest.explainBack,
      explainBack: p.manifest.type === 'proof' ? '' : eb,
      confidence: null,
      help: draft.hintsOpen,
      sealed: true,
      verdict: graded.verdict,
      score: graded.score,
      result: graded.result,
      report: null,
      falseFlags: graded.falseFlags,
    }
    attempts.push(attempt)
    await write(dir, 'attempts.json', { attempts })
    // The next attempt starts from a blank page and a fresh clock; opened hints stay opened.
    await write(dir, 'draft.json', { ...emptyDraft(), hintsOpen: draft.hintsOpen })
    return redact(attempt)
  })
}

function production(p: ProblemManifest, a: StoredAttempt): string {
  const head = p.type === 'proof' ? 'My proof, as submitted:' : p.type === 'audit' ? 'My flags:' : 'My readings:'
  const parts = [`${head}\n${answerText(p, a.answer)}`]
  if (a.explainBackPrompt) parts.push(`${a.explainBackPrompt}\n${a.explainBack}`)
  return parts.join('\n\n')
}

/** The pick that breaks the seal: the report is signed with it, then the result is shown. */
export async function pickProblemConfidence(
  packId: string,
  problemId: string,
  attemptId: string,
  confidence: Confidence,
): Promise<ProblemAttempt> {
  if (!isConfidence(confidence)) throw new Error('Pick one of the four confidence levels.')
  const p = await findProblem(packId, problemId)
  const dir = problemDir(packId, problemId)
  const key = await checkKey()
  return withLock(dir, async () => {
    const attempts = await readAttempts(dir)
    const a = attempts.find((x) => x.id === attemptId)
    if (!a) throw new Error('No such attempt.')
    if (!a.sealed) return redact(a)
    a.confidence = confidence
    const seconds = Math.max(0, Math.round((Date.parse(a.submittedAt) - Date.parse(a.openedAt)) / 1000))
    a.report = signProblemReport(
      {
        prob: `${packId}/${problemId}`,
        type: p.manifest.type,
        seq: a.seq,
        verdict: a.verdict!,
        score: a.score!,
        falseFlags: a.falseFlags,
        seconds: Number.isFinite(seconds) ? seconds : 0,
        at: a.submittedAt.replace(/\.\d{3}Z$/, 'Z'),
        conf: confidenceToken(confidence),
        ans: hash(production(p.manifest, a)),
        help: a.help,
      },
      key,
    )
    a.sealed = false
    await write(dir, 'attempts.json', { attempts })
    return redact(a)
  })
}

/** The learner's turn for the tutor: the signed report, then the answer and judgement as recorded. */
export async function problemProduction(packId: string, problemId: string, attemptId: string): Promise<string> {
  const p = await findProblem(packId, problemId)
  const a = (await readAttempts(problemDir(packId, problemId))).find((x) => x.id === attemptId)
  if (!a || a.sealed || !a.report) throw new Error('That attempt is still sealed.')
  return `${a.report}\n\n${production(p.manifest, a)}`
}

/** The engine's confidence values for the picker's four bands (dialogue-grammar.md). */
const CONFIDENCE_VALUE: Record<string, number> = { certain: 90, 'pretty-sure': 70, 'half-unsure': 50, guessing: 25 }

export type ProblemReportLookup =
  | { verified: false; reason: string }
  | {
      verified: true
      kind: 'problem'
      pack: string
      problem: string
      title: string
      type: string
      topic: string | null
      node: string | null
      unaided: boolean
      submission: number
      verdict: string
      score: string
      falseFlags: number
      help: number
      confidence: number | null
      /** The task, as the learner saw it. */
      prompt: string
      /** The answer and judgement exactly as recorded at Submit. */
      production: string
      /** The pack's key as criteria, for the stash entry's rubric. The learner saw the key at unseal. */
      criteria: string[]
      submittedAt: string
    }

/** Checks a problem report pasted into a tutor session, as lookupReport does for labs. */
export async function lookupProblemReport(line: string): Promise<ProblemReportLookup> {
  if (typeof line !== 'string' || line.length > 1000 || !isProblemReport(line))
    return { verified: false, reason: 'That is not a problem report.' }
  const fields = verifyProblemReport(line, await checkKey())
  if (!fields)
    return {
      verified: false,
      reason: 'The report does not verify: it was changed, or it was signed by another install.',
    }
  const [packId, problemId] = fields.prob.split('/')
  const p = packId && problemId ? await findProblem(packId, problemId).catch(() => null) : null
  if (p) {
    const a = (await readAttempts(problemDir(packId, problemId))).find((x) => x.report === line.trim())
    if (a && !a.sealed) {
      const text = production(p.manifest, a)
      if (hash(text) === fields.ans)
        return {
          verified: true,
          kind: 'problem',
          pack: packId,
          problem: problemId,
          title: p.manifest.title,
          type: p.manifest.type,
          topic: p.manifest.topic,
          node: p.manifest.node,
          unaided: p.manifest.unaided,
          submission: a.seq,
          verdict: fields.verdict,
          score: fields.score,
          falseFlags: fields.falseFlags,
          help: fields.help,
          confidence: CONFIDENCE_VALUE[fields.conf] ?? null,
          prompt: p.manifest.prompt,
          production: text,
          criteria: keyCriteria(p.manifest, await readKey(p)),
          submittedAt: a.submittedAt,
        }
    }
  }
  return {
    verified: false,
    reason: 'The signature is good, but no attempt on record carries this report (its pack may have been removed).',
  }
}
