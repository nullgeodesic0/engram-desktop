import { app } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { EXPLAIN_BACK_MAX } from '../../shared/contentPack'
import type {
  CheckOutcome,
  CheckRun,
  Confidence,
  LabSummary,
  LabView,
  MilestoneStatus,
  MilestoneView,
  PackSummary,
  SmokeResult,
  Submission,
} from '../../shared/labs'
import { REFLECT_QUESTION, RESUBMIT_QUESTION, isConfidence, verdictOf, wantsReflection } from '../../shared/labs'
import { labWorkbenchId, parseLabWorkbenchId, type WorkbenchCell, type WorkbenchDoc } from '../../shared/runtime'
import { parseCells } from '../../shared/workbenchFile'
import { getRuntimeStatus } from '../runtime/envManager'
import { newCellId, openWorkbench, seedWorkbench, workbenchDir } from '../runtime/workbenchStore'
import { startCheck, type RunningCheck } from './checkRunner'
import { reportFields, signReport } from './checkReport'
import {
  findLab,
  loadedPacks,
  packLayerId,
  reloadPacks,
  resolveInside,
  type LoadedLab,
  type LoadedPack,
} from './packStore'

/**
 * The learner's side of a pack lab, in app userData:
 *
 *     labs/packs/<pack>/<lab>/lab.py, meta.json, results.json   the workbench (see workbenchStore.ts)
 *     labs/records/<pack>/<lab>/submissions.json                every Submit, sealed or not
 *     labs/records/<pack>/<lab>/submissions/<m>-<n>/            the cells as frozen at that Submit, and the raw results
 *     labs/records/<pack>/<lab>/smoke/                          the last smoke run's work folder
 *     labs/.check-key                                           the HMAC key that signs reports
 *
 * The records sit outside the workbench folder, which is the kernel's and the
 * check's working directory, so the learner's code does not find sealed
 * results beside it by accident; while a submission is sealed the lab's
 * kernel is refused anyway (see labIsSealed).
 *
 * Submit, in the engine's order: the cells are frozen and the hidden tests
 * start; the learner writes the explain-back without any result in view; a
 * confidence is picked; only then does main hand over the results and the
 * signed report. Main enforces that order: until the pick, a submission
 * goes over the wire with its run and report blanked, whatever main knows.
 * The report is signed at that moment, so it carries the confidence and the
 * explain-back's hash.
 *
 * Feedback is tiered. Smoke and slip failures show their message. A core
 * failure shows only which behaviour failed (the test's docstring) until the
 * milestone has passed: the assertion text often holds the expected value,
 * and handing that over turns the next attempt into copying.
 *
 * A milestone's receipt is app-side (tests, time, the explain-back). It is
 * not learning state: no rating, schedule or stamp is written here, and
 * nothing here names the learning home. Doctrine: a pinned writer (D2).
 */

const SUB_ID = /^([a-z0-9][a-z0-9-]{0,31})-(\d{1,4})$/

/** What main keeps per submission; `run` and `report` never leave while sealed. */
interface StoredSubmission extends Submission {
  workDir: string
  /** The env the run used, for the report signed at unseal. */
  env?: string
}

interface SubmissionsFile {
  submissions: StoredSubmission[]
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, text, 'utf-8')
  await rename(tmp, path)
}

let keyPromise: Promise<Buffer> | null = null

/** This install's report-signing key, made on first use. It never leaves the machine. */
export function checkKey(): Promise<Buffer> {
  keyPromise ??= (async () => {
    const dir = join(app.getPath('userData'), 'labs')
    const p = join(dir, '.check-key')
    try {
      const hex = (await readFile(p, 'utf-8')).trim()
      if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex')
    } catch {
      // Made below.
    }
    await mkdir(dir, { recursive: true })
    const key = randomBytes(32)
    await writeAtomic(p, key.toString('hex'))
    await chmod(p, 0o600).catch(() => {})
    return key
  })()
  // A failed read or write is retried on the next call rather than cached.
  keyPromise.catch(() => {
    keyPromise = null
  })
  return keyPromise
}

/** The records folder of a lab: submissions and check work, outside the workbench folder. */
export function recordsDir(packId: string, labId: string): string {
  const id = labWorkbenchId(packId, labId)
  workbenchDir(id) // validates both ids
  return join(app.getPath('userData'), 'labs', 'records', packId, labId)
}

