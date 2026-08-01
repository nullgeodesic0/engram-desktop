// Pure state machine for "should this deep-link URL be acted on now, or held
// until the app is ready" — factored out of index.ts specifically so this
// piece of the pre-ready crash fix (see index.ts's handleDeepLink and its
// own doc comment) has real regression coverage. index.ts imports `electron`
// at module scope and can't run under vitest at all; this file imports
// nothing and is plain data plus two closures, so it can.
//
// The bug this exists to guard: macOS can fire 'open-url' before
// app.whenReady() resolves on a cold launch, and acting on it immediately
// (specifically: creating a BrowserWindow) throws before the app is ready.
// index.ts's app.whenReady().then() drains whatever this queue is holding
// once the app's startup window already exists.

export interface DeepLinkQueue {
  /** Call with every incoming URL, passing a fresh readiness check (not a
   * cached boolean — the caller's `app.isReady()` can flip between calls).
   * Returns the URL to act on immediately when the app is already ready, or
   * `null` when it was queued instead (the caller does nothing further in
   * that case; `drain()` is what surfaces it later). */
  handle(url: string, isReady: () => boolean): string | null
  /** Call once the app becomes ready. Returns the queued URL and clears it
   * — a second call before another `handle()` returns `null`, so a queued
   * link is only ever drained exactly once. */
  drain(): string | null
}

/** A later `handle()` call while one URL is still queued simply overwrites
 * it (last-write-wins) rather than accumulating a list — a cold launch
 * receiving two 'open-url' events before whenReady resolves is not a
 * realistic scenario worth queueing depth for, and "the most recent link
 * wins" is a deterministic, easy-to-reason-about rule if it ever happens. */
export function createDeepLinkQueue(): DeepLinkQueue {
  let pending: string | null = null
  return {
    handle(url, isReady) {
      if (!isReady()) {
        pending = url
        return null
      }
      return url
    },
    drain() {
      const url = pending
      pending = null
      return url
    },
  }
}
