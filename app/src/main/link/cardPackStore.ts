import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseCardPack, validateAgainstOverlay, type CardPack } from '../../shared/cardPack'

/**
 * App-owned storage for generated card packs — one file per node.
 *
 * Deliberately NOT in `~/.claude/learning/`. Explorables live there because a
 * live tutor writes them with its own Write tool inside a session; a card pack
 * is written by the APP, and the app does not author anything under the
 * learning home. The distinction is the whole "window, never a second author"
 * boundary, and it is easier to keep by never having the path than by
 * remembering not to use it.
 *
 * `put` is the enforcement point for the mobile-walk overlay. A pack that
 * breaks the bargain is REJECTED rather than stored: the overlay is
 * instructions to a model, and a model can drift, so the last line of defence
 * has to be code that refuses. A refused pack surfaces as a node the phone
 * cannot walk — visible, diagnosable — instead of a sitting that quietly
 * graded recognition as encoding.
 */

export interface CardPackStoreDeps {
  /** Absolute path to the packs root. Created on demand. */
  rootDir: string
}

export interface CardPackStore {
  put(pack: CardPack): Promise<void>
  get(topic: string, node: string): Promise<CardPack | null>
  listFor(topic: string): Promise<string[]>
}

/** Topic and node ids reach this store from a model's tool call, so they are
 * treated as untrusted path segments: anything that could climb out of the
 * store directory is refused rather than sanitised. Silently rewriting a bad
 * name would leave a pack somewhere nobody looks for it. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

function assertSafe(kind: string, value: string): void {
  if (!SAFE_SEGMENT.test(value) || value.includes('..')) {
    throw new Error(`unsafe ${kind} for a card-pack path: ${JSON.stringify(value)}`)
  }
}

function isSafe(value: string): boolean {
  return SAFE_SEGMENT.test(value) && !value.includes('..')
}

export function createCardPackStore(deps: CardPackStoreDeps): CardPackStore {
  const { rootDir } = deps

  return {
    async put(pack) {
      assertSafe('topic', pack.topic)
      assertSafe('node', pack.node)
      const reasons = validateAgainstOverlay(pack)
      if (reasons.length > 0) {
        throw new Error(`card pack breaks the mobile-walk overlay: ${reasons.join('; ')}`)
      }
      const dir = join(rootDir, pack.topic)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${pack.node}.json`), JSON.stringify(pack, null, 2), 'utf-8')
    },

    async get(topic, node) {
      if (!isSafe(topic) || !isSafe(node)) return null
      try {
        const raw: unknown = JSON.parse(await readFile(join(rootDir, topic, `${node}.json`), 'utf-8'))
        const parsed = parseCardPack(raw)
        // A stored pack is re-validated on the way out as well as in. The file
        // could have been written by an older build whose rules were looser.
        if (!parsed || validateAgainstOverlay(parsed).length > 0) return null
        return parsed
      } catch {
        return null
      }
    },

    async listFor(topic) {
      if (!isSafe(topic)) return []
      try {
        const files = await readdir(join(rootDir, topic))
        return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length))
      } catch {
        return []
      }
    },
  }
}
