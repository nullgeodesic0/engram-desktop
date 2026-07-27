import { useEffect, useState } from 'react'
import type { EngramStats, TopicSummary, TopicGraph, EnvironmentCheckResult, ActiveExperiment } from '../../../shared/types'
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
import { EnvironmentSteps } from '../components/EnvironmentSteps'
import { ExperimentBanner } from '../components/ExperimentBanner'
import { computeDueBuckets } from '../shared/dueBuckets'
import { recentViews, type RecentView } from '../shared/recentlyViewed'

const LAST_SEEN_STREAK_KEY = 'engram-desktop:last-seen-streak-days'
const LAST_SEEN_DUE_KEY = 'engram-desktop:last-seen-due-now'
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
  /** Deep-link targets for the "Recently viewed" row below — same
   * goToNode/goToSitting plumbing App.tsx already hands the Topic Map,
   * DashboardView, and the command palette. */
  onGoNode: (topicId: string, nodeId: string) => void
  onGoSitting: (sessionId: string) => void
}

/** The app's actual landing screen — streak, what's due, and quick entry points —
 * replacing "always opens on Review" with something that answers "where am I"
 * before asking you to do anything. Also the natural click-through target for a
 * background review-due notification down the line. */
export function HomeView({ onGoReview, onGoCoach, onGoTopic, onNewTopic, onGoNode, onGoSitting }: HomeViewProps) {
  const [stats, setStats] = useState<EngramStats | null>(null)
  // Snapshot at mount, not a subscription — this view fully remounts on every
  // visit to Home (see App.tsx's `view === 'home'` branch, not KeepMounted),
  // so a fresh localStorage read here already picks up anything recorded
  // while the user was elsewhere. See shared/recentlyViewed.ts.
  const [recent] = useState<RecentView[]>(() => recentViews())
  const [topics, setTopics] = useState<TopicSummary[] | null>(null)
  // Only consulted for the empty-topics guided card below — EnvironmentGate
  // already blocks the app on a broken environment, but its "Continue anyway"
  // escape hatch (or the environment breaking again later) can land you here
  // with topics still unmapped and Claude/the plugin still not resolvable.
  const [envCheck, setEnvCheck] = useState<EnvironmentCheckResult | null>(null)
  const [flashback, setFlashback] = useState<Flashback | null>(null)
  const [toastQueue, setToastQueue] = useState<AchievementDef[]>([])
  const [forecast, setForecast] = useState<number[] | null>(null)
  const [duePulse, setDuePulse] = useState(false)
  const [activeExperiment, setActiveExperiment] = useState<ActiveExperiment | null>(null)
  useEffect(() => {
    window.engram.stats().then(async (s) => {
      setStats(s)
      // stats.active_experiment is only ever the experiment's question string
      // (or null) — see engram.py's compute_stats. Gate the richer fetch
      // (started date, arms) on that so a fresh install with no experiment
      // ever run never pays a second subprocess call for this.
      if (typeof s.active_experiment === 'string' && s.active_experiment.length > 0) {
        window.engram.activeExperiment().then(setActiveExperiment)
      }
      // A genuinely new streak day, not just "streak_days > 0" on every visit —
      // localStorage is fine here (renderer-local, decorative, not app state).
      const lastSeen = Number(localStorage.getItem(LAST_SEEN_STREAK_KEY) ?? '0')
      if (s.streak_days > lastSeen) emitPulse('streak')
      localStorage.setItem(LAST_SEEN_STREAK_KEY, String(s.streak_days))

      // Due-now chip: single pulse only on a real increase since last seen —
      // never on a decrease (clearing reviews) and never on the very first
      // load ever (no stored value yet defaults to the current count, so
      // there's nothing to compare against).
      const lastSeenDue = Number(localStorage.getItem(LAST_SEEN_DUE_KEY) ?? String(s.due_now))
      if (s.due_now > lastSeenDue) setDuePulse(true)
      localStorage.setItem(LAST_SEEN_DUE_KEY, String(s.due_now))

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
    window.engram.environmentCheck().then(setEnvCheck)

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
  // (the engine's `due` command has no future horizon; the graphs on disk
  // do) — shared walk, see shared/dueBuckets.ts (also used by Review's
  // 14-day horizon; behavior here is unchanged, just extracted).
  useEffect(() => {
    computeDueBuckets(7).then(({ buckets }) => setForecast(buckets))
  }, [])

  const inProgress = topics?.filter((t) => t.states.new > 0 || t.states.learning > 0) ?? []
  const envBroken = envCheck !== null && !(envCheck.claudeOk && envCheck.pluginOk)

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
                pulse={duePulse}
                onPulseEnd={() => setDuePulse(false)}
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

      <ExperimentBanner experiment={activeExperiment} />

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
        {/* The empty-state decision itself (guided card vs. plain invitation) must wait on
            envCheck — topics() is a cheap readdir that routinely resolves before
            environmentCheck() finishes spawning `claude --version` (up to ~10s). Without this
            gate, a broken environment would flash the healthy "Begin your atlas" card first,
            and a click during that flash lands in a Learn session that's guaranteed to fail.
            Real topic data never waits on this — only these two empty-state branches do. */}
        {topics !== null && topics.length === 0 && envCheck === null && <SkeletonGrid count={3} />}
        {topics !== null && topics.length === 0 && envBroken && envCheck && (
          <div className="flex flex-col items-start gap-3 py-10 w-full max-w-lg">
            <div className="fig-caption">Fig. — setup needed before your first topic</div>
            <div className="font-[var(--font-serif)] text-[length:var(--text-display)] text-[var(--color-text-primary)]">
              Two things first.
            </div>
            <p className="text-sm text-[var(--color-text-dim)] max-w-md">
              Engram Desktop scripts the Claude Code CLI directly — both of these need to be in place before a topic
              can start.
            </p>
            <div className="w-full">
              <EnvironmentSteps result={envCheck} />
            </div>
            <Button variant="ghost" onClick={() => window.engram.environmentCheck().then(setEnvCheck)}>
              Check again
            </Button>
          </div>
        )}
        {topics !== null && topics.length === 0 && envCheck !== null && !envBroken && (
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

      {/* Quiet row of the last few nodes/sittings opened elsewhere in the app —
          hidden entirely when there's nothing yet (no empty chrome, same
          discipline as the rest of Home). See shared/recentlyViewed.ts;
          selecting one reuses the exact goToNode/goToSitting paths the Topic
          Map and the command palette already use. */}
      {recent.length > 0 && (
        <div className="flex flex-col gap-2">
          <DendriteDivider className="mb-1" />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] label-data uppercase tracking-wide text-[var(--color-text-faint)] shrink-0">
              Recently viewed
            </span>
            {recent.map((v) => (
              <button
                key={v.kind === 'node' ? `n:${v.topic}:${v.node}` : `s:${v.sessionId}`}
                onClick={() => (v.kind === 'node' ? onGoNode(v.topic, v.node) : onGoSitting(v.sessionId))}
                title={v.kind === 'node' ? `${v.label} — ${v.topicTitle}` : v.label}
                className="focus-ring flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-[var(--color-text-dim)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] transition-colors duration-[var(--dur-fast)]"
              >
                {v.kind === 'node' && <InkNode id={v.node} variant="outlined" color="var(--color-ink-cool)" size={10} />}
                <span className="truncate max-w-[9rem]">{v.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
              {stats.misconceptions_open > 0
                ? `${stats.misconceptions_open} noticed, filed for re-testing`
                : 'Nothing filed for re-testing'}
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