function subsPath(dir: string): string {
  return join(dir, 'submissions.json')
}

async function readSubs(dir: string): Promise<StoredSubmission[]> {
  try {
    const raw = JSON.parse(await readFile(subsPath(dir), 'utf-8')) as Partial<SubmissionsFile>
    return Array.isArray(raw.submissions) ? raw.submissions.map(normalise) : []
  } catch {
    return []
  }
}

/** Writes to one lab's submissions.json run one at a time. */
const locks = new Map<string, Promise<unknown>>()
function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(dir) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(
    dir,
    next.catch(() => {}),
  )
  return next
}

async function updateSubs(
  dir: string,
  fn: (subs: StoredSubmission[]) => void | Promise<void>,
): Promise<StoredSubmission[]> {
  return withLock(dir, async () => {
    const subs = await readSubs(dir)
    await fn(subs)
    await mkdir(dir, { recursive: true })
    await writeAtomic(subsPath(dir), JSON.stringify({ submissions: subs }, null, 2))
    return subs
  })
}

/** Core failure text stays in main until the milestone has passed. */
export function tierFeedback(tests: CheckOutcome[], milestonePassed: boolean): CheckOutcome[] {
  if (milestonePassed) return tests
  return tests.map((t) => (t.tier === 'core' && t.outcome !== 'passed' ? { ...t, message: '' } : t))
}

/** Has a submission for this milestone passed its core tests? */
function milestonePassed(subs: StoredSubmission[], milestoneId: string): boolean {
  return subs.some(
    (s) => s.milestoneId === milestoneId && !s.sealed && !!s.run && ['passed', 'slip'].includes(verdictOf(s.run)),
  )
}

/** What the renderer may see: nothing about the run until the seal breaks, and no core failure text until a pass. */
function redact(s: StoredSubmission, all: StoredSubmission[]): Submission {
  const { workDir: _w, env: _e, ...pub } = s
  if (s.sealed) return { ...pub, finished: false, run: null, report: null, verdict: null, reflectionPrompt: null }
  if (!pub.run) return pub
  return { ...pub, run: { ...pub.run, tests: tierFeedback(pub.run.tests, milestonePassed(all, s.milestoneId)) } }
}

