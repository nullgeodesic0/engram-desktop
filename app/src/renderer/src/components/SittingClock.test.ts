import { describe, expect, it } from 'vitest'
import { pacerState } from './SittingClock'

describe('pacerState', () => {
  it('counts down the budget and states completion, not overrun', () => {
    expect(pacerState(0, 25, null)).toEqual({ leftMinutes: 25, budgetReached: false, breakIndex: 0 })
    expect(pacerState(13 * 60 + 5, 25, null).leftMinutes).toBe(12)
    expect(pacerState(25 * 60, 25, null)).toMatchObject({ leftMinutes: 0, budgetReached: true })
    expect(pacerState(40 * 60, 25, null).leftMinutes).toBe(0)
  })
  it('has no budget line without a budget', () => {
    expect(pacerState(600, null, null)).toEqual({ leftMinutes: null, budgetReached: false, breakIndex: 0 })
  })
  it('raises a break suggestion at each interval', () => {
    expect(pacerState(24 * 60, null, 25).breakIndex).toBe(0)
    expect(pacerState(25 * 60, null, 25).breakIndex).toBe(1)
    expect(pacerState(51 * 60, null, 25).breakIndex).toBe(2)
  })
})
