import { describe, expect, it } from 'vitest'
import { withSessionStartLock } from './sessionStartLock'
import {
  askFor,
  chooseTopUp,
  packStock,
  CHECK_INTERVAL_MS,
  FIRST_CHECK_MS,
  MIN_GAP_MS,
  PACK_FLOOR,
  PACK_TARGET,
  topUpPacksNow,
  type TopicStock,
} from './packScheduler'

function stock(over: Partial<TopicStock> = {}): TopicStock {
  return { topic: 't', packed: 0, walkable: 5, ...over }
}

describe('packStock', () => {
  it('counts the gap between packs on hand and the target', () => {
    const out = packStock([{ topic: 'a', packed: 1, walkable: 9 }])
    expect(out[0].deficit).toBe(PACK_TARGET - 1)
  })

  it('never asks for more packs than the topic has nodes to pack', () => {
    // A topic with two unpacked nodes cannot yield five packs, and asking for
    // five would leave it permanently "in deficit" and permanently chosen.
    const out = packStock([{ topic: 'a', packed: 0, walkable: 2 }])
    expect(out[0].deficit).toBe(2)
  })

  it('is satisfied when the target is met', () => {
    const out = packStock([{ topic: 'a', packed: PACK_TARGET, walkable: 40 }])
    expect(out[0].deficit).toBe(0)
  })
})

describe('chooseTopUp', () => {
  const idle = { sittingRunning: false, lastRunAt: null, now: Date.parse('2026-08-10T12:00:00Z') }

  it('picks the emptiest topic', () => {
    const choice = chooseTopUp(
      packStock([
        { topic: 'full', packed: PACK_TARGET, walkable: 20 },
        { topic: 'thin', packed: 1, walkable: 20 },
        { topic: 'empty', packed: 0, walkable: 20 },
      ]),
      idle,
    )
    expect(choice?.topic).toBe('empty')
  })

  it('refuses while a sitting is already running', () => {
    // Packing spawns a sitting. Two at once competes for the same engine and,
    // worse, doubles the chance of the hang that stranded one for 96 minutes.
    const choice = chooseTopUp(packStock([{ topic: 'a', packed: 0, walkable: 9 }]), {
      ...idle,
      sittingRunning: true,
    })
    expect(choice).toBeNull()
  })

  it('refuses inside the debounce gap for a merely-low, reachable topic', () => {
    // A topic AT the floor is low, not unreachable, so a re-entry a moment
    // ago still blocks it — the debounce exists to stop a busy-loop, not to
    // ration a scarce resource. An unreachable one is never blocked by this
    // at all — see the breadth-before-depth suite for that half.
    const choice = chooseTopUp(packStock([{ topic: 'a', packed: PACK_FLOOR, walkable: 9 }]), {
      ...idle,
      lastRunAt: idle.now - 1_000,
    })
    expect(choice).toBeNull()
  })

  it('runs again the moment the debounce gap has passed', () => {
    const choice = chooseTopUp(packStock([{ topic: 'a', packed: PACK_FLOOR, walkable: 9 }]), {
      ...idle,
      lastRunAt: idle.now - MIN_GAP_MS,
    })
    expect(choice?.topic).toBe('a')
  })

  it('does nothing when every topic is stocked', () => {
    const choice = chooseTopUp(
      packStock([{ topic: 'a', packed: PACK_TARGET, walkable: 20 }]),
      idle,
    )
    expect(choice).toBeNull()
  })

  it('ignores a topic with nothing left to pack', () => {
    // Short of the target but out of nodes — packed by exhaustion rather than
    // by target. `walkable` counts nodes still UNPACKED, so zero means a
    // sitting could only report there is nothing to do.
    const choice = chooseTopUp(packStock([stock({ topic: 'a', packed: 3, walkable: 0 })]), idle)
    expect(choice).toBeNull()
  })
})

