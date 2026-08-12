/**
 * Keeping the phone stocked, without anyone remembering to — and keeping it
 * that way, the moment the desk is free to do it.
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
 * ## What changed: restraint used to mean waiting; now it means yielding
 *
 * The first design's restraint was TIME — a six-hour cooldown between
 * top-ups, on the theory that stock falls slowly (one pack per walk) so
 * acting often was never necessary. That theory was correct about the RATE
 * stock falls at and wrong about what the learner wants: "eventually
 * restocked" read as "broken" the moment someone actually used the phone
 * surface for a real session and watched the shelf stay empty for hours
 * after. The redesign's restraint is CONTENTION, not time — one sitting at a
 * time, still, because two competing for the same engine is real — but the
 * moment the desk goes idle (a sitting closes, any sitting, anywhere) is
 * exactly the moment to check again, not a ten-minute or six-hour wait for
 * permission. `sessionHandlers.ts`'s `onIdle` hook is what makes "the moment"
 * real rather than aspirational — see `startPackScheduler`'s caller in
 * `linkService.ts`.
 *
 * - **One at a time.** Packing spawns a sitting, and two at once compete for
 *   the same engine. It also doubles the chance of the hang that stranded a
 *   sitting for 96 minutes with nothing to show for it.
 * - **A short debounce, not a long cooldown.** `MIN_GAP_MS` exists only to
 *   stop a busy-loop re-entering itself, not to ration how often the phone is
 *   allowed to be useful. An unreachable topic ignores it outright.
 * - **Never past what the topic has.** A topic with two unpacked nodes cannot
 *   yield five packs; asking for five would leave it permanently in deficit
 *   and permanently chosen, which is a loop with a sitting on the end of it.
 *
 * The cheaper path runs alongside this one and needs no scheduler at all: a
 * sitting that has just taught a node is already being asked to pack it, so
 * ordinary desk work keeps the shelf stocked on its own. This exists for the
 * topic you have not sat with in a while — and now runs it down to zero
 * deficit across every topic, one sitting after another, whenever the engine
 * is free to give it the time.
 */

/** Packs per topic worth having on hand, always. Roughly a week of phone
 * walks at the pace the app measures, and small enough that topping up is
 * one sitting. */
export const PACK_TARGET = 5

/**
 * The floor every topic gets before any topic gets a second helping.
 *
 * BREADTH BEFORE DEPTH, and the first version had it backwards. It chose the
 * emptiest topic and filled it toward the target, which sounds right and is
 * not: with five topics at zero, the fifth of them waited far longer than the
 * first for no reason but turn order. Observed exactly that way — a learner
 * reached for classical mechanics on the phone and it was not there, because
 * the scheduler had spent its one turn on derivatives.
 *
 * One pack in every topic beats five packs in one topic, because the learner
 * does not choose their topic by what the scheduler happened to stock. Only
 * once everything is reachable does depth matter.
 */
export const PACK_FLOOR = 2

/**
 * The only throttle left, and it is not rationing — it is a debounce.
 *
 * Multiple triggers can fire close together (a sitting closing, the phone
 * polling, a ten-minute safety-net tick), and without SOME gap two of them
 * could both read "nothing running yet" and both act. Short on purpose:
 * long enough to not be a busy-loop, nowhere near long enough to be felt as
 * a wait. An unreachable topic (see `chooseTopUp`) ignores this gap entirely
 * — "you cannot open this topic away from your desk at all" outranks even a
 * busy-loop guard.
 */
export const MIN_GAP_MS = 15_000

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
  // priority and a pass on the debounce below — "you cannot open this at all"
  // does not wait on a busy-loop guard meant for the ordinary case.
  const unreachable = hungry.filter((t) => t.packed < PACK_FLOOR && t.walkable > 0)
  const urgent = unreachable.length > 0
  if (!urgent && state.lastRunAt !== null && state.now - state.lastRunAt < MIN_GAP_MS) return null

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
import { withSessionStartLock } from './sessionStartLock'
import type { TopicListEntry } from '../../shared/types'

/** A safety net, not the primary trigger any more — `onIdle` (wired in
 * linkService.ts) is what actually catches "the desk just went free."  This
 * poll exists only to notice stock changes `onIdle` cannot see on its own
 * (a topic's due queue grew since the last check, say), so it stays short
 * without needing to, since it is no longer the thing standing between a
 * learner and a restocked shelf. */
export const CHECK_INTERVAL_MS = 2 * 60_000

