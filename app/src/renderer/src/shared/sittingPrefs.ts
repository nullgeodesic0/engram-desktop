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
  /** Work one topic at a time this sitting. Null is a mixed queue, the
   * default. Like `style`, this is a per-sitting intent and never persists —
   * yesterday's decision to focus on one topic should not silently narrow
   * today's queue. */
  focusTopic: string | null
}

const KEY = 'engram-sitting-prefs'

const DEFAULTS: SittingPrefs = { mins: 10, style: 'standard', focusTopic: null }

export function loadSittingPrefs(): SittingPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    const mins = (parsed as { mins?: unknown } | null)?.mins
    // Any sane positive duration, not the three legacy presets.
    //
    // The budgets stopped being 5/10/25 when they became queue-derived, and
    // stopped being discrete at all when the ruler made them continuous — so
    // this guard silently discarded almost every budget a learner could
    // actually set. `saveSittingMins` wrote 23 to disk and this read it back
    // as "not one of mine" and returned the default, so the setting looked
    // like it simply did not persist. Bounded rather than open: a stored
    // value is untrusted input, and a 40-hour sitting is not a real budget.
    if (typeof mins === 'number' && Number.isFinite(mins) && mins >= 1 && mins <= 600) {
      // style and focusTopic are per-sitting intents, never restored.
      return { mins, style: 'standard', focusTopic: null }
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
