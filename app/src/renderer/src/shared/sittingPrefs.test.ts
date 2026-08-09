// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadSittingPrefs, saveSittingMins } from './sittingPrefs'

// Plain-node vitest (no jsdom in this repo's config) — a minimal localStorage
// stub is enough because the store touches only getItem/setItem.
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
})

describe('sittingPrefs', () => {
  it('defaults to standard/10', () => {
    expect(loadSittingPrefs()).toEqual({ mins: 10, style: 'standard', focusTopic: null })
  })
  it('persists the time pick', () => {
    saveSittingMins(5)
    expect(loadSittingPrefs()).toEqual({ mins: 5, style: 'standard', focusTopic: null })
  })
  it('NEVER persists style — always standard on load', () => {
    store.set('engram-sitting-prefs', JSON.stringify({ mins: 25, style: 'checkpoint' }))
    expect(loadSittingPrefs()).toEqual({ mins: 25, style: 'standard', focusTopic: null })
  })
  it('garbage degrades to defaults', () => {
    store.set('engram-sitting-prefs', '{not json')
    expect(loadSittingPrefs()).toEqual({ mins: 10, style: 'standard', focusTopic: null })
    store.set('engram-sitting-prefs', JSON.stringify({ mins: 999 }))
    expect(loadSittingPrefs()).toEqual({ mins: 10, style: 'standard', focusTopic: null })
  })
})
