import { describe, expect, it } from 'vitest'
import { daysStudiedInWindow, freshStartReason, rhythmLabel, rhythmSummary, weekStartYmd } from './studyRhythm'
import type { DayActivity } from '../../../shared/types'

const day = (date: string, count = 1): DayActivity => ({ date, count, items: [] })

// Wednesday 2026-11-11, local time.
const WED = new Date(2026, 10, 11, 15, 0, 0)

describe('daysStudiedInWindow', () => {
  it('counts distinct active days inside the window, today included', () => {
    const days = [day('2026-11-11'), day('2026-11-09'), day('2026-11-05'), day('2026-11-04')]
    expect(daysStudiedInWindow(days, 7, WED)).toBe(3)
  })

  it('ignores days with no receipts', () => {
    expect(daysStudiedInWindow([day('2026-11-11', 0)], 7, WED)).toBe(0)
  })

  it('does not reset after a missed day', () => {
    // studied Mon/Tue, skipped Wed so far: still 2, never 0
    const days = [day('2026-11-09'), day('2026-11-10')]
    expect(daysStudiedInWindow(days, 7, WED)).toBe(2)
  })
})

describe('rhythmLabel', () => {
  it('never mentions a miss', () => {
    const label = rhythmLabel(rhythmSummary([day('2026-11-10')], WED))
    expect(label).toBe('1 of the last 7 days · 1 this month')
    expect(label).not.toMatch(/miss|broke|lost|streak/i)
  })

  it('has a neutral empty state', () => {
    expect(rhythmLabel({ week: 0, month: 0 })).toBe('no sittings yet this month')
  })
})

describe('freshStartReason', () => {
  it('frames a return after a gap', () => {
    expect(freshStartReason(3, null, WED)).toBe('gap')
    expect(freshStartReason(12, null, WED)).toBe('gap')
  })

  it('is silent for a regular rhythm', () => {
    expect(freshStartReason(1, null, WED)).toBeNull()
    expect(freshStartReason(0, null, WED)).toBeNull()
  })

  it('is silent for someone with no sessions yet', () => {
    expect(freshStartReason(-1, null, WED)).toBeNull()
    expect(freshStartReason(null, null, WED)).toBeNull()
  })

  it('names a new week once', () => {
    const MON = new Date(2026, 10, 9, 9, 0, 0)
    expect(freshStartReason(1, null, MON)).toBe('new-week')
    expect(freshStartReason(1, weekStartYmd(MON), MON)).toBeNull()
    // already sat today: the fresh start has happened
    expect(freshStartReason(0, null, MON)).toBeNull()
  })

  it('computes the Monday of the week', () => {
    expect(weekStartYmd(WED)).toBe('2026-11-09')
    expect(weekStartYmd(new Date(2026, 10, 15))).toBe('2026-11-09') // Sunday
  })
})
