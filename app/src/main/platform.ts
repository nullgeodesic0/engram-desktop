/**
 * The one place that knows what OS this is, and the only sanctioned way to
 * launch an external CLI.
 *
 * ## Why a module instead of scattered `process.platform` checks
 *
 * Until this file existed the app had ZERO platform checks — every path was
 * implicitly macOS (`/opt/homebrew`, `$SHELL -lic`, `ps ax`, `~/Library/
 * Application Support`, `python3`). That is a legitimate way to ship a first
 * version, but it means the Windows/Linux failures are not one bug, they are
 * one assumption repeated in a dozen files. Centralising the answer here is
 * what keeps the fix from being a dozen independent regressions waiting to
 * happen.
 *
 * ## Why cross-spawn rather than `child_process.spawn`
 *
 * On Windows the CLIs this app drives are almost never real executables. An
 * `npm i -g @anthropic-ai/claude-code` install writes `claude.cmd` — a batch
 * shim — into `%APPDATA%\npm`. Node has REFUSED to spawn `.cmd`/`.bat` without
 * a shell since the CVE-2024-27980 fix (Node 18.20.2/20.12.2), so a plain
 * `spawn(claudeBin, args)` fails outright with EINVAL. The obvious workaround,
 * `shell: true`, is worse than useless here: Node then joins argv with bare
 * spaces and hands the result to `cmd.exe`, so the very first argument
 * containing a space or a quote is silently mangled — and this app passes
 * `--append-system-prompt <several kilobytes of prose>` on every single
 * session start. cross-spawn exists precisely to do the `cmd.exe /d /s /c`
 * dance with correct Windows quoting, and it is already in the tree.
 *
 * On macOS and Linux cross-spawn is a thin pass-through to `child_process`,
 * so routing every launch through here costs nothing on the platforms that
 * already worked.
 */

import crossSpawn from 'cross-spawn'
import type { ChildProcessByStdio, ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process'
import type { Readable } from 'node:stream'

export const isWindows = process.platform === 'win32'
export const isMac = process.platform === 'darwin'
export const isLinux = process.platform === 'linux'

/**
 * `spawn`, but able to launch a Windows batch shim without corrupting
 * arguments. Signature-compatible with `child_process.spawn` for the
 * piped-stdio case every caller here uses.
 */
export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcessWithoutNullStreams {
  return crossSpawn(command, args, options) as ChildProcessWithoutNullStreams
}

/**
 * `spawnCli` for the `stdio: ['ignore', 'pipe', 'pipe']` shape — a child we
 * only ever read from. A separate export rather than an overload because the
 * two cases differ in their RETURN type (whether `stdin` is a stream or
 * `null`), and TypeScript cannot infer that from an options object.
 */
export function spawnCliReadOnly(
  command: string,
  args: string[],
  options: Omit<SpawnOptions, 'stdio'> = {},
): ChildProcessByStdio<null, Readable, Readable> {
  return crossSpawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcessByStdio<
    null,
    Readable,
    Readable
  >
}

export interface ExecResult {
  stdout: string
  stderr: string
}

export interface ExecCliOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeout?: number
  /** Bytes of stdout to retain before the call is failed. Mirrors
   * `child_process.execFile`'s option of the same name. */
  maxBuffer?: number
  /** Written to the child's stdin, which is then closed. */
  input?: string
}

/** Rejection shape deliberately matching `promisify(execFile)`'s, so the
 * existing `catch (e) { e.stderr; e.code }` handlers around the call sites
 * this replaces keep working unchanged. */
export class CliExecError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly code: number | null,
  ) {
    super(message)
    this.name = 'CliExecError'
  }
}

const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024

/**
 * `promisify(execFile)`, but through `spawnCli` — so it, too, can run a
 * Windows `.cmd` shim. Used for the short one-shot probes (`claude
 * --version`, `engram.py path`, `tar -tzf`) that this app runs constantly.
 */
export function execCli(command: string, args: string[], options: ExecCliOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER
    const child = spawnCli(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let overflowed = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    function finish(err: Error | null): void {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (err) reject(err)
      else resolve({ stdout, stderr })
    }

    if (options.timeout && options.timeout > 0) {
      timer = setTimeout(() => {
        child.kill()
        finish(new CliExecError(`${command} timed out after ${options.timeout}ms`, stdout, stderr, null))
      }, options.timeout)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8')
      if (stdout.length > maxBuffer && !overflowed) {
        overflowed = true
        child.kill()
        finish(new CliExecError(`${command} exceeded maxBuffer of ${maxBuffer} bytes`, stdout, stderr, null))
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8')
    })
    // `error` is how a missing binary surfaces (ENOENT) — it fires INSTEAD of
    // 'close' on some platforms, so both paths must be able to settle.
    child.on('error', (err) => finish(err))
    child.on('close', (code) => {
      if (code === 0) finish(null)
      else finish(new CliExecError(`${command} exited with code ${code}`, stdout, stderr, code))
    })

    if (options.input !== undefined) {
      child.stdin?.write(options.input)
      child.stdin?.end()
    } else {
      // Nothing to say — close stdin so a CLI that reads it doesn't hang.
      child.stdin?.end()
    }
  })
}
