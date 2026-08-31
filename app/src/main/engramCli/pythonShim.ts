/**
 * A `python3` that exists on Windows.
 *
 * ## The problem
 *
 * This app is a window onto the Engram plugin, and the plugin's skills drive
 * the engine by shelling out — `python3 "$ENGRAM" due --cap 12`, and some
 * hundreds of similar lines across `learn`, `review`, `coach`, and the two
 * subagents. Those are the plugin's own files, run through the Claude CLI's
 * Bash tool, and this app does not fork them (see PRODUCT.md's plugin-overlay
 * doctrine, and `vendor/VENDORED.md`: one runtime source, never a private
 * copy that drifts).
 *
 * `python3` is not a name that exists on Windows. The python.org installer
 * writes `python.exe` and `py.exe` and has never written a `python3`; the
 * only `python3.exe` on a stock Windows is the Microsoft Store's zero-byte
 * execution alias, which opens a Store page and exits non-zero. So every one
 * of those skill lines fails, and it fails inside a Bash tool call in the
 * middle of a tutoring turn, where the learner sees a confusing engine error
 * rather than anything actionable.
 *
 * ## Why a PATH shim rather than a plugin overlay
 *
 * The overlay mechanism (`plugin-overlays/`) is the sanctioned way to change
 * plugin behaviour, and it would work: rewrite every `python3` to something
 * portable. But it would mean an overlay that has to be re-applied against
 * every future plugin version, touching hundreds of lines across files whose
 * content is prose the tutor reads — a large, permanently-maintained diff
 * against our single most important dependency, to fix something that is not
 * actually about the plugin's behaviour at all.
 *
 * The app already owns the environment of every session it spawns
 * (`sessionEnv.ts`). Putting a real `python3` on that environment's PATH
 * fixes every call site at once, forever, without a single line of the
 * plugin changing — and it is honest: the machine genuinely does have a
 * Python 3, we are only giving it the name the ecosystem uses for it.
 *
 * ## Why two files
 *
 * The Claude CLI's Bash tool on Windows runs Git Bash, but the plugin's hooks
 * and any `cmd.exe`-mediated call see a different resolver. `python3` (a
 * POSIX shell script) is what Git Bash finds and executes; `python3.cmd` is
 * what cmd.exe and PowerShell find. Writing both means the shim works
 * regardless of which shell ends up asking, and bash prefers the exact-name
 * match, so the two never race.
 */

import { mkdir, writeFile, chmod } from 'node:fs/promises'
import { join, delimiter } from 'node:path'
import { app } from 'electron'
import { resolvePython } from './pythonResolver'
import { isWindows } from '../platform'

let cachedDir: string | null = null

/**
 * Creates (or refreshes) the shim directory and returns it. Returns null on
 * macOS and Linux, where `python3` is the interpreter's real name and a shim
 * would be a layer of indirection buying nothing.
 *
 * Rewritten on every call rather than cached-on-disk: resolution is cheap
 * after the first probe, and a user who installs or moves Python between
 * launches should not have to discover that the app pinned a stale path.
 */
export async function ensurePython3Shim(): Promise<string | null> {
  if (!isWindows) return null
  if (cachedDir) return cachedDir

  const { command, prefixArgs } = await resolvePython()
  const dir = join(app.getPath('userData'), 'bin')
  await mkdir(dir, { recursive: true })

  // `%*` / `"$@"` forward the caller's arguments verbatim, which matters:
  // the skills pass file paths that routinely contain spaces (the learning
  // home lives under the user's profile directory).
  const cmdBody = ['@echo off', `"${command}" ${prefixArgs.join(' ')} %*`.replace(/\s+/g, ' ').trim(), ''].join('\r\n')
  const shBody = ['#!/bin/sh', `exec "${command}" ${prefixArgs.join(' ')} "$@"`.replace(/ +/g, ' '), ''].join('\n')

  await writeFile(join(dir, 'python3.cmd'), cmdBody, 'utf-8')
  const shPath = join(dir, 'python3')
  await writeFile(shPath, shBody, 'utf-8')
  // Git Bash honours the POSIX executable bit it synthesises from the ACL;
  // chmod is a no-op on some Windows filesystems and must not be fatal.
  await chmod(shPath, 0o755).catch(() => {})

  cachedDir = dir
  return dir
}

/** Prepends `dir` to a PATH string, using the platform's own separator. */
export function prependToPath(existingPath: string | undefined, dir: string): string {
  return existingPath ? `${dir}${delimiter}${existingPath}` : dir
}

/** Test-only: forget the created shim so it is rewritten. */
export function clearPythonShimCache(): void {
  cachedDir = null
}
