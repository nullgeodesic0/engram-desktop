import { describe, it, expect, beforeEach } from 'vitest'
import { recordSittingOutcome, loadSittingOutcome, describeAccuracy } from './lastSitting'

beforeEach(() => {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
})

const o = { at: 1, estimatedSeconds: 1380, actualSeconds: 1560, items: 4 }

describe('lastSitting', () => {
  it('round-trips an outcome', () => {
    recordSittingOutcome(o)
    expect(loadSittingOutcome()).toEqual(o)
  })

  it('rejects a sitting left open overnight — it says nothing about pace', () => {
    recordSittingOutcome({ ...o, actualSeconds: 9 * 60 * 60 })
    expect(loadSittingOutcome()).toBeNull()
  })

  it('stays quiet when the estimate was close', () => {
    expect(describeAccuracy({ ...o, estimatedSeconds: 1380, actualSeconds: 1560 })).toBeNull()
  })

  it('says so when the estimate ran long or short', () => {
    expect(describeAccuracy({ ...o, estimatedSeconds: 600, actualSeconds: 1500 })).toBe('last time: estimated 10 min, took 25')
    expect(describeAccuracy({ ...o, estimatedSeconds: 1500, actualSeconds: 600 })).toContain('took only 10')
  })

  it('survives unusable storage', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') }, removeItem: () => {},
    }
    expect(() => recordSittingOutcome(o)).not.toThrow()
    expect(loadSittingOutcome()).toBeNull()
  })
})
