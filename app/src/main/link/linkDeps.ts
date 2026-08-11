import type { CardPackStore } from './cardPackStore'
import type { OutboxStore } from './outboxStore'
import { walkablePacks, receiptSinceProvider, packsForMode } from '../session/walkablePacks'
import { dueNodeIds } from '../session/mobileOverview'
import { mobileProviders } from '../session/mobileProviders'

/**
 * Everything the phone-facing server answers with, assembled once.
 *
 * ## Why this exists
 *
 * The composition lived in `linkService.ts`, and the dev harness in
 * `scripts/mobileLink.ts` built its own alongside it with a comment promising
 * they matched. They did not, three separate times, and each time the symptom
 * was a phone reporting "your Mac isn't answering" about a route the Mac had
 * never heard of. `mobileProviders` was extracted to fix that — and then the
 * app grew `walkablePacks`, `reviewQueue`, `requestPacks` and
 * `onEvidenceBanked` OUTSIDE it, so the harness drifted again while the
 * comment claiming parity stayed exactly where it was.
 *
 * The lesson the second time is the same as the first: parity by convention
 * fails, so the shape has to be the thing that is shared rather than a promise
 * about it. Anything the phone can ASK for belongs here. What is left to the
 * caller is only what genuinely differs — where the stores live, and the two
 * capabilities that need a session to exist (starting one, and settling into
 * one), which a harness legitimately does not have.
 */
export interface LinkDepsInput {
  outbox: OutboxStore
  packs: CardPackStore
}

/**
 * A topic's packs that still have work in them, for a given mode.
 *
 * The one definition, shared by the phone's list, the overview's counts and
 * the scheduler's "does this topic need more packs" question. They must agree:
 * a scheduler that counts spent packs leaves a topic starved, and a phone that
 * lists them hands back the node the learner just finished.
 */
export function makeWalkableFor(input: LinkDepsInput) {
  return async function walkableFor(
    topic: string,
    mode: 'learn' | 'review' = 'learn',
  ): Promise<string[]> {
    const walkable = await walkablePacks(topic, {
      entries: (t) => input.packs.entriesFor(t),
      receiptSince: receiptSinceProvider,
      // Everything the phone has produced for this topic that the Mac has not
      // finished with — queued, in flight, or handed off awaiting a grade.
      banked: async (t) => {
        const [pending, inFlight] = await Promise.all([
          input.outbox.pending(),
          input.outbox.inFlight(),
        ])
        return new Set(
          [...pending, ...inFlight.map((f) => f.item)]
            .filter((item) => item.topic === t)
            .map((item) => item.node),
        )
      },
    })
    // Review is narrower: a pack is only openable if the engine says its node
    // is due. Fetched only when asked for, so Learn costs no extra read.
    if (mode !== 'review') return walkable
    return packsForMode(walkable, await dueNodeIds(topic), 'review')
  }
}

/** Every READ the phone gets, plus the pack list. Side-effect capabilities —
 * starting a sitting, settling a queue, writing a folder — are added by the
 * caller that actually has them. */
export function linkReadDeps(input: LinkDepsInput) {
  const walkableFor = makeWalkableFor(input)
  return {
    ...mobileProviders(walkableFor),
    walkablePacks: walkableFor,
  }
}
