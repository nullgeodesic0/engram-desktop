/** Pure bookkeeping over receipt `source` stamps — the app-side half of the
 * checkpoint bargain. The engine treats `source` as write-only free text, so
 * everything here (the recall floor, the quick meter, the drift lints) is
 * the desktop app keeping the books the engine deliberately doesn't.
 *
 * Population discipline: every function here considers only `kind ===
 * 'review'` rows with `relearn !== true` — the same rows the engine's own
 * retention family counts — because the floor and the meter are claims
 * about REVIEW evidence, and audit/relearn/encode rows are other kinds of
 * event entirely. `source === null` (old rows) reads as free recall: the
 * stamp is the checkpoint protocol's obligation, so its absence is honest
 * evidence the row predates or bypassed checkpoints. */

import type { RawReceipt } from '../../../shared/types'

export const CHECKPOINT_SOURCE = 'quick-mc'

/** How many consecutive checkpoint reviews trip the recall floor. Locked
 * product decision: every third review must be free recall — two checkpoint
 * receipts in a row puts the node on the floor list. */
export const RECALL_FLOOR_AFTER = 2

function reviewRows(receipts: RawReceipt[]): RawReceipt[] {
  return receipts.filter((r) => r.kind === 'review' && r.relearn !== true)
}

function byTsAscending(a: RawReceipt, b: RawReceipt): number {
  return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0
}

/** Node ids (namespaced `topic/node` collapses to the bare node id the due
 * payload and kickoff use — node ids are unique within a topic, and the
 * kickoff names nodes inside one sitting's mixed-topic queue, so the pair
 * key is used internally and the bare id returned per topic entry). */
export interface RecallDueEntry {
  topic: string
  node: string
}

/** Every node whose LAST `RECALL_FLOOR_AFTER` review receipts are all
 * checkpoint-stamped — the recall-floor list the kickoff names. A single
 * free-recall (or assessor, or null-source) review row resets the streak,
 * which is exactly the floor's semantics: recognition may carry a node
 * between recall checkpoints, never past them. */
export function recallDueNodes(receipts: RawReceipt[]): RecallDueEntry[] {
  const byNode = new Map<string, RawReceipt[]>()
  // '/' can never appear in a topic or node slug (both are [a-z0-9-]), so
  // the composite key splits back unambiguously.
  for (const r of reviewRows(receipts)) {
    const key = `${r.topic}/${r.node}`
    const rows = byNode.get(key) ?? []
    rows.push(r)
    byNode.set(key, rows)
  }
  const out: RecallDueEntry[] = []
  for (const [key, rows] of byNode) {
    rows.sort(byTsAscending)
    const tail = rows.slice(-RECALL_FLOOR_AFTER)
    if (tail.length === RECALL_FLOOR_AFTER && tail.every((r) => r.source === CHECKPOINT_SOURCE)) {
      const [topic, node] = key.split('/')
      out.push({ topic, node })
    }
  }
  return out.sort((a, b) => (a.topic + a.node < b.topic + b.node ? -1 : 1))
}

/** Source stamp for a step-sized review (the D5-pinned step-sized overlay):
 * a multi-step derivation reviewed by its plan plus one pivotal step instead
 * of a full re-derivation. Kept distinguishable forever, like quick-mc. */
export const STEP_SOURCE = 'step-probe'

/** Two step-sized reviews in a row put a node on the full-solve floor: the
 * next review is the whole derivation. Step probes keep a long chain cheap
 * to review; the floor keeps the learner able to run the chain end to end. */
export const FULL_SOLVE_AFTER = 2

/** Nodes whose last `FULL_SOLVE_AFTER` review receipts are all step-probe
 * stamped — named in the kickoff as needing a full solve this time. Same
 * population and reset semantics as `recallDueNodes`. */
export function fullSolveDueNodes(receipts: RawReceipt[]): RecallDueEntry[] {
  const byNode = new Map<string, RawReceipt[]>()
  for (const r of reviewRows(receipts)) {
    const key = `${r.topic}/${r.node}`
    const rows = byNode.get(key) ?? []
    rows.push(r)
    byNode.set(key, rows)
  }
  const out: RecallDueEntry[] = []
  for (const [key, rows] of byNode) {
    rows.sort(byTsAscending)
    const tail = rows.slice(-FULL_SOLVE_AFTER)
    if (tail.length === FULL_SOLVE_AFTER && tail.every((r) => r.source === STEP_SOURCE)) {
      const [topic, node] = key.split('/')
      out.push({ topic, node })
    }
  }
  return out.sort((a, b) => (a.topic + a.node < b.topic + b.node ? -1 : 1))
}

/** The quiet meter: of the most recent `windowSize` review receipts (across
 * all topics), how many were checkpoint-stamped. Null when there are no
 * review receipts at all — a meter with no data renders nothing, never a
 * fabricated zero. */
export function quickShare(receipts: RawReceipt[], windowSize = 30): { quick: number; total: number } | null {
  const rows = reviewRows(receipts).sort(byTsAscending).slice(-windowSize)
  if (rows.length === 0) return null
  return { quick: rows.filter((r) => r.source === CHECKPOINT_SOURCE).length, total: rows.length }
}

/** Machine-detectable drift between the checkpoint protocol's promises and
 * what actually landed on disk. These are the receipts' own facts — no
 * transcript reading, no claim/rubric access. */
export type CheckpointLintKind = 'checkpoint-easy' | 'audit-on-checkpoint'

export interface CheckpointLint {
  kind: CheckpointLintKind
  topic: string
  node: string
  ts: string
  detail: string
}

export function lintCheckpointReceipts(receipts: RawReceipt[]): CheckpointLint[] {
  const lints: CheckpointLint[] = []
  const checkpointDays = new Set<string>()
  for (const r of receipts) {
    if (r.source === CHECKPOINT_SOURCE && r.kind === 'review') {
      checkpointDays.add(`${r.topic}/${r.node}/${r.ts}`)
      if (r.rating === 'easy') {
        lints.push({
          kind: 'checkpoint-easy',
          topic: r.topic,
          node: r.node,
          ts: r.ts,
          detail: 'a checkpoint receipt carries rating "easy" — the protocol caps a flawless chain at "good"',
        })
      }
    }
  }
  for (const r of receipts) {
    if (r.kind === 'audit' && checkpointDays.has(`${r.topic}/${r.node}/${r.ts}`)) {
      lints.push({
        kind: 'audit-on-checkpoint',
        topic: r.topic,
        node: r.node,
        ts: r.ts,
        detail: 'an assessor audit landed on a node the same day as its checkpoint review — checkpoint items must never stash',
      })
    }
  }
  return lints
}
