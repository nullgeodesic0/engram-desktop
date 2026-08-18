import { useEffect, useState } from 'react'
import { ACHIEVEMENTS } from '../../../shared/achievements'
import type { UnlockedAchievement } from '../../../shared/types'
import { TrophyIcon, LockIcon } from './ui/icons'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Locked/unlocked badge grid — a permanent record, not a live status: once
 * unlocked an achievement stays shown as unlocked even if the underlying stat
 * (e.g. a streak) later resets. */
export function AchievementsPanel() {
  const [unlocked, setUnlocked] = useState<UnlockedAchievement[] | null>(null)

  useEffect(() => {
    window.engram.getUnlockedAchievements().then(setUnlocked)
  }, [])

  if (!unlocked) return null

  const byId = new Map(unlocked.map((u) => [u.id, u]))

  return (
    <div className="grid grid-cols-2 gap-2">
      {ACHIEVEMENTS.map((a) => {
        const hit = byId.get(a.id)
        return (
          <div
            key={a.id}
            className={`panel px-3 py-2.5 flex items-center gap-2.5 ${hit ? '' : 'opacity-40'}`}
          >
            <span className={hit ? 'text-[var(--color-ink-warm)]' : 'text-[var(--color-text-faint)]'}>
              {hit ? <TrophyIcon /> : <LockIcon />}
            </span>
            <div className="min-w-0">
              <div className={`text-sm truncate ${hit ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-dim)]'}`}>{a.label}</div>
              <div className="text-xs text-[var(--color-text-faint)] truncate">
                {hit ? formatDate(hit.unlockedAt) : a.description}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
