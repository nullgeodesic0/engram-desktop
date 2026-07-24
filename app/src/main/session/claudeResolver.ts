import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const COMMON_LOCATIONS = [
  join(homedir(), '.claude', 'local', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
]

let cached: string | null = null

/**
 * Resolve an absolute path to the `claude` CLI binary. `spawn('claude', ...)`
 * relies on inherited PATH, which is fine when the app runs via `npm run dev`
 * from a terminal but silently fails for a packaged app launched from
 * Finder/Dock/Spotlight — those don't inherit a login shell's PATH, so
 * wherever `claude` actually lives (nvm, Homebrew, the Claude Code local
 * installer under ~/.claude/local) often isn't visible.
 *
 * Checks common install locations first (cheap, no subprocess), then falls
 * back to asking the user's actual login shell for its real PATH once
 * (`$SHELL -lic 'command -v claude'`) — this correctly picks up whatever the
 * user's own shell rc files configure, which is the only fully general
 * answer short of requiring a specific install location.
 */
export async function resolveClaudeBinary(): Promise<string> {
  if (cached) return cached

  for (const loc of COMMON_LOCATIONS) {
    if (existsSync(loc)) {
      cached = loc
      return cached
    }
  }

  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const { stdout } = await execAsync(`${shell} -lic 'command -v claude'`, { timeout: 10_000 })
    const resolved = stdout.trim().split('\n').pop()?.trim()
    if (resolved && existsSync(resolved)) {
      cached = resolved
      return cached
    }
  } catch {
    // Login-shell probe failed (no such binary, shell not found, etc.) — fall through
    // to the bare-name fallback below rather than throwing here; the actual spawn
    // failure (if any) surfaces as a real session error the environment-check screen
    // and RateLimitBanner-adjacent error UI already know how to show.
  }

  cached = 'claude' // last resort: trust inherited PATH, correct in a terminal-launched dev run
  return cached
}

/** Test-only: clears the module-level cache so a resolution can be re-run. */
export function clearClaudeBinaryCache(): void {
  cached = null
}
