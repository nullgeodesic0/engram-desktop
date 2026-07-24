import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import type { UnlockedAchievement } from '../../shared/types'

function storePath(): string {
  return join(app.getPath('userData'), 'achievements.json')
}

async function read(): Promise<UnlockedAchievement[]> {
  try {
    return JSON.parse(await readFile(storePath(), 'utf-8'))
  } catch {
    return []
  }
}

async function write(unlocked: UnlockedAchievement[]): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(storePath(), JSON.stringify(unlocked, null, 2), 'utf-8')
}

export async function getUnlockedAchievements(): Promise<UnlockedAchievement[]> {
  return read()
}

/**
 * Records newly-unlocked achievement ids (evaluated client-side against
 * `EngramStats` — see shared/achievements.ts — since that's already fetched by
 * every view that would trigger this; no reason to duplicate that fetch here).
 * Idempotent: ids already present keep their original `unlockedAt`, never
 * overwritten by a later call.
 */
export async function recordUnlocked(ids: string[]): Promise<UnlockedAchievement[]> {
  const current = await read()
  const known = new Set(current.map((a) => a.id))
  const additions = ids.filter((id) => !known.has(id)).map((id) => ({ id, unlockedAt: new Date().toISOString() }))
  if (additions.length === 0) return current
  const next = [...current, ...additions]
  await write(next)
  return next
}
