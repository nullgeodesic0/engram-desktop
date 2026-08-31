/**
 * "How many reviews are due", shown on the app's own icon.
 *
 * macOS and Linux take a number: `app.setBadgeCount(n)` draws it on the Dock
 * icon (and on the Unity launcher, where the desktop supports it). Electron
 * guards that call cross-platform, so on Windows it is not an error — it is
 * simply a no-op, which is worse: the setting stays in the UI, the user turns
 * it on, and nothing ever appears.
 *
 * Windows' equivalent is `BrowserWindow.setOverlayIcon`, which takes a
 * picture rather than a number, so the numbers are drawn ahead of time and
 * shipped as ten 16px images (see scripts/build-platform-icons.py). Past nine
 * the overlay says "9+": at that size a second digit is unreadable, and the
 * exact figure is already on the sidebar badge where there is room for it.
 *
 * Both paths clear to nothing at zero — both when the setting is off and when
 * the queue is genuinely empty. A stale badge claiming work that is already
 * done is the one failure mode that would make the learner distrust it.
 */

import { app, nativeImage, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { isWindows } from '../platform'

/** Which overlay file a given count maps to, or null to clear. Pure, and
 * exported for its test — the boundaries (0, 1, 9, 10) are the whole logic. */
export function overlayFileForCount(count: number): string | null {
  if (!Number.isFinite(count) || count < 1) return null
  return count > 9 ? '9plus.png' : `${Math.floor(count)}.png`
}

/** A description is REQUIRED alongside a Windows overlay icon: it is what a
 * screen reader announces, and an overlay without one is an unlabelled
 * decoration to anyone not looking at the taskbar. */
export function overlayDescriptionForCount(count: number): string {
  return count === 1 ? '1 review due' : `${count} reviews due`
}

export function setTaskbarBadge(
  window: BrowserWindow | null,
  count: number,
  resolveResource: (name: string) => string,
): void {
  if (!isWindows) {
    app.setBadgeCount(count)
    return
  }
  // No window (the app is running tray-only) means no taskbar button to
  // overlay — nothing to do, and nothing lost: recreating the window calls
  // through here again with the current count.
  if (!window || window.isDestroyed()) return
  const file = overlayFileForCount(count)
  if (!file) {
    window.setOverlayIcon(null, '')
    return
  }
  const image = nativeImage.createFromPath(resolveResource(join('badge', file)))
  // An image that failed to load would blank the overlay rather than throw;
  // leaving the previous one up is the honest failure here, not a silent clear.
  if (image.isEmpty()) return
  window.setOverlayIcon(image, overlayDescriptionForCount(count))
}
