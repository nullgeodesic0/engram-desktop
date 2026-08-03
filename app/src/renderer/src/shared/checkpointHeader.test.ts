import { describe, it, expect } from 'vitest'
import { isCheckpointHeader, parseCheckpointHeader } from './checkpointHeader'

describe('checkpointHeader', () => {
  it('parses the canonical form', () => {
    expect(parseCheckpointHeader('Checkpoint 2/3')).toEqual({ step: 2, total: 3 })
  })
  it('tolerates spacing and trailing decoration', () => {
    expect(parseCheckpointHeader('Checkpoint 10 / 12 — sign of the payoff')).toEqual({ step: 10, total: 12 })
  })
  it('sniffs the prefix even when the counter is malformed', () => {
    expect(isCheckpointHeader('Checkpoint')).toBe(true)
    expect(parseCheckpointHeader('Checkpoint next')).toBeNull()
  })
  it('never matches Confidence or ordinary headers', () => {
    expect(isCheckpointHeader('Confidence')).toBe(false)
    expect(isCheckpointHeader('Session mode')).toBe(false)
    expect(parseCheckpointHeader('Confidence')).toBeNull()
  })
  it('rejects zero/absurd counters', () => {
    expect(parseCheckpointHeader('Checkpoint 0/3')).toBeNull()
  })
})
