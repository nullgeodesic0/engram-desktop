/** Learner preferences for how the app's own letter grades are composed.
 * Renderer localStorage, try/catch on every touch, same discipline as
 * sittingPrefs/calibrationStore — the grades are an app-side reading of the
 * engine's receipts, so this changes a view, never learning state.
 *
 * PUNCTUALITY IS OPTIONAL. It measures how close to the due date reviews
 * happen. That is about the calendar, not about what was learned: spacing
 * still works when a review is late (Cepeda et al. 2006), and FSRS already
 * schedules around a late review. For learners whose weeks are irregular
 * (often the case with ADHD) it turned every missed day into a lower letter.
 * When excluded it is still computed and shown, but carries no weight. */

const KEY = 'engram-grade-prefs'

export function punctualityCounts(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as { punctuality?: unknown }) : null
    if (parsed && typeof parsed.punctuality === 'boolean') return parsed.punctuality
  } catch {
    // fall through
  }
  return true
}

export function setPunctualityCounts(on: boolean): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ punctuality: on }))
  } catch {
    // best-effort
  }
}
