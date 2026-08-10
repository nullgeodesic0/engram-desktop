import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { composeMobileDrainKickoff } from '../../shared/mobileKickoff'
import type { OutboxItem } from '../../shared/linkProtocol'
import type { OutboxStore } from './outboxStore'

/**
 * Turns queued phone evidence into real sittings.
 *
 * This is the seam the whole mobile surface hangs off, and its contract is
 * mostly about not losing things. The learner produced this work — possibly on
 * a train, possibly days ago — and it exists in exactly one place until a
 * session settles it. So:
 *
 * - items are marked drained only once the engine has actually written a
 *   receipt for them. Starting a sitting only marks them IN FLIGHT: a session
 *   that crashed, was closed, or never rated used to leave the learner's
 *   evidence marked handled with nothing in the record to show for it;
 * - topics fail independently, because one broken session must not strand
 *   another topic's evidence behind it;
 * - the batch is written to a file and the kickoff names the path, since a
 *   sitting's productions do not fit a kickoff and inlining a production into
 *   a command line is what the plugin's shell-safety rule forbids.
 *
 * What this does NOT do is rate anything. It hands evidence to a session and
 * the session, running the D5-pinned mobile-walk protocol, decides what it was
 * worth. Any grading logic that appears here is the app becoming a second
 * author of the record.
 */

export interface MobileDrainDeps {
  outbox: OutboxStore
  /** Directory for batch files. OS tmpdir in production. */
  batchDir: string
  /** Starts a session, resolving to its id. Injected so the failure path is
   * testable without spawning a `claude` child process. */
  startSession: (message: string, kind: string, topic?: string) => Promise<string>
  /** True when the engine has written a receipt for this node since the given
   * time. Injected rather than read here: §D6 keeps main/link/ away from the
   * learning home, so the server layer gets an ANSWER and never a way to look. */
  receiptSince: (topic: string, node: string, since: string) => Promise<boolean>
  /** Injected so tests need no clock. */
  now?: () => Date
}

export interface DrainResult {
  sessionsStarted: number
  /** Items handed to a sitting on THIS call. Not the same as settled — see
   * `itemsSettled`, which is the number that actually reached the record. */
  itemsDrained: number
  /** Items from an earlier sitting whose receipt has since landed. These are
   * the ones truly finished, and they are counted here rather than folded into
   * `itemsDrained` because conflating handed-over with settled is the exact
   * mistake this reconciliation exists to correct. */
  itemsSettled: number
  /** Items whose sitting had long enough and produced nothing, returned to the
   * queue by this call. Reported rather than silently retried: a learner whose
   * evidence keeps coming back deserves to know the sittings are failing. */
  itemsRetried: number
  /** Items no sitting will ever settle, given up on by this call. */
  itemsAbandoned: number
  failures: Array<{ topic: string; error: string }>
}

function groupByTopic(items: OutboxItem[]): Map<string, OutboxItem[]> {
  const groups = new Map<string, OutboxItem[]>()
  for (const item of items) {
    const existing = groups.get(item.topic)
    if (existing) existing.push(item)
    else groups.set(item.topic, [item])
  }
  return groups
}

/** Sittings an item gets before the queue accepts it will never settle. Two,
 * not one: a single crash should not condemn real evidence. */
const MAX_HANDOFFS = 2

export async function drainOutbox(deps: MobileDrainDeps): Promise<DrainResult> {
  const { outbox, batchDir, startSession, receiptSince } = deps
  const now = deps.now ?? (() => new Date())
  const result: DrainResult = {
    sessionsStarted: 0,
    itemsDrained: 0,
    itemsSettled: 0,
    itemsRetried: 0,
    itemsAbandoned: 0,
    failures: [],
  }

  // Settle first, hand over second.
  //
  // Anything a previous sitting took is checked against the record before this
  // call decides what still needs doing. A receipt means done — permanently,
  // and only now. No receipt yet means leave it alone, because that sitting
  // may still be working; the store's grace decides when silence becomes
  // failure and puts the item back in `pending` on its own.
  const settled: string[] = []
  for (const flight of await outbox.inFlight()) {
    if (await receiptSince(flight.item.topic, flight.item.node, flight.startedAt)) {
      settled.push(flight.item.id)
    }
  }
  if (settled.length > 0) {
    await outbox.markDrained(settled)
    result.itemsSettled = settled.length
  }

  // Give up on what no sitting will settle.
  //
  // Not every item CAN produce a receipt. A walk parked after PREDICT carries
  // a pre-content commitment and no retrieval, so the tutor correctly writes
  // nothing for it — observed live, in a session note that said exactly that.
  // Without a stopping rule this queue opens a fresh sitting for the same
  // ungradeable card forever, which is not persistence but a loop.
  //
  // The budget is deliberately blunt. The drain cannot tell "ungradeable" from
  // "the sitting crashed twice", and guessing would eventually throw away real
  // work; counting attempts cannot. What it can do is stop, and say so.
  const stale = await outbox.staleInFlight()
  const giveUp: Array<{ id: string; reason: string }> = []
  const retry: OutboxItem[] = []
  for (const item of stale) {
    const attempts = await outbox.handoffCount(item.id)
    if (attempts >= MAX_HANDOFFS) {
      giveUp.push({
        id: item.id,
        reason: `${attempts} sittings produced no receipt — this evidence may not be gradeable on its own`,
      })
    } else {
      retry.push(item)
    }
  }
  if (giveUp.length > 0) {
    await outbox.markAbandoned(giveUp)
    result.itemsAbandoned = giveUp.length
  }
  result.itemsRetried = retry.length

  const pending = await outbox.pending()
  if (pending.length === 0) return result

  await mkdir(batchDir, { recursive: true })

  for (const [topic, items] of groupByTopic(pending)) {
    const path = join(batchDir, `mobile-batch-${randomUUID()}.json`)
    try {
      // The batch is exactly what the phone sent — no rating, no stamp, no
      // interpretation. The session reads this and decides.
      await writeFile(path, JSON.stringify({ topic, items }, null, 2), 'utf-8')
      const message = composeMobileDrainKickoff({
        topic,
        evidencePath: path,
        itemCount: items.length,
      })
      await startSession(message, 'learn', topic)
      // IN FLIGHT, not drained. The sitting exists; that is all this knows.
      // Whether it produces a receipt is decided by the record, on the next
      // call, by the reconciliation above.
      await outbox.markInFlight(
        items.map((i) => i.id),
        now().toISOString(),
      )
      result.sessionsStarted += 1
      result.itemsDrained += items.length
    } catch (error) {
      result.failures.push({ topic, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return result
}
