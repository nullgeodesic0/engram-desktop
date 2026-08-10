/**
 * Keeping the phone stocked, without anyone remembering to.
 *
 * A pack has to exist before a node can be walked away from the desk, and
 * until now packs existed only because someone ran a script. That makes the
 * companion app quietly useless: you reach for it on a train and the topic you
 * wanted has nothing ready.
 *
 * ## Why this is a top-up and not a build
 *
 * Authoring a pack takes a tutor — `emit_card_pack` is a bridge tool, so a
 * pack is written by a sitting that has the node in front of it. There is no
 * cheap local way to make one. So the scheduler cannot "generate packs"; it
 * can only decide that stock is low enough to be worth one sitting, and pick
 * which topic.
 *
 * That makes restraint the whole design:
 *
 * - **One at a time.** Packing spawns a sitting, and two at once compete for
 *   the same engine. It also doubles the chance of the hang that stranded a
 *   sitting for 96 minutes with nothing to show for it.
 * - **A long cooldown.** Stock falls slowly — a topic loses one pack per walk
 *   — so checking often is fine but ACTING often is not.
 * - **Never past what the topic has.** A topic with two unpacked nodes cannot
 *   yield five packs; asking for five would leave it permanently in deficit
 *   and permanently chosen, which is a loop with a sitting on the end of it.
 *
 * The cheaper path runs alongside this one and needs no scheduler at all: a
 * sitting that has just taught a node is already being asked to pack it, so
 * ordinary desk work keeps the shelf stocked on its own. This exists for the
 * topic you have not sat with in a while.
 */

/** Packs per topic worth having on hand. Roughly a week of phone walks at the
 * pace the app measures, and small enough that topping up is one sitting. */
export const PACK_TARGET = 5

/** Between top-up sittings. Long on purpose: stock drains one pack per walk,
 * so there is no version of "urgent" here. */
export const COOLDOWN_MS = 6 * 60 * 60_000

export interface TopicStock {
  topic: string
  /** Packs already on hand. */
  packed: number
  /** Nodes that could be packed but are not — the ceiling on any request. */
  walkable: number
}

export interface StockedTopic extends TopicStock {
  /** How many packs to ask for. Never more than the topic can supply. */
  deficit: number
}

export interface SchedulerState {
  /** True when any sitting is live. Packing waits for a quiet engine. */
  sittingRunning: boolean
  lastRunAt: number | null
  now: number
}

export function packStock(topics: TopicStock[]): StockedTopic[] {
  return topics.map((t) => ({
    ...t,
    deficit: Math.max(0, Math.min(PACK_TARGET - t.packed, t.walkable)),
  }))
}

/**
 * The one topic worth spending a sitting on right now, or null.
 *
 * Returning null is the common case and the correct one — a scheduler whose
 * default is to act is a scheduler that will eventually act at a bad moment.
 */
export function chooseTopUp(stocked: StockedTopic[], state: SchedulerState): StockedTopic | null {
  if (state.sittingRunning) return null
  if (state.lastRunAt !== null && state.now - state.lastRunAt < COOLDOWN_MS) return null

  const hungry = stocked.filter((t) => t.deficit > 0)
  if (hungry.length === 0) return null

  // Emptiest first. Ties break on the larger topic, which has more to lose
  // from being unreachable.
  return hungry.reduce((worst, t) =>
    t.packed < worst.packed || (t.packed === worst.packed && t.walkable > worst.walkable)
      ? t
      : worst,
  )
}

// ===========================================================================
// The running scheduler
// ===========================================================================

import { engramRead } from '../engramCli/readOnly'
import { composePackTopUpKickoff } from '../../shared/mobileKickoff'
import type { TopicListEntry } from '../../shared/types'

/** Polls often, acts rarely — the cooldown above is what throttles action. */
const CHECK_INTERVAL_MS = 30 * 60_000

let timer: ReturnType<typeof setInterval> | null = null
let lastRunAt: number | null = null

export interface PackSchedulerDeps {
  /** Nodes already packed for a topic. */
  packedFor: (topic: string) => Promise<string[]>
  /** True while any sitting is live. */
  sittingRunning: () => boolean
  /** Opens the top-up sitting. Injected so this is testable and so the
   * scheduler never learns how a session is started. */
  startSession: (message: string, topic: string) => Promise<unknown>
}

/**
 * One pass: read stock, decide, and at most open one sitting.
 *
 * Exported so a Settings button can run it on demand — an automatic thing the
 * learner cannot also trigger by hand is an automatic thing they cannot test.
 */
export async function topUpPacksNow(
  deps: PackSchedulerDeps,
  now: number = Date.now(),
): Promise<{ ranFor: string | null; stock: StockedTopic[] }> {
  const topics = await engramRead<TopicListEntry[]>('topics').catch(() => [] as TopicListEntry[])

  const rows: TopicStock[] = []
  for (const entry of topics) {
    const packed = await deps.packedFor(entry.topic).catch(() => [] as string[])
    const total =
      (entry.states?.new ?? 0) + (entry.states?.learning ?? 0) + (entry.states?.review ?? 0)
    rows.push({
      topic: entry.topic,
      packed: packed.length,
      // Unpacked nodes: the ceiling on what a sitting could add.
      walkable: Math.max(0, total - packed.length),
    })
  }

  const stock = packStock(rows)
  const choice = chooseTopUp(stock, {
    sittingRunning: deps.sittingRunning(),
    lastRunAt,
    now,
  })
  if (!choice) return { ranFor: null, stock }

  // Stamped BEFORE the attempt, not after. A start that throws still counts
  // against the cooldown — otherwise a topic whose sittings keep failing gets
  // retried every poll, which is the loop the outbox already had to be taught
  // not to run.
  lastRunAt = now
  await deps
    .startSession(composePackTopUpKickoff({ topic: choice.topic, count: choice.deficit }), choice.topic)
    .catch(() => {})
  return { ranFor: choice.topic, stock }
}

export function startPackScheduler(deps: PackSchedulerDeps): void {
  if (timer) return
  timer = setInterval(() => void topUpPacksNow(deps).catch(() => {}), CHECK_INTERVAL_MS)
}

export function stopPackScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
