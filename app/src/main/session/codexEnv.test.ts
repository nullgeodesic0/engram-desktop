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

  it('strips plugin roots the engine locator would check ahead of CODEX_PLUGIN_ROOT', () => {
    const base = { PATH: '/bin', ZCODE_PLUGIN_ROOT: '/zcode/engram', OPENCODE_PLUGIN_ROOT: '/oc/engram' }
    const env = buildCodexSessionEnv(base, '/plugins/engram')
    expect(env.ZCODE_PLUGIN_ROOT).toBeUndefined()
    expect(env.OPENCODE_PLUGIN_ROOT).toBeUndefined()
    expect(env.CODEX_PLUGIN_ROOT).toBe('/plugins/engram')
  })
})

describe('buildCodexSubscriptionEnv', () => {
  it('also protects non-session account/catalog app-server calls', () => {
    expect(buildCodexSubscriptionEnv({ OPENAI_API_KEY: 'paid', SAFE: 'yes' })).toEqual({ SAFE: 'yes' })
  })
})
