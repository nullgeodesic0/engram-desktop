import { describe, expect, it } from 'vitest'
import { normalizeAuthSettings } from './authSettings'

describe('normalizeAuthSettings', () => {
  it('keeps the Codex subscription mode and selected model', () => {
    expect(normalizeAuthSettings({ authMode: 'codexSubscription', codexModel: 'gpt-fast' })).toMatchObject({
      authMode: 'codexSubscription',
      codexModel: 'gpt-fast',
    })
  })

  it('gives existing settings files an empty Codex model without changing Claude defaults', () => {
    expect(normalizeAuthSettings({ authMode: 'subscription', subscriptionModel: 'claude-sonnet-5-5' })).toMatchObject({
      authMode: 'subscription',
      subscriptionModel: 'claude-sonnet-5-5',
      codexModel: '',
    })
  })

  it('moves a Claude pick from a retired lineup to its current tier', () => {
    expect(normalizeAuthSettings({ subscriptionModel: 'claude-opus-5' }).subscriptionModel).toBe('claude-opus-5-5')
    expect(normalizeAuthSettings({ subscriptionModel: 'claude-haiku-4-5-20251001' }).subscriptionModel).toBe('claude-haiku-5-5')
    expect(normalizeAuthSettings({ subscriptionModel: '' }).subscriptionModel).toBe('')
  })

  it('falls back from an unknown mode without retaining malformed model values', () => {
    expect(normalizeAuthSettings({ authMode: 'future', codexModel: 42 })).toMatchObject({
      authMode: 'subscription',
      codexModel: '',
    })
  })
})
