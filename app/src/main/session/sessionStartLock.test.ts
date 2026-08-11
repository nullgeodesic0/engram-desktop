import { describe, expect, it } from 'vitest'
import { withSessionStartLock } from './sessionStartLock'

/**
 * The bug this exists to close: `anySessionRunning()` is a synchronous read,
 * but every caller that acts on it does real async work — an engine read, a
 * stock scan across every topic — before actually starting a sitting. Two
 * callers close enough together each read "nothing running" before either
 * has registered a session, and both start one. Observed live, 2026-08-11:
 * two `claude -p` children for the same topic ran concurrently, one from the
 * phone's ASK button (linkService.ts's requestPacksFor) and one from the
 * background pack scheduler (packScheduler.ts's runTopUpPass) — two
 * DIFFERENT call paths, so `topUpPacksNow`'s own self-dedup (see
 * packScheduler.test.ts's "two overlapping calls" case) could not have
 * caught it; that guard only serializes the scheduler against itself.
 */
describe('withSessionStartLock', () => {
  it('serializes two overlapping check-then-start callers so only one starts', async () => {
    // Stands in for `anySessionRunning()` shared across both callers — real
    // production state is `sessions.size > 0`, checked fresh inside each
    // locked callback rather than passed in, which is the point: a callback
    // that runs SECOND must see what the FIRST one already did.
    let running = false
    let starts = 0

    async function checkThenMaybeStart(): Promise<void> {
      return withSessionStartLock(async () => {
        if (running) return
        // The async gap a real caller has before calling startSession — an
        // engine read, in linkService.ts; a full topic stock scan, in
        // packScheduler.ts.
        await new Promise((r) => setTimeout(r, 5))
        if (running) return
        running = true
        starts += 1
      })
    }

    // Two independent callers, a caller-shaped race apart — not simultaneous
    // to the microsecond, but close enough that an unguarded pair would both
    // pass the `running` check before either flips it.
    const a = checkThenMaybeStart()
    const b = checkThenMaybeStart()
    await Promise.all([a, b])

    expect(starts).toBe(1)
  })

  it('one caller throwing does not wedge the queue for the next', async () => {
    let ran = false
    await expect(
      withSessionStartLock(async () => {
        throw new Error('a start attempt that failed')
      }),
    ).rejects.toThrow('a start attempt that failed')

    await withSessionStartLock(async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })

  it('runs callers in the order they were queued', async () => {
    const order: number[] = []
    await Promise.all([
      withSessionStartLock(async () => {
        await new Promise((r) => setTimeout(r, 10))
        order.push(1)
      }),
      withSessionStartLock(async () => {
        order.push(2)
      }),
    ])
    expect(order).toEqual([1, 2])
  })
})
