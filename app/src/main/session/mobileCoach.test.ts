import { describe, expect, it } from 'vitest'
import { projectCoach } from './mobileCoach'
import type { DayActivity, WeekRetention } from '../engramCli/receiptsHistory'

const days: DayActivity[] = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
  count: i % 3,
  items: [],
}))

const weeks: WeekRetention[] = [
  { weekStart: '2026-06-01', total: 10, recalled: 5, rate: 0.5 },
  { weekStart: '2026-06-08', total: 0, recalled: 0, rate: null },
  { weekStart: '2026-06-15', total: 20, recalled: 18, rate: 0.9 },
]

describe('projectCoach', () => {
  it('windows activity to the recent stretch a phone can draw', () => {
    const out = projectCoach(days, weeks, 4)
    expect(out.days).toHaveLength(28)
    // Newest last, so the strip reads left to right like a calendar.
    expect(out.days[out.days.length - 1].date).toBe(days[days.length - 1].date)
  })

  it('keeps a week with no retrievals rather than closing the gap', () => {
    // A silent week is a fact about the record. Dropping it would draw a
    // continuous line through a fortnight where nothing happened.
    const out = projectCoach(days, weeks, 4)
    expect(out.weeks).toHaveLength(3)
    expect(out.weeks[1].rate).toBeNull()
  })

  it('reports open misconceptions as a count, not as their text', () => {
    // A misconception is the learner's own wrong idea, stated in their words.
    // The count says there is something to resolve; the text belongs at the
    // desk with the session that can actually work on it.
    const out = projectCoach(days, weeks, 4)
    expect(typeof out.openMisconceptions).toBe('number')
    expect(JSON.stringify(out)).not.toContain('misconceptionText')
  })

  it('says plainly when there is not enough to say anything', () => {
    const out = projectCoach([], [], 0)
    expect(out.days).toHaveLength(0)
    expect(out.weeks).toHaveLength(0)
    expect(out.retentionRate).toBeNull()
  })

  it('reports overall retention only from weeks that measured something', () => {
    // Averaging a null week as zero would report a decline that never happened.
    const out = projectCoach(days, weeks, 4)
    expect(out.retentionRate).toBeCloseTo((5 + 18) / (10 + 20), 5)
  })
})
