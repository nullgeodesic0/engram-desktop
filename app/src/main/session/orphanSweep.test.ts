import { describe, expect, it } from 'vitest'
import { ORPHAN_MARKER, orphanPidsFromPsOutput, orphanPidsFromPowershellOutput } from './orphanSweep'

const SELF = 4242

describe('orphanPidsFromPsOutput', () => {
  it('picks out only the lines carrying our own MCP-config marker', () => {
    const out = [
      '  501 /usr/bin/some-unrelated-daemon',
      `  777 /opt/homebrew/bin/claude -p --mcp-config /var/folders/t/${ORPHAN_MARKER}ab12/mcp-config.json`,
      '  888 /Applications/Safari.app/Contents/MacOS/Safari',
    ].join('\n')
    expect(orphanPidsFromPsOutput(out, SELF)).toEqual([777])
  })

  it('never returns our own pid, init, or a malformed line', () => {
    const out = [
      `${SELF} claude --mcp-config /tmp/${ORPHAN_MARKER}x/mcp-config.json`,
      `1 launchd --mcp-config /tmp/${ORPHAN_MARKER}x/mcp-config.json`,
      `not-a-pid claude --mcp-config /tmp/${ORPHAN_MARKER}x/mcp-config.json`,
    ].join('\n')
    expect(orphanPidsFromPsOutput(out, SELF)).toEqual([])
  })

  it('tolerates the right-aligned pid column ps actually emits', () => {
    expect(orphanPidsFromPsOutput(`\t 91234   claude --mcp-config /tmp/${ORPHAN_MARKER}z/c.json`, SELF)).toEqual([91234])
  })
})

describe('orphanPidsFromPowershellOutput', () => {
  it('reads the bare-pid-per-line shape the CIM query emits, CRLF included', () => {
    expect(orphanPidsFromPowershellOutput('1234\r\n5678\r\n', SELF)).toEqual([1234, 5678])
  })

  it('ignores blank lines and our own pid', () => {
    expect(orphanPidsFromPowershellOutput(`\r\n${SELF}\r\n9\r\n\r\n`, SELF)).toEqual([9])
  })
})
