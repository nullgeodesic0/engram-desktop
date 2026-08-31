/**
 * Launch-time orphan sweep — the belt-and-suspenders half of
 * `abortAllSessions`.
 *
 * `before-quit` never runs on a crash, a force-kill, or an installer's
 * pkill, and a surviving tutor child keeps writing its session transcript
 * and blocks that session's `--resume` (observed live, 2026-08-03). Our
 * children are unambiguously identifiable: their argv carries the app's own
 * per-instance MCP config path (`engram-desktop-mcp-<random>/mcp-config.json`,
 * see permissionConfig.ts) — nothing else on the machine launches claude with
 * that marker. At launch this process owns zero children, so every match is
 * an orphan. Best-effort throughout: a failed sweep must never block startup.
 *
 * ## Why the enumeration is platform-specific
 *
 * There is no portable way to ask "which processes are running, and with what
 * command line". `ps ax -o pid=,command=` covers macOS and Linux. Windows has
 * no `ps`; `wmic` was the traditional answer and has been removed from
 * Windows 11 24H2, so the only version-safe route is a CIM query through
 * PowerShell. That query is slower (a few hundred ms) than `ps`, which is why
 * it runs detached at startup and nothing waits on it.
 *
 * ## Why the kill is platform-specific too
 *
 * On POSIX, SIGTERM is deliberate rather than SIGKILL: the Claude CLI flushes
 * its transcript on TERM, and a half-written transcript is exactly the state
 * this sweep exists to avoid creating more of. Windows has no signals — a
 * `process.kill(pid)` there is an unconditional `TerminateProcess`, with no
 * flush and no way to ask for one. `taskkill /T` is used instead so the
 * orphan's own children (the CLI shells out) go with it rather than being
 * re-parented and left behind, which is the one thing that would make the
 * sweep actively counterproductive.
 */

import { execCli, isWindows } from '../platform'

/** The argv marker that identifies a child this app spawned. */
export const ORPHAN_MARKER = 'engram-desktop-mcp-'

const POWERSHELL_QUERY =
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*" +
  ORPHAN_MARKER +
  "*' } | ForEach-Object { $_.ProcessId }"

/**
 * Parses `ps ax -o pid=,command=` output into the pids whose command line
 * carries the marker. Exported for tests — the parsing is the part with edge
 * cases (leading whitespace, a pid column that is right-aligned, our own pid
 * appearing in the list), not the exec.
 */
export function orphanPidsFromPsOutput(stdout: string, selfPid: number): number[] {
  const pids: number[] = []
  for (const line of stdout.split('\n')) {
    if (!line.includes(ORPHAN_MARKER)) continue
    const pid = Number(line.trim().split(/\s+/, 1)[0])
    if (Number.isFinite(pid) && pid > 1 && pid !== selfPid) pids.push(pid)
  }
  return pids
}

/** Parses the PowerShell query's output: one bare pid per line. */
export function orphanPidsFromPowershellOutput(stdout: string, selfPid: number): number[] {
  const pids: number[] = []
  for (const line of stdout.split('\n')) {
    const pid = Number(line.trim())
    if (Number.isFinite(pid) && pid > 1 && pid !== selfPid) pids.push(pid)
  }
  return pids
}

async function findOrphanPids(): Promise<number[]> {
  if (isWindows) {
    const { stdout } = await execCli(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_QUERY],
      { timeout: 20_000 },
    )
    return orphanPidsFromPowershellOutput(stdout, process.pid)
  }
  const { stdout } = await execCli('ps', ['ax', '-o', 'pid=,command='], { timeout: 20_000 })
  return orphanPidsFromPsOutput(stdout, process.pid)
}

async function terminate(pid: number): Promise<void> {
  if (isWindows) {
    // /T so the orphan's own children go with it; /F because a console
    // process will not act on the polite close request the flagless form
    // sends, and a sweep that leaves the orphan running is worse than none.
    await execCli('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: 10_000 })
    return
  }
  process.kill(pid, 'SIGTERM')
}

/** Fire-and-forget. Never throws, never rejects, never blocks startup. */
export function sweepOrphanTutors(): void {
  void (async () => {
    let pids: number[]
    try {
      pids = await findOrphanPids()
    } catch {
      return // no ps, no PowerShell, a locked-down policy — nothing to do
    }
    for (const pid of pids) {
      try {
        await terminate(pid)
      } catch {
        // already gone, or not ours to signal — either way, done
      }
    }
  })()
}
