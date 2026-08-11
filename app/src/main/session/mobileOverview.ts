import { packsForMode } from './walkablePacks'
import { engramRead, readTopicGraph } from '../engramCli/readOnly'
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
  /** Of those, the ones the engine says are DUE — what Review can open.
   *
   * Separate from `due` on purpose, and the gap between them is the honest
   * fact this menu has to show. `due` is what the desk owes; `reviewReady` is
   * what the phone can actually hand you. A register that showed only the
   * first offered work it could not open. */
  reviewReady: number
  /** FSRS state counts — the shape the health ring and state chips draw. */
  states: { new: number; learning: number; review: number }
  /** App-local filing label. Folders are a VIEW over the list, never a
   * location: nothing moves on disk and the folder SET is implicit, exactly
   * the distinct names in use. Null means unfiled. */
  folder: string | null
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
/**
 * The node ids the engine says are due for one topic.
 *
 * Ids only. A due ITEM carries probe, claim and rubric — the expected answers
 * — which is the whole reason this module hands the phone counts rather than
 * items; returning the ids keeps that boundary while letting Review tell a
 * pack it may open from one it may not.
 */
export async function dueNodeIds(topic: string): Promise<Set<string>> {
  const due = await engramRead<DueItem[]>('due', ['--limit', '500']).catch(() => [] as DueItem[])
  return new Set(due.filter((item) => item.topic === topic).map((item) => item.id))
}

export async function buildMobileOverview(
  packedFor: (topic: string) => Promise<string[]>,
): Promise<MobileOverview> {
  const topics = await engramRead<TopicListEntry[]>('topics')
  // One `due` call for everything, then tally by topic. Per-topic calls would
  // be N spawns of the CLI for a menu that refreshes on every app foreground.
  const due = await engramRead<DueItem[]>('due', ['--limit', '500'])

  const dueNodesByTopic = new Map<string, Set<string>>()
  for (const item of due) {
    const set = dueNodesByTopic.get(item.topic) ?? new Set<string>()
    set.add(item.id)
    dueNodesByTopic.set(item.topic, set)
  }
  const dueByTopic = new Map<string, number>()
  for (const item of due) {
    dueByTopic.set(item.topic, (dueByTopic.get(item.topic) ?? 0) + 1)
  }

  const overview: MobileTopicOverview[] = []
  for (const entry of topics) {
    const packedNodes = await packedFor(entry.topic)
    overview.push({
      topic: entry.topic,
      title: entry.title ?? entry.topic,
      due: dueByTopic.get(entry.topic) ?? 0,
      packed: packedNodes.length,
      reviewReady: packsForMode(
        packedNodes, dueNodesByTopic.get(entry.topic) ?? new Set(), 'review').length,
      states: {
        new: entry.states?.new ?? 0,
        learning: entry.states?.learning ?? 0,
        review: entry.states?.review ?? 0,
      },
      folder: entry.folder ?? null,
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

/**
 * One topic's concept graph, stripped to what a figure needs to be drawn.
 *
 * ## What is deliberately absent
 *
 * `EngramNode` carries `claim`, `rubric`, `probe` and `transfer_probe` — the
 * expected answers. None of them cross. The phone gets an id, a scheduling
 * state, a threshold flag, and prerequisite edges: enough to draw a real
 * figure, and not enough to answer a single probe with.
 *
 * The projection is the point. A convenience that shipped whole nodes so the
 * client could "just render what it needs" would put every answer in the
 * topic on the device, and the next retrieval would be recognition with a
 * receipt recording it as memory.
 */
export interface ConstellationNode {
  id: string
  /** FSRS state: `new`, `learning`, `review`, or whatever the engine reports. */
  state: string
  threshold: boolean
  /** Prerequisite edges, filtered to nodes present in this projection. */
  requires: string[]
  /** FSRS stability in days, or null for a node the engine has not scheduled.
   * These four are what the node table sorts and filters on. */
  stability: number | null
  /** Local 'YYYY-MM-DD', as the engine writes it. */
  due: string | null
  reps: number | null
  lapses: number | null
}

export interface ConstellationGraph {
  topic: string
  /** The engine's own teaching sequence, when it has one. */
  order: string[]
  nodes: ConstellationNode[]
}

export async function buildConstellationGraph(topic: string): Promise<ConstellationGraph> {
  // The read is typed to exactly the fields allowed to cross, and nothing
  // else. `readTopicGraph` returns `unknown`, so this narrowing is the only
  // view of the graph this function has — the projection is enforced by the
  // type rather than promised by a comment. A future edit that wanted `claim`
  // would have to widen this declaration, which is a visible act.
  type DrawableNode = {
    state?: unknown
    threshold?: unknown
    edges?: { requires?: string[] }
    /** Scheduling only. Widened from state+threshold so the phone can offer
     * the desktop's node TABLE — stability, due date, reps and lapses are the
     * columns it sorts and filters on, and without them the table is a list of
     * names. Still no probe, claim or rubric: this stays a scheduling read,
     * which is what keeps it off the §D4 answer-reader list. */
    fsrs?: { s?: unknown; due?: unknown; reps?: unknown; lapses?: unknown }
  }
  const graph = (await readTopicGraph(topic)) as {
    order?: string[]
    nodes?: Record<string, DrawableNode>
  }
  const present = new Set(Object.keys(graph.nodes ?? {}))
  const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null)
  const nodes: ConstellationNode[] = Object.entries(graph.nodes ?? {}).map(([id, node]) => ({
    id,
    state: typeof node.state === 'string' ? node.state : 'new',
    threshold: node.threshold === true,
    stability: num(node.fsrs?.s),
    due: typeof node.fsrs?.due === 'string' ? node.fsrs.due : null,
    reps: num(node.fsrs?.reps),
    lapses: num(node.fsrs?.lapses),
    // Filtered to drawn nodes: an edge to something absent is a line to
    // nowhere, and the client should not have to guess.
    requires: (node.edges?.requires ?? []).filter((req) => present.has(req)),
  }))
  return { topic, order: graph.order ?? [], nodes }
}
