import { Notification } from 'electron'
import { engramRead } from '../engramCli/readOnly'
import { getNotifierSettings, getNotifiedSignature, recordNotified } from './notifierState'

const CHECK_INTERVAL_MS = 5 * 60_000 // poll every 5 min; the settings' cadence throttles actual notifications, not this poll

interface DueItemLite {
  topic: string
  id: string
}

let timer: ReturnType<typeof setInterval> | null = null

async function currentDue(): Promise<DueItemLite[]> {
  return engramRead<DueItemLite[]>('due', ['--limit', '50'])
}

/**
 * Fires a native notification if reminders are on and either the due set has
 * changed since the last notification or the configured cadence has elapsed —
 * so a still-unread reminder doesn't re-fire every 5-minute poll, but a
 * genuinely new item (or enough time passing) does surface again.
 */
async function checkAndMaybeNotify(onClick: () => void): Promise<void> {
  const settings = await getNotifierSettings()
  if (!settings.remindersEnabled) return

  const due = await currentDue().catch(() => [])
  if (due.length === 0) return

  const signature = due.map((d) => `${d.topic}:${d.id}`).sort().join(',')
  const { lastNotifiedAt, lastSignature } = await getNotifiedSignature()
  const elapsedMs = lastNotifiedAt ? Date.now() - new Date(lastNotifiedAt).getTime() : Infinity
  if (signature === lastSignature && elapsedMs < settings.cadenceMinutes * 60_000) return

  fireNotification(due.length, onClick)
  await recordNotified(signature)
}

function fireNotification(count: number, onClick: () => void): void {
  const n = new Notification({
    title: count === 1 ? '1 review due' : `${count} reviews due`,
    body: 'Engram Desktop — clear them in a couple of minutes.',
  })
  n.on('click', onClick)
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
  const due = await currentDue().catch(() => [])
  if (due.length > 0) {
    fireNotification(due.length, onClick)
    const signature = due.map((d) => `${d.topic}:${d.id}`).sort().join(',')
    await recordNotified(signature)
  }
  return { dueCount: due.length }
}
