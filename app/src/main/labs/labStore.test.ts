import { mkdtempSync, rmSync, symlinkSync, cpSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CheckRun } from '../../shared/labs'

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
const jobs: { mode: string; testsPath: string; workDir: string }[] = []
vi.mock('./checkRunner', () => ({
  startCheck: (job: { mode: string; testsPath: string; workDir: string }) => {
    jobs.push(job)
    if (job.mode === 'smoke') {
      return {
        done: Promise.resolve({
          completed: true,
          error: null,
          seconds: 1,
          tests: [{ name: 'test_shape', tier: 'smoke', outcome: 'passed', message: '' }],
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
    { name: 'test_exact_line', tier: 'core', outcome: 'passed', message: '' },
    { name: 'test_returns_plain_floats', tier: 'slip', outcome: 'failed', message: 'return Python floats' },
  ],
}

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
    const sub = await labs.submitMilestone('example-pack', 'fit-a-line', 'm1')
    expect(sub).toMatchObject({ id: 'm1-1', sealed: true, run: null, report: null })
    expect(readFileSync(join(sub ? jobs.at(-1)!.workDir : '', 'lab.py'), 'utf-8')).toContain('def fit_line')
    await expect(labs.submitMilestone('example-pack', 'fit-a-line', 'm1')).rejects.toThrow(/already under way/)
    await expect(labs.pickConfidence('example-pack', 'fit-a-line', 'm1-1', 'Certain')).rejects.toThrow(
      /explain-back before/,
    )
    await expect(labs.submissionProduction('example-pack', 'fit-a-line', 'm1-1')).rejects.toThrow(/sealed/)

    release(passing)
    await new Promise((r) => setTimeout(r, 50))
    // Finished in main, but still nothing on the wire.
    const mid = (await labs.labView('example-pack', 'fit-a-line')).submissions[0]
    expect(mid).toMatchObject({ finished: true, sealed: true, run: null, report: null, verdict: null })

    await labs.submitExplainBack(
      'example-pack',
      'fit-a-line',
      'm1-1',
      'Setting the gradient of the squared error to zero.',
    )
    await expect(labs.submitExplainBack('example-pack', 'fit-a-line', 'm1-1', 'again')).rejects.toThrow()
    const open = await labs.pickConfidence('example-pack', 'fit-a-line', 'm1-1', 'Pretty sure')
    expect(open).toMatchObject({ sealed: false, confidence: 'Pretty sure', verdict: 'slip' })
    expect(open.run?.tests).toHaveLength(2)

    const key = await labs.checkKey()
    const fields = verifyReport(open.report!, key)
    expect(fields).toMatchObject({
      lab: 'example-pack/fit-a-line',
      milestone: 'm1',
      seq: 1,
      verdict: 'slip',
      core: '1/1',
      slip: '0/1',
      env: 'base-0123456789ab',
    })
    const production = await labs.submissionProduction('example-pack', 'fit-a-line', 'm1-1')
    expect(production).toBe(`${open.report}\n\nSetting the gradient of the squared error to zero.`)
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
})
