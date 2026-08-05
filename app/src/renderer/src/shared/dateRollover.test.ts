import { describe, it, expect } from 'vitest'
import { dateHasRolledOver } from './dateRollover'

describe('dateHasRolledOver', () => {
  it('false for the same local date', () => {
    expect(dateHasRolledOver('2026-08-05', '2026-08-05')).toBe(false)
  })
  it('true across a day boundary', () => {
    expect(dateHasRolledOver('2026-08-05', '2026-08-06')).toBe(true)
  })
  it('true across a month/year boundary', () => {
    expect(dateHasRolledOver('2026-12-31', '2027-01-01')).toBe(true)
  })
  it('true if the clock somehow moved backward — a wall-clock adjustment is still a change worth refreshing on', () => {
    expect(dateHasRolledOver('2026-08-06', '2026-08-05')).toBe(true)
  })
})
