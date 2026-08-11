import { describe, expect, it } from 'vitest'
import { askFor, chooseTopUp, packStock, PACK_FLOOR, PACK_TARGET, type TopicStock } from './packScheduler'

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

  it('refuses inside the long cooldown once every topic is reachable', () => {
    // A topic AT the floor is low, not unreachable, so it waits on the long
    // clock. An unreachable one would have run an hour in — see the
    // breadth-before-depth suite for that half.
    const choice = chooseTopUp(packStock([{ topic: 'a', packed: PACK_FLOOR, walkable: 9 }]), {
      ...idle,
      lastRunAt: idle.now - 60 * 60_000,
    })
    expect(choice).toBeNull()
  })

  it('runs again once the cooldown has passed', () => {
    const choice = chooseTopUp(packStock([{ topic: 'a', packed: PACK_FLOOR, walkable: 9 }]), {
      ...idle,
      lastRunAt: idle.now - 7 * 60 * 60_000,
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

  it('uses the short clock while anything is unreachable', () => {
    const state = { ...idle, lastRunAt: idle.now - 50 * 60_000 }
    expect(chooseTopUp(packStock([{ topic: 'a', packed: 0, walkable: 9 }]), state)?.topic).toBe('a')
    // The same gap is far too soon once everything is merely low.
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
