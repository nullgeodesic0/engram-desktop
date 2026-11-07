import { app, Notification } from 'electron'
import { engramRead } from '../engramCli/readOnly'
import { getNotifierSettings, getNotifiedSignature, recordNotified } from './notifierState'
import type { NotifierSettings } from '../../shared/types'
import { measurePace } from './paceScan'
import { planSitting, humanMinutes, type PaceModel } from '../../shared/sittingPace'
import { badgeFigure, reminderDue, notificationCopy } from './reminderPolicy'

const CHECK_INTERVAL_MS = 5 * 60_000 // poll every 5 min; the settings' cadence throttles actual notifications, not this poll

interface DueItemLite {
  topic: string
  id: string
}

let timer: ReturnType<typeof setInterval> | null = null

async function currentDue(): Promise<DueItemLite[]> {
  return engramRead<DueItemLite[]>('due', ['--limit', '50'])
}

/** How the due count reaches the app icon. Injected because the answer is
 * platform-specific and one of the two forms needs a BrowserWindow this module
 * has no business holding: macOS and Linux take a number
 * (`app.setBadgeCount`), Windows needs a picture drawn onto the taskbar
 * button (`win.setOverlayIcon`). See session/taskbarBadge.ts.
 *
 * The default keeps this module runnable on its own — the pre-Windows
 * behaviour exactly — so a caller that never installs one is not broken, just
 * limited to the platforms where a count is enough. */
let badgeSetter: (count: number) => void = (count) => app.setBadgeCount(count)

export function installBadgeSetter(fn: (count: number) => void): void {
  badgeSetter = fn
}

/** The pace model is a transcript scan — cheap but not free — so it is cached
 * for an hour; the badge only needs to be roughly right about a sitting. */
let paceCache: { at: number; model: PaceModel } | null = null
async function paceModel(): Promise<PaceModel | null> {
  if (paceCache && Date.now() - paceCache.at < 60 * 60_000) return paceCache.model
  try {
    const model = await measurePace()
    paceCache = { at: Date.now(), model }
    return model
  } catch {
    return null
  }
}

interface SittingFit {
  items: number
  seconds: number
}

async function fitSitting(settings: NotifierSettings, due: DueItemLite[]): Promise<SittingFit | null> {
  if (due.length === 0) return { items: 0, seconds: 0 }
  const model = await paceModel()
  if (!model) return null
  const plan = planSitting(settings.sittingMinutes, due.map((d) => d.topic), model)
  return { items: plan.items, seconds: plan.predictedSeconds }
}

/** Mirrors today's sitting (or, in `count` style, the raw due count) onto the
 * app icon — 0 clears it, both when the setting is off and when nothing is
 * due. */
function updateBadge(settings: NotifierSettings, dueCount: number, fit: SittingFit | null): void {
  badgeSetter(badgeFigure(settings, dueCount, fit?.items ?? null))
}

/**
 * Fires a native notification if reminders are on and either the due set has
 * changed since the last notification or the configured cadence has elapsed —
 * so a still-unread reminder doesn't re-fire every 5-minute poll, but a
 * genuinely new item (or enough time passing) does surface again. The dock
 * badge is refreshed on every poll regardless of the notification cadence.
 */
async function checkAndMaybeNotify(onClick: () => void, onDueCount?: (count: number) => void): Promise<void> {
  const settings = await getNotifierSettings()
  const due = await currentDue().catch(() => [])
  const fit = await fitSitting(settings, due)
  updateBadge(settings, due.length, fit)
  onDueCount?.(due.length)

  if (!settings.remindersEnabled) return
  if (due.length === 0) return

  const signature = due.map((d) => `${d.topic}:${d.id}`).sort().join(',')
  const { lastNotifiedAt, lastSignature } = await getNotifiedSignature()
  if (!reminderDue(settings, { lastNotifiedAt, lastSignature, signature }, new Date())) return

  fireNotification(settings, due.length, fit, onClick)
  await recordNotified(signature)
}

/** The action button only renders on macOS when the app is signed and the
 * notification style allows it — `on('click')` (anywhere on the banner) stays
 * the primary, always-working navigation path; the button is an extra. */
function fireNotification(settings: NotifierSettings, count: number, fit: SittingFit | null, onClick: () => void): void {
  const copy = notificationCopy(settings, count, fit ? { items: fit.items, minutes: humanMinutes(fit.seconds) } : null)
  const n = new Notification({
    title: copy.title,
    body: copy.body,
    actions: [{ type: 'button', text: 'Start the sitting' }],
  })
  n.on('click', onClick)
  n.on('action', onClick)
  n.show()
}

/** `onDueCount`, when given, is pushed the fresh count on every poll — this is
 * the sidebar badge's data path (see App.tsx's `onDueCount`/preload's
 * `onDueCount`). Optional so nothing else calling this module needs to know
 * about it. */
export function startReviewNotifier(onClick: () => void, onDueCount?: (count: number) => void): void {
  if (timer) return
  checkAndMaybeNotify(onClick, onDueCount)
  timer = setInterval(() => checkAndMaybeNotify(onClick, onDueCount), CHECK_INTERVAL_MS)
}

export function stopReviewNotifier(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** The "Check reviews now" action (Settings button, tray menu item) — bypasses
 * the cadence/dedup throttle so it always gives real feedback on demand,
 * including confirming notifications are actually configured/permitted. */
export async function checkReviewsNow(onClick: () => void, onDueCount?: (count: number) => void): Promise<{ dueCount: number }> {
  const settings = await getNotifierSettings()
  const due = await currentDue().catch(() => [])
  const fit = await fitSitting(settings, due)
  updateBadge(settings, due.length, fit)
  onDueCount?.(due.length)
  if (due.length > 0) {
    fireNotification(settings, due.length, fit, onClick)
    const signature = due.map((d) => `${d.topic}:${d.id}`).sort().join(',')
    await recordNotified(signature)
  }
  return { dueCount: due.length }
}

/** The badge's freshness path (App.tsx calls this on window focus and when a
 * review sitting ends) — same fetch+badge-update as `checkAndMaybeNotify`,
 * minus the notification/cadence dedup: this is a user- or event-triggered
 * refresh, not a background poll, so it should never fire a native
 * notification on its own. */
export async function refreshDueCount(onDueCount?: (count: number) => void): Promise<{ dueCount: number }> {
  const settings = await getNotifierSettings()
  const due = await currentDue().catch(() => [])
  updateBadge(settings, due.length, await fitSitting(settings, due))
  onDueCount?.(due.length)
  return { dueCount: due.length }
}
