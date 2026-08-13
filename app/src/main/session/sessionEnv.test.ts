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

describe('local-model mode', () => {
  it('points the CLI at the local server and satisfies its auth requirement', () => {
    const env = buildSessionEnv({ PATH: '/usr/bin' }, '/root', 'local', null, 'http://localhost:11434')
    expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:11434')
    // The CLI refuses to start unauthenticated even against an endpoint that
    // ignores credentials; this placeholder is not a secret.
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('local-no-auth')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('trims a trailing slash so the CLI never builds a double-slashed path', () => {
    const env = buildSessionEnv({}, '/root', 'local', null, 'http://localhost:11434/')
    expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:11434')
  })

  it('refuses to start rather than falling back to a billed endpoint', () => {
    expect(() => buildSessionEnv({}, '/root', 'local', null, '')).toThrow(/no server address/i)
    expect(() => buildSessionEnv({}, '/root', 'local', null, null)).toThrow(/no server address/i)
  })

  it('strips an ambient ANTHROPIC_BASE_URL in every other mode', () => {
    // A shell that exports it (another launcher, a proxy experiment) must
    // never silently redirect tutoring to an endpoint nobody chose here.
    const stray = { PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'http://somewhere-else:9999' }
    expect(buildSessionEnv(stray, '/root', 'subscription').ANTHROPIC_BASE_URL).toBeUndefined()
    expect(buildSessionEnv(stray, '/root', 'apiKey', 'sk-real').ANTHROPIC_BASE_URL).toBeUndefined()
    expect(stray.ANTHROPIC_BASE_URL).toBe('http://somewhere-else:9999') // caller's env untouched
  })
})
