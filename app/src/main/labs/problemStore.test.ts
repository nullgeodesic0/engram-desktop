import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'engram-problems-'))
const userData = join(root, 'userData')
const packDir = join(root, 'example-pack')
const EXAMPLE = resolve(__dirname, '../../../../examples/example-pack')

vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false } }))

const { addPackFolder } = await import('./packStore')
const store = await import('./problemStore')
const { flagMarks, normalise } = await import('./problemKey')

beforeAll(async () => {
  cpSync(EXAMPLE, packDir, { recursive: true })
  await addPackFolder(packDir)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const PACK = 'example-pack'

describe('passage matching', () => {
  it('matches a passage selected in the typeset text against the key written in TeX', () => {
    expect(normalise('its gradient is $-2A^\\top(A\\beta - y)$')).toBe(normalise('its gradient is −2A⊤(Aβ−y)'))
    expect(flagMarks('gradient is −2A⊤(Aβ−y). Setting', 'its gradient is $-2A^\\top(A\\beta - y)$')).toBe(true)
    expect(flagMarks('Stack the design matrix', 'its gradient is $-2A^\\top(A\\beta - y)$')).toBe(false)
  })
})

describe('problems', () => {
  it('lists the example problems with no errors', async () => {
    const list = await store.listProblems()
    expect(list.errors).toEqual([])
    expect(list.problems.map((p) => `${p.problemId}:${p.type}`)).toEqual([
      'normal-equations-proof:proof',
      'flawed-fit-writeup:audit',
      'read-the-fit:figure',
    ])
  })

  it('keeps the key out of the view and the result sealed until the pick', async () => {
    const v = await store.problemView(PACK, 'flawed-fit-writeup')
    expect(JSON.stringify(v)).not.toContain('Legendre published')
    expect(v.draft.openedAt).not.toBeNull()
    const a = await store.submitProblem(
      PACK,
      'flawed-fit-writeup',
      {
        type: 'audit',
        flags: [
          { quote: 'Because A⊤A is always invertible', cls: 'dropped-assumption', note: 'Needs independent columns.' },
          { quote: 'jointly by Gauss and Legendre', cls: 'hallucinated-citation', note: 'No joint paper.' },
          { quote: 'Stack the design matrix', cls: 'logic-gap', note: 'Seems off.' },
        ],
      },
      'No: uniqueness needs independent columns.',
    )
    expect(a).toMatchObject({ sealed: true, verdict: null, result: null, report: null, score: null })
    await expect(store.submitProblem(PACK, 'flawed-fit-writeup', { type: 'audit', flags: [] }, 'x')).rejects.toThrow(
      /already in/,
    )
    await expect(store.problemProduction(PACK, 'flawed-fit-writeup', a.id)).rejects.toThrow(/sealed/)
    const open = await store.pickProblemConfidence(PACK, 'flawed-fit-writeup', a.id, 'Pretty sure')
    expect(open).toMatchObject({ sealed: false, verdict: 'slip', score: '2/4' })
    expect(open.report).toMatch(
      /^\[engram-check v1 prob=example-pack\/flawed-fit-writeup type=audit sub=1 verdict=slip score=2\/4 false=1 /,
    )
    expect(open.report!.length).toBeLessThanOrEqual(400)
    if (open.result?.type !== 'audit') throw new Error('expected an audit result')
    expect(open.result.errors.map((e) => e.foundBy)).toEqual([1, null, 0, null])
    expect(open.result.falseFlags).toEqual([2])
  })

  it('verifies its own report for the tutor, with the answer and the key as criteria', async () => {
    const v = await store.problemView(PACK, 'flawed-fit-writeup')
    const a = v.attempts[0]
    const r = await store.lookupProblemReport(a.report!)
    expect(r).toMatchObject({
      verified: true,
      kind: 'problem',
      topic: 'least-squares',
      node: 'normal-equations',
      verdict: 'slip',
      confidence: 70,
      help: 0,
    })
    if (!r.verified) throw new Error('expected verified')
    expect(r.production).toContain('Needs independent columns.')
    expect(r.production).toContain('Would you sign this derivation?')
    expect(r.criteria.some((c) => c.includes('(central)'))).toBe(true)
    const forged = a.report!.replace('verdict=slip', 'verdict=passed')
    expect(await store.lookupProblemReport(forged)).toMatchObject({ verified: false })
    const hand = await store.problemProduction(PACK, 'flawed-fit-writeup', a.id)
    expect(hand.startsWith(a.report!)).toBe(true)
  })

  it('grades a figure reading by tolerance and core or slip tier', async () => {
    await store.problemView(PACK, 'read-the-fit')
    const a = await store.submitProblem(
      PACK,
      'read-the-fit',
      { type: 'figure', values: { 'line-at-5': 6.5, slope: 1.45, 'residual-at-0': 1.5 } },
      'No, the residuals curve.',
    )
    const open = await store.pickProblemConfidence(PACK, 'read-the-fit', a.id, 'Certain')
    expect(open).toMatchObject({ verdict: 'slip', score: '2/3' })
    const b = await store.submitProblem(PACK, 'read-the-fit', { type: 'figure', values: { 'line-at-5': 9 } }, 'Fine.')
    expect((await store.pickProblemConfidence(PACK, 'read-the-fit', b.id, 'Just guessing')).verdict).toBe('core')
  })

  it('records a proof as open, counts opened hints as help, and shows the reference only after the pick', async () => {
    const v = await store.openProblemHint(PACK, 'normal-equations-proof')
    expect(v.hints).toHaveLength(1)
    expect(v.hintCount).toBe(2)
    await expect(store.submitProblem(PACK, 'normal-equations-proof', { type: 'proof', steps: [] }, '')).rejects.toThrow(
      /at least one step/,
    )
    const a = await store.submitProblem(
      PACK,
      'normal-equations-proof',
      { type: 'proof', steps: [{ statement: 'Set the gradient to zero.', because: 'A minimum is stationary.' }] },
      '',
    )
    expect(a.result).toBeNull()
    const open = await store.pickProblemConfidence(PACK, 'normal-equations-proof', a.id, 'Half unsure')
    expect(open).toMatchObject({ verdict: 'open', help: 1 })
    expect(open.result?.type === 'proof' && open.result.reference.length).toBe(5)
    expect(open.report).toContain('score=- false=0')
  })

  it('reports a broken key on its pack instead of failing a Submit later', async () => {
    const key = join(packDir, 'problems', 'flawed-fit-writeup', 'key.json')
    const good = readFileSync(key, 'utf-8')
    writeFileSync(key, good.replace('introduced jointly by Gauss', 'invented jointly by Gauss'))
    const list = await store.listProblems()
    expect(list.errors[0].error).toMatch(/does not appear in the audit text/)
    writeFileSync(key, good)
  })
})
