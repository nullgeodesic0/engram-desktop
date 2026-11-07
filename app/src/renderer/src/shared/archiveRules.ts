import type { TopicListEntry } from '../../../shared/types'

// The two pure archive predicates, split out of archive.ts (which also holds
// the React switch) so topicGrade.ts — also compiled into the node project
// for the sanity scripts — can use them without pulling in React. See
// archive.ts for the rules themselves.

/** Every node retired. `retired` is sparse (older engines omit it), so an
 * absent count reads as "not archived", never as zero-of-zero. */
export function isArchivedTopic(t: TopicListEntry): boolean {
  return t.retired != null && t.nodes > 0 && t.retired >= t.nodes
}

/** The node population coverage should be measured over: the non-retired
 * nodes. `liveStates` is only present when something is retired; otherwise
 * the engine's own counts already are the live ones. */
export function liveNodeCounts(t: TopicListEntry): { nodes: number; review: number } {
  if (t.liveStates) {
    const s = t.liveStates
    return { nodes: s.review + s.learning + s.new, review: s.review }
  }
  return { nodes: t.nodes, review: t.states.review }
}

