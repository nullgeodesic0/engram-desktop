import { describe, expect, it } from 'vitest'
import { envDirFor, envInterpreter, lockHash, progressLine, runtimeLayout, uvAssetFor, UV_VERSION } from './runtimePaths'

describe('runtime paths', () => {
  it('pins a checksummed uv asset for every desktop target the app ships', () => {
    for (const [platform, arch] of [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['win32', 'x64'],
      ['win32', 'arm64'],
    ] as const) {
      const a = uvAssetFor(platform, arch)
      expect(a, `${platform}-${arch}`).not.toBeNull()
      expect(a!.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(a!.url).toContain(`/download/${UV_VERSION}/`)
    }
    expect(uvAssetFor('linux', 'ia32')).toBeNull()
  })

  it('names an env by the first 12 hex of its lockfile hash, line endings ignored', () => {
    const h = lockHash('stim==1.15\n')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
    expect(lockHash('stim==1.15\r\n')).toBe(h)
    expect(lockHash('stim==1.16\n')).not.toBe(h)
  })

  it('lays the runtime out under one root, with the interpreter where venv puts it', () => {
    const l = runtimeLayout('/u/runtime', 'linux')
    expect(l.uvBin).toBe(`/u/runtime/uv/${UV_VERSION}/uv`)
    expect(envDirFor(l, 'qec-core', 'abc')).toBe('/u/runtime/envs/qec-core-abc')
    expect(envInterpreter('/e', 'linux')).toBe('/e/bin/python')
    expect(envInterpreter('C:\\e', 'win32')).toMatch(/Scripts[\\/]python\.exe$/)
    expect(runtimeLayout('/u/runtime', 'win32').uvBin).toMatch(/uv\.exe$/)
  })

  it('keeps uv progress lines and drops noise', () => {
    expect(progressLine('Downloading numpy (15.7MiB)')).toBe('Downloading numpy (15.7MiB)')
    expect(progressLine('\u001b[32mInstalled\u001b[0m 31 packages in 2.1s')).toBe('Installed 31 packages in 2.1s')
    expect(progressLine(' + stim==1.15.0')).toBeNull()
    expect(progressLine('')).toBeNull()
  })
})
