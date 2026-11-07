/** The pure decisions behind the dock badge and the review reminder — kept
 * free of Electron so every rule here is testable.
 *
 * Two research findings shape this module:
 *
 * - A growing number is a debt signal. After a few days away the raw due
 *   count snowballs, and a large, delayed, open-ended task is the hardest kind
 *   to start for learners with ADHD (steep delay discounting; strong reactions
 *   to failure signals). So by default the badge shows the size of ONE
 *   sitting at the learner's measured pace, which stops growing once the
 *   backlog outgrows a sitting.
 * - A reminder tied to a specific cue works better than a generic nag:
 *   implementation intentions ("when X, I will Y") carry d = 0.65 across 94
 *   tests (Gollwitzer & Sheeran 2006). When the learner names a time with
 *   their return commitment, the reminder fires once a day at that time
 *   rather than on a rolling cadence.
 */

import type { NotifierSettings } from '../../shared/types'

/** The number to draw on the icon. 0 clears it. */
export function badgeFigure(settings: NotifierSettings, dueCount: number, sittingItems: number | null): number {
  if (!settings.dockBadgeEnabled || dueCount <= 0) return 0
  if (settings.badgeStyle === 'count' || sittingItems === null) return dueCount
  return Math.max(1, Math.min(dueCount, sittingItems))
}

/** Parse "HH:MM" (24h). Null on anything else. */
export function parseReminderTime(value: string | null | undefined): { h: number; m: number } | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return { h, m }
}

interface ReminderHistory {
  lastNotifiedAt: string | null
  lastSignature: string | null
  /** Signature of the current due set. */
  signature: string
}

/** Whether a reminder should fire now (the caller has already checked that
 * reminders are on and something is due). */
export function reminderDue(settings: NotifierSettings, history: ReminderHistory, now: Date): boolean {
  const time = parseReminderTime(settings.reminderTime)
  if (time) {
    // Once a day, at or after the committed time.
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.h, time.m, 0, 0)
    if (now.getTime() < today.getTime()) return false
    if (!history.lastNotifiedAt) return true
    return new Date(history.lastNotifiedAt).getTime() < today.getTime()
  }
  const elapsedMs = history.lastNotifiedAt ? now.getTime() - new Date(history.lastNotifiedAt).getTime() : Infinity
  return !(history.signature === history.lastSignature && elapsedMs < settings.cadenceMinutes * 60_000)
}

/** Notification text. States the sitting, not the debt, and never promises a
 * duration it did not measure (the old body said "a couple of minutes" for a
 * queue that measures at about five minutes an item). */
export function notificationCopy(
  settings: NotifierSettings,
  dueCount: number,
  fit: { items: number; minutes: string } | null,
): { title: string; body: string } {
  if (!fit || fit.items <= 0) {
    return {
      title: dueCount === 1 ? '1 review is ready' : `${dueCount} reviews are ready`,
      body: 'Engram Desktop',
    }
  }
  const items = `${fit.items} ${fit.items === 1 ? 'item' : 'items'}`
  const rest = dueCount > fit.items ? ' The rest can wait.' : ''
  return {
    title: settings.reminderTime ? 'Your planned sitting' : 'A sitting is ready',
    body: `${items}, about ${fit.minutes} at your pace.${rest}`,
  }
}
