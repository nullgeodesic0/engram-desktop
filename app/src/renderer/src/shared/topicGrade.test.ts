import { describe, it, expect } from 'vitest'
import type { Misconception } from '../../../shared/types'
import { computeHistoricalTopicGrade } from './topicGrade'

/** The resolved_ts cutoff semantics (misconceptions overhaul, commit 1) —
 * a resolution only counts from its own date. Pinned here because there is
 * no engine-side oracle for the historical mapping: engram.py stamps
 * `resolved_ts` but never re-derives past state from it. */

function row(over: Partial<Misconception>): Misconception {
  return {
    id: 'm_test_000',
    ts: '2026-07-01',
    topic: 't',
    node: 'n',
    description: 'd',
    status: 'open',
    ...over,
  }
}

function conceptualAt(cutoff: string, misconceptions: Misconception[]) {
  return computeHistoricalTopicGrade({
    receipts: [],
    topic: 't',
    misconceptions,
    days: [],
    picks: [],
    cutoff,
  }).components.conceptual
}

describe('computeHistoricalTopicGrade resolved_ts mapping', () => {
  it('a row resolved AFTER the cutoff counts as open at that cutoff', () => {
    const c = conceptualAt('2026-07-10', [
      row({ id: 'm_a', status: 'resolved', resolved_ts: '2026-07-20' }),
    ])
    // Open at the cutoff: raw carries the open count.
    expect(c.raw).toBe(1)
  })

  it('a row resolved BEFORE the cutoff counts as resolved', () => {
    const c = conceptualAt('2026-07-25', [
      row({ id: 'm_a', status: 'resolved', resolved_ts: '2026-07-20' }),
    ])
    expect(c.raw).toBe(0)
  })

  it('a resolved row missing resolved_ts resolves at ts (hand-edit fallback)', () => {
    const c = conceptualAt('2026-07-10', [row({ id: 'm_a', status: 'resolved' })])
    expect(c.raw).toBe(0)
  })

  it('a row filed after the cutoff is excluded entirely', () => {
    const c = conceptualAt('2026-06-30', [
      row({ id: 'm_a', ts: '2026-07-01', status: 'resolved', resolved_ts: '2026-07-02' }),
    ])
    expect(c.available).toBe(false)
    expect(c.n).toBe(0)
  })
})
