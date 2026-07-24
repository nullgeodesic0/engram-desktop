import { useEffect, useState } from 'react'
import type { EngramStats, TopicSummary, TopicGraph } from '../../../shared/types'
import { SkeletonBar, SkeletonGrid } from '../components/Skeleton'
import { emitPulse } from '../../../shared/neuralFieldBus'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { ACHIEVEMENTS, type AchievementDef } from '../../../shared/achievements'
import { AchievementToast } from '../components/AchievementToast'
import { InkNode } from '../components/ui/InkNode'
import { HealthRing } from '../components/ui/HealthRing'
import { DueForecast } from '../components/DueForecast'
import { DendriteDivider } from '../components/ui/DendriteDivider'
import { StatBlock } from '../components/ui/StatBlock'
import { Button } from '../components/ui/Button'

const LAST_SEEN_STREAK_KEY = 'engram-desktop:last-seen-streak-days'
const FLASHBACK_MIN_DAYS_AGO = 3

interface Flashback {
  daysAgo: number
  topic: string
  topicTitle: string
  node: string
  claim: string
}

function daysAgo(dateStr: string): number {
  const then = new Date(`${dateStr}T00:00:00Z`).getTime()
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((today - then) / 86_400_000)
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Still up'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

interface HomeViewProps {
  onGoReview: () => void
  onGoCoach: () => void
  onGoTopic: (topicId: string) => void
  onNewTopic: () => void
}

/** The app's actual landing screen — streak, what's due, and quick entry points —
 * replacing "always opens on Review" with something that answers "where am I"
 * before asking you to do anything. Also the natural click-through target for a
 * background review-due notification down the line. */
export function HomeView({ onGoReview, onGoCoach, onGoTopic, onNewTopic }: HomeViewProps) {
  const [stats, setStats] = useState<EngramStats | null>(null)
  const [topics, setTopics] = useState<TopicSummary[] | null>(null)
  const [flashback, setFlashback] = useState<Flashback | null>(null)
  const [toastQueue, setToastQueue] = useState<AchievementDef[]>([])
  const [forecast, setForecast] = useState<number[] | null>(null)

  useEffect(() => {
    window.engram.stats().then(async (s) => {
      setStats(s)
      // A genuinely new streak day, not just "streak_days > 0" on every visit —
      // localStorage is fine here (renderer-local, decorative, not app state).
      const lastSeen = Number(localStorage.getItem(LAST_SEEN_STREAK_KEY) ?? '0')
      if (s.streak_days > lastSeen) emitPulse('streak')
      localStorage.setItem(LAST_SEEN_STREAK_KEY, String(s.streak_days))

      // Achievements — evaluated here (Home already fetches stats on every visit,
      // the natural landing screen) against the persisted unlocked set; anything
      // newly crossed gets recorded and queued for a toast + a warm pulse.
      const unlocked = await window.engram.getUnlockedAchievements()
      const unlockedIds = new Set(unlocked.map((u) => u.id))
      const newlyUnlocked = ACHIEVEMENTS.filter((a) => !unlockedIds.has(a.id) && a.check(s))
      if (newlyUnlocked.length > 0) {
        await window.engram.recordUnlockedAchievements(newlyUnlocked.map((a) => a.id))
        setToastQueue(newlyUnlocked)
        emitPulse('streak')
      }
    })
    window.engram.topics().then(setTopics)

    // "On this day" — the most recent day with real activity that's old enough to
    // feel like a callback rather than "yesterday" (a strict exact-N-days-ago
    // anniversary would usually be empty this early in real usage).
    window.engram.receiptsHistory().then(async (history) => {
      const candidateDays = [...history.days].reverse().filter((d) => d.items.length > 0 && daysAgo(d.date) >= FLASHBACK_MIN_DAYS_AGO)
      const day = candidateDays[0]
      if (!day) return
      const item = day.items[Math.floor(Math.random() * day.items.length)]
      try {
        const graph = (await window.engram.topicGraph(item.topic)) as TopicGraph
        const node = graph.nodes[item.node]
        if (!node) return
        setFlashback({
          daysAgo: daysAgo(day.date),
          topic: item.topic,
          topicTitle: graph.title,
          node: item.node,
          claim: node.claim,
        })
      } catch {
        // Topic graph unreadable (deleted topic, etc.) — flashback just doesn't show.
      }
    })
  }, [])

  // 7-day due forecast, computed from the topic graphs' own fsrs.due dates
  // (the engine's `due` command has no future horizon; the graphs on disk do).
  useEffect(() => {
    window.engram.topics().then(async (ts) => {
      const buckets = new Array(7).fill(0) as number[]
      const today = new Date()
      const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      await Promise.all(
        ts.map(async (t) => {
          try {
            const g = (await window.engram.topicGraph(t.topic)) as {
              nodes?: Record<string, { state?: string; fsrs?: { due?: string | null } }>
            }
            if (!g?.nodes) return
            for (const node of Object.values(g.nodes)) {
              const due = node?.fsrs?.due
              if (typeof due !== 'string' || node?.state === 'new') continue
              const d = new Date(`${due}T00:00:00`)
              const diffDays = Math.floor((d.getTime() - dayStart.getTime()) / 86400000)
              const idx = Math.min(6, Math.max(0, diffDays))
              if (diffDays <= 6) buckets[idx] += 1
            }
          } catch {
            // A topic with an unreadable graph just doesn't contribute.
          }
        }),
      )
      setForecast(buckets)
    })
  }, [])

  const inProgress = topics?.filter((t) => t.states.new > 0 || t.states.learning > 0) ?? []

  return (
    <div className="p-8 flex flex-col gap-8 w-full h-full overflow-y-auto">
      <header>
        {stats ? (
          <>
            <h1 className="font-[var(--font-serif)] text-[length:var(--text-display)] text-[var(--color-text-primary)]">{greeting()}.</h1>
            <div className="grid grid-cols-2 gap-3 max-w-xs mt-3">
              <StatBlock
                label="Streak"
                value={String(stats.streak_days)}
                tone="warm"
                caption="Fig. 1 — days of uninterrupted recall"
              />
              <StatBlock
                label="Due now"
                value={String(stats.due_now)}
                tone="cool"
                caption="Fig. 2 — items awaiting free recall"
              />
            </div>
            {forecast ? (
              <div className="mt-3 max-w-xs">
                <DueForecast buckets={forecast} />
              </div>
            ) : (
              <div className="mt-3 max-w-xs flex flex-col gap-1.5">
                <SkeletonBar height={32} />
                <SkeletonBar width="40%" height={10} />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <SkeletonBar width={220} height={30} />
            <SkeletonBar width={160} height={14} />
          </div>
        )}
      </header>

      {flashback && (
        <div className="panel px-5 py-4 flex flex-col gap-1.5">
          <div className="text-xs label-data text-[var(--color-text-faint)] uppercase tracking-wide">
            {flashback.daysAgo} days ago · {flashback.topicTitle}
          </div>
          <DendriteDivider className="mb-3" />
          <p className="text-sm text-[var(--color-text-dim)]">{flashback.claim}</p>
          <div className="text-xs text-[var(--color-text-faint)] mt-0.5">{humanizeNodeId(flashback.node)}</div>
        </div>
      )}

      {stats && stats.due_now > 0 && (
        <Button
          variant="primary"
          onClick={onGoReview}
          className="!px-6 !py-5 w-full flex items-center justify-between text-left normal-case"
        >
          <div>
            <div className="text-base">Clear today’s reviews</div>
            <div className="text-xs opacity-80 mt-1">{stats.due_now} item(s) waiting — a couple of minutes each.</div>
          </div>
          <span className="text-lg">→</span>
        </Button>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-[var(--color-text-dim)] uppercase tracking-wide">Continue learning</h2>
        <DendriteDivider className="mb-3" />
        {topics === null && <SkeletonGrid count={3} />}
        {topics !== null && topics.length === 0 && (
          <div className="flex flex-col items-start gap-3 py-10">
            <div className="fig-caption">Fig. — an unmarked atlas</div>
            <div className="font-[var(--font-serif)] text-[length:var(--text-display)] text-[var(--color-text-primary)]">Begin your atlas</div>
            <p className="text-sm text-[var(--color-text-dim)] max-w-md">
              Engram teaches by making you produce, then verifies what stuck — free recall, honest grades, and a map that fills in as you learn.
            </p>
            <Button variant="primary" onClick={onNewTopic}>Start your first topic</Button>
          </div>
        )}
        {topics !== null && topics.length > 0 && inProgress.length === 0 && (
          <Button
            variant="ghost"
            onClick={onNewTopic}
            className="!px-5 !py-4 w-full flex items-center gap-3 hover:text-[var(--color-ink-warm)]"
          >
            <span className="text-lg leading-none">+</span>
            <span className="text-sm">Nothing in progress — start a new topic</span>
          </Button>
        )}
        <div className="grid grid-cols-3 gap-3">
          {inProgress.map((t) => (
            <button
              key={t.topic}
              onClick={() => onGoTopic(t.topic)}
              className="focus-ring panel text-left px-4 py-3 flex flex-col gap-2 hover:bg-[var(--color-surface-2)] hover:border-[var(--color-ink-warm-dim)] transition-colors duration-[var(--dur-base)]"
            >
              <div className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                <InkNode id={t.topic} variant={t.states.review > 0 ? 'filled' : 'outlined'} size={16} />
                <HealthRing
                  consolidated={t.states.review}
                  total={t.states.new + t.states.learning + t.states.review}
                  due={t.due}
                  size={18}
                />
                <span className="line-clamp-1">{t.title}</span>
              </div>
              <div className="flex gap-3 text-xs label-data">
                <span className="text-[var(--color-ink-warm)]">{t.states.review} review</span>
                <span className="text-[var(--color-ink-cool)]">{t.states.new} new</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {stats && (
        <div className="flex flex-col gap-0">
          <DendriteDivider className="mb-3" />
          <Button
            variant="ghost"
            onClick={onGoCoach}
            className="!px-5 !py-4 w-full flex items-center justify-between text-left"
          >
            <div className="text-sm">
              {stats.pending_verify > 0 ? `${stats.pending_verify} pending grading · ` : ''}
              {stats.misconceptions_open > 0 ? `${stats.misconceptions_open} open misconceptions` : 'Loop closure looking good'}
            </div>
            <span className="text-sm">Coach →</span>
          </Button>
        </div>
      )}

      {toastQueue[0] && (
        <AchievementToast achievement={toastQueue[0]} onDone={() => setToastQueue((q) => q.slice(1))} />
      )}
    </div>
  )
}