describe('breadth before depth', () => {
  const idle = { sittingRunning: false, lastRunAt: null, now: Date.parse('2026-08-10T12:00:00Z') }

  it('packs an unreachable topic before deepening a reachable one', () => {
    // The first version chose the emptiest and filled it toward the target,
    // which left the fifth empty topic waiting thirty hours. Observed: a
    // learner reached for classical mechanics and it was not there.
    const choice = chooseTopUp(
      packStock([
        { topic: 'deep', packed: 3, walkable: 40 },
        { topic: 'unreachable', packed: 0, walkable: 9 },
      ]),
      idle,
    )
    expect(choice?.topic).toBe('unreachable')
  })

  it('an unreachable topic ignores the debounce gap entirely', () => {
    // "You cannot open this topic away from your desk at all" outranks even
    // the busy-loop guard — the moment a prior sitting ends, the next one for
    // an unreachable topic may start immediately.
    const state = { ...idle, lastRunAt: idle.now - 1 }
    expect(chooseTopUp(packStock([{ topic: 'a', packed: 0, walkable: 9 }]), state)?.topic).toBe('a')
    // The same near-zero gap is still too soon for a topic that is merely low.
    expect(chooseTopUp(packStock([{ topic: 'a', packed: PACK_FLOOR, walkable: 9 }]), state)).toBeNull()
  })

  it('asks only for what makes a topic reachable, not for the full target', () => {
    // Asking for five when two open the door spends a long sitting on depth
    // nobody needed yet.
    expect(askFor(packStock([{ topic: 'a', packed: 0, walkable: 9 }])[0])).toBe(PACK_FLOOR)
    expect(askFor(packStock([{ topic: 'a', packed: PACK_FLOOR, walkable: 9 }])[0])).toBe(
      PACK_TARGET - PACK_FLOOR,
    )
  })

  it('never asks for more packs than the topic has nodes left', () => {
    expect(askFor(packStock([{ topic: 'a', packed: 0, walkable: 1 }])[0])).toBe(1)
  })
})

/**
 * Owed retrievals are demand too, and the first version could not see them.
 *
 * `deficit` was the gap to PACK_TARGET and nothing else, so a topic holding
 * five packs read as fully stocked — even with two due nodes none of those
 * packs covered. It was then filtered out of `hungry` and could never be
 * chosen again. Observed with real data: eleven due retrievals, eleven packs,
 * and not one pack in common with a due node; derivatives was exactly this
 * case, and the topic best placed to serve a review was the one the scheduler
 * had written off.
 */
describe('due work as demand', () => {
  const idle = { sittingRunning: false, lastRunAt: null, now: Date.parse('2026-08-10T12:00:00Z') }

  it('a topic at full learn stock is still hungry for its unpacked due nodes', () => {
    const out = packStock([{ topic: 'a', packed: PACK_TARGET, walkable: 40, dueUnpacked: 2 }])
    expect(out[0].deficit).toBe(2)
  })

  it('takes the larger of the two demands rather than their sum', () => {
    // Three packs short of target and one owed retrieval is a three-pack
    // sitting, not four: the same sitting can cover both.
    const out = packStock([{ topic: 'a', packed: 2, walkable: 40, dueUnpacked: 1 }])
    expect(out[0].deficit).toBe(PACK_TARGET - 2)
  })

  it('still never asks for more than the topic has to pack', () => {
    const out = packStock([{ topic: 'a', packed: 0, walkable: 1, dueUnpacked: 6 }])
    expect(out[0].deficit).toBe(1)
  })

  it('owed retrievals outrank a merely low shelf', () => {
    // Both are reachable, so neither is urgent by the floor rule. One owes a
    // retrieval the learner cannot do away from the desk; the other is simply
    // stocked light. Owed now beats speculative.
    const chosen = chooseTopUp(
      packStock([
        { topic: 'low-shelf', packed: 2, walkable: 40, dueUnpacked: 0 },
        { topic: 'owes-review', packed: 4, walkable: 40, dueUnpacked: 3 },
      ]),
      idle,
    )
    expect(chosen?.topic).toBe('owes-review')
  })

  it('but an unreachable topic still comes first', () => {
    // Below the floor means the learner cannot open the topic AT ALL, which
    // is worse than owing a retrieval inside a topic they can open.
    const chosen = chooseTopUp(
      packStock([
        { topic: 'unreachable', packed: 0, walkable: 40, dueUnpacked: 0 },
        { topic: 'owes-review', packed: 4, walkable: 40, dueUnpacked: 3 },
      ]),
      idle,
    )
    expect(chosen?.topic).toBe('unreachable')
  })

  it('asks for enough to cover what is owed', () => {
    const [t] = packStock([{ topic: 'a', packed: PACK_TARGET, walkable: 40, dueUnpacked: 3 }])
    expect(askFor(t)).toBe(3)
  })
})

