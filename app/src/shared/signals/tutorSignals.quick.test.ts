import { describe, it, expect } from 'vitest'
import { hasQuickSource, isQuickEasyViolation } from './tutorSignals'

const BASE = 'python3 "$ENGRAM" rate --topic grad-electrodynamics --node gauss-symmetry-solve --grade recalled'

describe('hasQuickSource', () => {
  it('matches the overlay-mandated stamp', () => {
    expect(hasQuickSource(`${BASE} --rating good --source quick-mc`)).toBe(true)
    expect(hasQuickSource(`${BASE} --rating good --source "quick-mc"`)).toBe(true)
  })
  it('never matches self/assessor or the flag absent', () => {
    expect(hasQuickSource(`${BASE} --rating good --source self`)).toBe(false)
    expect(hasQuickSource(`${BASE} --rating good`)).toBe(false)
  })
})

describe('isQuickEasyViolation', () => {
  it('fires only on quick-mc + easy together', () => {
    expect(isQuickEasyViolation(`${BASE} --rating easy --source quick-mc`)).toBe(true)
    expect(isQuickEasyViolation(`${BASE} --source quick-mc --rating easy`)).toBe(true)
    expect(isQuickEasyViolation(`${BASE} --rating easy --source self`)).toBe(false)
    expect(isQuickEasyViolation(`${BASE} --rating good --source quick-mc`)).toBe(false)
  })
})
