import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliSpec } from './cliResolver'

const { resolveCliBinary, clearCliBinaryCache } = vi.hoisted(() => ({
  resolveCliBinary: vi.fn<(spec: CliSpec) => Promise<string>>(async () => 'codex'),
  clearCliBinaryCache: vi.fn(),
}))

vi.mock('./cliResolver', () => ({
  resolveCliBinary,
  clearCliBinaryCache,
  windowsVariants: (dir: string, name: string) => [
    `${dir}\\${name}.exe`,
    `${dir}\\${name}.cmd`,
    `${dir}\\${name}.bat`,
  ],
}))

import { resolveCodexBinary } from './codexResolver'

describe('resolveCodexBinary', () => {
  beforeEach(() => {
    resolveCliBinary.mockClear()
  })

  it('checks the official standalone installer location on Windows', async () => {
    await resolveCodexBinary()

    const spec = resolveCliBinary.mock.calls[0]?.[0]
    expect(spec?.windows?.('C:\\Users\\x', {
      LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
    })).toContain('C:\\Users\\x\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe')
  })

  it('honors a custom standalone install directory on every platform', async () => {
    await resolveCodexBinary()

    const spec = resolveCliBinary.mock.calls[0]?.[0]
    expect(spec?.windows?.('C:\\Users\\x', {
      CODEX_INSTALL_DIR: 'D:\\Tools\\Codex',
    })).toContain('D:\\Tools\\Codex\\codex.exe')
    expect(spec?.posix?.('/Users/x', {
      CODEX_INSTALL_DIR: '/Volumes/Tools/codex-bin',
    })).toContain('/Volumes/Tools/codex-bin/codex')
  })

  it('checks the Codex binary bundled with ChatGPT on macOS', async () => {
    await resolveCodexBinary()

    const spec = resolveCliBinary.mock.calls[0]?.[0]
    expect(spec?.posix?.('/Users/x', {})).toEqual(expect.arrayContaining([
      '/Applications/ChatGPT.app/Contents/Resources/codex',
      '/Users/x/Applications/ChatGPT.app/Contents/Resources/codex',
    ]))
  })
})
