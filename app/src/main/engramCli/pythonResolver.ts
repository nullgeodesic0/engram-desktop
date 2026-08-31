/**
 * Finding a Python 3 interpreter to run `engram.py` with.
 *
 * ## Why this is not just "python3"
 *
 * Every read this app does of the learning engine shells out to
 * `python3 engram.py <subcommand>`. On macOS and Linux that bare name is
 * correct and always has been. On Windows it is wrong in a way that fails
 * *silently and confusingly* rather than cleanly:
 *
 *  - The canonical Windows interpreter is `python.exe`, not `python3.exe`.
 *    Python's own Windows installer has never created a `python3` alias.
 *  - Windows 10+ nevertheless SHIPS a `python3.exe` at
 *    `%LOCALAPPDATA%\Microsoft\WindowsApps\python3.exe`. It is not an
 *    interpreter — it is a zero-byte App Execution Alias whose only behaviour,
 *    when Python is not installed from the Microsoft Store, is to open the
 *    Store page and exit non-zero. A naive PATH lookup finds it, `existsSync`
 *    says yes, and every engram read then fails with an error that has
 *    nothing to do with Python being absent.
 *  - The version-aware launcher `py.exe` is the officially recommended entry
 *    point on Windows and needs an argument (`py -3`) to guarantee Python 3.
 *
 * So a candidate is not accepted because it exists. It is accepted because it
 * ran and said it was Python 3. That single probe — once per app run,
 * memoised — is what makes the Store-alias case, the "python is 2.7" case,
 * and the "py.exe is installed but has no 3.x registered" case all resolve to
 * the same honest answer instead of three different mystery failures.
 *
 * ## Why the result is a command PLUS arguments
 *
 * `py -3` cannot be expressed as a path. The resolver therefore returns an
 * argv prefix rather than a string, and callers spread it — which also keeps
 * the door open for a future `uv run`-style launcher without another rewrite.
 */

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import which from 'which'
import { execCli, isWindows } from '../platform'

export interface PythonCommand {
  /** The executable to launch. */
  command: string
  /** Arguments that must precede the script path, e.g. `['-3']` for `py`. */
  prefixArgs: string[]
}

/** A candidate before it has proved itself. */
interface Candidate extends PythonCommand {
  /** When set, skip the candidate unless this path exists — saves a spawn on
   * the (common) miss for absolute candidates. */
  requirePath?: string
}

const PROBE_ARGS = ['-c', 'import sys; sys.stdout.write(str(sys.version_info[0]))']
const PROBE_TIMEOUT_MS = 8_000

function windowsCandidates(home: string, env: NodeJS.ProcessEnv): Candidate[] {
  const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
  const out: Candidate[] = [
    // The launcher first: it is the one entry point that is explicit about
    // which major version it is handing back.
    { command: 'py', prefixArgs: ['-3'] },
    { command: 'python', prefixArgs: [] },
  ]
  // Per-user and all-users installs of CPython, newest minor first. The
  // versioned directory name (`Python313`) is the installer's own convention
  // on all three roots. Enumerated rather than globbed: `readdirSync` on a
  // missing directory throws, and the list is short and stable enough to
  // spell out.
  const pythonRoots = [
    join(localAppData, 'Programs', 'Python'),
    'C:\\',
    join(env.ProgramFiles ?? 'C:\\Program Files'),
  ]
  for (const minor of [14, 13, 12, 11, 10, 9, 8]) {
    for (const root of pythonRoots) {
      const exe = join(root, `Python3${minor}`, 'python.exe')
      out.push({ command: exe, prefixArgs: [], requirePath: exe })
    }
  }
  // Conda/miniconda, which put a genuine python.exe somewhere PATH may not
  // reach when the user has never run `conda init`.
  for (const dir of [join(home, 'anaconda3'), join(home, 'miniconda3'), join(localAppData, 'Continuum', 'anaconda3')]) {
    const exe = join(dir, 'python.exe')
    out.push({ command: exe, prefixArgs: [], requirePath: exe })
  }
  return out
}

function posixCandidates(home: string): Candidate[] {
  const out: Candidate[] = [{ command: 'python3', prefixArgs: [] }]
  for (const dir of [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    join(home, '.pyenv', 'shims'),
    join(home, '.local', 'bin'),
  ]) {
    const exe = join(dir, 'python3')
    out.push({ command: exe, prefixArgs: [], requirePath: exe })
  }
  // Last: a bare `python` that turns out to be a 3.x, which is the norm inside
  // an activated virtualenv and on distributions that retired the `python3`
  // symlink. The probe is what makes trusting this safe.
  out.push({ command: 'python', prefixArgs: [] })
  return out
}

/** Runs a candidate and returns true only if it reported major version 3. */
async function isPython3(candidate: Candidate): Promise<boolean> {
  if (candidate.requirePath && !existsSync(candidate.requirePath)) return false
  try {
    const { stdout } = await execCli(candidate.command, [...candidate.prefixArgs, ...PROBE_ARGS], {
      timeout: PROBE_TIMEOUT_MS,
    })
    return stdout.trim() === '3'
  } catch {
    // Missing, the Store alias, a launcher with no 3.x registered, a 2.x that
    // chokes on the probe — all the same answer: not this one.
    return false
  }
}

let cached: PythonCommand | null = null
let inFlight: Promise<PythonCommand> | null = null

/**
 * The first candidate that proves itself Python 3. Memoised for the process
 * lifetime, and de-duplicated while in flight — the read handlers fire many
 * engram reads concurrently on startup and must not each pay for the probe.
 *
 * Falls back to the platform's conventional name when nothing verifies, so
 * the failure the user sees is `engram.py` failing to launch with a real
 * message, not this resolver throwing somewhere they can't see.
 */
export async function resolvePython(): Promise<PythonCommand> {
  if (cached) return cached
  if (inFlight) return inFlight
  inFlight = (async () => {
    const home = homedir()
    const candidates = isWindows ? windowsCandidates(home, process.env) : posixCandidates(home)
    for (const candidate of candidates) {
      if (await isPython3(candidate)) {
        cached = { command: candidate.command, prefixArgs: candidate.prefixArgs }
        return cached
      }
    }
    // Nothing verified. Try PATH one last time under the platform's own name
    // before giving up on a useful answer.
    const fallbackName = isWindows ? 'python' : 'python3'
    try {
      const onPath = await which(fallbackName, { nothrow: true })
      if (onPath) {
        cached = { command: onPath, prefixArgs: [] }
        return cached
      }
    } catch {
      // ignore — the conventional bare name below is the last word
    }
    cached = { command: fallbackName, prefixArgs: [] }
    return cached
  })()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/** Test-only: drops the memoised interpreter so it can be re-resolved. */
export function clearPythonCache(): void {
  cached = null
  inFlight = null
}
