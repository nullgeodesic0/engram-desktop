/**
 * Finding an external CLI on disk, on any of the three desktop platforms.
 *
 * ## The problem this solves
 *
 * `spawn('claude', ...)` relies on the inherited PATH. That is fine when the
 * app is started from a terminal, and wrong for every way a real user starts
 * a real app:
 *
 *  - **macOS** — a Finder/Dock/Spotlight launch inherits `/usr/bin:/bin:
 *    /usr/sbin:/sbin` and nothing else. Homebrew, nvm, and Claude Code's own
 *    `~/.claude/local` installer are all invisible.
 *  - **Linux** — a `.desktop` launch inherits the session PATH, which usually
 *    DOES include `~/.local/bin`, but not a `~/.bun/bin` or an nvm shim that
 *    only an interactive rc file adds.
 *  - **Windows** — a GUI launch inherits the full user PATH from the registry,
 *    so PATH lookup genuinely works here; what does NOT work is assuming the
 *    hit is an `.exe`. `npm i -g` writes `claude.cmd`, and finding it at all
 *    requires honouring PATHEXT rather than testing for a bare filename.
 *
 * So the search runs in four tiers, cheapest and most certain first:
 *
 *   1. Known install locations for this platform (pure `existsSync`, no
 *      subprocess).
 *   2. A PATHEXT-aware PATH lookup (`which`), which is the tier that carries
 *      Windows and most of Linux.
 *   3. POSIX only: ask the user's real login shell what ITS PATH resolves to
 *      (`$SHELL -lic 'command -v <name>'`). This is the only fully general
 *      answer to the macOS Finder-launch problem, because it evaluates the
 *      user's own rc files. There is no Windows analogue and none is needed —
 *      Windows has no "login shell rc mutates PATH" convention; PATH is
 *      already in the environment tier 2 searched.
 *   4. The bare name, trusting inherited PATH. Correct in a terminal-launched
 *      dev run, and a spawn failure from here surfaces as a real session error
 *      the environment-check screen already knows how to show.
 *
 * Kept separate from the individual `claudeResolver`/`opencodeResolver`/
 * `pythonResolver` modules, and injectable, so the tier ordering and the
 * platform-specific candidate lists can be tested without a `claude` install
 * on the machine running the tests.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { win32 as winPath, posix as posixPath } from 'node:path'
import which from 'which'
import { execCli } from '../platform'

export interface CliSpec {
  /** Bare command name, e.g. `claude`. */
  name: string
  /** Absolute candidates to try before anything else, on macOS and Linux. */
  posix?: (home: string, env: NodeJS.ProcessEnv) => string[]
  /** Absolute candidates to try before anything else, on Windows. Extensions
   * must be spelled out — `existsSync` does not apply PATHEXT. */
  windows?: (home: string, env: NodeJS.ProcessEnv) => string[]
}

export interface ResolverDeps {
  platform: NodeJS.Platform
  home: string
  env: NodeJS.ProcessEnv
  exists(path: string): boolean
  /** PATHEXT-aware PATH lookup. Resolves null when not found. */
  lookupOnPath(name: string): Promise<string | null>
  /** POSIX login-shell probe. Resolves null when it can't answer. */
  probeLoginShell(name: string): Promise<string | null>
}

/** Executable extensions a Windows install might use, in the order we prefer
 * them: a real executable beats a batch shim, because it needs no `cmd.exe`
 * hop at spawn time (see platform.ts). `.ps1` is deliberately absent —
 * PowerShell scripts cannot be launched as a process image at all, and npm
 * always writes a `.cmd` beside any `.ps1` it generates. */
export const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat'] as const

/**
 * Every `<dir>\<name><ext>` combination worth stat-ing on Windows.
 *
 * `path.win32.join`, not `path.join` — the separator `path.join` picks comes
 * from the HOST it runs on, not from the paths it is joining, so building a
 * Windows candidate list with it produces `C:\bin/claude.cmd` anywhere but
 * Windows. That is invisible in production (this branch only ever runs on
 * Windows, where the two agree) and precisely what made the Windows half of
 * the resolver untestable from a Mac. Being explicit about which flavour of
 * path is being constructed is the honest form either way.
 */
export function windowsVariants(dir: string, name: string): string[] {
  return WINDOWS_EXECUTABLE_EXTENSIONS.map((ext) => winPath.join(dir, `${name}${ext}`))
}

/**
 * Install locations shared by every CLI we look for, rather than repeated per
 * tool: npm's global bin, winget's shim directory, bun, and the standard
 * user-local and system prefixes.
 *
 * `posixPath.join`, not the plain `join` used elsewhere in this file — the
 * plain form resolves to whatever `path.join` the HOST Node process has,
 * which is `path.win32.join` when this actually runs on Windows. That
 * produced `C:\opt\homebrew\bin\claude` — a POSIX candidate with backslash
 * separators — invisible in the app itself (this function is never reached
 * on Windows, `genericWindowsCandidates` is) but exactly the bug that broke
 * `cliResolver.test.ts` when it ran on a real Windows CI runner, where the
 * test calls this function directly. Same class of mistake `windowsVariants`
 * already documents in the other direction.
 */