/**
 * The first check has to happen near launch.
 *
 * `startPackScheduler` set an interval and nothing else, so a freshly launched
 * app did not look at its stock for ten minutes — the exact window in which
 * someone who just relaunched is standing there wondering why nothing has
 * happened. Worse in combination with auto-settle: the tenth-minute check can
 * land while a settle sitting holds the engine, be correctly skipped, and wait
 * another ten.
 */
describe('firstCheckDelay', () => {
  it('is far shorter than the polling interval', () => {
    expect(FIRST_CHECK_MS).toBeLessThan(CHECK_INTERVAL_MS)
  })

  it('leaves the launch itself alone', () => {
    // Not zero. Launch is already doing window creation, store reads and the
    // link server; adding a topics read and possibly a sitting to that moment
    // is how a scheduler earns a reputation for making the app slow to open.
    expect(FIRST_CHECK_MS).toBeGreaterThanOrEqual(30_000)
  })
})

/**
 * A concurrency guard, needed once this runs on more than a timer.
 *
 * `topUpPacksNow` decides whether to start a sitting by reading `lastRunAt`,
 * then only writes it partway through — after the topics/packed reads, right
 * before calling `startSession`. Two calls close enough together both read
 * the old `lastRunAt`, both pass the cooldown check, and both start a
 * sitting. That was safe while the only caller was a ten-minute timer; it
 * stops being safe the moment a phone request can trigger a check, because a
 * menu open fires several requests within milliseconds of each other.
 */
describe('topUpPacksNow concurrency', () => {
  it('two overlapping calls start at most one sitting', async () => {
    let starts = 0
    const gate: { resolve: (() => void) | null } = { resolve: null }
    const deps = {
      listTopics: async () => [{
        topic: 't', title: 'T', goal: '', nodes: 5, due: 0,
        states: { new: 5, learning: 0, review: 0 },
      }],
      packedFor: async () => [],
      sittingRunning: () => false,
      startSession: async () => {
        starts += 1
        // Held open, so the second call's read-decide window overlaps the
        // first call's write-then-start window — the exact race.
        await new Promise<void>((resolve) => { gate.resolve = resolve })
      },
    }
    const first = topUpPacksNow(deps, Date.parse('2026-08-10T12:00:00Z'))
    const second = topUpPacksNow(deps, Date.parse('2026-08-10T12:00:00.010Z'))
    await new Promise((r) => setTimeout(r, 10))
    gate.resolve?.()
    await Promise.all([first, second])
    expect(starts).toBe(1)
  })

  /**
   * The gap `inFlight` above cannot close: it only serializes `topUpPacksNow`
   * against ITSELF. The actual incident (2026-08-11) was two DIFFERENT call
   * paths — the phone's ASK button (linkService.ts's requestPacksFor) and
   * this scheduler — each independently reading "nothing running" and both
   * starting a sitting for the same topic. `sittingRunning` is live here
   * (checks a real flag flipped by the other path's stand-in), proving the
   * fix is the shared `withSessionStartLock`, not a smarter read of the
   * running flag — no read survives being taken twice across an await.
   */
  it('a scheduler pass cannot act while a concurrent phone ASK holds the decision', async () => {
    let sessionRunning = false
    let starts = 0

    // Stands in for requestPacksFor mid-flight: past its own "nothing
    // running" check, holding the lock, NOT YET having flipped
    // `sessionRunning` — the exact window in which an unlocked scheduler
    // pass used to be free to barge in and read the same stale "false".
    const askGate: { resolve: (() => void) | null } = { resolve: null }
    const askHeld = new Promise<void>((resolve) => { askGate.resolve = resolve })
    const ask = withSessionStartLock(async () => {
      if (sessionRunning) return
      await askHeld
      starts += 1
      sessionRunning = true
    })

    const deps = {
      listTopics: async () => [{
        topic: 't', title: 'T', goal: '', nodes: 5, due: 0,
        states: { new: 5, learning: 0, review: 0 },
      }],
      packedFor: async () => [],
      sittingRunning: () => sessionRunning,
      startSession: async () => {
        starts += 1
        sessionRunning = true
      },
    }

    // Fires while `ask` is still holding the lock open. Its own topic-stock
    // scan (listTopics/packedFor above) resolves in a couple of microtasks —
    // long before this test releases `ask` — so an unlocked scheduler
    // decision reaches `chooseTopUp` well within the held window.
    const scheduler = topUpPacksNow(deps, Date.parse('2026-08-10T12:00:00Z'))
    await new Promise((r) => setTimeout(r, 5))
    // Correctly still 0: `ask` hasn't released, so nothing has actually
    // started yet — the scheduler's own decision is queued behind it, not
    // running unlocked. An unfixed `runTopUpPass` fails HERE, at 1: its
    // decision ran the moment its (much faster) topic-stock scan resolved,
    // never having waited on `ask`'s held lock at all.
    expect(starts).toBe(0)

    askGate.resolve?.()
    await Promise.all([scheduler, ask])
    expect(starts).toBe(1)
  })
})

