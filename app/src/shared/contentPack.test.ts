import { describe, expect, it } from 'vitest'
import { isSafeRelPath, parseLabManifest, parsePackManifest } from './contentPack'
import { interleave, nextPracticeInterval, samePrintout } from './labs'

const pack = { format: 1, id: 'demo', title: 'Demo', version: '1.0.0', labs: ['labs/one'] }
const milestone = { id: 'm1', title: 'First', brief: 'Do it.', hidden: 'checks/h.py', explainBack: 'Why?' }

describe('content pack manifests', () => {
  it('reads a minimal pack and lab', () => {
    const p = parsePackManifest(pack)
    expect(p.ok && p.value.runtime).toBeNull()
    const l = parseLabManifest({ id: 'one', title: 'One', milestones: [milestone] })
    expect(l.ok && l.value.milestones[0]).toMatchObject({
      id: 'm1',
      smoke: null,
      hidden: 'checks/h.py',
      timeLimitS: 600,
    })
  })

  it('reads a runtime layer, and refuses one named base', () => {
    const runtime = {
      layer: 'sci',
      label: 'Science',
      lock: 'runtime/sci.lock',
      imports: ['numpy'],
      packages: ['numpy'],
    }
    const p = parsePackManifest({ ...pack, runtime })
    expect(p.ok && p.value.runtime?.lock).toBe('runtime/sci.lock')
    expect(parsePackManifest({ ...pack, runtime: { ...runtime, layer: 'base' } }).ok).toBe(false)
    expect(parsePackManifest({ ...pack, runtime: { ...runtime, imports: ['os; rm'] } }).ok).toBe(false)
  })

  it('refuses paths that leave the pack', () => {
    for (const bad of ['../x', '/etc/passwd', 'a/../../b', 'C:/x', 'a\\b', '', './a', 'a//b'])
      expect(isSafeRelPath(bad)).toBe(false)
    expect(isSafeRelPath('labs/one/checks/h.py')).toBe(true)
    expect(parsePackManifest({ ...pack, labs: ['../elsewhere'] }).ok).toBe(false)
    expect(parseLabManifest({ id: 'one', title: 'One', milestones: [{ ...milestone, hidden: '/tmp/h.py' }] }).ok).toBe(
      false,
    )
  })

  it('refuses bad ids, repeated milestones, and hidden tests with no explain-back question', () => {
    expect(parsePackManifest({ ...pack, id: 'Has Spaces' }).ok).toBe(false)
    expect(parsePackManifest({ ...pack, id: 'x'.repeat(33) }).ok).toBe(false)
    expect(parsePackManifest({ ...pack, format: 2 }).ok).toBe(false)
    expect(parseLabManifest({ id: 'one', title: 'One', milestones: [milestone, milestone] }).ok).toBe(false)
    expect(parseLabManifest({ id: 'one', title: 'One', milestones: [{ ...milestone, explainBack: ' ' }] }).ok).toBe(
      false,
    )
    expect(parseLabManifest({ id: 'one', title: 'One', milestones: [] }).ok).toBe(false)
    expect(parseLabManifest({ id: 'one', title: 'One', milestones: [{ ...milestone, timeLimitS: 99999 }] }).ok).toBe(
      false,
    )
  })

  it('takes a brief-only milestone without tests or a question', () => {
    const l = parseLabManifest({
      id: 'one',
      title: 'One',
      milestones: [{ id: 'm1', title: 'Read', brief: 'Read this.' }],
    })
    expect(l.ok && l.value.milestones[0].hidden).toBeNull()
  })

  it('reads a brief from a file through the reader it is given', () => {
    const l = parseLabManifest(
      { id: 'one', title: 'One', milestones: [{ ...milestone, brief: undefined, briefFile: 'm1.md' }] },
      (p) => `from ${p}`,
    )
    expect(l.ok && l.value.milestones[0].brief).toBe('from m1.md')
  })

  it('reads a ladder and bounds its steps', () => {
    const one = (extra: object) =>
      parseLabManifest({ id: 'one', title: 'One', milestones: [{ ...milestone, ...extra }] })
    const l = one({ worked: 'A sibling.', completion: 'partial.py', steps: ['First.', 'Second.'] })
    expect(l.ok && l.value.milestones[0]).toMatchObject({
      worked: 'A sibling.',
      completion: 'partial.py',
      steps: ['First.', 'Second.'],
    })
    expect(
      one({}).ok &&
        one({}).ok &&
        (one({}) as { value: { milestones: { steps: string[] }[] } }).value.milestones[0].steps,
    ).toEqual([])
    expect(one({ steps: ['ok', ''] }).ok).toBe(false)
    expect(one({ steps: Array(13).fill('x') }).ok).toBe(false)
    expect(one({ completion: '../escape.py' }).ok).toBe(false)
  })

  it('reads the tutor link, predict items and variants, and bounds them', () => {
    const lab = (extra: object, labExtra: object = {}) =>
      parseLabManifest({ id: 'one', title: 'One', ...labExtra, milestones: [{ ...milestone, ...extra }] })
    const l = lab(
      {
        node: 'normal-equations',
        predict: [{ id: 'p1', code: 'print(1)', output: '1' }],
        variants: [{ id: 'v1', brief: 'Again.', hidden: 'checks/v1.py' }],
      },
      { topic: 'least_squares.2026' },
    )
    expect(l.ok && l.value.topic).toBe('least_squares.2026')
    expect(l.ok && l.value.milestones[0]).toMatchObject({
      node: 'normal-equations',
      predict: [{ id: 'p1', prompt: 'What does this print?', code: 'print(1)', output: '1', why: '' }],
      variants: [{ id: 'v1', title: '', brief: 'Again.', hidden: 'checks/v1.py', starter: null }],
    })
    const plain = lab({})
    expect(plain.ok && plain.value.topic).toBeNull()
    expect(plain.ok && plain.value.milestones[0]).toMatchObject({ node: null, predict: [], variants: [] })

    expect(lab({}, { topic: 'has space' }).ok).toBe(false)
    expect(lab({ node: '"; rm -rf' }).ok).toBe(false)
    expect(lab({ predict: [{ id: 'p1', code: '  ', output: '' }] }).ok).toBe(false)
    expect(lab({ predict: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, code: 'x', output: '' })) }).ok).toBe(
      false,
    )
    // An item and a variant cannot share an id.
    expect(
      lab({ predict: [{ id: 'x', code: 'x', output: '' }], variants: [{ id: 'x', brief: 'b', hidden: 'h.py' }] }).ok,
    ).toBe(false)
    expect(lab({ variants: [{ id: 'v1', hidden: 'h.py' }] }).ok).toBe(false)
    expect(lab({ variants: [{ id: 'v1', brief: 'b', hidden: '../h.py' }] }).ok).toBe(false)
    // Only a milestone with hidden tests can be practised.
    expect(
      lab({ hidden: undefined, explainBack: undefined, variants: [{ id: 'v', brief: 'b', hidden: 'h.py' }] }).ok,
    ).toBe(false)
    // The practice notebook's name is reserved.
    expect(parseLabManifest({ id: 'one--practice', title: 'One', milestones: [milestone] }).ok).toBe(false)
  })
})