/** Older records, and fields added since, read with their defaults. */
function normalise(s: StoredSubmission): StoredSubmission {
  return {
    ...s,
    explainBackPrompt: s.explainBackPrompt ?? '',
    reflectionPrompt: s.reflectionPrompt ?? null,
    reflection: s.reflection ?? null,
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function milestoneViews(lab: LoadedLab, subs: StoredSubmission[]): MilestoneView[] {
  let gateOpen = true
  return lab.manifest.milestones.map((m) => {
    const mine = subs.filter((s) => s.milestoneId === m.id)
    const passed = milestonePassed(subs, m.id)
    let status: MilestoneStatus
    if (!m.hidden) status = 'brief'
    else if (!gateOpen) status = 'locked'
    else if (passed) status = 'passed'
    else if (mine.some((s) => s.sealed)) status = 'submitted'
    else status = 'open'
    if (m.hidden) gateOpen = gateOpen && passed
    return {
      id: m.id,
      title: m.title,
      brief: m.brief,
      hasSmoke: !!m.smoke,
      hasHidden: !!m.hidden,
      explainBack: m.explainBack,
      timeLimitS: m.timeLimitS,
      status,
    }
  })
}

async function labSummary(pack: LoadedPack, lab: LoadedLab): Promise<LabSummary> {
  const packId = pack.manifest!.id
  const dir = workbenchDir(labWorkbenchId(packId, lab.manifest.id))
  const subs = await readSubs(recordsDir(packId, lab.manifest.id))
  const views = milestoneViews(lab, subs)
  let started = false
  try {
    await readFile(join(dir, 'meta.json'))
    started = true
  } catch {
    started = false
  }
  return {
    packId,
    labId: lab.manifest.id,
    title: lab.manifest.title,
    kicker: lab.manifest.kicker,
    summary: lab.manifest.summary,
    milestones: views.filter((v) => v.status !== 'brief').length,
    passed: views.filter((v) => v.status === 'passed').length,
    started,
  }
}

export async function listPacks(refresh = false): Promise<PackSummary[]> {
  const packs = refresh ? await reloadPacks() : await loadedPacks()
  const out: PackSummary[] = []
  for (const p of packs) {
    const labs: LabSummary[] = []
    if (p.manifest) for (const l of p.labs) labs.push(await labSummary(p, l))
    out.push({
      folder: p.folder,
      id: p.manifest?.id ?? null,
      title: p.manifest?.title ?? p.folder.split(/[\\/]/).pop() ?? p.folder,
      version: p.manifest?.version ?? '',
      description: p.manifest?.description ?? '',
      layer: packLayerId(p),
      labs,
      error: p.error,
    })
  }
  return out
}

export async function labView(packId: string, labId: string): Promise<LabView> {
  const { pack, lab } = await findLab(packId, labId)
  const workbenchId = labWorkbenchId(packId, labId)
  const subs = await settleOrphans(packId, labId)
  return {
    packId,
    labId,
    workbenchId,
    packTitle: pack.manifest!.title,
    title: lab.manifest.title,
    kicker: lab.manifest.kicker,
    summary: lab.manifest.summary,
    layer: packLayerId(pack),
    milestones: milestoneViews(lab, subs),
    submissions: subs.map((x) => redact(x, subs)),
  }
}

/** Is a submission of this lab sealed? Its kernel is refused until the seal breaks. */
export async function labIsSealed(workbenchId: string): Promise<boolean> {
  const lab = parseLabWorkbenchId(workbenchId)
  if (!lab) return false
  return (await readSubs(recordsDir(lab.packId, lab.labId))).some((s) => s.sealed)
}

// ---------------------------------------------------------------------------
// The learner's copy
// ---------------------------------------------------------------------------

async function starterCells(pack: LoadedPack, lab: LoadedLab): Promise<WorkbenchCell[]> {
  if (!lab.manifest.starter) return []
  const path = await resolveInside(pack.root!, lab.dir, lab.manifest.starter)
  let missing = 0
  const cells = parseCells(await readFile(path, 'utf-8'), () => `__missing${missing++}`)
  // Given cells are refreshed by id on every open, so an id the parser made up
  // would match nothing next time.
  if (missing) throw new Error(`${lab.manifest.starter}: give every cell an id (# %% id=…).`)
  return cells
}

/**
 * Brings the pack's given cells into a lab already under way: each is
 * refreshed from the starter by id, and one the starter has gained since is
 * inserted after the cell that precedes it in the starter (or at the top).
 */
export function mergeGiven(cells: WorkbenchCell[], starter: WorkbenchCell[]): WorkbenchCell[] {
  const given = new Map(starter.filter((c) => c.kind === 'given').map((c) => [c.id, c.source]))
  const out = cells.map((c) => (c.kind === 'given' && given.has(c.id) ? { ...c, source: given.get(c.id)! } : c))
  const have = new Set(out.map((c) => c.id))
  starter.forEach((c, i) => {
    if (c.kind !== 'given' || have.has(c.id)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((x) => x.id === starter[j].id)
      if (k >= 0) {
        at = k + 1
        break
      }
    }
    out.splice(at, 0, { ...c })
    have.add(c.id)
  })
  return out
}

/**
 * Opens the learner's copy of a lab, making it from the pack's starter the
 * first time. Given cells are the pack's, read-only in the workbench, so on
 * every open they are refreshed from the starter by id: a pack update that
 * fixes a given cell reaches a lab already under way.
 */
export async function openLab(packId: string, labId: string): Promise<WorkbenchDoc> {
  const { pack, lab } = await findLab(packId, labId)
  const id = labWorkbenchId(packId, labId)
  const starter = await starterCells(pack, lab)
  let doc: WorkbenchDoc
  try {
    doc = await openWorkbench(id)
  } catch {
    const cells = starter.length ? starter : [{ id: newCellId(), kind: 'code' as const, source: '' }]
    return seedWorkbench(id, lab.manifest.title, cells)
  }
  doc.cells = mergeGiven(doc.cells, starter)
  return doc
}

/** The runnable cells of the saved lab.py, in order: what a check executes. */
function runnableCells(text: string): { id: string; source: string }[] {
  return parseCells(text, newCellId)
    .filter((c) => c.kind !== 'note')
    .map((c) => ({ id: c.id, source: c.source }))
}

async function layerReady(layer: string): Promise<boolean> {
  const st = await getRuntimeStatus()
  return st.layers.some((l) => l.id === layer && (l.state === 'ready' || (l.state === 'installing' && !!l.envDir)))
}

// ---------------------------------------------------------------------------
// Smoke checks: visible, any time, never sealed
// ---------------------------------------------------------------------------

/** Smoke runs by lab records folder; a null entry is one still being set up. */
const smokeRuns = new Map<string, RunningCheck | null>()

export async function runSmoke(packId: string, labId: string, milestoneId: string): Promise<SmokeResult> {
  const { pack, lab } = await findLab(packId, labId)
  const m = lab.manifest.milestones.find((x) => x.id === milestoneId)
  if (!m?.smoke) throw new Error('This milestone has no smoke checks.')
  const records = recordsDir(packId, labId)
  // Claimed before the first await below, so two quick clicks cannot both start.
  if (smokeRuns.has(records)) throw new Error('A smoke run is already going for this lab.')
  smokeRuns.set(records, null)
  try {
    if ((await readSubs(records)).some((s) => s.sealed))
      throw new Error('Finish the submission under way first: its explain-back and confidence come before more checks.')
    const layer = packLayerId(pack)
    if (!(await layerReady(layer))) throw new Error(`Install the ${layer} runtime layer in Settings first.`)
    const dir = workbenchDir(labWorkbenchId(packId, labId))
    const work = join(records, 'smoke')
    await rm(work, { recursive: true, force: true })
    await mkdir(work, { recursive: true })
    await writeFile(
      join(work, 'cells.json'),
      JSON.stringify(runnableCells(await readFile(join(dir, 'lab.py'), 'utf-8'))),
      'utf-8',
    )
    const tests = await resolveInside(pack.root!, lab.dir, m.smoke)
    const running = startCheck({
      layer,
      workDir: work,
      cwd: dir,
      testsPath: tests,
      mode: 'smoke',
      timeLimitS: m.timeLimitS,
    })
    smokeRuns.set(records, running)
    return { milestoneId, run: await running.done, at: new Date().toISOString() }
  } finally {
    smokeRuns.delete(records)
  }
}

export function cancelSmoke(packId: string, labId: string): void {
  smokeRuns.get(recordsDir(packId, labId))?.cancel()
}

// ---------------------------------------------------------------------------
// Submit → explain-back → confidence → unseal
// ---------------------------------------------------------------------------

/** Hidden runs in flight, by submission work folder. */
const hiddenRuns = new Map<string, { done: Promise<unknown>; cancel: () => void }>()

function locate(
  packId: string,
  labId: string,
  submissionId: string,
): { dir: string; work: string; milestoneId: string } {
  const m = SUB_ID.exec(submissionId)
  if (!m) throw new Error('Invalid submission id')
  const dir = recordsDir(packId, labId)
  return { dir, work: join(dir, 'submissions', submissionId), milestoneId: m[1] }
}

function brokenRun(error: string): CheckRun {
  return { completed: false, error, tests: [], seconds: 0 }
}

/** The env a run used, "<layer>-<lockhash>" (its folder name), for the report. */
async function envName(layer: string): Promise<string> {
  const info = (await getRuntimeStatus()).layers.find((l) => l.id === layer)
  return info?.envDir?.split(/[\\/]/).pop() || `${layer}-${info?.lockHash || 'unknown'}`
}

export async function submitMilestone(packId: string, labId: string, milestoneId: string): Promise<Submission> {
  const { pack, lab } = await findLab(packId, labId)
  const m = lab.manifest.milestones.find((x) => x.id === milestoneId)
  if (!m?.hidden) throw new Error('This milestone has nothing to submit.')
  const layer = packLayerId(pack)
  if (!(await layerReady(layer))) throw new Error(`Install the ${layer} runtime layer in Settings first.`)
  const testsPath = await resolveInside(pack.root!, lab.dir, m.hidden)
  const env = await envName(layer)
  const labDir = workbenchDir(labWorkbenchId(packId, labId))
  const dir = recordsDir(packId, labId)
  // Frozen: the check and the hash both read this text, never the live file.
  const labPy = await readFile(join(labDir, 'lab.py'))
  const codeHash = createHash('sha256').update(labPy).digest('hex').slice(0, 12)

  // One locked step from "is anything sealed?" to the record on disk and the
  // run registered, so a second Submit cannot slip in between.
  let sub: StoredSubmission | undefined
  const subs = await updateSubs(dir, async (all) => {
    const status = milestoneViews(lab, all).find((v) => v.id === milestoneId)?.status
    if (status === 'locked') throw new Error('An earlier milestone has to pass first.')
    if (all.some((s) => s.sealed)) throw new Error('Finish the submission already under way first.')
    const prior = all.filter((s) => s.milestoneId === milestoneId)
    const seq = prior.reduce((n, s) => Math.max(n, s.seq), 0) + 1
    const id = `${milestoneId}-${seq}`
    const work = join(dir, 'submissions', id)
    await rm(work, { recursive: true, force: true })
    await mkdir(work, { recursive: true })
    await writeFile(join(work, 'lab.py'), labPy)
    await writeFile(join(work, 'cells.json'), JSON.stringify(runnableCells(labPy.toString('utf-8'))), 'utf-8')
    sub = {
      id,
      milestoneId,
      seq,
      submittedAt: new Date().toISOString(),
      codeHash,
      // A second try asks about the change, not the method again.
      explainBackPrompt: prior.length ? RESUBMIT_QUESTION : m.explainBack,
      explainBack: null,
      confidence: null,
      reflectionPrompt: null,
      reflection: null,
      sealed: true,
      finished: false,
      run: null,
      report: null,
      verdict: null,
      env,
      workDir: work,
    }
    all.push(sub)
    const running = startCheck({
      layer,
      workDir: work,
      cwd: labDir,
      testsPath,
      mode: 'hidden',
      timeLimitS: m.timeLimitS,
    })
    const done = running.done
      .catch((e: unknown) => brokenRun(`The check could not run: ${e instanceof Error ? e.message : String(e)}`))
      .then((run) => recordRun(dir, id, run))
      .catch(() => {})
      .finally(() => hiddenRuns.delete(work))
    hiddenRuns.set(work, { done, cancel: running.cancel })
  })
  return redact(sub!, subs)
}

/** Stores a finished hidden run. The submission stays sealed; the report is signed at unseal. */
async function recordRun(dir: string, id: string, run: CheckRun): Promise<void> {
  await updateSubs(dir, (subs) => {
    const s = subs.find((x) => x.id === id)
    if (s && !s.finished) Object.assign(s, { finished: true, run, verdict: verdictOf(run) })
  })
}

export async function submitExplainBack(
  packId: string,
  labId: string,
  submissionId: string,
  text: string,
): Promise<Submission> {
  const { dir } = locate(packId, labId, submissionId)
  const clean = String(text ?? '').trim()
  if (!clean) throw new Error('Write the explain-back first.')
  if (clean.length > EXPLAIN_BACK_MAX) throw new Error(`Keep the explain-back under ${EXPLAIN_BACK_MAX} characters.`)
  let out: StoredSubmission | undefined
  const subs = await updateSubs(dir, (subs) => {
    const s = subs.find((x) => x.id === submissionId)
    if (!s) throw new Error('No such submission.')
    if (!s.sealed || s.explainBack !== null) throw new Error('This submission already has its explain-back.')
    s.explainBack = clean
    out = s
  })
  return redact(out!, subs)
}

/** Breaks the seal: a run the app lost becomes broken, and the report is signed with the confidence. */
async function unseal(packId: string, labId: string, submissionId: string): Promise<StoredSubmission[]> {
  const { dir, work } = locate(packId, labId, submissionId)
  await hiddenRuns.get(work)?.done
  const key = await checkKey()
  return updateSubs(dir, (all) => {
    const s = all.find((x) => x.id === submissionId)
    if (!s || !s.sealed || s.confidence === null || s.explainBack === null) return
    if (!s.finished) {
      // The app closed mid-run: nothing will finish it now.
      const run = brokenRun('The app closed before the hidden tests finished. Submit again.')
      Object.assign(s, { finished: true, run, verdict: verdictOf(run) })
    }
    s.report = signReport(
      reportFields({
        lab: `${packId}/${labId}`,
        milestone: s.milestoneId,
        seq: s.seq,
        run: s.run!,
        env: s.env ?? 'unknown',
        codeHash: s.codeHash,
        at: new Date(s.submittedAt),
        confidence: s.confidence,
        explainBack: s.explainBack,
      }),
      key,
    )
    s.reflectionPrompt = wantsReflection(s.confidence, s.verdict) ? REFLECT_QUESTION : null
    s.sealed = false
  })
}

/**
 * Submissions whose confidence was picked but which are still sealed: the
 * app quit between the pick and the unseal. They unseal now (as broken, if
 * their run was lost too), so a lab never stays sealed for good.
 */
async function settleOrphans(packId: string, labId: string): Promise<StoredSubmission[]> {
  const dir = recordsDir(packId, labId)
  let subs = await readSubs(dir)
  for (const s of subs) {
    if (s.sealed && s.confidence !== null && !hiddenRuns.has(s.workDir)) subs = await unseal(packId, labId, s.id)
  }
  return subs
}

/**
 * The pick that breaks the seal. Waits for the hidden run if it is still
 * going. Picking again with the same confidence (after a crash, or a double
 * click) carries on rather than failing.
 */
export async function pickConfidence(
  packId: string,
  labId: string,
  submissionId: string,
  confidence: Confidence,
): Promise<Submission> {
  if (!isConfidence(confidence)) throw new Error('Pick one of the four confidence levels.')
  const { dir } = locate(packId, labId, submissionId)
  await updateSubs(dir, (subs) => {
    const s = subs.find((x) => x.id === submissionId)
    if (!s) throw new Error('No such submission.')
    if (!s.sealed) return
    if (s.explainBack === null) throw new Error('Write the explain-back before picking a confidence.')
    if (s.confidence !== null && s.confidence !== confidence) throw new Error('A confidence is already picked.')
    s.confidence = confidence
  })
  const subs = await unseal(packId, labId, submissionId)
  return redact(subs.find((x) => x.id === submissionId)!, subs)
}

/** The answer to the sure-but-wrong question, asked once the results are in view. */
export async function submitReflection(
  packId: string,
  labId: string,
  submissionId: string,
  text: string,
): Promise<Submission> {
  const { dir } = locate(packId, labId, submissionId)
  const clean = String(text ?? '').trim()
  if (!clean) throw new Error('Write a line first.')
  if (clean.length > EXPLAIN_BACK_MAX) throw new Error(`Keep it under ${EXPLAIN_BACK_MAX} characters.`)
  let out: StoredSubmission | undefined
  const subs = await updateSubs(dir, (subs) => {
    const s = subs.find((x) => x.id === submissionId)
    if (!s) throw new Error('No such submission.')
    if (s.sealed || !s.reflectionPrompt) throw new Error('This submission asks no such question.')
    if (s.reflection !== null) throw new Error('This submission already has its answer.')
    s.reflection = clean
    out = s
  })
  return redact(out!, subs)
}

/** The learner's turn for the tutor: the signed report, the explain-back, and the reflection if any. */
export async function submissionProduction(packId: string, labId: string, submissionId: string): Promise<string> {
  const { dir } = locate(packId, labId, submissionId)
  const s = (await readSubs(dir)).find((x) => x.id === submissionId)
  if (!s || s.sealed || !s.report) throw new Error('That submission is still sealed.')
  const parts = [s.report, `${s.explainBackPrompt}\n${s.explainBack ?? ''}`]
  if (s.reflectionPrompt && s.reflection) parts.push(`${s.reflectionPrompt}\n${s.reflection}`)
  return parts.join('\n\n')
}

/** The frozen copy's folder, for the learner to look at what was submitted. Only once unsealed. */
export async function submissionDir(packId: string, labId: string, submissionId: string): Promise<string> {
  const { dir, work } = locate(packId, labId, submissionId)
  const s = (await readSubs(dir)).find((x) => x.id === submissionId)
  if (!s || s.sealed) throw new Error('That submission is still sealed.')
  return work
}

/** Stops every check: at quit, or when the runtime goes away. A run's process group must not outlive it. */
export function cancelAllChecks(): void {
  for (const r of smokeRuns.values()) r?.cancel()
  for (const r of hiddenRuns.values()) r.cancel()
}

/** Stops the checks of one pack's labs, when the pack is removed. */
export function cancelPackChecks(packId: string): void {
  const root = join(app.getPath('userData'), 'labs', 'records', packId) + sep
  for (const [k, r] of smokeRuns) if ((k + sep).startsWith(root)) r?.cancel()
  for (const [k, r] of hiddenRuns) if (k.startsWith(root)) r.cancel()
}
