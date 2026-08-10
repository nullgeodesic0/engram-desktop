import { describe, expect, it } from 'vitest'
import { PHONE_SOURCES, projectTopicReceipts } from './mobileReceipts'
import type { RawReceipt } from '../engramCli/receiptsHistory'

function receipt(over: Partial<RawReceipt>): RawReceipt {
  return {
    id: null,
    ts: '2026-08-01T10:00:00Z',
    topic: 'mechanics',
    node: 'lagrangian',
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
    productionTruncated: false,
    ...over,
  }
}

describe('projectTopicReceipts', () => {
  it('keeps only the requested topic', () => {
    const out = projectTopicReceipts(
      'mechanics',
      [receipt({}), receipt({ topic: 'electrodynamics', node: 'gauge' })],
    )
    expect(out.receipts.map((r) => r.node)).toEqual(['lagrangian'])
  })

  it('orders newest first', () => {
    const out = projectTopicReceipts(
      'mechanics',
      [
        receipt({ ts: '2026-08-01T10:00:00Z', node: 'lagrangian' }),
        receipt({ ts: '2026-08-03T10:00:00Z', node: 'noether' }),
      ],
    )
    expect(out.receipts.map((r) => r.node)).toEqual(['noether', 'lagrangian'])
  })

  it('marks phone-sourced receipts, and only those', () => {
    const out = projectTopicReceipts(
      'mechanics',
      [
        receipt({ node: 'a', source: 'self' }),
        receipt({ node: 'b', source: 'mobile-mc' }),
        receipt({ node: 'c', source: 'quick-mc' }),
        receipt({ node: 'd', source: null }),
      ],
    )
    const byNode = Object.fromEntries(out.receipts.map((r) => [r.node, r.fromPhone]))
    expect(byNode).toEqual({ a: false, b: true, c: true, d: false })
  })

  it('recognises the walk-level stamp the tutor actually writes', () => {
    // Caught by the first real round trip. The overlay stamps each ITEM with
    // its card kind, but stamps THE NODE'S ENCODE RECEIPT `mobile-walk` — and
    // that node receipt is the one provisional is computed from. Deriving the
    // set from the per-kind map alone missed it, so a node walked entirely on
    // the phone came back looking desk-graded: precisely the failure the §D6
    // pin exists to prevent, arriving through the one stamp the map does not
    // contain.
    const out = projectTopicReceipts('mechanics', [
      receipt({ node: 'walked', source: 'mobile-walk', kind: 'encode' }),
    ])
    expect(out.receipts[0].fromPhone).toBe(true)
    expect(out.provisional).toEqual(['walked'])
  })

  it('every phone stamp the wire can carry is recognised', () => {
    for (const source of PHONE_SOURCES) {
      const out = projectTopicReceipts('mechanics', [receipt({ source })])
      expect(out.receipts[0].fromPhone, source).toBe(true)
    }
  })

  it('calls a node provisional when its LATEST receipt came from the phone', () => {
    const out = projectTopicReceipts(
      'mechanics',
      [
        receipt({ node: 'a', ts: '2026-08-01T10:00:00Z', source: 'mobile-mc' }),
        receipt({ node: 'b', ts: '2026-08-01T10:00:00Z', source: 'mobile-mc' }),
        // b was later re-done at the desk — that Solidifies it.
        receipt({ node: 'b', ts: '2026-08-02T10:00:00Z', source: 'self' }),
      ],
    )
    expect(out.provisional).toEqual(['a'])
  })

  it('windows to the most recent MAX receipts', () => {
    const many = Array.from({ length: 90 }, (_, i) =>
      receipt({ node: `n${i}`, ts: `2026-08-01T${String(i % 24).padStart(2, '0')}:00:00Z` }),
    )
    const out = projectTopicReceipts('mechanics', many)
    expect(out.receipts.length).toBe(60)
  })

  it('provisional survives the window — it is computed before truncation', () => {
    const many = Array.from({ length: 90 }, (_, i) =>
      receipt({ node: `n${i}`, ts: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z` }),
    )
    // The oldest node is far outside the 60-receipt window but is still the
    // latest receipt for ITS node, so it is still provisional if phone-sourced.
    many.push(receipt({ node: 'ancient', ts: '2026-01-01T10:00:00Z', source: 'mobile-ladder' }))
    const out = projectTopicReceipts('mechanics', many)
    expect(out.receipts.some((r) => r.node === 'ancient')).toBe(false)
    expect(out.provisional).toContain('ancient')
  })

  it('names a node by humanising its id, because the schema has no titles', () => {
    // engram's graph nodes carry the answer fields, the edges and the FSRS
    // state — and no title field at all. An earlier version read
    // `nodes[id].title`, found nothing, and shipped raw ids to the phone.
    // Deriving is also strictly safer: this path now performs no graph read,
    // so there is no node object nearby to widen into.
    const out = projectTopicReceipts(
      'mechanics',
      [receipt({ node: 'runge-lenz-vector-dynamical-symmetry' })],
    )
    expect(out.receipts[0].title).toBe('Runge Lenz Vector Dynamical Symmetry')
  })

  it('carries no answer payload — grades cross the wire, content never does', () => {
    const out = projectTopicReceipts('mechanics', [receipt({})])
    const keys = Object.keys(out.receipts[0]).sort()
    expect(keys).toEqual(
      [
        'dueNext',
        'fromPhone',
        'grade',
        'intervalDays',
        'kind',
        'node',
        'rating',
        'relearn',
        'source',
        'title',
        'ts',
      ].sort(),
    )
  })
})
