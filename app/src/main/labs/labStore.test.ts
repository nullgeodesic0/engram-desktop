import { mkdtempSync, rmSync, symlinkSync, cpSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CheckRun, Submission } from '../../shared/labs'

const root = mkdtempSync(join(tmpdir(), 'engram-labs-'))
const userData = join(root, 'userData')
const packDir = join(root, 'example-pack')
const EXAMPLE = resolve(__dirname, '../../../../examples/example-pack')

vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false } }))
vi.mock('../runtime/envManager', () => ({
  getRuntimeStatus: async () => ({
    layers: [{ id: 'base', state: 'ready', envDir: '/rt/envs/base-0123456789ab', lockHash: '0123456789ab' }],
  }),
}))
let release: (run: CheckRun) => void = () => {}
const jobs: { mode: string; testsPath: string; workDir: string; cwd: string }[] = []
vi.mock('./checkRunner', () => ({
  startCheck: (job: { mode: string; testsPath: string; workDir: string; cwd: string }) => {
    jobs.push(job)
    if (job.mode === 'smoke') {
      return {
        done: Promise.resolve({
          completed: true,
          error: null,
          seconds: 1,
          tests: [
            { id: 's::test_shape', name: 'test_shape', about: '', tier: 'smoke', outcome: 'passed', message: '' },
          ],
        }),
        cancel: () => {},
      }
    }
    return { done: new Promise<CheckRun>((r) => (release = r)), cancel: () => {} }
  },
}))

const { addPackFolder, layerForWorkbench, packLayerDefs, removePackFolder } = await import('./packStore')
const labs = await import('./labStore')
const { verifyReport } = await import('./checkReport')

const passing: CheckRun = {
  completed: true,
  error: null,
  seconds: 3,
  tests: [
    { id: 'h::exact', name: 'test_exact_line', about: 'An exact line', tier: 'core', outcome: 'passed', message: '' },
    {
      id: 'h::floats',
      name: 'test_returns_plain_floats',
      about: 'Plain floats',
      tier: 'slip',
      outcome: 'failed',
      message: 'return Python floats',
    },
  ],
}

const failing: CheckRun = {
  completed: true,
  error: null,
  seconds: 2,
  tests: [
    {
      id: 'h::exact',
      name: 'test_exact_line',
      about: 'An exact line',
      tier: 'core',
      outcome: 'failed',
      message: 'expected slope 2, got 3',
    },
    {
      id: 'h::floats',
      name: 'test_returns_plain_floats',
      about: 'Plain floats',
      tier: 'slip',
      outcome: 'failed',
      message: 'return Python floats',
    },
  ],
}

const settle = () => new Promise((r) => setTimeout(r, 50))

