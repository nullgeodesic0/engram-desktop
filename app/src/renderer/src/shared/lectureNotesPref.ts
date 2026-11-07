/** The Settings → "Lecture notes" toggle. Persisted the way
 * checkpointAllNodesPref.ts persists its toggle — renderer localStorage,
 * try/catch on every touch, a missing or garbage value reads as the default
 * (off) — and for the same reason: the engine never reads it. It only ever
 * reaches the learner's own words in a sitting (see lectureNotesKickoff.ts). */

const KEY = 'engram-lecture-notes'

export function loadLectureNotesOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function saveLectureNotesOn(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? 'on' : 'off')
  } catch {
    // best-effort — a failed save costs one re-pick, never a sitting
  }
}
