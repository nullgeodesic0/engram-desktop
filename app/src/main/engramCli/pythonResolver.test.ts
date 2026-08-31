import { describe, expect, it } from 'vitest'
import { windowsVariants } from '../session/cliResolver'

// pythonResolver.ts's windowsCandidates/posixCandidates are not exported (the
// resolver's public surface is only `resolvePython`), so the regression this
// file guards against — plain `path.join` silently adopting the HOST OS's
// separator instead of the separator the candidate list is FOR — is instead
// pinned via `windowsVariants`, which both this module and pythonResolver.ts
// depend on for the identical reason and which IS exported. A host running
// this suite on Windows would turn a POSIX-flavoured `path.join('/a', 'b')`
// into `/a\b`, and this assertion catches that class of mistake regardless of
// which OS actually runs the test — exactly the bug that broke
// cliResolver.test.ts on the Windows CI runner.
describe('path construction stays platform-explicit regardless of host OS', () => {
  it('windowsVariants always uses backslashes, even when this test itself runs on POSIX', () => {
    expect(windowsVariants('C:\\Users\\x', 'python')).toEqual([
      'C:\\Users\\x\\python.exe',
      'C:\\Users\\x\\python.cmd',
      'C:\\Users\\x\\python.bat',
    ])
  })
})
