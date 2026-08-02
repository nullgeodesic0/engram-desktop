import { describe, expect, it } from 'vitest'
import { buildSessionEnv } from './sessionEnv'

describe('buildSessionEnv', () => {
  it('sets ENGRAM_ROOT and preserves the rest of the environment', () => {
    const env = buildSessionEnv({ PATH: '/usr/bin', HOME: '/Users/x' }, '/plugins/engram/1.10.1')
    expect(env.ENGRAM_ROOT).toBe('/plugins/engram/1.10.1')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/Users/x')
  })

  it('strips stray Anthropic auth vars so a shell export can never flip sessions onto API billing', () => {
    const base = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-stray', ANTHROPIC_AUTH_TOKEN: 'tok-stray' }
    const env = buildSessionEnv(base, '/root')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(base.ANTHROPIC_API_KEY).toBe('sk-stray')
  })

  it('apiKey mode injects the stored key, replacing any inherited value', () => {
    const base = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-stray' }
    const env = buildSessionEnv(base, '/root', 'apiKey', 'sk-real')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-real')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ENGRAM_ROOT).toBe('/root')
  })

  it('apiKey mode with no stored key throws with an actionable message — never a silent fallback', () => {
    for (const missing of [null, '', '   ']) {
      expect(() => buildSessionEnv({}, '/root', 'apiKey', missing)).toThrow('Settings → Authentication')
    }
  })

  it('subscription mode ignores a stored key entirely', () => {
    const env = buildSessionEnv({}, '/root', 'subscription', 'sk-stored')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})
