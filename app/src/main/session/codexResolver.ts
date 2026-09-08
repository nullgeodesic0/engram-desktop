import { resolveCliBinary, clearCliBinaryCache } from './cliResolver'

/** Resolve Codex through the GUI-safe cross-platform CLI search shared by
 * Claude and OpenCode. Generic npm, Homebrew, XDG, and winget locations
 * cover the supported Codex installers. */
export async function resolveCodexBinary(): Promise<string> {
  return resolveCliBinary({ name: 'codex' })
}

export function clearCodexBinaryCache(): void {
  clearCliBinaryCache('codex')
}
