import { describe, expect, it } from 'vitest'
import { delimiter } from 'node:path'
import { buildCodexSessionEnv, buildCodexSubscriptionEnv } from './codexEnv'

describe('buildCodexSessionEnv', () => {
  it('shares the Engram engine while stripping ambient API billing credentials', () => {
    const base = { PATH: '/bin', OPENAI_API_KEY: 'paid', CODEX_API_KEY: 'paid-too', KEEP: 'yes' }
    const env = buildCodexSessionEnv(base, '/plugins/engram', '/shim')
    expect(env).toMatchObject({ ENGRAM_ROOT: '/plugins/engram', CODEX_PLUGIN_ROOT: '/plugins/engram', KEEP: 'yes' })
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.CODEX_API_KEY).toBeUndefined()
    expect(env.PATH).toBe(`/shim${delimiter}/bin`)
    expect(base.OPENAI_API_KEY).toBe('paid')
  })
})

describe('buildCodexSubscriptionEnv', () => {
  it('also protects non-session account/catalog app-server calls', () => {
    expect(buildCodexSubscriptionEnv({ OPENAI_API_KEY: 'paid', SAFE: 'yes' })).toEqual({ SAFE: 'yes' })
  })
})
