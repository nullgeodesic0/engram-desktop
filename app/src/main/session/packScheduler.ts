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

/**
 * The floor every topic gets before any topic gets a second helping.
 *
 * BREADTH BEFORE DEPTH, and the first version had it backwards. It chose the
 * emptiest topic and filled it toward the target, which sounds right and is
 * not: with five topics at zero and a six-hour cooldown, the fifth of them
 * would have waited thirty hours. Observed exactly that way — a learner
 * reached for classical mechanics on the phone and it was not there, because
 * the scheduler had spent its one turn on derivatives.
 *
 * One pack in every topic beats five packs in one topic, because the learner
 * does not choose their topic by what the scheduler happened to stock. Only
 * once everything is reachable does depth matter.
 */
export const PACK_FLOOR = 2

/** Between top-up sittings once every topic is reachable. Long on purpose:
 * stock drains one pack per walk, so there is no version of urgent. */
export const COOLDOWN_MS = 6 * 60 * 60_000

/**
 * Between sittings while a topic is still unreachable.
 *
 * Shorter, because "you cannot open this topic away from your desk" is a real
 * gap rather than a low shelf, and thirty hours to close it is not automatic
 * in any sense the word usually carries.
 */
export const URGENT_COOLDOWN_MS = 45 * 60_000

export interface TopicStock {
  topic: string
  /** Packs already on hand. */
  packed: number
  /** Nodes that could be packed but are not — the ceiling on any request. */
  walkable: number
  /** Due nodes with no pack on the phone — retrievals the learner is owed and
   * cannot do away from the desk. Optional so a caller that cannot read the
   * due queue behaves exactly as before. */
  dueUnpacked?: number
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
    // Two demands, and the LARGER of them — not their sum, because one sitting
    // covers both: three packs short of target and one owed retrieval is a
    // three-pack sitting.
    //
    // The second demand was missing entirely, and its absence was structural.
    // Deficit measured only the gap to PACK_TARGET, so a topic holding five
    // packs read as fully stocked and dropped out of `hungry` forever — even
    // with due nodes none of those five covered. Measured against real data:
    // eleven due retrievals, eleven packs, and not one pack in common with a
    // due node. The topic best placed to serve a review was the one the
    // scheduler had written off.
    deficit: Math.max(
      0,
      Math.min(Math.max(PACK_TARGET - t.packed, t.dueUnpacked ?? 0), t.walkable),
    ),
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

  const hungry = stocked.filter((t) => t.deficit > 0)
  if (hungry.length === 0) return null

  // Below the floor is a topic the learner cannot open away from the desk at
  // all. That is a different condition from a low shelf, and it gets both the
  // priority and the shorter clock.
  const unreachable = hungry.filter((t) => t.packed < PACK_FLOOR && t.walkable > 0)
  const urgent = unreachable.length > 0
  const cooldown = urgent ? URGENT_COOLDOWN_MS : COOLDOWN_MS
  if (state.lastRunAt !== null && state.now - state.lastRunAt < cooldown) return null

  // Owed beats speculative. Below the floor still comes first — a topic the
  // learner cannot open AT ALL is worse than a retrieval they cannot do away
  // from the desk inside a topic they can — but among reachable topics, a
  // retrieval the engine has already scheduled outranks stocking a shelf
  // against a trip nobody has taken yet.
  const owing = hungry.filter((t) => (t.dueUnpacked ?? 0) > 0)
  const pool = urgent ? unreachable : owing.length > 0 ? owing : hungry
  // Emptiest first. Ties break on the larger topic, which has more to lose
  // from being unreachable.
  return pool.reduce((worst, t) =>
    t.packed < worst.packed || (t.packed === worst.packed && t.walkable > worst.walkable)
      ? t
      : worst,
  )
}

/** How many packs to ask for on this run: enough to clear the floor when a
 * topic is unreachable, otherwise enough to reach the target. Asking for five
 * when two would make it reachable spends a long sitting on depth nobody
 * needed yet. */
export function askFor(topic: StockedTopic): number {
  const toFloor = Math.max(0, PACK_FLOOR - topic.packed)
  return Math.max(1, Math.min(topic.walkable, toFloor > 0 ? toFloor : topic.deficit))
}

// ===========================================================================
// The running scheduler
// ===========================================================================

import { engramRead } from '../engramCli/readOnly'
import { composePackTopUpKickoff } from '../../shared/mobileKickoff'
import type { TopicListEntry } from '../../shared/types'

/** Polls often, acts rarely — the cooldown above is what throttles action. */
const CHECK_INTERVAL_MS = 10 * 60_000

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
  /** Node ids the engine says are due for a topic. Optional: without it the
   * scheduler behaves as before and simply never mentions owed retrievals. */
  dueNodesFor?: (topic: string) => Promise<Set<string>>
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

  // Which topics owe a retrieval the phone cannot serve. A top-up that
  // covered only what comes NEXT left those topics permanently unopenable in
  // Review — due work at the desk, nothing on the phone, forever.
  const dueUnpackedByTopic = new Map<string, number>()

  const rows: TopicStock[] = []
  for (const entry of topics) {
    const packed = await deps.packedFor(entry.topic).catch(() => [] as string[])
    const due = await deps.dueNodesFor?.(entry.topic).catch(() => new Set<string>())
    if (due) {
      const packedSet = new Set(packed)
      dueUnpackedByTopic.set(entry.topic, [...due].filter((n) => !packedSet.has(n)).length)
    }
    const total =
      (entry.states?.new ?? 0) + (entry.states?.learning ?? 0) + (entry.states?.review ?? 0)
    rows.push({
      topic: entry.topic,
      packed: packed.length,
      dueUnpacked: dueUnpackedByTopic.get(entry.topic) ?? 0,
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
    .startSession(
      composePackTopUpKickoff({
        topic: choice.topic,
        count: askFor(choice),
        dueUnpacked: (dueUnpackedByTopic.get(choice.topic) ?? 0) > 0,
      }),
      choice.topic,
    )
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
