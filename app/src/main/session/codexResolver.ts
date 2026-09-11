import { posix as posixPath, win32 as winPath } from 'node:path'
import { resolveCliBinary, clearCliBinaryCache, windowsVariants } from './cliResolver'

/** Resolve Codex through the GUI-safe cross-platform CLI search shared by
 * Claude and OpenCode. Generic npm, Homebrew, XDG, and winget locations
 * cover the supported Codex installers. */
export async function resolveCodexBinary(): Promise<string> {
  return resolveCliBinary({
    name: 'codex',
    posix: (home, env) => [
      ...(env.CODEX_INSTALL_DIR ? [posixPath.join(env.CODEX_INSTALL_DIR, 'codex')] : []),
      '/Applications/ChatGPT.app/Contents/Resources/codex',
      posixPath.join(home, 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex'),
    ],
    windows: (home, env) => {
      const localAppData = env.LOCALAPPDATA ?? winPath.join(home, 'AppData', 'Local')
      const dirs = [
        ...(env.CODEX_INSTALL_DIR ? [env.CODEX_INSTALL_DIR] : []),
        winPath.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin'),
      ]
      return dirs.flatMap((dir) => windowsVariants(dir, 'codex'))
    },
  })
}

export function clearCodexBinaryCache(): void {
  clearCliBinaryCache('codex')
}
