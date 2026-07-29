import { useEffect, useState } from 'react'
import type { EngramStats, TopicListEntry, TopicGraph, EnvironmentCheckResult, ActiveExperiment } from '../../../shared/types'
import { SkeletonBar, SkeletonGrid } from '../components/Skeleton'
import { emitPulse } from '../../../shared/neuralFieldBus'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { ACHIEVEMENTS, type AchievementDef } from '../../../shared/achievements'
import { AchievementToast } from '../components/AchievementToast'
import { InkNode } from '../components/ui/InkNode'
import { TopicCard } from '../components/TopicCard'
import { topicBucket } from '../shared/topicShelf'
import { DueForecast } from '../components/DueForecast'
import { DendriteDivider } from '../components/ui/DendriteDivider'
import { StatBlock } from '../components/ui/StatBlock'
import { StatFraction } from '../components/ui/StatFraction'
import { PlateFigure } from '../components/ui/PlateFigure'
import { SectionBanner } from '../components/ui/SectionBanner'
import { Button } from '../components/ui/Button'
import { EnvironmentSteps } from '../components/EnvironmentSteps'
import { ExperimentBanner } from '../components/ExperimentBanner'
import { computeDueBuckets } from '../shared/dueBuckets'
import { recentViews, type RecentView } from '../shared/recentlyViewed'

const LAST_SEEN_STREAK_KEY = 'engram-desktop:last-seen-streak-days'
const LAST_SEEN_DUE_KEY = 'engram-desktop:last-seen-due-now'
const FLASHBACK_MIN_DAYS_AGO = 3
/**
 * A flashback prints a node's canonical `claim` — the exact text `/review`
 * reveals only AFTER the learner has produced an answer and it has been
 * graded (review SKILL.md §2: "Show the probe only … Reveal: canonical
 * `claim`"). Printing it unprompted on the landing screen for a node whose
 * next retrieval is imminent converts that retrieval into recognition: the
 * learner reads the answer here, clicks "Clear today's reviews", produces it
 * minutes later, and the receipt records a memory that was really reading.
 * That is the one thing the blind assessor cannot detect, and it inflates
 * the schedule the learner is trusting with their memory.
 *
 * So a candidate is eligible only if its own `fsrs.due` sits further out
 * than this window (or it carries no scheduled retrieval at all). Measured
 * on real data at the time this gate was added: 45 of 76 eligible-by-age
 * flashback candidates were for nodes due within 7 days, several already
 * overdue. See .superpowers/sdd/doctrine-audit.md (V-1).
 */
const FLASHBACK_SAFE_DUE_DAYS = 7
/** Bound on how many past items the eligibility walk will inspect before
 * giving up and showing no flashback — the card is decoration; it never
 * costs an unbounded number of graph reads to find one. */
const FLASHBACK_MAX_PROBES = 40

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

/**
 * True when a node's canonical claim may be printed on Home — i.e. its next
 * scheduled retrieval is far enough out (or absent) that reading the answer
 * here cannot contaminate it. Local-calendar arithmetic on engram.py's own
 * local `YYYY-MM-DD` due string (getFullYear/Month/Date, never toISOString —
 * same discipline as shared/dueBuckets.ts). A malformed date fails CLOSED:
 * unknown due means not safe.
 */
function safeToReveal(due: string | null): boolean {
  if (!due) return true // never scheduled — nothing to contaminate
  const d = new Date(`${due}T00:00:00`)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysUntilDue = Math.floor((d.getTime() - dayStart.getTime()) / 86_400_000)
  return daysUntilDue > FLASHBACK_SAFE_DUE_DAYS
}

/** Fisher-Yates copy — the flashback picks at random among eligible items,
 * and the gate above means several may have to be tried before one lands. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Still up'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** A group of topic tiles under a small subheading — hidden entirely (no
 * heading, no empty grid) when the bucket is empty, same discipline as the
 * rest of Home. */