beforeAll(() => cpSync(EXAMPLE, packDir, { recursive: true }))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('content packs and lab submissions', () => {
  it('adds the example pack and lists its lab on the base layer', async () => {
    await addPackFolder(packDir)
    const [p] = await labs.listPacks(true)
    expect(p).toMatchObject({ id: 'example-pack', layer: 'base', error: null })
    expect(p.labs[0]).toMatchObject({ labId: 'fit-a-line', milestones: 2, passed: 0, started: false })
    expect(await packLayerDefs()).toEqual([])
    expect(await layerForWorkbench('example-pack/fit-a-line')).toBe('base')
    await expect(addPackFolder(packDir)).rejects.toThrow(/already added/)
  })

  it('seeds the learner copy from the starter, and gives the milestones their states', async () => {
    const doc = await labs.openLab('example-pack', 'fit-a-line')
    expect(doc.cells.map((c) => c.kind)).toEqual(['given', 'note', 'code', 'code'])
    const v = await labs.labView('example-pack', 'fit-a-line')
    expect(v.milestones.map((m) => m.status)).toEqual(['open', 'locked', 'brief'])
    expect(v.milestones[0].brief).toContain('normal equations')
  })

  it('runs smoke checks in the open', async () => {
    const r = await labs.runSmoke('example-pack', 'fit-a-line', 'm1')
    expect(r.run.tests[0].outcome).toBe('passed')
    expect(jobs.at(-1)?.testsPath).toMatch(/smoke_m1\.py$/)
  })

  it('keeps results sealed until the explain-back and the confidence pick, in that order', async () => {
    await expect(labs.submitMilestone('example-pack', 'fit-a-line', 'm2')).rejects.toThrow(/earlier milestone/)
    // Two quick Submits: exactly one gets through.
    const both = await Promise.allSettled([
      labs.submitMilestone('example-pack', 'fit-a-line', 'm1'),
      labs.submitMilestone('example-pack', 'fit-a-line', 'm1'),
    ])
    expect(both.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const sub = (both.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Submission>).value
    expect(sub).toMatchObject({ id: 'm1-1', sealed: true, run: null, report: null })
    expect(sub.explainBackPrompt).toMatch(/normal equations/)
    expect(jobs.at(-1)!.workDir).toContain(join('labs', 'records', 'example-pack', 'fit-a-line'))
    expect(jobs.at(-1)!.cwd).toBe(join(userData, 'labs', 'packs', 'example-pack', 'fit-a-line'))
    expect(readFileSync(join(jobs.at(-1)!.workDir, 'lab.py'), 'utf-8')).toContain('def fit_line')
    expect(await labs.labIsSealed('example-pack/fit-a-line')).toBe(true)
    await expect(labs.runSmoke('example-pack', 'fit-a-line', 'm1')).rejects.toThrow(/under way/)
    await expect(labs.submissionDir('example-pack', 'fit-a-line', 'm1-1')).rejects.toThrow(/sealed/)
    await expect(labs.pickConfidence('example-pack', 'fit-a-line', 'm1-1', 'Certain')).rejects.toThrow(
      /explain-back before/,
    )
    await expect(labs.submissionProduction('example-pack', 'fit-a-line', 'm1-1')).rejects.toThrow(/sealed/)

    release(failing)
    await settle()
    // Finished in main, but nothing on the wire, not even that it finished.
    const mid = (await labs.labView('example-pack', 'fit-a-line')).submissions[0]
    expect(mid).toMatchObject({ finished: false, sealed: true, run: null, report: null, verdict: null })

    await labs.submitExplainBack(
      'example-pack',
      'fit-a-line',
      'm1-1',
      'Setting the gradient of the squared error to zero.',
    )
    await expect(labs.submitExplainBack('example-pack', 'fit-a-line', 'm1-1', 'again')).rejects.toThrow()
    const open = await labs.pickConfidence('example-pack', 'fit-a-line', 'm1-1', 'Certain')
    expect(open).toMatchObject({ sealed: false, confidence: 'Certain', verdict: 'core' })
    // Which behaviour failed, but not the expected value, until the milestone passes.
    const core = open.run!.tests.find((t) => t.tier === 'core')!
    expect(core).toMatchObject({ about: 'An exact line', outcome: 'failed', message: '' })
    expect(open.run!.tests.find((t) => t.tier === 'slip')!.message).toBe('return Python floats')
    // Sure, and wrong: one more question.
    expect(open.reflectionPrompt).toMatch(/assumption/)
    await labs.submitReflection('example-pack', 'fit-a-line', 'm1-1', 'I assumed polyfit returns intercept first.')
    expect(await labs.labIsSealed('example-pack/fit-a-line')).toBe(false)

    const key = await labs.checkKey()
    const fields = verifyReport(open.report!, key)
    expect(fields).toMatchObject({
      lab: 'example-pack/fit-a-line',
      milestone: 'm1',
      seq: 1,
      verdict: 'core',
      core: '0/1',
      slip: '0/1',
      env: 'base-0123456789ab',
      conf: 'certain',
    })
    expect(fields!.eb).toMatch(/^[0-9a-f]{12}$/)
    const production = await labs.submissionProduction('example-pack', 'fit-a-line', 'm1-1')
    expect(production.startsWith(`${open.report}\n\n`)).toBe(true)
    expect(production).toContain('Setting the gradient of the squared error to zero.')
    expect(production).toContain('I assumed polyfit returns intercept first.')
  })

  it('asks about the change on a resubmission, and shows core failure text once the milestone passes', async () => {
    const sub = await labs.submitMilestone('example-pack', 'fit-a-line', 'm1')
    expect(sub).toMatchObject({ id: 'm1-2', seq: 2 })
    expect(sub.explainBackPrompt).toMatch(/what did you change/)
    release(passing)
    await settle()
    await labs.submitExplainBack('example-pack', 'fit-a-line', 'm1-2', 'Swapped the order of the returned pair.')
    const open = await labs.pickConfidence('example-pack', 'fit-a-line', 'm1-2', 'Pretty sure')
    expect(open).toMatchObject({ verdict: 'slip', reflectionPrompt: null })
    const v = await labs.labView('example-pack', 'fit-a-line')
    const first = v.submissions.find((s) => s.id === 'm1-1')!
    expect(first.run!.tests.find((t) => t.tier === 'core')!.message).toBe('expected slope 2, got 3')
  })

  it('unseals a submission whose app quit between the pick and the results', async () => {
    // Simulate the crash: a sealed record with a confidence and no run in flight.
    const dir = labs.recordsDir('example-pack', 'fit-a-line')
    const file = join(dir, 'submissions.json')
    const data = JSON.parse(readFileSync(file, 'utf-8'))
    data.submissions.push({
      ...data.submissions[0],
      id: 'm1-3',
      seq: 3,
      sealed: true,
      finished: false,
      run: null,
      verdict: null,
      report: null,
      confidence: 'Half unsure',
      workDir: join(dir, 'submissions', 'm1-3'),
    })
    writeFileSync(file, JSON.stringify(data))
    const v = await labs.labView('example-pack', 'fit-a-line')
    const s = v.submissions.find((x) => x.id === 'm1-3')!
    expect(s).toMatchObject({ sealed: false, verdict: 'broken' })
    expect(s.run?.error).toMatch(/app closed/)
    expect(await labs.labIsSealed('example-pack/fit-a-line')).toBe(false)
  })

  it('opens the next milestone once the core tests pass', async () => {
    const v = await labs.labView('example-pack', 'fit-a-line')
    expect(v.milestones.map((m) => m.status)).toEqual(['passed', 'open', 'brief'])
  })

  it('refuses a pack whose files point outside its folder', async () => {
    const evil = join(root, 'evil-pack')
    cpSync(EXAMPLE, evil, { recursive: true })
    const pj = JSON.parse(readFileSync(join(evil, 'pack.json'), 'utf-8'))
    writeFileSync(join(evil, 'pack.json'), JSON.stringify({ ...pj, id: 'evil-pack' }))
    const outside = join(root, 'outside.py')
    writeFileSync(outside, 'def test_x(lab): pass\n')
    rmSync(join(evil, 'labs/fit-a-line/checks/hidden_m1.py'))
    symlinkSync(outside, join(evil, 'labs/fit-a-line/checks/hidden_m1.py'))
    await addPackFolder(evil)
    const p = (await labs.listPacks(true)).find((x) => x.id === 'evil-pack')!
    expect(p.error).toMatch(/points outside the pack/)
    expect(p.labs).toHaveLength(0)
    await removePackFolder(evil)
    expect((await labs.listPacks(true)).map((x) => x.id)).toEqual(['example-pack'])
  })

  it('opens worked steps one at a time, adds the partial solution once, and says so on the next Submit', async () => {
    let v = await labs.labView('example-pack', 'fit-a-line')
    const m1 = v.milestones[0]
    expect(m1).toMatchObject({ stepsTotal: 3, steps: [], hasCompletion: true, completionUsed: false })
    expect(m1.passedOn).toEqual({ seq: 2, unaided: true })
    expect(m1.worked).toContain('through the origin')
    expect(v.milestones[1].worked).toContain('constant')
    for (let i = 1; i <= 3; i++) {
      v = await labs.revealStep('example-pack', 'fit-a-line', 'm1')
      expect(v.milestones[0].steps).toHaveLength(i)
    }
    await expect(labs.revealStep('example-pack', 'fit-a-line', 'm1')).rejects.toThrow(/already open/)

    const before = (await labs.openLab('example-pack', 'fit-a-line')).cells.length
    const doc = await labs.addCompletion('example-pack', 'fit-a-line', 'm1')
    expect(doc.cells.length).toBe(before + 2)
    expect(doc.cells.at(-1)).toMatchObject({ id: 'm1-partial', kind: 'code' })
    expect((await labs.addCompletion('example-pack', 'fit-a-line', 'm1')).cells.length).toBe(before + 2)

    const sub = await labs.submitMilestone('example-pack', 'fit-a-line', 'm1')
    expect(sub).toMatchObject({ rung: 'completion', help: 3 })
    await expect(labs.revealStep('example-pack', 'fit-a-line', 'm1')).rejects.toThrow(/under way/)
    release(passing)
    await settle()
    await labs.submitExplainBack('example-pack', 'fit-a-line', sub.id, 'Finished the solve.')
    const open = await labs.pickConfidence('example-pack', 'fit-a-line', sub.id, 'Certain')
    expect(verifyReport(open.report!, await labs.checkKey())).toMatchObject({ rung: 'completion', help: 3 })
  })

  it('brings a given cell the starter gained into a lab under way', () => {
    const cell = (id: string, kind: 'given' | 'code' = 'code', source = id) => ({ id, kind, source })
    const merged = labs.mergeGiven(
      [cell('g1', 'given', 'old'), cell('mine')],
      [cell('g1', 'given', 'new'), cell('c1'), cell('g2', 'given'), cell('g0', 'given')],
    )
    expect(merged.map((c) => c.id)).toEqual(['g1', 'g2', 'g0', 'mine'])
    expect(merged[0].source).toBe('new')
  })

  it('refuses a starter cell without an id, and a brief file outside the pack', async () => {
    const bad = join(root, 'bad-pack')
    cpSync(EXAMPLE, bad, { recursive: true })
    const pj = JSON.parse(readFileSync(join(bad, 'pack.json'), 'utf-8'))
    writeFileSync(join(bad, 'pack.json'), JSON.stringify({ ...pj, id: 'bad-pack' }))
    const starter = join(bad, 'labs/fit-a-line/starter.py')
    writeFileSync(starter, readFileSync(starter, 'utf-8').replace('# %% id=c-r2', '# %%'))
    await addPackFolder(bad)
    await expect(labs.openLab('bad-pack', 'fit-a-line')).rejects.toThrow(/give every cell an id/)
    await removePackFolder(bad)

    const evil = join(root, 'evil-brief')
    cpSync(EXAMPLE, evil, { recursive: true })
    writeFileSync(join(evil, 'pack.json'), JSON.stringify({ ...pj, id: 'evil-brief' }))
    writeFileSync(join(root, 'secret.md'), 'secret')
    rmSync(join(evil, 'labs/fit-a-line/m1.md'))
    symlinkSync(join(root, 'secret.md'), join(evil, 'labs/fit-a-line/m1.md'))
    await addPackFolder(evil).catch(() => {})
    const p = (await labs.listPacks(true)).find((x) => x.id === 'evil-brief')
    expect(p?.labs ?? []).toHaveLength(0)
    if (p) await removePackFolder(evil)
  })

  it('shows a predicted output only once the guess is locked in, and only one guess', async () => {
    let m1 = (await labs.labView('example-pack', 'fit-a-line')).milestones[0]
    expect(m1.predict.map((x) => x.id)).toEqual(['design-matrix', 'at-y', 'solve-types'])
    expect(m1.predict.every((x) => x.output === null && x.why === null && x.correct === null)).toBe(true)
    m1 = (await labs.predictOutput('example-pack', 'fit-a-line', 'm1', 'design-matrix', '(2, 3)\n[2. 1.]'))
      .milestones[0]
    expect(m1.predict[0]).toMatchObject({ guess: '(2, 3)\n[2. 1.]', output: '(3, 2)\n[2. 1.]', correct: false })
    expect(m1.predict[0].why).toContain('column_stack')
    expect(m1.predict[1].output).toBeNull()
    await expect(labs.predictOutput('example-pack', 'fit-a-line', 'm1', 'design-matrix', '(3, 2)')).rejects.toThrow(
      /already locked/,
    )
    m1 = (await labs.predictOutput('example-pack', 'fit-a-line', 'm1', 'at-y', '[13.  9.]  \n')).milestones[0]
    expect(m1.predict[1].correct).toBe(true)
    await expect(labs.predictOutput('example-pack', 'fit-a-line', 'm1', 'nope', 'x')).rejects.toThrow(/No such/)
  })

  it('verifies a pasted report against the record, and hands back the record’s own answers', async () => {
    const v = await labs.labView('example-pack', 'fit-a-line')
    const first = v.submissions.find((x) => x.id === 'm1-1')!
    const r = await labs.lookupReport(`  ${first.report}\n`)
    expect(r).toMatchObject({
      verified: true,
      pack: 'example-pack',
      lab: 'fit-a-line',
      milestone: 'm1',
      milestoneTitle: 'The fit',
      topic: null,
      node: null,
      submission: 1,
      verdict: 'core',
      confidence: 90,
      explainBack: 'Setting the gradient of the squared error to zero.',
      reflection: 'I assumed polyfit returns intercept first.',
    })
    expect(r.verified && r.explainBackPrompt).toMatch(/normal equations/)
    // One changed character, and it no longer verifies.
    const forged = first.report!.replace('verdict=core', 'verdict=pass')
    expect(await labs.lookupReport(forged)).toMatchObject({ verified: false })
    expect(await labs.lookupReport('hello')).toMatchObject({ verified: false })
  })

  it('reads the lab’s cells for the tutor, but not while a submission is sealed', async () => {
    const live = await labs.readLabCells('example-pack', 'fit-a-line')
    expect(live.source).toBe('live')
    expect(live.cells.some((c) => c.source.includes('def fit_line'))).toBe(true)
    const frozen = await labs.readLabCells('example-pack', 'fit-a-line', { milestone: 'm1', submission: 1 })
    expect(frozen.source).toBe('submitted')
    await expect(labs.readLabCells('example-pack', 'fit-a-line', { milestone: 'm1', submission: 99 })).rejects.toThrow(
      /No such/,
    )
    const sub = await labs.submitMilestone('example-pack', 'fit-a-line', 'm2')
    await expect(labs.readLabCells('example-pack', 'fit-a-line')).rejects.toThrow(/sealed/)
    release(passing)
    await settle()
    await labs.submitExplainBack('example-pack', 'fit-a-line', sub.id, 'It is the explained share of the variance.')
    await labs.pickConfidence('example-pack', 'fit-a-line', sub.id, 'Half unsure')
    expect((await labs.readLabCells('example-pack', 'fit-a-line')).cells.length).toBeGreaterThan(0)
  })

  it('brings a passed milestone back a day later as a variant, in its own notebook', async () => {
    const now = new Date()
    let q = await labs.practiceQueue(now)
    expect(q.due).toEqual([])
    expect(q.later.map((x) => `${x.milestoneId}:${x.variantId}`)).toEqual(['m1:through-origin', 'm2:given-fit'])
    q = await labs.practiceQueue(new Date(now.getTime() + 2 * 86_400_000))
    expect(q.due.map((x) => x.milestoneId)).toEqual(['m1', 'm2'])

    await expect(labs.checkPractice('example-pack', 'fit-a-line', 'm1', 'Certain')).rejects.toThrow(/Open this item/)
    const s1 = await labs.startPractice('example-pack', 'fit-a-line', 'm1')
    expect(s1).toMatchObject({ workbenchId: 'example-pack/fit-a-line--practice', fresh: true })
    expect(s1.item).toMatchObject({ variantId: 'through-origin', brief: expect.stringContaining('fit_through_origin') })
    expect(labs.parsePracticeWorkbenchId(s1.workbenchId)).toEqual({ packId: 'example-pack', labId: 'fit-a-line' })
    expect(await layerForWorkbench(s1.workbenchId)).toBe('base')
    expect(await labs.labIsSealed(s1.workbenchId)).toBe(false)
    const dir = join(userData, 'labs', 'packs', 'example-pack', 'fit-a-line--practice')
    // From the starter, not the learner's lab: no partial solution, no edits.
    expect(readFileSync(join(dir, 'lab.py'), 'utf-8')).not.toContain('m1-partial')
    writeFileSync(join(dir, 'lab.py'), readFileSync(join(dir, 'lab.py'), 'utf-8') + '\n# %% id=mine\nx = 1\n')
    // Picking the same item again keeps the work in progress.
    expect(await labs.startPractice('example-pack', 'fit-a-line', 'm1')).toMatchObject({ fresh: false })
    expect(readFileSync(join(dir, 'lab.py'), 'utf-8')).toContain('id=mine')

    await expect(labs.checkPractice('example-pack', 'fit-a-line', 'm1', 'Sure' as never)).rejects.toThrow(/how sure/)
    const pending = labs.checkPractice('example-pack', 'fit-a-line', 'm1', 'Pretty sure')
    await settle()
    expect(jobs.at(-1)).toMatchObject({ mode: 'hidden', cwd: dir })
    expect(jobs.at(-1)!.testsPath).toMatch(/hidden_m1_origin\.py$/)
    expect(readFileSync(join(jobs.at(-1)!.workDir, 'lab.py'), 'utf-8')).toContain('id=mine')
    release({ ...passing, tests: passing.tests.map((t) => ({ ...t, outcome: 'passed', message: '' })) })
    const a = await pending
    expect(a).toMatchObject({ variantId: 'through-origin', verdict: 'passed', confidence: 'Pretty sure' })
    const days = (Date.parse(a.nextDue) - Date.parse(a.at)) / 86_400_000
    expect(days).toBe(3)

    q = await labs.practiceQueue(new Date(now.getTime() + 2 * 86_400_000))
    expect(q.due.map((x) => x.milestoneId)).toEqual(['m2'])
    const back = q.later.find((x) => x.milestoneId === 'm1')!
    expect(back).toMatchObject({ variantId: 'parabola', attempts: 1, interval: 3 })
    // The next variant gets a fresh notebook.
    const s2 = await labs.startPractice('example-pack', 'fit-a-line', 'm1')
    expect(s2).toMatchObject({ fresh: true, item: { variantId: 'parabola' } })
    expect(readFileSync(join(dir, 'lab.py'), 'utf-8')).not.toContain('id=mine')

    // A failure brings it back tomorrow.
    const p2 = labs.checkPractice('example-pack', 'fit-a-line', 'm1', 'Certain')
    await settle()
    release(failing)
    const b = await p2
    expect(b.verdict).toBe('core')
    expect((Date.parse(b.nextDue) - Date.parse(b.at)) / 86_400_000).toBe(1)
    // Practice shows the full failure text: the milestone has passed.
    expect(b.run.tests[0].message).toBe('expected slope 2, got 3')
  })

  it('hides core failure text until the milestone passes', () => {
    const t = failing.tests
    expect(labs.tierFeedback(t, false).map((x) => x.message)).toEqual(['', 'return Python floats'])
    expect(labs.tierFeedback(t, true).map((x) => x.message)).toEqual([
      'expected slope 2, got 3',
      'return Python floats',
    ])
  })
})