describe('predict items, practice intervals and interleaving', () => {
  it('compares printouts without minding trailing space or line endings', () => {
    expect(samePrintout('(3, 2)\r\n[2. 1.]  \n\n', '(3, 2)\n[2. 1.]')).toBe(true)
    expect(samePrintout('(3,2)\n[2. 1.]', '(3, 2)\n[2. 1.]')).toBe(false)
    expect(samePrintout(' 1', '1')).toBe(false)
  })

  it('roughly triples the interval on a pass and starts over on a failure', () => {
    expect(nextPracticeInterval(0, 'passed')).toBe(1)
    expect(nextPracticeInterval(1, 'passed')).toBe(3)
    expect(nextPracticeInterval(3, 'slip')).toBe(9)
    expect(nextPracticeInterval(100, 'passed')).toBe(120)
    expect(nextPracticeInterval(27, 'core')).toBe(1)
    expect(nextPracticeInterval(27, 'broken')).toBe(1)
  })

  it('never puts the same milestone twice in a row, and alternates labs while it can', () => {
    const it = (labId: string, milestoneId: string, due: string) => ({ packId: 'p', labId, milestoneId, due })
    const out = interleave([
      it('a', 'm1', '2026-01-01'),
      it('a', 'm2', '2026-01-02'),
      it('a', 'm3', '2026-01-03'),
      it('b', 'm1', '2026-01-04'),
    ])
    expect(out.map((x) => `${x.labId}${x.milestoneId}`)).toEqual(['am1', 'bm1', 'am2', 'am3'])
    for (let i = 1; i < out.length; i++)
      expect(`${out[i].labId}${out[i].milestoneId}`).not.toBe(`${out[i - 1].labId}${out[i - 1].milestoneId}`)
    expect(interleave([])).toEqual([])
  })
})
