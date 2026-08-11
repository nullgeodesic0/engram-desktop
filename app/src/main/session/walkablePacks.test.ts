import { describe, expect, it } from 'vitest'
import { walkablePacks, receiptRetiresPack } from './walkablePacks'

/**
 * The phone asked "what is packed for this topic" and got back every pack
 * file on disk, forever. `startWalk` takes the first of them, so every walk of
 * a topic served the same alphabetically-first node — the learner completed
 * it, settled it, came back, and was handed it again. Reported from the
 * device, on Statistical Mechanics.
 */
describe('walkablePacks', () => {
  const entries = async () => [
    { node: 'ensembles', generatedAt: '2026-08-10T10:00:00.000Z' },
    { node: 'partition-function', generatedAt: '2026-08-10T10:00:00.000Z' },
    { node: 'free-energy', generatedAt: '2026-08-10T10:00:00.000Z' },
  ]
  const nothingBanked = async () => new Set<string>()
  const noReceipts = async () => false

  it('offers every pack when nothing has been walked', async () => {
    expect(await walkablePacks('sm', { entries, receiptSince: noReceipts, banked: nothingBanked }))
      .toEqual(['ensembles', 'partition-function', 'free-energy'])
  })

  it('retires a pack once the desk has graded its node', async () => {
    const receiptSince = async (_t: string, node: string, since: string) =>
      node === 'ensembles' && since < '2026-08-10T11:00:00.000Z'
    expect(await walkablePacks('sm', { entries, receiptSince, banked: nothingBanked }))
      .toEqual(['partition-function', 'free-energy'])
  })

  it('a receipt OLDER than the pack does not retire it', async () => {
    // The node was reviewed last week and has just been re-packed. The pack is
    // for work not yet done, and refusing it would strand the node.
    const receiptSince = async (_t: string, _n: string, _since: string) => false
    expect(await walkablePacks('sm', { entries, receiptSince, banked: nothingBanked }))
      .toHaveLength(3)
  })

  it('retires a pack whose walk is already banked but not yet settled', async () => {
    // Between finishing a walk and the Mac grading it there is no receipt, and
    // without this the learner is handed the node they just did.
    const banked = async () => new Set(['partition-function'])
    expect(await walkablePacks('sm', { entries, receiptSince: noReceipts, banked }))
      .toEqual(['ensembles', 'free-energy'])
  })

  it('reports nothing rather than throwing when the record cannot be read', async () => {
    const receiptSince = async () => {
      throw new Error('history unreadable')
    }
    // A pack whose spentness is unknowable is still offered: the failure mode
    // of a repeated node is a wasted walk, and of a swallowed one, a node the
    // learner can never reach.
    expect(await walkablePacks('sm', { entries, receiptSince, banked: nothingBanked }))
      .toHaveLength(3)
  })
})

/**
 * engram writes some receipts date-only ('2026-08-10') and some full ISO.
 *
 * That matters here and nowhere else. A pack generated at 08:03 and walked at
 * 21:00 the SAME day gets a receipt stamped '2026-08-10', which as a string
 * sorts before '2026-08-10T08:03:28.635Z' — so an exact comparison says the
 * node has not been touched since the pack was written, and never will, since
 * the pack's timestamp does not move. The node would come back forever: the
 * exact bug this module exists to fix, surviving inside the fix.
 *
 * The drain's `receiptSince` keeps the exact comparison on purpose — there,
 * reading a date-only receipt as the start of its day can only fail to settle
 * something, which is the safe direction. Retirement wants the opposite
 * reading, so it gets its own predicate rather than a flag on the shared one.
 */
describe('receiptRetiresPack', () => {
  it('retires on a later full timestamp', () => {
    expect(receiptRetiresPack('2026-08-10T21:00:00.000Z', '2026-08-10T08:03:28.635Z')).toBe(true)
  })

  it('does not retire on an earlier full timestamp', () => {
    expect(receiptRetiresPack('2026-08-10T07:00:00.000Z', '2026-08-10T08:03:28.635Z')).toBe(false)
  })

  it('retires on a date-only receipt from the same day as the pack', () => {
    expect(receiptRetiresPack('2026-08-10', '2026-08-10T08:03:28.635Z')).toBe(true)
  })

  it('retires on a date-only receipt from after the pack', () => {
    expect(receiptRetiresPack('2026-08-11', '2026-08-10T08:03:28.635Z')).toBe(true)
  })

  it('does not retire on a date-only receipt from before the pack', () => {
    expect(receiptRetiresPack('2026-08-09', '2026-08-10T08:03:28.635Z')).toBe(false)
  })
})
