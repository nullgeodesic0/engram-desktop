import { describe, expect, it } from 'vitest'
import {
  envDirFor,
  runtimeTarget,
  scrubbedEnv,
  envInterpreter,
  lockHash,
  progressLine,
  runtimeLayout,
  uvAssetFor,
  UV_VERSION,
} from './runtimePaths'

describe('runtime paths', () => {
  it('pins a checksummed uv asset for every desktop target the app ships', () => {
    for (const [platform, arch] of [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['linux', 'x64'],
      ['win32', 'x64'],
      ['win32', 'arm64'],
    ] as const) {
      const a = uvAssetFor(platform, arch)
      expect(a, `${platform}-${arch}`).not.toBeNull()
      expect(a!.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(a!.url).toContain(`/download/${UV_VERSION}/`)
    }
    expect(uvAssetFor('linux', 'ia32')).toBeNull()
    // Linux on ARM is refused up front.
    expect(uvAssetFor('linux', 'arm64')).toBeNull()
    // Windows on ARM runs the x64 build under emulation, for the win_amd64 wheels.
    expect(uvAssetFor('win32', 'arm64')!.file).toBe(uvAssetFor('win32', 'x64')!.file)
    expect(runtimeTarget('win32', 'arm64')!.python).toMatch(/windows-x86_64/)
  })

  it('names an env by the first 12 hex of its lockfile hash, line endings ignored', () => {
    const h = lockHash('numpy==1.15\n')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
    expect(lockHash('numpy==1.15\r\n')).toBe(h)
    expect(lockHash('numpy==1.16\n')).not.toBe(h)
  })

  it('lays the runtime out under one root, with the interpreter where venv puts it', () => {
    const l = runtimeLayout('/u/runtime', 'linux')
    expect(l.uvBin).toBe(`/u/runtime/uv/${UV_VERSION}/uv`)
    expect(envDirFor(l, 'base', 'abc')).toBe('/u/runtime/envs/base-abc')
    expect(envInterpreter('/e', 'linux')).toBe('/e/bin/python')
    expect(envInterpreter('C:\\e', 'win32')).toMatch(/Scripts[\\/]python\.exe$/)
    expect(runtimeLayout('/u/runtime', 'win32').uvBin).toMatch(/uv\.exe$/)
  })

  it('keeps uv progress lines and drops noise', () => {
    expect(progressLine('Downloading numpy (15.7MiB)')).toBe('Downloading numpy (15.7MiB)')
    expect(progressLine('\u001b[32mInstalled\u001b[0m 31 packages in 2.1s')).toBe('Installed 31 packages in 2.1s')
    expect(progressLine(' + numpy==1.15.0')).toBeNull()
    expect(progressLine('')).toBeNull()
  })

  it('scrubs AI credentials and foreign Python settings from a kernel environment', () => {
    const env = scrubbedEnv({
      PATH: '/bin',
      HOME: '/h',
      ANTHROPIC_API_KEY: 'k',
      anthropic_base_url: 'u',
      OPENAI_API_KEY: 'k',
      CLAUDE_CODE_OAUTH_TOKEN: 't',
      CLAUDECODE: '1',
      SOME_SERVICE_API_KEY: 'k',
      PYTHONPATH: '/x',
      VIRTUAL_ENV: '/v',
      LANG: 'en_US.UTF-8',
    })
    expect(Object.keys(env).sort()).toEqual(['HOME', 'LANG', 'PATH'])
  })
})