/**
 * How long after launch the first check happens.
 *
 * There was no first check. `startPackScheduler` set an interval and nothing
 * else, so a freshly launched app did not look at its own stock for ten
 * minutes — precisely the window in which someone who just relaunched is
 * watching to see whether anything happens. Worse alongside auto-settle: the
 * tenth-minute check can land while a settle sitting holds the engine, be
 * correctly skipped, and wait another ten.
 *
 * Not zero. Launch is already creating a window, reading stores and starting
 * the link server, and adding a topics read — possibly a whole sitting — to
 * that moment is how a background scheduler earns the blame for a slow open.
 */
export const FIRST_CHECK_MS = 45_000

let timer: ReturnType<typeof setInterval> | null = null
let firstCheck: ReturnType<typeof setTimeout> | null = null
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
  /** Deletes any pack for this topic the desk has already graded since it was
   * written, and returns the nodes it removed. Optional and additive — a
   * caller that omits it just never sweeps, exactly today's behavior. Run
   * BEFORE `packedFor` reads this pass's stock, so a node solidified at the
   * desk frees its slot and can be re-topped-up in the very same pass rather
   * than waiting for the next trigger to notice. */
  cleanupStaleFor?: (topic: string) => Promise<string[]>
  /** The topic list. Optional and defaulted to the real engine read — tests
   * inject a fixture instead of spawning the real CLI, which is also what
   * exposed the concurrency race: a live spawn is slow enough that two calls
   * milliseconds apart genuinely overlap. */
  listTopics?: () => Promise<TopicListEntry[]>
}

/**
 * One pass: read stock, decide, and at most open one sitting.
 *
 * Exported so a Settings button can run it on demand — an automatic thing the
 * learner cannot also trigger by hand is an automatic thing they cannot test.
 */
export function topUpPacksNow(
  deps: PackSchedulerDeps,
  now: number = Date.now(),
): Promise<{ ranFor: string | null; stock: StockedTopic[] }> {
  // A concurrency guard, needed once this runs on more than a ten-minute
  // timer. `lastRunAt` is written partway through — after the topics/packed
  // reads, right before starting a sitting — so two calls close enough
  // together both read the OLD value, both pass the cooldown check, and both
  // start a sitting. Safe on a lone timer; not safe once a phone request can
  // trigger a check, because opening a menu fires several requests within
  // milliseconds of each other. The second call joins the first's promise
  // rather than starting its own pass.
  if (inFlight) return inFlight
  inFlight = runTopUpPass(deps, now).finally(() => {
    inFlight = null
  })
  return inFlight
}

let inFlight: Promise<{ ranFor: string | null; stock: StockedTopic[] }> | null = null

async function runTopUpPass(
  deps: PackSchedulerDeps,
  now: number,
): Promise<{ ranFor: string | null; stock: StockedTopic[] }> {
  const listTopics = deps.listTopics ?? (() => engramRead<TopicListEntry[]>('topics'))
  const topics = await listTopics().catch(() => [] as TopicListEntry[])

  // Which topics owe a retrieval the phone cannot serve. A top-up that
  // covered only what comes NEXT left those topics permanently unopenable in
  // Review — due work at the desk, nothing on the phone, forever.
  const dueUnpackedByTopic = new Map<string, number>()

  const rows: TopicStock[] = []
  for (const entry of topics) {
    await deps.cleanupStaleFor?.(entry.topic).catch(() => [] as string[])
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

  // The decision and the start are one locked unit, not just this pass's own
  // `inFlight` dedup above — that only serializes `topUpPacksNow` against
  // ITSELF. `deps.sittingRunning()` here reads the very same `sessions.size`
  // the phone's ASK button checks (linkService.ts's requestPacksFor), and a
  // call from THAT path can land in the gap between this read and this
  // pass's own `startSession` call. See sessionStartLock.ts — reproduced
  // live, 2026-08-11, as two concurrent sittings for the same topic.
  return withSessionStartLock(async () => {
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
  })
}

export function startPackScheduler(deps: PackSchedulerDeps): void {
  if (timer) return
  firstCheck = setTimeout(() => {
    firstCheck = null
    void topUpPacksNow(deps).catch(() => {})
  }, FIRST_CHECK_MS)
  timer = setInterval(() => void topUpPacksNow(deps).catch(() => {}), CHECK_INTERVAL_MS)
}

export function stopPackScheduler(): void {
  if (timer) clearInterval(timer)
  if (firstCheck) clearTimeout(firstCheck)
  timer = null
  firstCheck = null
}
