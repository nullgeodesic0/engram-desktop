import { app, Notification } from 'electron'
import { engramRead } from '../engramCli/readOnly'
import { getNotifierSettings, getNotifiedSignature, recordNotified } from './notifierState'
import type { NotifierSettings } from '../../shared/types'

const CHECK_INTERVAL_MS = 5 * 60_000 // poll every 5 min; the settings' cadence throttles actual notifications, not this poll

interface DueItemLite {
  topic: string
  id: string
}

let timer: ReturnType<typeof setInterval> | null = null

async function currentDue(): Promise<DueItemLite[]> {
  return engramRead<DueItemLite[]>('due', ['--limit', '50'])
}

/** Mirrors the due count onto the dock icon (macOS/Linux; a no-op elsewhere via
 * Electron's own cross-platform guard) — 0 clears it, both when the setting is
 * off and when nothing is due. */
function updateBadge(settings: NotifierSettings, dueCount: number): void {
  app.setBadgeCount(settings.dockBadgeEnabled ? dueCount : 0)
}

/**
 * Fires a native notification if reminders are on and either the due set has
 * changed since the last notification or the configured cadence has elapsed —
 * so a still-unread reminder doesn't re-fire every 5-minute poll, but a
 * genuinely new item (or enough time passing) does surface again. The dock
 * badge is refreshed on every poll regardless of the notification cadence.
 */
async function checkAndMaybeNotify(onClick: () => void): Promise<void> {
  const settings = await getNotifierSettings()
  const due = await currentDue().catch(() => [])
  updateBadge(settings, due.length)

  if (!settings.remindersEnabled) return
  if (due.length === 0) return

  const signature = due.map((d) => `${d.topic}:${d.id}`).sort().join(',')
  const { lastNotifiedAt, lastSignature } = await getNotifiedSignature()
  const elapsedMs = lastNotifiedAt ? Date.now() - new Date(lastNotifiedAt).getTime() : Infinity
  if (signature === lastSignature && elapsedMs < settings.cadenceMinutes * 60_000) return

  fireNotification(due.length, onClick)
  await recordNotified(signature)
}

/** The action button only renders on macOS when the app is signed and the
 * notification style allows it — `on('click')` (anywhere on the banner) stays
 * the primary, always-working navigation path; the button is an extra. */
function fireNotification(count: number, onClick: () => void): void {
  const n = new Notification({
    title: count === 1 ? '1 review due' : `${count} reviews due`,
    body: 'Engram Desktop — clear them in a couple of minutes.',
    actions: [{ type: 'button', text: 'Review now' }],
  })
  n.on('click', onClick)
  n.on('action', onClick)
  n.show()
}

export function startReviewNotifier(onClick: () => void): void {
  if (timer) return
  checkAndMaybeNotify(onClick)
  timer = setInterval(() => checkAndMaybeNotify(onClick), CHECK_INTERVAL_MS)
}

export function stopReviewNotifier(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** The "Check reviews now" action (Settings button, tray menu item) — bypasses
 * the cadence/dedup throttle so it always gives real feedback on demand,
 * including confirming notifications are actually configured/permitted. */
export async function checkReviewsNow(onClick: () => void): Promise<{ dueCount: number }> {
  const settings = await getNotifierSettings()
  const due = await currentDue().catch(() => [])
  updateBadge(settings, due.length)
  if (due.length > 0) {
    fireNotification(due.length, onClick)
    const signature = due.map((d) => `${d.topic}:${d.id}`).sort().join(',')
    await recordNotified(signature)
  }
  return { dueCount: due.length }
}
