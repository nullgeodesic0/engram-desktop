/** The ready plate's sitting shape — persisted the way calibrationStore
 * persists picks (renderer localStorage, try/catch on every touch, garbage
 * degrades to defaults; no IPC, no pinned writer).
 *
 * STYLE NEVER PERSISTS. The checkpoint style is opt-in PER SITTING — that
 * per-sitting election is half of the constitutional bargain the overlay's
 * licence rests on (see plugin-overlays/engram/review-skill.quick-…md), so
 * `loadSittingPrefs` always returns `style: 'standard'` and only the time
 * pick survives a restart. Do not "fix" this by persisting style. */

import type { SittingMins, SittingStyle } from './reviewKickoff'

export interface SittingPrefs {
  mins: SittingMins
  style: SittingStyle
}

const KEY = 'engram-sitting-prefs'

const DEFAULTS: SittingPrefs = { mins: 10, style: 'standard' }

export function loadSittingPrefs(): SittingPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    const mins = (parsed as { mins?: unknown } | null)?.mins
    if (mins === 5 || mins === 10 || mins === 25) {
      return { mins, style: 'standard' }
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULTS }
}

export function saveSittingMins(mins: SittingMins): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ mins }))
  } catch {
    // best-effort — a failed save costs one re-pick, never a sitting
  }
}
