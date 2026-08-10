import { engramRead } from '../engramCli/readOnly'
import type { DueItem, TopicListEntry } from '../../shared/types'

/**
 * The counts the phone's main menu shows, and nothing else.
 *
 * ## Why this is not in `main/link/`
 *
 * The link directory is pinned inert by checkDoctrine §D6: nothing in it may
 * name the engine, spawn a process, or reach the learning home. That rule is
 * what keeps a network peer from being one bug away from the learner's record.
 * This module reads the engine, so it lives outside that boundary and is handed
 * to the server as a plain function. The server gets an answer, never a way to
 * ask the engine anything of its own.
 *
 * ## Why it is counts only
 *
 * A due item carries `probe`, `claim` and `rubric` — the expected answers. The
 * order of operations is sacred: probe → production → confidence → reveal. A
 * menu that shipped due items to a phone so it could say "6 due" would put the
 * claims on the device too, and the next retrieval would be recognition with a
 * receipt recording it as memory. So the items are counted here and discarded
 * here; nothing but numbers crosses the wire.
 *
 * The counting reads `.topic` off each due item and no other field, which is
 * why this file is not a D4 answer reader.
 */

export interface MobileTopicOverview {
  topic: string
  title: string
  /** Retrievals the engine says are due now. */
  due: number
  /** Nodes with a card pack on hand, so the phone can actually walk them. */
  packed: number
}

export interface MobileOverview {
  topics: MobileTopicOverview[]
  dueTotal: number
  /** Measured median minutes per review item, or null before enough history. */
  minutesPerItem: number | null
}

/**
 * Builds the snapshot.
 *
 * `packedFor` is injected rather than imported so this module needs no
 * knowledge of the pack store — the composition root owns that wiring, and
 * this stays a pure question about the engine plus one lookup.
 */
export async function buildMobileOverview(
  packedFor: (topic: string) => Promise<string[]>,
): Promise<MobileOverview> {
  const topics = await engramRead<TopicListEntry[]>('topics')
  // One `due` call for everything, then tally by topic. Per-topic calls would
  // be N spawns of the CLI for a menu that refreshes on every app foreground.
  const due = await engramRead<DueItem[]>('due', ['--limit', '500'])

  const dueByTopic = new Map<string, number>()
  for (const item of due) {
    dueByTopic.set(item.topic, (dueByTopic.get(item.topic) ?? 0) + 1)
  }

  const overview: MobileTopicOverview[] = []
  for (const entry of topics) {
    overview.push({
      topic: entry.topic,
      title: entry.title ?? entry.topic,
      due: dueByTopic.get(entry.topic) ?? 0,
      packed: (await packedFor(entry.topic)).length,
    })
  }

  // Most due first, then most packed — the menu should lead with what the
  // learner can actually do something about.
  overview.sort((a, b) => b.due - a.due || b.packed - a.packed)

  return {
    topics: overview,
    dueTotal: due.length,
    minutesPerItem: null,
  }
}
