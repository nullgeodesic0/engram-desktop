/** Study rhythm: a count of days studied that cannot "break".
 *
 * A consecutive-day streak resets to zero on the first missed day, and a
 * broken streak is measurably demotivating (Silverman & Barasch, J. Consumer
 * Research) while one missed day has no measurable effect on habit formation
 * (Lally et al. 2010). Learners with ADHD miss days more often and react to
 * failure signals more strongly, so the streak was the surface most likely to
 * end the habit it was meant to protect.
 *
 * A rolling window ("studied 4 of the last 7 days") carries the same
 * information about regularity, recovers by itself, and never shows a zero
 * that the learner has to climb back from. Pure functions over the receipts
 * history every Home visit already fetches. */

import type { DayActivity } from '../../../shared/types'

/** Local YYYY-MM-DD for `d` — engram.py's own `today().isoformat()` shape. */
function localYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** How many of the last `windowDays` calendar days (today included) carry at
 * least one receipt. */
export function daysStudiedInWindow(days: DayActivity[], windowDays: number, now: Date = new Date()): number {
  const active = new Set(days.filter((d) => d.count > 0 || d.items.length > 0).map((d) => d.date))
  let n = 0
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    if (active.has(localYmd(d))) n++
  }
  return n
}

export interface RhythmSummary {
  /** Days with a receipt in the last 7 days, today included. */
  week: number
  /** Days with a receipt in the last 30 days, today included. */
  month: number
}

export function rhythmSummary(days: DayActivity[], now: Date = new Date()): RhythmSummary {
  return { week: daysStudiedInWindow(days, 7, now), month: daysStudiedInWindow(days, 30, now) }
}

/** The rhythm line Home prints. Never mentions missed days. */
export function rhythmLabel(r: RhythmSummary): string {
  if (r.month === 0) return 'no sittings yet this month'
  return `${r.week} of the last 7 days · ${r.month} this month`
}

/** Gap, in days, after which a return is framed as a fresh start rather than
 * a continuation. Temporal landmarks raise goal pursuit (Dai, Milkman & Riis
 * 2014); a return after a few days away is a landmark the app can name. */
export const FRESH_START_GAP_DAYS = 3

export type FreshStartReason = 'gap' | 'new-week' | null

/** Whether Home should open with a fresh-start framing.
 *
 * `daysSinceLastSession` is the engine's own figure
 * (stats.adherence.return.days_since_last_session). A learner who has never
 * sat a session (a negative or non-finite value) gets no fresh-start plate:
 * they have nothing to come back from. `lastWeekStartSeen` is the local
 * YYYY-MM-DD of the Monday Home last showed the new-week framing on, so it
 * appears at most once per week. */
export function freshStartReason(
  daysSinceLastSession: number | null | undefined,
  lastWeekStartSeen: string | null,
  now: Date = new Date(),
): FreshStartReason {
  if (typeof daysSinceLastSession !== 'number' || !Number.isFinite(daysSinceLastSession) || daysSinceLastSession < 0) {
    return null
  }
  if (daysSinceLastSession >= FRESH_START_GAP_DAYS) return 'gap'
  // Monday, and not already shown this week, and the learner did not already
  // sit today (a Monday-morning sitting has already made its fresh start).
  if (now.getDay() === 1 && daysSinceLastSession > 0 && lastWeekStartSeen !== weekStartYmd(now)) return 'new-week'
  return null
}

/** Local YYYY-MM-DD of the Monday that starts `now`'s week. */
export function weekStartYmd(now: Date = new Date()): string {
  const offset = (now.getDay() + 6) % 7
  return localYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset))
}