function TopicGroup({
  heading,
  caption,
  topics,
  onGoTopic,
  resumableTopics,
}: {
  heading: string
  caption?: string
  topics: TopicListEntry[]
  onGoTopic: (topicId: string) => void
  /** Which of THESE topics has an in-progress Learn session — passed only by
   * the "Continue learning" call below; the Consolidated/Not started groups
   * never resolve resumability for their own topics, so they always render
   * plain (see the `.dogear` scarcity doctrine in index.css: it marks "the
   * one you're in", not every card in a list). */
  resumableTopics?: Set<string>
}) {
  if (topics.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] label-data uppercase tracking-wide text-[var(--color-text-faint)]">{heading}</span>
        {caption && <span className="text-xs text-[var(--color-text-faint)]">{caption}</span>}
      </div>
      <div className="grid grid-cols-1 min-[760px]:grid-cols-2 min-[1080px]:grid-cols-3 gap-3">
        {topics.map((t) => (
          <TopicCard
            key={t.topic}
            variant="tile"
            topic={t}
            onOpen={() => onGoTopic(t.topic)}
            resumable={resumableTopics?.has(t.topic)}
          />
        ))}
      </div>
    </div>
  )
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
  const [topics, setTopics] = useState<TopicListEntry[] | null>(null)
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
  // Which "Continue learning" topic actually has an in-progress Learn
  // session — the one card in that group that earns `.dogear` ("the one
  // you're in"). Same `lastSessionFor('learn', …)` probe LearnSessionView's
  // own `refreshTopics` uses, just scoped to the active bucket rather than
  // every topic (this is decoration, not the shelf's own resume affordance).
  const [resumableTopics, setResumableTopics] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!topics) return
    const active = topics.filter((t) => topicBucket(t) === 'active')
    if (active.length === 0) {
      setResumableTopics(new Set())
      return
    }
    let cancelled = false
    Promise.all(
      active.map((t) => window.engram.lastSessionFor('learn', t.topic).then((id) => [t.topic, id] as const)),
    ).then((pairs) => {
      if (cancelled) return
      setResumableTopics(new Set(pairs.filter(([, id]) => id !== null).map(([topic]) => topic)))
    })
    return () => {
      cancelled = true
    }
  }, [topics])
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
      // One graph read per topic, reused across candidates — the walk below can
      // touch several items before finding one whose answer is safe to print.
      const graphCache = new Map<string, TopicGraph | null>()
      const graphFor = async (topic: string): Promise<TopicGraph | null> => {
        if (graphCache.has(topic)) return graphCache.get(topic) ?? null
        let g: TopicGraph | null = null
        try {
          g = (await window.engram.topicGraph(topic)) as TopicGraph
        } catch {
          // Topic graph unreadable (deleted topic, etc.) — that topic just
          // can't supply a flashback.
        }
        graphCache.set(topic, g)
        return g
      }

      let probes = 0
      for (const day of candidateDays) {
        for (const item of shuffled(day.items)) {
          if (probes++ >= FLASHBACK_MAX_PROBES) return
          const graph = await graphFor(item.topic)
          const node = graph?.nodes[item.node]
          if (!graph || !node) continue
          // The doctrine gate — see FLASHBACK_SAFE_DUE_DAYS. A node with a
          // retrieval coming up keeps its answer to itself.
          if (!safeToReveal(node.fsrs?.due ?? null)) continue
          setFlashback({
            daysAgo: daysAgo(day.date),
            topic: item.topic,
            topicTitle: graph.title,
            node: item.node,
            claim: node.claim,
          })
          return
        }
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

  // See topicBucket()'s doc comment — these three groups partition `topics`
  // exhaustively, so a topic is never dropped and never double-counted.
  const active = topics?.filter((t) => topicBucket(t) === 'active') ?? []
  const consolidated = topics?.filter((t) => topicBucket(t) === 'consolidated') ?? []
  const notStarted = topics?.filter((t) => topicBucket(t) === 'notStarted') ?? []
  const envBroken = envCheck !== null && !(envCheck.claudeOk && envCheck.pluginOk)

  return (
    <div className="p-8 flex flex-col gap-8 w-full h-full overflow-y-auto">
      {/* Register 1 — status band: the greeting IS the page title (the app's
          one display-size text; every section heading below is the
          `label-data` uppercase idiom instead), a one-line subtitle, the
          streak/due-now/forecast readout composed as one horizontal band,
          and the review CTA. */}
      <div className="flex flex-col gap-4">
        <header>
          {stats ? (
            <>
              <h1 className="font-(family-name:--font-serif) text-[length:var(--text-display)] text-[var(--color-text-primary)]">{greeting()}.</h1>
              {topics !== null && (
                <p className="text-sm text-[var(--color-text-dim)] mt-1">
                  {topics.length} {topics.length === 1 ? 'topic' : 'topics'} in your atlas
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <SkeletonBar width={220} height={30} />
              <SkeletonBar width={160} height={14} />
            </div>
          )}
        </header>

        {/* The due briefing plate — Home's own ready-room (the anatomy the
            Review plate established, via the shared PlateFigure): the due-now
            count as THE figure, the old CTA sub-line re-set as its note, the
            old Due-now StatBlock's caption kept as the fig-caption, and the
            review CTA as the plate's action row. The one-shot pulse (real
            count increases only — see the localStorage tracking above) now
            lands on the figure itself. */}
        {stats && (
          <div className="tilt-card panel px-6 py-5 flex flex-col gap-4">
            <PlateFigure
              value={stats.due_now}
              tone={stats.due_now > 0 ? 'warm' : 'dim'}
              title={stats.due_now > 0 ? 'due for recall now' : 'nothing due right now'}
              note={stats.due_now > 0 ? 'a couple of minutes each' : undefined}
              pulse={duePulse}
              onPulseEnd={() => setDuePulse(false)}
            />
            <div className="fig-caption">Fig. — items awaiting free recall</div>
            {stats.due_now > 0 && (
              <div className="flex gap-3 items-center">
                <Button variant="primary" size="lg" onClick={onGoReview}>
                  Clear today’s reviews
                </Button>
              </div>
            )}
          </div>
        )}

        {stats && (
          <div className="flex items-stretch gap-3 flex-wrap">
            <StatBlock
              label="Streak"
              value={String(stats.streak_days)}
              tone="warm"
              caption="Fig. — days of uninterrupted recall"
            />
            <div className="panel tilt-card p-3 flex-1 min-w-[180px] flex flex-col justify-center">
              {forecast ? (
                <DueForecast buckets={forecast} />
              ) : (
                <div className="flex flex-col gap-1.5">
                  <SkeletonBar height={32} />
                  <SkeletonBar width="40%" height={10} />
                </div>
              )}
            </div>
          </div>
        )}

        <ExperimentBanner experiment={activeExperiment} />

        {flashback && (
          <div className="panel tilt-card px-5 py-4 flex flex-col gap-1.5">
            <SectionBanner label={`${flashback.daysAgo} days ago · ${flashback.topicTitle}`} className="border-t-0" />
            <DendriteDivider className="mb-3" />
            <p className="text-sm text-[var(--color-text-dim)]">{flashback.claim}</p>
            <div className="text-xs text-[var(--color-text-faint)] mt-0.5">{humanizeNodeId(flashback.node)}</div>
          </div>
        )}

      </div>

      <DendriteDivider />

      {/* Register 2 — library: the topic groups, on a responsive grid (one
          column narrow, two past 760px — the app's one narrow threshold —
          three past 1080px). */}
      <section className="flex flex-col gap-3">
        <SectionBanner
          label="Your topics"
          count={topics !== null ? <StatFraction n={active.length} d={topics.length} /> : undefined}
        />
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
            <div className="font-(family-name:--font-serif) text-[length:var(--text-display)] text-[var(--color-text-primary)]">
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
            <div className="font-(family-name:--font-serif) text-[length:var(--text-display)] text-[var(--color-text-primary)]">Begin your atlas</div>
            <p className="text-sm text-[var(--color-text-dim)] max-w-md">
              Engram teaches by making you produce, then verifies what stuck — free recall, honest grades, and a map that fills in as you learn.
            </p>
            <Button variant="primary" onClick={onNewTopic}>Start your first topic</Button>
          </div>
        )}
        {/* active/consolidated/notStarted partition `topics` exhaustively (see
            topicBucket()), so whenever topics.length > 0 at least one of the
            three groups below is non-empty — there is no remaining case where
            a real topic exists but nothing renders. The old "Nothing in
            progress — start a new topic" fallback lived here for exactly that
            gap: it read `inProgress.length === 0`, which was true both when
            there were genuinely no topics AND when every topic was all-review.
            Grouping instead of filtering closes that gap structurally rather
            than by special-casing review, so the fallback has no case left to
            catch and is gone — a fully-encoded-only library now shows its
            "Consolidated" group instead of a false "start a new topic" nudge. */}
        <div className="flex flex-col gap-6">
          <TopicGroup heading="Continue learning" topics={active} onGoTopic={onGoTopic} resumableTopics={resumableTopics} />
          <TopicGroup
            heading="Consolidated"
            caption="fully encoded — held by review alone"
            topics={consolidated}
            onGoTopic={onGoTopic}
          />
          <TopicGroup heading="Not started" topics={notStarted} onGoTopic={onGoTopic} />
        </div>
      </section>

      {/* Register 3 — trails: quietest register, the last few nodes/sittings
          opened elsewhere in the app and the coach summary row. Only rendered
          at all (divider included) when there's at least one of the two —
          same "no empty chrome" discipline as the rest of Home. */}
      {(recent.length > 0 || stats) && (
        <>
          <DendriteDivider />
          <div className="flex flex-col gap-6">
            {/* Hidden entirely when there's nothing yet. See
                shared/recentlyViewed.ts; selecting one reuses the exact
                goToNode/goToSitting paths the Topic Map and the command
                palette already use. */}
            {recent.length > 0 && (
              <div className="flex flex-col gap-2">
                <SectionBanner label="Recently viewed" count={recent.length} />
                <div className="flex items-center gap-2 flex-wrap">
                  {recent.map((v) => (
                    <button
                      key={v.kind === 'node' ? `n:${v.topic}:${v.node}` : `s:${v.sessionId}`}
                      onClick={() => (v.kind === 'node' ? onGoNode(v.topic, v.node) : onGoSitting(v.sessionId))}
                      title={v.kind === 'node' ? `${v.label} — ${v.topicTitle}` : v.label}
                      className="focus-ring flex items-center gap-1.5 px-2.5 py-1 text-xs text-[var(--color-text-dim)] bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)] hover:text-[var(--color-text-primary)] transition-colors duration-[var(--dur-fast)]"
                    >
                      {v.kind === 'node' && <InkNode id={v.node} variant="outlined" color="var(--color-ink-cool)" size={10} />}
                      <span className="truncate max-w-[9rem]">{v.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {stats && (
              <Button
                variant="ghost"
                size="lg"
                onClick={onGoCoach}
                className="tilt-card w-full flex items-center justify-between text-left"
              >
                <div className="text-sm">
                  {stats.pending_verify > 0 ? `${stats.pending_verify} pending grading · ` : ''}
                  {stats.misconceptions_open > 0
                    ? `${stats.misconceptions_open} noticed, filed for re-testing`
                    : 'Nothing filed for re-testing'}
                </div>
                <span className="text-sm">Coach →</span>
              </Button>
            )}
          </div>
        </>
      )}

      {toastQueue[0] && (
        <AchievementToast achievement={toastQueue[0]} onDone={() => setToastQueue((q) => q.slice(1))} />
      )}
    </div>
  )
}
