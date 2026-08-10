import { describe, expect, it } from 'vitest'
import { chooseTopUp, packStock, PACK_TARGET, type TopicStock } from './packScheduler'

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

  it('refuses inside the cooldown after a previous run', () => {
    const choice = chooseTopUp(packStock([{ topic: 'a', packed: 0, walkable: 9 }]), {
      ...idle,
      lastRunAt: idle.now - 60 * 60_000,
    })
    expect(choice).toBeNull()
  })

  it('runs again once the cooldown has passed', () => {
    const choice = chooseTopUp(packStock([{ topic: 'a', packed: 0, walkable: 9 }]), {
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
