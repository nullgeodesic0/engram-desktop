import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import type { UpdateCheckResult } from '../../shared/types'

const execFileAsync = promisify(execFile)

const REPO = 'nullgeodesic0/engram-desktop'
const GH_TIMEOUT_MS = 10_000

/**
 * Build-aware update check for an unsigned, non-store distribution: this repo is
 * private, there's no release manifest or auto-updater, so "is there something
 * newer" just means "does `main` on GitHub have a commit this build doesn't have
 * yet" — checked via the user's own authenticated `gh` CLI (never an embedded
 * token; see docs/development.md for how a newer build actually gets installed).
 *
 * Any failure here — gh missing, not logged in, offline, private-repo 404,
 * timeout, malformed output — resolves to state:'unknown' with a plain-words
 * reason. This function must never throw and never reject; the renderer should
 * never see an update check as an error state, just a quiet "couldn't check".
 */

interface CachedState {
  result: UpdateCheckResult
  checkedAt: string
}

function statePath(): string {
  return join(app.getPath('userData'), 'update-state.json')
}

async function readCache(): Promise<CachedState | null> {
  try {
    const raw = JSON.parse(await readFile(statePath(), 'utf-8')) as CachedState
    if (!raw?.result || !raw?.checkedAt) return null
    return raw
  } catch {
    return null
  }
}

async function writeCache(state: CachedState): Promise<void> {
  try {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(statePath(), JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // Caching is a nicety (avoids redundant gh calls) — never let a write
    // failure (e.g. a read-only userData dir) surface as an app error.
  }
}

function isSameLocalDay(isoA: string, isoB: string): boolean {
  const a = new Date(isoA)
  const b = new Date(isoB)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** The last result computed, without triggering a fresh `gh` call — for the
 * Settings UI to render something on mount before/without a live check. */
export async function getCachedUpdateCheck(): Promise<UpdateCheckResult | null> {
  const cache = await readCache()
  return cache?.result ?? null
}

/** True if the cached check was already run today (local time) — gates the
 * once-per-launch auto-check so a string of quick relaunches in one day
 * doesn't repeatedly hit `gh`. */
export async function checkedToday(): Promise<boolean> {
  const cache = await readCache()
  return cache != null && isSameLocalDay(cache.checkedAt, new Date().toISOString())
}

function reasonForError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/ENOENT/.test(msg)) return 'the gh CLI isn’t installed'
  if (/timed out|ETIMEDOUT/i.test(msg)) return 'the check timed out'
  if (/not logged into any|authentication|HTTP 401|HTTP 403|gh auth login/i.test(msg))
    return 'gh isn’t signed in to GitHub'
  if (/HTTP 404/.test(msg)) return 'couldn’t reach the repo (check gh auth/access)'
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network/i.test(msg)) return 'no network connection'
  return 'couldn’t reach GitHub'
}

/**
 * Runs the live check: `gh api` for HEAD of `main`, compared against this
 * build's baked-in commit (see electron.vite.config.ts's `define`). Always
 * resolves — never throws — and always updates the on-disk cache so
 * getCachedUpdateCheck()/checkedToday() reflect the attempt even on failure.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const checkedAt = new Date().toISOString()
  const buildCommit = __BUILD_COMMIT__
  const buildDate = __BUILD_DATE__

  if (!buildCommit || buildCommit === 'unknown') {
    const result: UpdateCheckResult = {
      state: 'unknown',
      buildCommit,
      buildDate,
      checkedAt,
      reason: 'this build doesn’t know its own commit',
    }
    await writeCache({ result, checkedAt })
    return result
  }

  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['api', `repos/${REPO}/commits/main`, '--jq', '{sha:.sha,date:.commit.committer.date}'],
      { timeout: GH_TIMEOUT_MS },
    )
    const parsed = JSON.parse(stdout.trim()) as { sha: string; date: string }
    if (!parsed?.sha) throw new Error('malformed gh output')

    const remoteCommit = parsed.sha.slice(0, 7)
    const remoteDate = parsed.date
    const state: UpdateCheckResult['state'] = parsed.sha.toLowerCase().startsWith(buildCommit.toLowerCase())
      ? 'current'
      : 'behind'

    const result: UpdateCheckResult = { state, buildCommit, buildDate, remoteCommit, remoteDate, checkedAt }
    await writeCache({ result, checkedAt })
    return result
  } catch (err) {
    const result: UpdateCheckResult = {
      state: 'unknown',
      buildCommit,
      buildDate,
      checkedAt,
      reason: reasonForError(err),
    }
    await writeCache({ result, checkedAt })
    return result
  }
}

/** Called once after app ready (delayed — see main/index.ts) to auto-populate
 * the cache without the user having to open Settings first. Silently skips if
 * already checked today; silently swallows any error (checkForUpdate already
 * never throws, but this is the "fire and forget from a timer" call site). */
export async function maybeAutoCheckForUpdate(): Promise<void> {
  try {
    if (await checkedToday()) return
    await checkForUpdate()
  } catch {
    // Never let the once-per-launch timer callback throw into an unhandled
    // rejection — this is a background nicety, not a critical path.
  }
}
