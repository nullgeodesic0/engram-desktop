import { useEffect, useState } from 'react'
import type { AchievementDef } from '../../../shared/achievements'
import { TrophyIcon } from './ui/icons'

const VISIBLE_MS = 4000
const FADE_MS = 300

/** A brief toast for a newly-unlocked achievement — auto-dismisses on its own.
 * Callers should key this by achievement id so a new unlock re-mounts and
 * re-triggers the animation instead of silently updating in place. */
export function AchievementToast({ achievement, onDone }: { achievement: AchievementDef; onDone: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const toShow = setTimeout(() => setVisible(true), 20)
    const toHide = setTimeout(() => setVisible(false), VISIBLE_MS)
    const toDone = setTimeout(onDone, VISIBLE_MS + FADE_MS)
    return () => {
      clearTimeout(toShow)
      clearTimeout(toHide)
      clearTimeout(toDone)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [achievement.id])

  return (
    <div
      className="fixed bottom-6 right-6 z-50 panel-raised border-[var(--color-ink-warm-dim)] px-4 py-3 flex items-center gap-3 transition-all"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transitionDuration: `${FADE_MS}ms`,
      }}
    >
      <span className="text-[var(--color-ink-warm)]">
        <TrophyIcon />
      </span>
      <div>
        <div className="text-xs label-data uppercase tracking-wide text-[var(--color-ink-warm)]">Achievement unlocked</div>
        <div className="text-sm text-[var(--color-text-primary)] mt-0.5">{achievement.label}</div>
        <div className="text-xs text-[var(--color-text-faint)]">{achievement.description}</div>
      </div>
    </div>
  )
}
