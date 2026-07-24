import type { EngramStats } from './types'

export interface AchievementDef {
  id: string
  label: string
  description: string
  check: (stats: EngramStats) => boolean
}

/**
 * Pure rules over `EngramStats` — no new data source needed. `streak_days` and
 * `reviews` are already engine-computed server-side (engram.py's own `stats`
 * command), so this reuses data every view already fetches rather than
 * re-deriving a streak from raw receipts. "Topic mastered" reuses the same
 * per-topic `states` breakdown the Home/Dashboard views already render.
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_review', label: 'First review', description: 'Cleared your first review', check: (s) => s.reviews >= 1 },
  { id: 'streak_3', label: '3-day streak', description: 'Reviewed 3 days in a row', check: (s) => s.streak_days >= 3 },
  { id: 'streak_7', label: '7-day streak', description: 'Reviewed 7 days in a row', check: (s) => s.streak_days >= 7 },
  { id: 'streak_30', label: '30-day streak', description: 'Reviewed 30 days in a row', check: (s) => s.streak_days >= 30 },
  { id: 'streak_100', label: '100-day streak', description: 'Reviewed 100 days in a row', check: (s) => s.streak_days >= 100 },
  { id: 'reviews_100', label: '100 reviews', description: '100 total reviews completed', check: (s) => s.reviews >= 100 },
  {
    id: 'topic_mastered',
    label: 'Topic mastered',
    description: 'Every node in a topic reached review state',
    check: (s) => s.topics.some((t) => t.states.new === 0 && t.states.learning === 0 && t.states.review > 0),
  },
]
