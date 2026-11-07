import { describe, expect, it } from 'vitest'
import { confidentMisses, sittingPayoff } from './sittingPayoff'
import type { GradeResult } from '../../../shared/gradeResult'

const r = (node: string, grade: GradeResult['grade'], sBefore: number | null, sAfter: number | null): GradeResult => ({
  node,
  grade,
  rating: grade === 'recalled' ? 'good' : grade === 'partial' ? 'hard' : 'again',
  state: null,
  sBefore,
  sAfter,
  intervalDays: null,
  daysSinceEncode: null,
})

describe('sittingPayoff', () => {
  it('counts memories that now hold longer, and new week-long holds', () => {
    const p = sittingPayoff([r('a', 'recalled', 3, 9), r('b', 'recalled', 8, 20), r('c', 'lapsed', 5, 1), r('d', 'partial', null, null)])
    expect(p).toEqual({ strengthened: 2, holdWeek: 1 })
  })
})

describe('confidentMisses', () => {
  it('names misses made with Certain or Pretty sure only', () => {
    const picks: Record<string, string> = { a: 'Certain', b: 'Pretty sure', c: 'Just guessing', d: 'Certain' }
    const res = [r('a', 'lapsed', 1, 1), r('b', 'partial', 1, 1), r('c', 'lapsed', 1, 1), r('d', 'recalled', 1, 2)]
    expect(confidentMisses(res, (n) => picks[n] ?? null)).toEqual(['a', 'b'])
  })
})
