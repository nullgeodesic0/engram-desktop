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
 * - items are marked drained only AFTER their session actually starts, never
 *   before, so a failed start leaves them queued for the next attempt;
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
}

export interface DrainResult {
  sessionsStarted: number
  itemsDrained: number
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

export async function drainOutbox(deps: MobileDrainDeps): Promise<DrainResult> {
  const { outbox, batchDir, startSession } = deps
  const pending = await outbox.pending()
  const result: DrainResult = { sessionsStarted: 0, itemsDrained: 0, failures: [] }
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
      // Only now. A drain marked before the session exists is evidence lost.
      await outbox.markDrained(items.map((i) => i.id))
      result.sessionsStarted += 1
      result.itemsDrained += items.length
    } catch (error) {
      result.failures.push({ topic, error: error instanceof Error ? error.message : String(error) })
    }
  }

  return result
}
