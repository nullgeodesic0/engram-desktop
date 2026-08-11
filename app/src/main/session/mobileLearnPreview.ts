import { readTopicGraph } from '../engramCli/readOnly'

/**
 * The nearest thing to a floor under LEARN.
 *
 * ## Why Learn has no floor, and why this exists anyway
 *
 * Review can always open because the engine already holds a `probe` for
 * every DUE node — the node was taught once, and the retrieval question
 * already exists. A Learn walk teaches a node for the first time: eight
 * authored beats (open a gap, predict, struggle, resolve, self-explain,
 * connect, verify, close), each written by a tutor who has the node, the
 * learner's history, and the source material in front of it. There is no
 * version of that a phone can synthesise without becoming a second author of
 * the curriculum itself — not evidence this time, the TEACHING.
 *
 * So Learn keeps no graded floor. What it can still have is a PREVIEW: read
 * ahead to the question the next unpacked node will actually ask, with zero
 * grading and zero evidence. This is legitimate for the identical reason the
 * review floor is — `probe` is real, already-authored content (the
 * curriculum architect writes it when a topic's node graph is built, before
 * any teaching sitting ever runs), and showing a learner the question they
 * are about to be asked is not authoring anything. It replaces "not on this
 * phone yet" — a dead end — with something to actually read on a train.
 *
 * ## What this must never become
 *
 * A cold guess at an unscaffolded `probe`, submitted as if it were a real
 * ENCODE, would corrupt what an encode receipt MEANS: "the learner was
 * taught this and it stuck" would start meaning "the learner guessed once."
 * That is a materially different and worse risk than the review recognition
 * floor, which only widens who may perform an ALREADY-SCHEDULED retrieval.
 * This module has no path to `MobileWalk`, produces no `OutboxItem`, and
 * must not grow one without that being a deliberate, separately-argued
 * doctrine change.
 */

/** The two fields this module is allowed to read off a node — see the same
 * pinned pattern as mobileReview.ts's `RawDue`. Naming only what is wanted
 * means `claim`, `rubric` and `transfer_probe` can never be forwarded by
 * accident. */
interface RawNode {
  state?: string
  probe?: string
  threshold?: boolean
}

export interface RawGraph {
  /** Curriculum order. Absent or short reads as "no preference" — the
   * function then falls back to object key order, which is still every
   * node, just not necessarily the taught sequence. */
  order?: string[]
  nodes: Record<string, RawNode>
}

/** What crosses to the phone. Questions only, exactly like `ReviewProbe`. */
export interface LearnPreview {
  node: string
  nodeTitle: string
  probe: string
  threshold: boolean
}

/**
 * The first not-yet-encoded, not-yet-packed node in curriculum order.
 *
 * Pure function — the graph and the packed set are both passed in — so the
 * concurrency-hostile parts (reading the CLI, reading the pack store) stay
 * out of the part worth unit testing.
 */
export function buildLearnPreview(
  graph: RawGraph,
  packedNodes: Set<string>,
  humanize: (id: string) => string,
): LearnPreview | null {
  const order = graph.order && graph.order.length > 0 ? graph.order : Object.keys(graph.nodes)
  for (const id of order) {
    const node = graph.nodes[id]
    if (!node) continue
    if (node.state !== 'new') continue
    if (packedNodes.has(id)) continue
    if (typeof node.probe !== 'string' || node.probe.length === 0) continue
    return {
      node: id,
      nodeTitle: humanize(id),
      probe: node.probe,
      threshold: Boolean(node.threshold),
    }
  }
  return null
}

/** The real reader, for the composition root. */
export async function readLearnPreview(
  topic: string,
  packedNodes: Set<string>,
  humanize: (id: string) => string,
): Promise<LearnPreview | null> {
  const graph = (await readTopicGraph(topic).catch(() => null)) as RawGraph | null
  if (!graph) return null
  return buildLearnPreview(graph, packedNodes, humanize)
}
