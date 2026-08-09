import { describe, expect, test } from 'vitest'
import { parseOutboxItem, sourceStampFor } from './linkProtocol'

/**
 * The phone is an untrusted client by construction — it is reachable over the
 * LAN and its payloads carry learner evidence into a real session. These tests
 * pin the two doctrine rules the wire format itself has to enforce, because a
 * guard that only the UI honours is not a guard:
 *
 *   1. the phone never mints a rating or a source stamp (`a window, never a
 *      second author` — the Mac's live session rates);
 *   2. the source stamp is DERIVED from the input kind, so no payload can
 *      launder recognition evidence into the free-recall pool.
 */

function validItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '6f1c2a10-0000-4000-8000-000000000001',
    topic: 'grad-statistical-mechanics',
    node: 'liouville-theorem',
    mode: 'review',
    kind: 'ladder',
    confidence: 3,
    trail: 'assembly 5/6',
    committedAt: '2026-08-09T18:04:00.000Z',
    ...over,
  }
}

describe('parseOutboxItem', () => {
  test('accepts a well-formed item', () => {
    const parsed = parseOutboxItem(validItem())
    expect(parsed?.node).toBe('liouville-theorem')
    expect(parsed?.kind).toBe('ladder')
  })

  test('rejects an item that carries its own rating', () => {
    expect(parseOutboxItem(validItem({ rating: 'easy' }))).toBeNull()
  })

  test('rejects an item that carries its own source stamp', () => {
    expect(parseOutboxItem(validItem({ source: 'self' }))).toBeNull()
  })

  test('rejects an unknown input kind', () => {
    expect(parseOutboxItem(validItem({ kind: 'freebie' }))).toBeNull()
  })

  test('requires a production on a recall item', () => {
    expect(parseOutboxItem(validItem({ kind: 'recall' }))).toBeNull()
    expect(parseOutboxItem(validItem({ kind: 'recall', production: 'entropy is...' }))).not.toBeNull()
  })

  test('rejects a production on a tap-derived item', () => {
    // A tap item has no production to grade; accepting one would hand the
    // blind assessor a shape it cannot honestly judge.
    expect(parseOutboxItem(validItem({ production: 'smuggled prose' }))).toBeNull()
  })

  test('caps a production at the engine PRODUCTION_MAX of 800 characters', () => {
    const item = validItem({ kind: 'recall', production: 'x'.repeat(801) })
    expect(parseOutboxItem(item)).toBeNull()
  })

  test('rejects a confidence outside the four bands', () => {
    expect(parseOutboxItem(validItem({ confidence: 5 }))).toBeNull()
    expect(parseOutboxItem(validItem({ confidence: 0 }))).toBeNull()
    expect(parseOutboxItem(validItem({ confidence: null }))).not.toBeNull()
  })
})

describe('sourceStampFor', () => {
  test('derives a distinct stamp per tap-derived kind', () => {
    expect(sourceStampFor('checkpoint')).toBe('quick-mc')
    expect(sourceStampFor('connect')).toBe('mobile-mc')
    expect(sourceStampFor('cloze')).toBe('mobile-cloze')
    expect(sourceStampFor('ladder')).toBe('mobile-ladder')
  })

  test('stamps a spoken or typed recall as ordinary production', () => {
    // The escape hatch that keeps mobile from being a permanent downgrade:
    // a real production on the phone is `self`, uncapped, assessor-graded.
    expect(sourceStampFor('recall')).toBe('self')
  })
})
