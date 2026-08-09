import { describe, it, expect, beforeEach } from 'vitest'
import { saveDraft, loadDraft, clearDraft, draftKey } from './composerDrafts'

beforeEach(() => {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
})

const K = { surface: 'review', topic: 't', node: 'n' }

describe('composerDrafts', () => {
  it('round-trips a draft', () => {
    saveDraft(K, 'half an answer')
    expect(loadDraft(K)).toBe('half an answer')
  })

  it('keeps nodes apart, and the two loops apart', () => {
    saveDraft(K, 'A')
    saveDraft({ ...K, node: 'other' }, 'B')
    saveDraft({ ...K, surface: 'learn' }, 'C')
    expect(loadDraft(K)).toBe('A')
    expect(loadDraft({ ...K, node: 'other' })).toBe('B')
    expect(loadDraft({ ...K, surface: 'learn' })).toBe('C')
  })

  it('refuses to key on an unidentified node', () => {
    expect(draftKey({ surface: 'review', topic: null, node: 'n' })).toBeNull()
    expect(draftKey({ surface: 'review', topic: 't', node: null })).toBeNull()
    saveDraft({ surface: 'review', topic: null, node: null }, 'x')
    expect(loadDraft({ surface: 'review', topic: null, node: null })).toBeNull()
  })

  it('treats an emptied box as a deletion, not a tombstone', () => {
    saveDraft(K, 'something')
    saveDraft(K, '   ')
    expect(loadDraft(K)).toBeNull()
  })

  it('drops a draft older than a week, and removes it', () => {
    saveDraft(K, 'stale')
    expect(loadDraft(K, Date.now() + 8 * 24 * 60 * 60 * 1000)).toBeNull()
    expect(loadDraft(K)).toBeNull()
  })

  it('clears on demand', () => {
    saveDraft(K, 'x')
    clearDraft(K)
    expect(loadDraft(K)).toBeNull()
  })

  it('survives unusable storage rather than throwing', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error('nope') },
      setItem: () => { throw new Error('nope') },
      removeItem: () => { throw new Error('nope') },
    }
    expect(() => saveDraft(K, 'x')).not.toThrow()
    expect(loadDraft(K)).toBeNull()
  })
})
