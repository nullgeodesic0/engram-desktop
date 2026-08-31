import { posix as posixPath, win32 as winPath } from 'node:path'
import { resolveCliBinary, clearCliBinaryCache, windowsVariants } from './cliResolver'

/**
 * Resolve an absolute path to the `claude` CLI binary.
 *
 * The general problem — a packaged app's PATH is not a terminal's PATH — and
 * the four-tier search that answers it both live in `cliResolver.ts`. This
 * file is only the Claude-specific part: where Claude Code's own installers
 * put things.
 *
 * `~/.claude/local/claude` is the Claude Code local installer's own target on
 * every platform and so goes first; on Windows the same directory holds a
 * `.cmd`/`.exe` instead of an extensionless shell script, and `existsSync`
 * does not apply PATHEXT, so each extension has to be spelled out. The
 * npm-global case (`%APPDATA%\npm\claude.cmd`) is covered by the generic
 * candidate list in `cliResolver.ts` — it is not Claude-specific.
 *
 * NOTE for callers: the returned path may be a Windows `.cmd` batch shim,
 * which `child_process.spawn` refuses to execute. Launch it through
 * `spawnCli`/`execCli` from `platform.ts`, never `spawn`/`execFile` directly.
 */
export async function resolveClaudeBinary(): Promise<string> {
  return resolveCliBinary({
    name: 'claude',
    // posixPath.join, not join — same host-Node-decides-the-separator trap
    // documented on cliResolver.ts's genericPosixCandidates; this candidate
    // list is reached and asserted on directly by claudeResolver.test.ts-style
    // callers regardless of which OS actually runs the test.
    posix: (home) => [posixPath.join(home, '.claude', 'local', 'claude')],
    // winPath.join, not join — see the note on `windowsVariants`.
    windows: (home, env) => {
      const localAppData = env.LOCALAPPDATA ?? winPath.join(home, 'AppData', 'Local')
      return [
        ...windowsVariants(winPath.join(home, '.claude', 'local'), 'claude'),
        ...windowsVariants(winPath.join(localAppData, 'Programs', 'claude-code'), 'claude'),
        ...windowsVariants(winPath.join(localAppData, 'claude-code', 'bin'), 'claude'),
      ]
    },
  })
}

/** Test-only: clears the module-level cache so a resolution can be re-run. */
export function clearClaudeBinaryCache(): void {
  clearCliBinaryCache('claude')
}
