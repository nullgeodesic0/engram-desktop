import { describe, it, expect } from 'vitest'
import { recallDueNodes, quickShare, lintCheckpointReceipts, CHECKPOINT_SOURCE } from './checkpointEvidence'
import type { RawReceipt } from '../../../shared/types'

function receipt(over: Partial<RawReceipt>): RawReceipt {
  return {
    id: null,
    ts: '2026-08-01',
    topic: 't',
    node: 'n',
    kind: 'review',
    grade: 'recalled',
    rating: 'good',
    sBefore: 1,
    sAfter: 2,
    capstone: false,
    intervalDays: 4,
    dueNext: '2026-08-05',
    relearn: false,
    source: 'self',
    ...over,
  }
}

const Q = { source: CHECKPOINT_SOURCE }

describe('recallDueNodes', () => {
  it('two consecutive checkpoint reviews put a node on the floor', () => {
    const rows = [receipt({ ts: '2026-08-01', ...Q }), receipt({ ts: '2026-08-02', ...Q })]
    expect(recallDueNodes(rows)).toEqual([{ topic: 't', node: 'n' }])
  })
  it('a free-recall row between them resets the streak', () => {
    const rows = [receipt({ ts: '2026-08-01', ...Q }), receipt({ ts: '2026-08-02', source: 'self' }), receipt({ ts: '2026-08-03', ...Q })]
    expect(recallDueNodes(rows)).toEqual([])
  })
  it('null-source (old) rows read as recall, not checkpoint', () => {
    const rows = [receipt({ ts: '2026-08-01', ...Q }), receipt({ ts: '2026-08-02', source: null })]
    expect(recallDueNodes(rows)).toEqual([])
  })
  it('relearn and non-review kinds never count toward the streak', () => {
    const rows = [
      receipt({ ts: '2026-08-01', ...Q }),
      receipt({ ts: '2026-08-02', ...Q, relearn: true }),
      receipt({ ts: '2026-08-03', kind: 'audit', ...Q }),
    ]
    expect(recallDueNodes(rows)).toEqual([])
  })
  it('one checkpoint review alone is not a floor', () => {
    expect(recallDueNodes([receipt(Q)])).toEqual([])
  })
})

describe('quickShare', () => {
  it('null with no review receipts', () => {
    expect(quickShare([receipt({ kind: 'encode' })])).toBeNull()
  })
  it('counts checkpoint rows within the trailing window only', () => {
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => receipt({ ts: `2026-07-0${i + 1}`, ...Q, node: `old${i}` })),
      ...Array.from({ length: 30 }, (_, i) => receipt({ ts: `2026-08-${String(i + 1).padStart(2, '0')}`, node: `n${i}` })),
    ]
    expect(quickShare(rows, 30)).toEqual({ quick: 0, total: 30 })
    expect(quickShare(rows, 33)).toEqual({ quick: 3, total: 33 })
  })
})

describe('lintCheckpointReceipts', () => {
  it('flags a checkpoint receipt rated easy', () => {
    const lints = lintCheckpointReceipts([receipt({ ...Q, rating: 'easy' })])
    expect(lints).toHaveLength(1)
    expect(lints[0].kind).toBe('checkpoint-easy')
  })
  it('flags an audit landing on a checkpoint node the same day', () => {
    const lints = lintCheckpointReceipts([receipt(Q), receipt({ kind: 'audit', source: 'assessor' })])
    expect(lints).toHaveLength(1)
    expect(lints[0].kind).toBe('audit-on-checkpoint')
  })
  it('clean receipts produce no lints', () => {
    expect(lintCheckpointReceipts([receipt({}), receipt(Q)])).toEqual([])
  })
})
