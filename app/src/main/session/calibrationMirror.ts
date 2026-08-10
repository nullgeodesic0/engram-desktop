import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ConfidencePick } from '../../shared/confidence'

/**
 * A main-process copy of the renderer's confidence picks.
 *
 * ## Why this exists
 *
 * Calibration is one of the five components of a topic grade, and its input —
 * the learner's confidence picks — lives in a localStorage ring buffer the
 * renderer owns. The main process serves the phone, cannot see localStorage,
 * and so was computing the phone's grade with that component marked
 * unavailable. The model renormalises honestly around a missing component, so
 * the number was never a lie, but it was a DIFFERENT number: a topic could
 * read B at the desk and C in your pocket.
 *
 * A grade that changes with the surface you read it on is not a measurement.
 * So the renderer mirrors its picks here whenever they change, and the phone's
 * grade is computed from the same five components as the desk's.
 *
 * ## Why the picks and not the computed number
 *
 * Calibration is per-topic — it pairs picks against the assessor's grades for
 * that topic's nodes — so a single "last calibration number" could not be
 * re-scoped to whichever topic the phone asks about. Mirroring the picks keeps
 * one definition of the computation (`computeTopicGrade`) rather than adding a
 * second, pre-chewed one that could drift from it.
 *
 * The buffer is capped at 200 by the store that owns it, so this file stays
 * small and the write stays cheap.
 *
 * ## What this is not
 *
 * Not learning state. A confidence pick is the app's own record of what the
 * learner said before an answer was revealed; the engine knows nothing about
 * it and no rating depends on it. It lives in app data alongside
 * topicSettings, on the app's side of the line.
 */

/**
 * Resolved lazily, and without a top-level `electron` import.
 *
 * Every other store here imports `app` at module scope, which is fine because
 * only Electron ever loads them. This one is reachable from the dev fixture —
 * mobileProviders → mobileReceipts → here — and a static electron import
 * crashes plain Node at load time, taking the whole harness with it. Found
 * exactly that way.
 */
async function mirrorPath(): Promise<string> {
  let dir: string
  try {
    const { app } = await import('electron')
    dir = app.getPath('userData')
  } catch {
    // Not inside Electron: the dev fixture, which points at the same store the
    // app uses so both see one set of picks.
    dir = join(homedir(), 'Library', 'Application Support', 'Engram Desktop')
  }
  return join(dir, 'calibration-mirror.json')
}

let cached: ConfidencePick[] | null = null

export async function setCalibrationMirror(picks: ConfidencePick[]): Promise<void> {
  cached = picks
  try {
    const path = await mirrorPath()
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(picks), 'utf-8')
  } catch {
    // A mirror that fails to persist still serves this run from memory, and
    // the next pick rewrites it. Losing it costs one component of a grade
    // until the renderer next syncs — never a wrong number, only a
    // renormalised one.
  }
}

export async function getCalibrationMirror(): Promise<ConfidencePick[]> {
  if (cached) return cached
  try {
    const raw: unknown = JSON.parse(await readFile(await mirrorPath(), 'utf-8'))
    cached = Array.isArray(raw) ? (raw as ConfidencePick[]) : []
  } catch {
    cached = []
  }
  return cached
}
