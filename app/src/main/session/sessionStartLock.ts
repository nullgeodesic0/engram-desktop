/**
 * Serializes every "may I start a sitting" decision across every caller that
 * can spawn one: the phone's ASK button (linkService.ts's requestPacksFor),
 * the background pack scheduler (packScheduler.ts's runTopUpPass), and the
 * outbox drain (mobileDrain.ts's per-topic loop in drainOutbox).
 *
 * `anySessionRunning()` (sessionHandlers.ts) is a synchronous read of
 * `sessions.size > 0`, and `sessions.set` happens synchronously at the top of
 * `startSession` — both correct on their own. The gap is upstream of that: a
 * caller reads the guard, then does real async work (an engine read, a full
 * topic stock scan) BEFORE ever calling `startSession`, and nothing is
 * registered in `sessions` until that work finishes. A second caller landing
 * in that window reads the same "nothing running" the first one did, and
 * both proceed to spawn. Reproduced live, 2026-08-11: two `claude -p`
 * children for the same topic ran concurrently, started from two different
 * paths — the pack scheduler already serializes against ITSELF (see
 * packScheduler.ts's own `inFlight`), which could not have caught this,
 * because the other caller was a different function entirely.
 *
 * The fix is not a smarter read of `sessions.size` — no read of shared state
 * survives being taken twice across an await. It is making the whole
 * "check, do the async prep, start" sequence a single unit that every caller
 * queues behind, so a caller that runs second always sees what a caller that
 * ran first already did.
 */
let queue: Promise<unknown> = Promise.resolve()

export function withSessionStartLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  // Chain the NEXT caller off a settled marker, not off `run` itself — a
  // caller that queues behind a rejected attempt must still get its turn,
  // and `.catch` on `run` alone would leave that rejection unhandled a
  // second time (Node logs an unhandled-rejection warning for the same
  // error twice otherwise).
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