function genericPosixCandidates(name: string, home: string): string[] {
  const dirs = [
    '/opt/homebrew/bin', // Apple-silicon Homebrew
    '/usr/local/bin', // Intel Homebrew, and the usual `make install` prefix
    posixPath.join(home, '.local', 'bin'), // pipx, pip --user, and the XDG convention Linux leans on
    posixPath.join(home, 'bin'),
    posixPath.join(home, '.bun', 'bin'),
    posixPath.join(home, '.npm-global', 'bin'),
    '/usr/bin',
    '/snap/bin', // Linux: snap-packaged tools
    '/var/lib/flatpak/exports/bin',
  ]
  return dirs.map((dir) => posixPath.join(dir, name))
}

/** `winPath.join` throughout, for the reason spelled out on `windowsVariants`. */
function genericWindowsCandidates(name: string, home: string, env: NodeJS.ProcessEnv): string[] {
  const appData = env.APPDATA ?? winPath.join(home, 'AppData', 'Roaming')
  const localAppData = env.LOCALAPPDATA ?? winPath.join(home, 'AppData', 'Local')
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
  const dirs = [
    winPath.join(appData, 'npm'), // `npm i -g` — by far the most common, and always a .cmd
    winPath.join(localAppData, 'Programs', name),
    winPath.join(localAppData, name, 'bin'),
    winPath.join(localAppData, 'Microsoft', 'WinGet', 'Links'), // winget's shim dir
    winPath.join(home, '.local', 'bin'),
    winPath.join(home, '.bun', 'bin'),
    winPath.join(programFiles, name),
    winPath.join(programFiles, name, 'bin'),
  ]
  return dirs.flatMap((dir) => windowsVariants(dir, name))
}

/**
 * The tiered search described in this module's header. Pure with respect to
 * the injected deps — no `process`, no `os`, no filesystem of its own.
 */
export async function resolveCliBinaryWith(spec: CliSpec, deps: ResolverDeps): Promise<string> {
  const onWindows = deps.platform === 'win32'

  // Tier 1 — known install locations. Tool-specific candidates first: a
  // `~/.claude/local/claude` is a stronger signal about which install the
  // user actually means than a stray copy on a generic prefix.
  const specific = onWindows ? (spec.windows?.(deps.home, deps.env) ?? []) : (spec.posix?.(deps.home, deps.env) ?? [])
  const generic = onWindows
    ? genericWindowsCandidates(spec.name, deps.home, deps.env)
    : genericPosixCandidates(spec.name, deps.home)
  for (const candidate of [...specific, ...generic]) {
    if (deps.exists(candidate)) return candidate
  }

  // Tier 2 — PATH, honouring PATHEXT on Windows.
  try {
    const onPath = await deps.lookupOnPath(spec.name)
    if (onPath) return onPath
  } catch {
    // A PATH lookup that throws is a "not found", never a fatal error.
  }

  // Tier 3 — POSIX login shell. Skipped on Windows: there is no `-lic`, and
  // spawning `cmd.exe` to re-read a PATH we already have would find nothing
  // tier 2 didn't.
  if (!onWindows) {
    try {
      const fromShell = await deps.probeLoginShell(spec.name)
      if (fromShell && deps.exists(fromShell)) return fromShell
    } catch {
      // Shell missing, rc file that errors, timeout — fall through.
    }
  }

  // Tier 4 — trust inherited PATH and let the real spawn failure speak.
  return spec.name
}

/** Real-world deps: the filesystem, `which`, and the user's login shell. */
export function defaultResolverDeps(): ResolverDeps {
  return {
    platform: process.platform,
    home: homedir(),
    env: process.env,
    exists: existsSync,
    lookupOnPath: (name) => which(name, { nothrow: true }) as Promise<string | null>,
    probeLoginShell: async (name) => {
      const shell = process.env.SHELL || '/bin/sh'
      const { stdout } = await execCli(shell, ['-lic', `command -v ${name}`], { timeout: 10_000 })
      // An rc file that prints a banner puts its noise BEFORE the answer, so
      // the path is the last non-empty line, not the first.
      return stdout.trim().split('\n').pop()?.trim() || null
    },
  }
}

/**
 * `resolveCliBinaryWith` against the real machine, memoised per spec name.
 * Resolution costs a login-shell spawn in the worst case, and the answer
 * cannot change while the app runs, so every caller shares one result.
 */
const cache = new Map<string, string>()

export async function resolveCliBinary(spec: CliSpec): Promise<string> {
  const hit = cache.get(spec.name)
  if (hit) return hit
  const resolved = await resolveCliBinaryWith(spec, defaultResolverDeps())
  cache.set(spec.name, resolved)
  return resolved
}

/** Test-only: drops a memoised resolution so it can be re-run. */
export function clearCliBinaryCache(name?: string): void {
  if (name === undefined) cache.clear()
  else cache.delete(name)
}
