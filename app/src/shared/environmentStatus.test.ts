import { describe, expect, it } from 'vitest'
import { environmentIsReady } from './environmentStatus'

describe('environmentIsReady', () => {
  it('requires Codex, not Claude, when Codex subscription is selected', () => {
    expect(environmentIsReady({ pluginOk: true, claudeOk: false, codexOk: true, authMode: 'codexSubscription' })).toBe(true)
    expect(environmentIsReady({ pluginOk: true, claudeOk: true, codexOk: false, authMode: 'codexSubscription' })).toBe(false)
  })

  it('preserves the Claude requirement for Claude-backed modes and legacy results', () => {
    expect(environmentIsReady({ pluginOk: true, claudeOk: true })).toBe(true)
    expect(environmentIsReady({ pluginOk: true, claudeOk: false, codexOk: true })).toBe(false)
  })
})
