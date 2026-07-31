import { describe, it, expect } from 'vitest'
import type { Misconception } from '../../../shared/types'
import { computeHistoricalTopicGrade, CONCEPTUAL_GRACE_DAYS } from './topicGrade'

/** The conceptual component's two overhaul rules, pinned here because there
 * is no engine-side oracle for either: (1) resolved_ts cutoff semantics — a
 * resolution only counts from its own date; (2) the grace window — an open
 * row younger than CONCEPTUAL_GRACE_DAYS as of the evaluation date is
 * pending re-test and counts on neither side, while `raw` still reports the
 * honest total open count. */

function row(over: Partial<Misconception>): Misconception {
  return {
    id: 'm_test_000',
    ts: '2026-06-01',
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

// Three aged rows (ts 2026-06-01 — well past grace at every cutoff used)
// so the component clears COMPONENT_MIN_N.conceptual = 3.
const base = [
  row({ id: 'm_a', status: 'resolved', resolved_ts: '2026-06-05' }),
  row({ id: 'm_b', status: 'resolved', resolved_ts: '2026-06-05' }),
]

describe('computeHistoricalTopicGrade resolved_ts mapping', () => {
  it('a row resolved AFTER the cutoff counts as open at that cutoff', () => {
    const c = conceptualAt('2026-07-10', [...base, row({ id: 'm_c', status: 'resolved', resolved_ts: '2026-07-20' })])
    expect(c.available).toBe(true)
    expect(c.n).toBe(3)
    expect(c.raw).toBe(1) // m_c was still open as of 07-10
    expect(c.score).toBeCloseTo((2 / 3) * 100)
  })

  it('a row resolved BEFORE the cutoff counts as resolved', () => {
    const c = conceptualAt('2026-07-25', [...base, row({ id: 'm_c', status: 'resolved', resolved_ts: '2026-07-20' })])
    expect(c.raw).toBe(0)
    expect(c.score).toBe(100)
  })

  it('a resolved row missing resolved_ts resolves at ts (hand-edit fallback)', () => {
    const c = conceptualAt('2026-07-10', [...base, row({ id: 'm_c', status: 'resolved' })])
    expect(c.raw).toBe(0)
    expect(c.score).toBe(100)
  })

  it('a row filed after the cutoff is excluded entirely', () => {
    const c = conceptualAt('2026-05-30', [...base, row({ id: 'm_c' })])
    expect(c.available).toBe(false)
    expect(c.n).toBe(0)
  })
})

describe('conceptual grace window', () => {
  it('a fresh open row counts on neither side but stays in raw', () => {
    const fresh = row({ id: 'm_fresh', ts: '2026-07-05' }) // 5 days old at cutoff
    const c = conceptualAt('2026-07-10', [...base, row({ id: 'm_aged' }), fresh])
    expect(c.available).toBe(true)
    expect(c.n).toBe(3) // 2 resolved + 1 aged open; the fresh row is graced out
    expect(c.raw).toBe(2) // but raw states the honest total open count
    expect(c.score).toBeCloseTo((2 / 3) * 100)
  })

  it('an open row at exactly the grace boundary counts', () => {
    const boundary = row({ id: 'm_edge', ts: '2026-06-26' }) // exactly 14 days at 07-10
    expect(CONCEPTUAL_GRACE_DAYS).toBe(14)
    const c = conceptualAt('2026-07-10', [...base, boundary])
    expect(c.n).toBe(3)
    expect(c.raw).toBe(1)
  })

  it('all-fresh opens leave the component unavailable, not an F', () => {
    const c = conceptualAt('2026-07-10', [
      row({ id: 'm_1', ts: '2026-07-08' }),
      row({ id: 'm_2', ts: '2026-07-09' }),
      row({ id: 'm_3', ts: '2026-07-10' }),
    ])
    expect(c.available).toBe(false)
  })
})