/**
 * A node completed at the desk after its pack was already on the phone
 * should not just stop being OFFERED (walkablePacks already does that) — the
 * stale file should be gone, and the topic's next node should take its place
 * the same pass. Reported: solidifying a node at the desk left its old
 * mobile pack sitting on disk forever, uncounted but never cleared, and
 * nothing ever asked for what should have replaced it.
 */
describe('topUpPacksNow cleans up desk-graded packs', () => {
  it('removes a stale pack before counting stock, freeing a slot to refill', async () => {
    const removed: Array<[string, string]> = []
    const deps = {
      listTopics: async () => [{
        topic: 't', title: 'T', goal: '', nodes: 5, due: 0,
        states: { new: 3, learning: 0, review: 2 },
      }],
      // Reports the pack as already gone — the cleanup ran first and this is
      // the store's own count reflecting it, not a second source of truth.
      packedFor: async () => ['b'],
      cleanupStaleFor: async (topic: string) => {
        removed.push([topic, 'a'])
        return ['a']
      },
      sittingRunning: () => false,
      startSession: async () => {},
    }
    const result = await topUpPacksNow(deps, Date.parse('2026-08-10T12:00:00Z'))
    expect(removed).toEqual([['t', 'a']])
    // packed=1 is below PACK_FLOOR, so the topic is still hungry — a fresh
    // top-up fires for it in this very pass, the "repopulates" half of the
    // feature, not merely "removes".
    expect(result.ranFor).toBe('t')
  })

  it('a topic with nothing stale is untouched', async () => {
    let called = false
    const deps = {
      listTopics: async () => [{
        topic: 't', title: 'T', goal: '', nodes: 2, due: 0,
        states: { new: 0, learning: 0, review: 2 },
      }],
      packedFor: async () => ['a', 'b'],
      cleanupStaleFor: async () => {
        called = true
        return []
      },
      sittingRunning: () => false,
      startSession: async () => {},
    }
    await topUpPacksNow(deps, Date.parse('2026-08-10T12:00:00Z'))
    expect(called).toBe(true)
  })

  it('missing cleanupStaleFor is fine — cleanup is additive, not required', async () => {
    const deps = {
      listTopics: async () => [{
        topic: 't', title: 'T', goal: '', nodes: 2, due: 0,
        states: { new: 0, learning: 0, review: 2 },
      }],
      packedFor: async () => ['a', 'b'],
      sittingRunning: () => false,
      startSession: async () => {},
    }
    await expect(topUpPacksNow(deps, Date.parse('2026-08-10T12:00:00Z'))).resolves.toBeDefined()
  })
})
