import { describe, expect, it } from 'vitest'
import { editShare, formatSeconds } from './oral'
import { answerText, axisValue, cleanAnswer, parseProblemManifest, type ProblemManifest } from './problems'

const noFiles = (p: string): string => {
  throw new Error(`unexpected read of ${p}`)
}

function parsed(raw: unknown, read: (p: string) => string = noFiles): ProblemManifest {
  const r = parseProblemManifest(raw, read)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

const proof = {
  id: 'p',
  type: 'proof',
  title: 'A proof',
  prompt: 'Show it.',
  topic: 't',
  key: 'key.json',
}

const figure = {
  id: 'f',
  type: 'figure',
  title: 'A figure',
  prompt: 'Read it.',
  explainBack: 'What does it show?',
  image: 'fig.png',
  key: 'key.json',
  questions: [
    { id: 'a', prompt: 'The value at 1', unit: '%' },
    { id: 'b', prompt: 'The slope' },
  ],
}

describe('parseProblemManifest', () => {
  it('reads a proof, with no judgement and no step count by default', () => {
    const p = parsed(proof)
    expect(p.type).toBe('proof')
    expect(p.explainBack).toBe('')
    expect(p.type === 'proof' && p.steps).toBe(null)
    expect(p.node).toBe(null)
  })

  it('reads an audit text from its file', () => {
    const p = parsed({ ...proof, type: 'audit', explainBack: 'Would you trust it?', text: 'text.md' }, (f) =>
      f === 'text.md' ? 'The text.' : '',
    )
    expect(p.type === 'audit' && p.text).toBe('The text.')
  })

  it('refuses a node without a topic, hints on an unaided problem, and a bad type', () => {
    expect(parseProblemManifest({ ...proof, topic: null, node: 'n' }, noFiles).ok).toBe(false)
    expect(parseProblemManifest({ ...proof, unaided: true, hints: ['h'] }, noFiles).ok).toBe(false)
    expect(parseProblemManifest({ ...proof, type: 'oral' }, noFiles).ok).toBe(false)
  })

  it('refuses a figure with repeated question ids, a non-image, or a log axis through zero', () => {
    expect(
      parseProblemManifest(
        {
          ...figure,
          questions: [
            { id: 'a', prompt: 'x' },
            { id: 'a', prompt: 'y' },
          ],
        },
        noFiles,
      ).ok,
    ).toBe(false)
    expect(parseProblemManifest({ ...figure, image: 'fig.svg' }, noFiles).ok).toBe(false)
    const axes = { x: { px: [0, 100], value: [0, 1] }, y: { px: [100, 0], value: [0, 1], scale: 'log' } }
    expect(parseProblemManifest({ ...figure, axes }, noFiles).ok).toBe(false)
  })
})

describe('oral exams', () => {
  const oralExam = {
    id: 'o',
    type: 'oral',
    title: 'An oral',
    prompt: 'Answer aloud.',
    topic: 't',
    key: 'key.json',
    questions: [
      { id: 'q1', prompt: 'Why?' },
      { id: 'q2', prompt: 'How?', seconds: 60 },
    ],
  }

  it('reads an oral exam: unaided, no explain-back, three minutes a question by default', () => {
    const p = parsed(oralExam)
    if (p.type !== 'oral') throw new Error('not oral')
    expect(p.unaided).toBe(true)
    expect(p.explainBack).toBe('')
    expect(p.questions.map((q) => q.seconds)).toEqual([180, 60])
  })

  it('refuses hints, repeated ids, no questions, and a time outside 30 s to 15 min', () => {
    expect(parseProblemManifest({ ...oralExam, hints: ['Think.'] }, noFiles).ok).toBe(false)
    expect(parseProblemManifest({ ...oralExam, questions: [] }, noFiles).ok).toBe(false)
    expect(
      parseProblemManifest(
        {
          ...oralExam,
          questions: [
            { id: 'q', prompt: 'a' },
            { id: 'q', prompt: 'b' },
          ],
        },
        noFiles,
      ).ok,
    ).toBe(false)
    expect(parseProblemManifest({ ...oralExam, questions: [{ id: 'q', prompt: 'a', seconds: 10 }] }, noFiles).ok).toBe(
      false,
    )
    expect(parseProblemManifest({ ...oralExam, questions: [{ id: 'q', prompt: 'a', seconds: 901 }] }, noFiles).ok).toBe(
      false,
    )
  })
})

describe('editShare and formatSeconds', () => {
  it('counts changed words over the longer text', () => {
    expect(editShare('the cat sat', 'the cat sat')).toBe(0)
    expect(editShare('The cat  sat', 'the cat sat')).toBe(0)
    expect(editShare('the cat sat', 'the bat sat')).toBeCloseTo(1 / 3)
    expect(editShare('the cat sat', 'the cat sat down')).toBe(0.25)
    expect(editShare('', 'typed answer')).toBe(1)
    expect(editShare('', '')).toBe(0)
  })

  it('formats seconds', () => {
    expect(formatSeconds(45)).toBe('45 s')
    expect(formatSeconds(180)).toBe('3 min')
    expect(formatSeconds(75.4)).toBe('1 min 15 s')
  })
})

describe('axisValue', () => {
  it('maps pixels linearly, including an inverted y axis', () => {
    expect(axisValue({ px: [100, 500], value: [0, 8], scale: 'linear' }, 300)).toBeCloseTo(4)
    expect(axisValue({ px: [400, 0], value: [0, 12], scale: 'linear' }, 100)).toBeCloseTo(9)
  })

  it('maps pixels by decade on a log axis', () => {
    const a = { px: [0, 200] as [number, number], value: [1e-4, 1e-2] as [number, number], scale: 'log' as const }
    expect(axisValue(a, 100)).toBeCloseTo(1e-3, 10)
    expect(axisValue(a, 50) / 1e-4).toBeCloseTo(Math.sqrt(10), 6)
  })
})

describe('cleanAnswer and answerText', () => {
  it('drops empty proof steps and refuses a justification with no statement', () => {
    const p = parsed(proof)
    const a = cleanAnswer(p, {
      steps: [
        { statement: ' A ', because: 'def' },
        { statement: '', because: '' },
      ],
    })
    expect(a).toEqual({ type: 'proof', steps: [{ statement: 'A', because: 'def' }] })
    expect(answerText(p, a)).toBe('1. A\n   Because: def')
    expect(() => cleanAnswer(p, { steps: [{ statement: '', because: 'x' }] })).toThrow(/no statement/)
    expect(() => cleanAnswer(p, { steps: [] })).toThrow(/at least one step/)
  })

  it('needs a class and a note on every audit flag, and allows none at all', () => {
    const p = parsed({ ...proof, type: 'audit', explainBack: 'Trust it?', text: 't.md' }, () => 'text')
    expect(() => cleanAnswer(p, { flags: [{ quote: 'q', cls: 'nonsense', note: 'n' }] })).toThrow(/class/)
    expect(() => cleanAnswer(p, { flags: [{ quote: 'q', cls: 'overfit', note: '' }] })).toThrow(/one line/)
    const none = cleanAnswer(p, { flags: [] })
    expect(answerText(p, none)).toBe('No errors flagged.')
    const one = cleanAnswer(p, { flags: [{ quote: 'q', cls: 'overfit', note: 'fits noise' }] })
    expect(answerText(p, one)).toMatch(/^1\. "q"\n {3}.+: fits noise$/)
  })

  it('keeps only finite figure readings, and needs at least one', () => {
    const p = parsed(figure)
    const a = cleanAnswer(p, { values: { a: 3.5, b: 'x', c: 9 } })
    expect(a).toEqual({ type: 'figure', values: { a: 3.5, b: null } })
    expect(answerText(p, a)).toBe('- The value at 1 3.5 %\n- The slope (left blank)')
    expect(() => cleanAnswer(p, { values: { a: Number.NaN } })).toThrow(/at least one/)
  })
})
