import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * A cheap fingerprint of "has the record changed since you last asked".
 *
 * ## Why the phone needs one
 *
 * The phone caches. It has to: a topic's figure, the artifact gallery, the
 * coach's reading and a topic's receipts are all expensive reads over a link
 * that may be a phone's last bar of signal, and refetching them on every
 * navigation would make the app feel like a website.
 *
 * But everything it caches is a projection of the same underlying thing — the
 * learner's record — and that record now changes with NOTHING happening on the
 * phone at all, because the Mac settles its queue on its own. A node's state,
 * its due date, its stability, a topic's letter grade and the coach's counts
 * all move when a receipt lands. Caches keyed on "have I fetched this yet"
 * cannot see that, so they showed a graph from before the grade.
 *
 * The due count had the same disease and got a poll. Polling five endpoints
 * every 45 seconds is not the answer; ONE stamp on a request the phone already
 * makes is. When it changes, the phone drops everything and refetches what is
 * actually on screen.
 *
 * ## Why mtimes and not a hash
 *
 * A receipt is append-only, one file per topic, and the engine writes it. Size
 * plus modification time across that directory changes exactly when a receipt
 * lands and never otherwise, for the cost of a stat per topic. Hashing the
 * contents would be the same answer, read in full, on every menu refresh.
 *
 * Deliberately NOT a timestamp of "now" and not a counter this app increments:
 * both would drift from the thing they claim to describe the first time
 * something wrote a receipt without going through here — and the desk writes
 * receipts all day without going through here.
 */
export async function readRecordStamp(): Promise<string> {
  const dir = join(homedir(), '.claude', 'learning', 'receipts')
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort()
    const parts: string[] = []
    for (const file of files) {
      const s = await stat(join(dir, file))
      parts.push(`${file}:${s.size}:${Math.floor(s.mtimeMs)}`)
    }
    return parts.join('|')
  } catch {
    // Unreadable reads as "unchanged" rather than as a new value every time.
    // A stamp that always differs would make the phone drop every cache on
    // every refresh — the exact cost this exists to avoid.
    return ''
  }
}
