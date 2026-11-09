import { app } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EXPLAIN_BACK_MAX } from '../../shared/contentPack'
import type {
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
import { isConfidence, verdictOf } from '../../shared/labs'
import { labWorkbenchId, type WorkbenchCell, type WorkbenchDoc } from '../../shared/runtime'
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
 *     labs/packs/<pack>/<lab>/submissions.json                  every Submit, sealed or not
 *     labs/packs/<pack>/<lab>/submissions/<m>-<n>/lab.py        the cells as frozen at that Submit
 *     labs/packs/<pack>/<lab>/.checks/smoke/                    the last smoke run's work folder
 *     labs/.check-key                                           the HMAC key that signs reports
 *
 * Submit, in the engine's order: the cells are frozen and the hidden tests
 * start; the learner writes the explain-back without any result in view; a
 * confidence is picked; only then does main hand over the results and the
 * signed report. Main enforces that order: until the pick, a submission
 * goes over the wire with its run and report blanked, whatever main knows.
 *
 * A milestone's receipt is app-side (tests, time, the explain-back). It is
 * not learning state: no rating, schedule or stamp is written here, and
 * nothing here names the learning home. Doctrine: a pinned writer (D2).
 */

const SUB_ID = /^([a-z0-9][a-z0-9-]{0,31})-(\d{1,4})$/

/** What main keeps per submission; `run` and `report` never leave while sealed. */
interface StoredSubmission extends Submission {
  workDir: string
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
  return keyPromise
}

function subsPath(dir: string): string {
  return join(dir, 'submissions.json')
}

async function readSubs(dir: string): Promise<StoredSubmission[]> {
  try {
    const raw = JSON.parse(await readFile(subsPath(dir), 'utf-8')) as Partial<SubmissionsFile>
    return Array.isArray(raw.submissions) ? raw.submissions : []
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

async function updateSubs(dir: string, fn: (subs: StoredSubmission[]) => void): Promise<StoredSubmission[]> {
  return withLock(dir, async () => {
    const subs = await readSubs(dir)
    fn(subs)
    await mkdir(dir, { recursive: true })
    await writeAtomic(subsPath(dir), JSON.stringify({ submissions: subs }, null, 2))
    return subs
  })
}

/** What the renderer may see: nothing about the run until the seal breaks. */
function redact(s: StoredSubmission): Submission {
  const { workDir: _w, ...pub } = s
  return s.sealed ? { ...pub, run: null, report: null, verdict: null } : pub
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function milestoneViews(lab: LoadedLab, subs: StoredSubmission[]): MilestoneView[] {
  let gateOpen = true
  return lab.manifest.milestones.map((m) => {
    const mine = subs.filter((s) => s.milestoneId === m.id)
    const passed = mine.some(
      (s) => !s.sealed && s.run && (verdictOf(s.run) === 'passed' || verdictOf(s.run) === 'slip'),
    )
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
  const subs = await readSubs(dir)
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
  const subs = await readSubs(workbenchDir(workbenchId))
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
    submissions: subs.map(redact),
  }
}

// ---------------------------------------------------------------------------
// The learner's copy
// ---------------------------------------------------------------------------

async function starterCells(pack: LoadedPack, lab: LoadedLab): Promise<WorkbenchCell[]> {
  if (!lab.manifest.starter) return []
  const path = await resolveInside(pack.root!, lab.dir, lab.manifest.starter)
  return parseCells(await readFile(path, 'utf-8'), newCellId)
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
  const given = new Map(starter.filter((c) => c.kind === 'given').map((c) => [c.id, c.source]))
  doc.cells = doc.cells.map((c) => (c.kind === 'given' && given.has(c.id) ? { ...c, source: given.get(c.id)! } : c))
  return doc
}

/** The runnable cells of the saved lab.py, in order: what a check executes. */
async function frozenCells(labPy: string): Promise<{ id: string; source: string }[]> {
  return parseCells(await readFile(labPy, 'utf-8'), newCellId)
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

const smokeRuns = new Map<string, RunningCheck>()

export async function runSmoke(packId: string, labId: string, milestoneId: string): Promise<SmokeResult> {
  const { pack, lab } = await findLab(packId, labId)
  const m = lab.manifest.milestones.find((x) => x.id === milestoneId)
  if (!m?.smoke) throw new Error('This milestone has no smoke checks.')
  const layer = packLayerId(pack)
  if (!(await layerReady(layer))) throw new Error(`Install the ${layer} runtime layer in Settings first.`)
  const dir = workbenchDir(labWorkbenchId(packId, labId))
  if (smokeRuns.has(dir)) throw new Error('A smoke run is already going for this lab.')
  const work = join(dir, '.checks', 'smoke')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  await writeFile(join(work, 'cells.json'), JSON.stringify(await frozenCells(join(dir, 'lab.py'))), 'utf-8')
  const tests = await resolveInside(pack.root!, lab.dir, m.smoke)
  const running = startCheck({
    layer,
    workDir: work,
    testsPath: tests,
    mode: 'smoke',
    timeLimitS: m.timeLimitS,
  })
  smokeRuns.set(dir, running)
  try {
    return {
      milestoneId,
      run: await running.done,
      at: new Date().toISOString(),
    }
  } finally {
    smokeRuns.delete(dir)
  }
}

export function cancelSmoke(packId: string, labId: string): void {
  smokeRuns.get(workbenchDir(labWorkbenchId(packId, labId)))?.cancel()
}

// ---------------------------------------------------------------------------
// Submit → explain-back → confidence → unseal
// ---------------------------------------------------------------------------

/** Hidden runs in flight, by submission work folder. */
const hiddenRuns = new Map<string, { done: Promise<CheckRun>; cancel: () => void }>()

function locate(packId: string, labId: string, submissionId: string): { dir: string; milestoneId: string } {
  const m = SUB_ID.exec(submissionId)
  if (!m) throw new Error('Invalid submission id')
  return {
    dir: workbenchDir(labWorkbenchId(packId, labId)),
    milestoneId: m[1],
  }
}

export async function submitMilestone(packId: string, labId: string, milestoneId: string): Promise<Submission> {
  const { pack, lab } = await findLab(packId, labId)
  const dir = workbenchDir(labWorkbenchId(packId, labId))
  const m = lab.manifest.milestones.find((x) => x.id === milestoneId)
  if (!m?.hidden) throw new Error('This milestone has nothing to submit.')
  const before = await readSubs(dir)
  const status = milestoneViews(lab, before).find((v) => v.id === milestoneId)?.status
  if (status === 'locked') throw new Error('An earlier milestone has to pass first.')
  if (before.some((s) => s.sealed)) throw new Error('Finish the submission already under way first.')
  const layer = packLayerId(pack)
  if (!(await layerReady(layer))) throw new Error(`Install the ${layer} runtime layer in Settings first.`)
  const testsPath = await resolveInside(pack.root!, lab.dir, m.hidden)
  const envInfo = (await getRuntimeStatus()).layers.find((l) => l.id === layer)

  const seq = before.filter((s) => s.milestoneId === milestoneId).reduce((n, s) => Math.max(n, s.seq), 0) + 1
  const id = `${milestoneId}-${seq}`
  const work = join(dir, 'submissions', id)
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  // Frozen: the check and the hash both read this copy, never the live file.
  await copyFile(join(dir, 'lab.py'), join(work, 'lab.py'))
  const labPy = await readFile(join(work, 'lab.py'))
  const codeHash = createHash('sha256').update(labPy).digest('hex').slice(0, 12)
  await writeFile(join(work, 'cells.json'), JSON.stringify(await frozenCells(join(work, 'lab.py'))), 'utf-8')

  const sub: StoredSubmission = {
    id,
    milestoneId,
    seq,
    submittedAt: new Date().toISOString(),
    codeHash,
    explainBack: null,
    confidence: null,
    sealed: true,
    finished: false,
    run: null,
    report: null,
    verdict: null,
    workDir: work,
  }
  // The env the run used, "<layer>-<lockhash>" (its folder name), for the report.
  const env = envInfo?.envDir?.split(/[\\/]/).pop() || `${layer}-${envInfo?.lockHash || 'unknown'}`
  await updateSubs(dir, (subs) => subs.push(sub))

  const running = startCheck({
    layer,
    workDir: work,
    testsPath,
    mode: 'hidden',
    timeLimitS: m.timeLimitS,
  })
  const done = running.done.then(async (run) => {
    const key = await checkKey()
    const report = signReport(
      reportFields({
        lab: `${packId}/${labId}`,
        milestone: milestoneId,
        seq,
        run,
        env,
        codeHash,
        at: new Date(),
      }),
      key,
    )
    await updateSubs(dir, (subs) => {
      const s = subs.find((x) => x.id === id)
      if (s)
        Object.assign(s, {
          finished: true,
          run,
          report,
          verdict: verdictOf(run),
        })
    })
    return run
  })
  hiddenRuns.set(work, { done, cancel: running.cancel })
  void done.catch(() => {}).finally(() => hiddenRuns.delete(work))
  return redact(sub)
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
  await updateSubs(dir, (subs) => {
    const s = subs.find((x) => x.id === submissionId)
    if (!s) throw new Error('No such submission.')
    if (!s.sealed || s.explainBack !== null) throw new Error('This submission already has its explain-back.')
    s.explainBack = clean
    out = s
  })
  return redact(out!)
}

/**
 * The pick that breaks the seal. Waits for the hidden run if it is still
 * going. A run the app lost (it was closed mid-run) unseals as broken, so the
 * learner submits again instead of waiting forever.
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
    if (!s.sealed) throw new Error('This submission is already unsealed.')
    if (s.explainBack === null) throw new Error('Write the explain-back before picking a confidence.')
    if (s.confidence !== null) throw new Error('A confidence is already picked.')
    s.confidence = confidence
  })
  await hiddenRuns.get(join(dir, 'submissions', submissionId))?.done.catch(() => {})
  const key = await checkKey()
  const subs = await updateSubs(dir, (all) => {
    const s = all.find((x) => x.id === submissionId)
    if (!s) return
    if (!s.finished) {
      const run: CheckRun = {
        completed: false,
        error: 'The app closed before the hidden tests finished. Submit again.',
        tests: [],
        seconds: 0,
      }
      const [, mid, seq] = SUB_ID.exec(submissionId)!
      s.run = run
      s.verdict = verdictOf(run)
      s.report = signReport(
        reportFields({
          lab: `${packId}/${labId}`,
          milestone: mid,
          seq: Number(seq),
          run,
          env: 'unknown',
          codeHash: s.codeHash,
          at: new Date(),
        }),
        key,
      )
      s.finished = true
    }
    s.sealed = false
  })
  return redact(subs.find((x) => x.id === submissionId)!)
}

/** The learner's turn for the tutor: the signed report, then the explain-back. */
export async function submissionProduction(packId: string, labId: string, submissionId: string): Promise<string> {
  const { dir } = locate(packId, labId, submissionId)
  const s = (await readSubs(dir)).find((x) => x.id === submissionId)
  if (!s || s.sealed || !s.report) throw new Error('That submission is still sealed.')
  return `${s.report}\n\n${s.explainBack ?? ''}`
}

/** Opens the frozen copy's folder, for the learner to look at what was submitted. */
export function submissionDir(packId: string, labId: string, submissionId: string): string {
  const { dir } = locate(packId, labId, submissionId)
  return join(dir, 'submissions', submissionId)
}

/** Stops every check, at quit: a run's process group must not outlive the app. */
export function cancelAllChecks(): void {
  for (const r of smokeRuns.values()) r.cancel()
  for (const r of hiddenRuns.values()) r.cancel()
}
