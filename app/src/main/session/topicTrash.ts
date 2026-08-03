/** Whole-topic deletion — the second (and last) gated writer into the
 * learning home, alongside backup.ts's restore. "Delete" here is an app-side
 * MOVE, never an erase: the topic's engine files leave the learning home for
 * a timestamped folder under the app's own userData (`topic-trash/`), so the
 * engine — and every app surface that reads through it — stops seeing the
 * topic entirely, while the learner can still dig the files back out by
 * hand. Nothing is destroyed, no record is fabricated, no mastery claim
 * advances; the operation is a custody transfer the learner explicitly
 * confirmed by typing the topic's own slug.
 *
 * THE GATES (pinned by checkDoctrine D2.trashGate — removing any of these
 * turns a blessed exception into the second writer the doctrine forbids):
 *  - refuses while ANY session is live (a driven session appends receipts;
 *    moving the file under it would let the engine recreate it and split
 *    the topic's history across two files);
 *  - refuses a malformed slug, and refuses when the topic has no graph;
 *  - destination is ALWAYS app userData — never a path derived from user
 *    input beyond the validated slug, never inside the learning home.
 *
 * Deliberately left in place: the topic's rows in the shared
 * misconceptions.json (cross-topic ledger the engine owns — filtering
 * another topic's file to remove rows would make the app a line-editor of
 * engine records) and any artifact files (node-referenced, harmless once
 * the graph is gone). Both are historical records, not live queue inputs. */
import { app } from 'electron'
import { mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

function learningHome(): string {
  return process.env.ENGRAM_HOME ?? join(homedir(), '.claude', 'learning')
}

export async function moveTopicToTrash(
  topic: string,
  hasLiveSessions: () => boolean,
): Promise<{ trashedTo: string; moved: string[] }> {
  if (!/^[a-z0-9-]+$/.test(topic)) {
    throw new Error(`moveTopicToTrash: malformed topic "${topic}"`)
  }
  if (hasLiveSessions()) {
    throw new Error('moveTopicToTrash: refused while a session is live — end the sitting first')
  }
  const home = learningHome()
  const graphPath = join(home, 'graphs', `${topic}.json`)
  if (!existsSync(graphPath)) {
    throw new Error(`moveTopicToTrash: no graph for topic "${topic}" — nothing to delete`)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destRoot = join(app.getPath('userData'), 'topic-trash', `${topic}-${stamp}`)
  await mkdir(destRoot, { recursive: true })
  const moved: string[] = []
  for (const rel of [`graphs/${topic}.json`, `receipts/${topic}.jsonl`] as const) {
    const src = join(home, rel)
    if (!existsSync(src)) continue
    await rename(src, join(destRoot, rel.replace('/', '__')))
    moved.push(rel)
  }
  return { trashedTo: destRoot, moved }
}
