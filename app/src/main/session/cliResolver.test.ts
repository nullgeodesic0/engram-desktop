import { describe, expect, it } from 'vitest'
import {
  clearCliBinaryCache,
  resolveCliBinary,
  resolveCliBinaryWith,
  windowsVariants,
  type ResolverDeps,
} from './cliResolver'

/** A deps object where nothing is found anywhere, so each test can opt one
 * tier into succeeding and assert that the tiers above it were preferred. */
function deps(over: Partial<ResolverDeps> = {}): ResolverDeps {
  return {
    platform: 'darwin',
    home: '/Users/x',
    env: {},
    exists: () => false,
    lookupOnPath: async () => null,
    probeLoginShell: async () => null,
    ...over,
  }
}

describe('resolveCliBinaryWith', () => {
  it('prefers a tool-specific install location over every generic prefix', async () => {
    const found = await resolveCliBinaryWith(
      { name: 'claude', posix: (home) => [`${home}/.claude/local/claude`] },
      deps({ exists: (p) => p === '/Users/x/.claude/local/claude' || p === '/opt/homebrew/bin/claude' }),
    )
    expect(found).toBe('/Users/x/.claude/local/claude')
  })

  it('falls through to the generic prefixes when the tool-specific one is absent', async () => {
    const found = await resolveCliBinaryWith(
      { name: 'claude', posix: (home) => [`${home}/.claude/local/claude`] },
      deps({ exists: (p) => p === '/opt/homebrew/bin/claude' }),
    )
    expect(found).toBe('/opt/homebrew/bin/claude')
  })

  it('uses PATH only after every known location has missed', async () => {
    const found = await resolveCliBinaryWith(
      { name: 'claude' },
      deps({ lookupOnPath: async () => '/somewhere/odd/claude' }),
    )
    expect(found).toBe('/somewhere/odd/claude')
  })

  it('asks the login shell only when PATH also missed, and verifies what it answers', async () => {
    const asked: string[] = []
    const found = await resolveCliBinaryWith(
      { name: 'claude' },
      deps({
        probeLoginShell: async (n) => {
          asked.push(n)
          return '/Users/x/.nvm/versions/node/v22/bin/claude'
        },
        exists: (p) => p === '/Users/x/.nvm/versions/node/v22/bin/claude',
      }),
    )
    expect(asked).toEqual(['claude'])
    expect(found).toBe('/Users/x/.nvm/versions/node/v22/bin/claude')
  })

  it('rejects a login-shell answer that does not exist rather than returning a dead path', async () => {
    const found = await resolveCliBinaryWith(
      { name: 'claude' },
      deps({ probeLoginShell: async () => '/stale/claude' }),
    )
    expect(found).toBe('claude')
  })

  it('never probes a login shell on Windows — there is no `-lic` to probe with', async () => {
    let probed = false
    const found = await resolveCliBinaryWith(
      { name: 'claude' },
      deps({
        platform: 'win32',
        home: 'C:\\Users\\x',
        probeLoginShell: async () => {
          probed = true
          return 'C:\\anything'
        },
      }),
    )
    expect(probed).toBe(false)
    expect(found).toBe('claude')
  })

  it('finds the npm-global .cmd shim on Windows — the single most common install', async () => {
    const found = await resolveCliBinaryWith(
      { name: 'claude' },
      deps({
        platform: 'win32',
        home: 'C:\\Users\\x',
        env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' },
        exists: (p) => p === 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd',
      }),
    )
    expect(found).toBe('C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd')
  })

  it('prefers a real .exe over a .cmd shim in the same directory', async () => {
    const dir = 'C:\\Users\\x\\AppData\\Roaming\\npm'
    const found = await resolveCliBinaryWith(
      { name: 'claude' },
      deps({
        platform: 'win32',
        home: 'C:\\Users\\x',
        env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' },
        exists: (p) => p === `${dir}\\claude.exe` || p === `${dir}\\claude.cmd`,
      }),
    )
    expect(found).toBe(`${dir}\\claude.exe`)
  })

  it('a PATH lookup that throws is a miss, not a crash', async () => {
    const found = await resolveCliBinaryWith(
      { name: 'claude' },
      deps({
        lookupOnPath: async () => {
          throw new Error('PATH is unreadable')
        },
      }),
    )
    expect(found).toBe('claude')
  })

  it('never consults Windows candidates on POSIX, or POSIX candidates on Windows', async () => {
    const seen: string[] = []
    await resolveCliBinaryWith(
      { name: 'tool', posix: () => ['/posix/only'], windows: () => ['C:\\windows\\only'] },
      deps({ exists: (p) => (seen.push(p), false) }),
    )
    expect(seen).toContain('/posix/only')
    expect(seen).not.toContain('C:\\windows\\only')
  })
})

describe('windowsVariants', () => {
  it('spells out every executable extension, because existsSync does not apply PATHEXT', () => {
    expect(windowsVariants('C:\\bin', 'claude')).toEqual([
      'C:\\bin\\claude.exe',
      'C:\\bin\\claude.cmd',
      'C:\\bin\\claude.bat',
    ])
  })
})

describe('resolveCliBinary cache', () => {
  it('retries an unresolved command after it becomes available while the app is running', async () => {
    const name = 'engram-test-late-installed-cli'
    clearCliBinaryCache(name)

    expect(await resolveCliBinary({ name })).toBe(name)
    expect(await resolveCliBinary({
      name,
      posix: () => [process.execPath],
      windows: () => [process.execPath],
    })).toBe(process.execPath)
  })
})
