import type { EngramStats } from './types'

export interface AchievementDef {
  id: string
  label: string
  description: string
  check: (stats: EngramStats) => boolean
}

/**
 * Pure rules over `EngramStats` — no new data source needed.
 *
 * NO CONSECUTIVE-DAY STREAKS. The 3/7/30/100-day streak milestones were
 * retired: a streak resets to zero on one missed day, broken streaks are
 * measurably demotivating (Silverman & Barasch, J. Consumer Research), and a
 * single miss does not affect habit formation (Lally et al. 2010). Every rule
 * below is cumulative, so nothing here can be lost by taking a day off. Each
 * one names something the record actually measured, never a pat on the back.
 * Previously unlocked streak ids stay in the persisted unlocked set and are
 * simply no longer listed.
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_review', label: 'First review', description: 'Cleared your first review', check: (s) => s.reviews >= 1 },
  { id: 'reviews_25', label: '25 reviews', description: '25 reviews completed', check: (s) => s.reviews >= 25 },
  { id: 'reviews_100', label: '100 reviews', description: '100 total reviews completed', check: (s) => s.reviews >= 100 },
  { id: 'reviews_500', label: '500 reviews', description: '500 total reviews completed', check: (s) => s.reviews >= 500 },
  {
    id: 'sittings_8_in_30',
    label: 'Steady month',
    description: '8 or more sittings within 30 days',
    check: (s) => (s.adherence?.return?.sessions_30d ?? 0) >= 8,
  },
  {
    id: 'durable_30',
    label: 'A month-long memory',
    description: 'A concept now holds for 30 days or more',
    check: (s) => (s.momentum?.most_durable?.stability_days ?? 0) >= 30,
  },
  {
    id: 'topic_mastered',
    label: 'Topic mastered',
    description: 'Every node in a topic reached review state',
    check: (s) => s.topics.some((t) => t.states.new === 0 && t.states.learning === 0 && t.states.review > 0),
  },
]
