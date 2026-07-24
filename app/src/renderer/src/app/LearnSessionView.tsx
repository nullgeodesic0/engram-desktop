import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionEvent } from '../../../shared/sessionEvents'
import type { BridgeAskRequest } from '../../../shared/bridgeProtocol'
import type { TopicSummary, SessionIndexEntry, ArtifactEntry, TopicGraph } from '../../../shared/types'
import { AskDialog } from '../components/AskDialog'
import { RateLimitBanner } from '../components/RateLimitBanner'
import { isBlockingRateLimitStatus } from '../../../shared/rateLimit'
import { ChatMessageView } from '../components/ChatMessageView'
import { MessageComposer } from '../components/MessageComposer'
import { JobsRail, type Job } from '../components/JobsRail'
import { TopicSettingsModal } from '../components/TopicSettingsModal'
import { NewTopicModal } from '../components/NewTopicModal'
import { ContextGauge } from '../components/ContextGauge'
import { BeatStepper, type BeatOutcome } from '../components/BeatStepper'
import { TypingIndicator } from '../components/TypingIndicator'
import { ChatScrollRegion } from '../components/ChatScrollRegion'
import { parseTranscriptToMessages, type ChatMessage } from '../../../shared/chatMessages'
import { extractLastUsageFromTranscript } from '../../../shared/sessionUsage'
import { latestBeatLabel } from '../../../shared/beatLabelParser'
import { extractBannerFromTranscript, extractLastWalkFromTranscript } from '../../../shared/bannerFromTranscript'
import { invalidateSearchIndex } from '../shared/searchIndex'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { emitPulse, setAmbientLevel } from '../../../shared/neuralFieldBus'
import { recordConfidence } from '../shared/calibrationStore'
import { SessionHistoryModal } from '../components/SessionHistoryModal'
import { parseGradeResults, type GradeResult } from '../../../shared/gradeResult'
import { MarkView, GradingShimmer, type RitualMark } from '../components/ritual/Marks'
import { ActionChips, type SuggestedAction } from '../components/ritual/ActionChips'
import { SessionOpenPlate, SessionCeremony } from '../components/ritual/Bookends'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { SkeletonBar } from '../components/Skeleton'
import { InkNode } from '../components/ui/InkNode'
import { HealthRing } from '../components/ui/HealthRing'
import { friendlyErrorText } from '../shared/friendlyError'
import { extractTicketFromMessages } from '../shared/ticketParser'
import { TicketCard } from '../components/ritual/TicketCard'
import { InkWell } from '../components/ritual/InkWell'
import { FlowChain } from '../components/ritual/FlowChain'
import { trailingRecalled } from '../../../shared/gradeResult'
import { paperSlide, warmTone } from '../shared/soundscape'

// NOT `rate` — confirmed live (spike/FINDINGS.md Finding 5.2) that /learn's VERIFY step
// stashes the production and only grades in a batch at session end via the assessor, so a
// `rate` call essentially never happens mid-session. `next --topic` is the call the skill
// actually makes at the start of every node (`python3 "$ENGRAM" next --topic <topic>`),
// making it the real node-boundary signal.
function looksLikeNextNodeCall(input: Record<string, unknown>): boolean {
  const command = String(input.command ?? '')
  return command.includes(' next ') && command.includes('--topic')
}

// `python3 "$ENGRAM" receipt --file <assessor-output.json>` (SKILL.md step 4) is
// the batch-grade call — the one place /learn's tool_result carries an ARRAY of
// per-node grade results (cmd_receipt in engram.py), unlike the single-item
// shape a bare `rate` call would return.
function looksLikeReceiptCall(input: Record<string, unknown>): boolean {
  const command = String(input.command ?? '')
  return command.includes('receipt') && command.includes('--file')
}

function looksLikeArtifactSet(input: Record<string, unknown>): string | null {
  const command = String(input.command ?? '')
  if (!command.includes('artifact set')) return null
  const m = command.match(/--path\s+"?([^"\s]+)"?/)
  return m ? m[1] : null
}

// Pretest (SKILL.md §2, new topics only) is the one place /learn calls `rate`
// directly rather than stash-then-batch-grade — `--kind pretest` is a real,
// distinct Tier-1 signal, not a guess. Returns the pretested node id, if any.
function looksLikePretestRate(input: Record<string, unknown>): string | null {
  const command = String(input.command ?? '')
  if (!command.includes(' rate ') || !command.includes('--kind pretest')) return null
  const m = command.match(/--node\s+"?([^"\s]+)"?/)
  return m ? m[1] : null
}

// Stash is the "production filed for later grading" moment (spike/FINDINGS.md
// Finding 5.2) — a Bash call containing `stash` that isn't actually the next/
// rate/receipt call (those also happen to run through Bash and could contain
// the literal substring in a path, so the exclusions matter more than they
// would for a narrower regex).
// `add-topic --file <tmp>` is the architect's curriculum-save moment — the one
// call that mints a topic. Its success output carries {ok, topic, nodes}.
function looksLikeAddTopicCall(input: Record<string, unknown>): boolean {
  const command = String(input.command ?? '')
  return command.includes('add-topic')
}

function looksLikeStashCall(input: Record<string, unknown>): boolean {
  const command = String(input.command ?? '')
  if (!/\bstash\b/.test(command)) return false
  if (looksLikeNextNodeCall(input)) return false
  if (looksLikeReceiptCall(input)) return false
  if (looksLikePretestRate(input)) return false
  return true
}

// Plain Omit<Union, K> collapses a discriminated union to its common fields
// (Pick over a union's keyof, not a per-member distribution) — this variant
// distributes over each member first so `kind: 'beat'` still requires `beat`
// while `kind: 'stamp'` doesn't.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

// The dialogue-grammar beats the app knows how to render/step through (mirrors
// BeatStepper's STEPS keys) — beat_outcome payloads naming anything else are ignored,
// since bridge:ui payloads are untrusted model output, not a validated internal call.
const KNOWN_BEATS = new Set(['open_gap', 'predict', 'struggle', 'resolve', 'self_explain', 'connect', 'verify'])
const KNOWN_OUTCOMES = new Set(['confirmed', 'partial', 'missed'])
const KNOWN_ACTION_KINDS = new Set(['open_explorable', 'show_on_map', 'go_review', 'prefill'])

function isArtifactSmithSpawn(input: Record<string, unknown>): boolean {
  const blob = JSON.stringify(input)
  return blob.includes('engram-artifact-smith')
}

/** The node id being taught isn't in the `next --topic` command itself — `next`
 * picks the node and returns it. `cmd_next` in engram.py `emit()`s
 * `{topic, id, node: {...}, ...}` (id is null only when the frontier is
 * empty), which is exactly what lands in this tool_use's tool_result content. */
function parseNextNodeId(content: unknown): string | null {
  const text = typeof content === 'string' ? content : null
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as { id?: unknown }
    return typeof parsed.id === 'string' ? parsed.id : null
  } catch {
    return null
  }
}

// window.engram.topicGraph returns Promise<unknown> (preload's IPC bridge has no
// compile-time guarantee of the disk-read shape) — a shape sanity check before the
// cast keeps a malformed/partial graph file from crashing the why-chain lookup below.
function looksLikeTopicGraph(v: unknown): v is TopicGraph {
  if (typeof v !== 'object' || v === null) return false
  const nodes = (v as { nodes?: unknown }).nodes
  // typeof null === 'object' — a malformed graph with `"nodes": null` must
  // fail here, not crash later at `topicGraphCache.nodes[...]`.
  return typeof nodes === 'object' && nodes !== null
}

function TopicCard({
  topic,
  resumable,
  onOpen,
  onSettings,
  onStartFresh,
}: {
  topic: TopicSummary
  resumable: boolean
  onOpen: () => void
  onSettings: () => void
  onStartFresh: () => void
}) {
  return (
    <div className="panel px-5 py-4 flex items-center justify-between gap-4 hover:bg-[var(--color-surface-2)] hover:border-[var(--color-ink-warm-dim)] transition-colors duration-[var(--dur-base)]">
      <HealthRing
        consolidated={topic.states.review}
        total={topic.states.new + topic.states.learning + topic.states.review}
        due={topic.due}
      />
      <button onClick={onOpen} className="focus-ring flex-1 min-w-0 text-left flex flex-col gap-1">
        <div className="text-sm text-[var(--color-text-primary)] flex items-center gap-2">
          {topic.title}
          {resumable && (
            <span className="label-data text-[10px] px-1.5 py-0.5 rounded text-[var(--color-ink-cool)] bg-[var(--color-surface-3)]">
              continuing
            </span>
          )}
        </div>
        <div className="text-xs text-[var(--color-text-faint)] line-clamp-1">{topic.goal}</div>
        <div className="flex gap-3 text-xs label-data mt-1">
          <span className="text-[var(--color-ink-warm)]">{topic.states.review} review</span>
          <span className="text-[var(--color-ink-cool)]">{topic.states.new} new</span>
          {topic.due > 0 && <span className="text-[var(--color-ink-danger)]">{topic.due} due</span>}
        </div>
      </button>
      {resumable && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onStartFresh()
          }}
          title="Abandon the in-progress session and start this topic over from scratch"
          className="focus-ring shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-faint)] hover:text-[var(--color-ink-warm)] hover:bg-[var(--color-surface-3)]"
        >
          ↻
        </button>
      )}
      <button
        onClick={onSettings}
        title="Topic settings"
        className="focus-ring shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)]"
      >
        ⚙
      </button>
    </div>
  )
}

/** Matches TopicCard's geometry (panel, HealthRing-sized leading circle, title +
 * goal + tag row) so the topic list doesn't jump in height once real data lands. */
function TopicListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="panel px-5 py-4 flex items-center gap-4">
          <SkeletonBar width={22} height={22} />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <SkeletonBar width="40%" height={14} />
            <SkeletonBar width="65%" height={10} />
            <SkeletonBar width="30%" height={10} />
          </div>
        </div>
      ))}
    </div>
  )
}

interface LearnSessionViewProps {
  /** Set by App.tsx when arriving via the Home screen or ⌘K command palette's
   * "Continue: <topic>" entry — opens that topic automatically once the topic
   * list has loaded, then clears itself via onDeepLinkConsumed. */
  deepLinkTopicId?: string | null
  onDeepLinkConsumed?: () => void
  /** Reports live-session state up to App.tsx so the sidebar nav can show an
   * ink-dot ("a session is alive in there") while this view isn't the active tab. */
  onActivity?: (a: { active: boolean; busy: boolean }) => void
  /** bridge:ui's spotlight_node forwarded up — App.tsx wires this to the map view in Task 6. */
  onSpotlight?: (s: { topicId: string; nodeId: string }) => void
  /** An action chip's go_review kind forwarded up — App.tsx wires this to setView('review') in Task 6. */
  onGoReview?: () => void
  /** Bumped by App.tsx (via the ⌘N menu item / 'learn:new-topic' deep link) to
   * pop the New Topic modal open — only the change matters, not the value. */
  openNewTopicSignal?: number
}

export function LearnSessionView({
  deepLinkTopicId,
  onDeepLinkConsumed,
  onActivity,
  onSpotlight,
  onGoReview,
  openNewTopicSignal,
}: LearnSessionViewProps = {}) {
  // Topic-list state
  const [topics, setTopics] = useState<TopicSummary[] | null>(null)
  const [settingsFor, setSettingsFor] = useState<TopicSummary | null>(null)
  const [newTopicOpen, setNewTopicOpen] = useState(false)
  // Which topics have a resumable session — shown as a hint on each TopicCard so opening
  // a topic's "continue vs. fresh start" behavior (see openTopic) isn't a surprise.
  const [resumableTopics, setResumableTopics] = useState<Set<string>>(new Set())

  // Session state
  const [activeTopic, setActiveTopic] = useState<TopicSummary | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [production, setProduction] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const [markdownPreview, setMarkdownPreview] = useState(false)
  const [askRequest, setAskRequest] = useState<BridgeAskRequest | null>(null)
  const [rateLimit, setRateLimit] = useState<{ status: string; resetsAt: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [contextUsage, setContextUsage] = useState<{ usedTokens: number; contextWindow: number } | null>(null)
  const [currentBeat, setCurrentBeat] = useState<string | null>(null)
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null)
  const [beatTrail, setBeatTrail] = useState<Map<string, BeatOutcome>>(new Map())
  const [nodePosition, setNodePosition] = useState<string | null>(null)
  const [sessionGrades, setSessionGrades] = useState<GradeResult[]>([])
  const [streakDays, setStreakDays] = useState<number | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<SessionIndexEntry[]>([])
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null)
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>([])
  const [marks, setMarks] = useState<RitualMark[]>([])
  const [gradingPending, setGradingPending] = useState(false)
  const [walkNumber, setWalkNumber] = useState<number | null>(null)
  const [commitment, setCommitment] = useState<string | null>(null)
  const [momentumOn, setMomentumOn] = useState(true)
  const [lastWalk, setLastWalk] = useState<{ graded: number; shaky: string[] } | null>(null)
  const [closedUnexpectedly, setClosedUnexpectedly] = useState(false)
  const [chamber, setChamber] = useState(false)
  // bridge:ui-driven ephemera (Task 5) — all reset in resetSessionEphemera.
  const [sessionPhase, setSessionPhase] = useState<string | null>(null)
  const [suggestedActions, setSuggestedActions] = useState<SuggestedAction[]>([])
  const [progressNote, setProgressNote] = useState<string | null>(null)
  // Lazily fetched + cached artifact list, used only to validate an open_explorable
  // chip's arg against a real artifact path before handing it to window.engram.openArtifact.
  const [knownArtifacts, setKnownArtifacts] = useState<ArtifactEntry[] | null>(null)
  // Fetched once per session open (openTopic/startFreshForTopic) — powers the "why?"
  // disclosure next to the node title. Cleared alongside the rest of the per-session
  // ephemera and on every node crossing (see crossToNode) so a stale graph from the
  // previous topic never backs a why-chain lookup for the new one.
  const [topicGraphCache, setTopicGraphCache] = useState<TopicGraph | null>(null)
  const [whyChainOpen, setWhyChainOpen] = useState(false)

  const pendingNextToolUseId = useRef<string | null>(null)
  const pendingReceiptToolUseId = useRef<string | null>(null)
  const nextCallsSeen = useRef(0)
  const sessionIdRef = useRef<string | null>(null)
  const messagesRef = useRef<ChatMessage[]>([])
  messagesRef.current = messages
  const markSeq = useRef(0)
  const pendingStashToolUseIds = useRef<Set<string>>(new Set())
  // Instructions/files given in the New Topic modal, awaiting the engine-minted
  // topic id (revealed by the session's first `next --topic <id>` call) so they
  // can persist as real TopicSettings for every future session.
  const pendingNewTopicSettings = useRef<{ systemPromptExtra: string; contextFiles: string[] } | null>(null)
  // The add-topic call being watched + the atlas mark it will resolve into.
  const pendingAddTopic = useRef<{ toolUseId: string; markId: string } | null>(null)
  const lastNodeIdRef = useRef<string | null>(null)
  const intentionalStopRef = useRef(false)
  // Mirrors currentBeat synchronously (unlike the state itself, which only
  // settles after a render) so onBridgeBeat can read "the beat we're leaving"
  // as a plain value in the handler body instead of reaching for it inside a
  // setState updater — see setBeat below.
  const currentBeatRef = useRef<string | null>(null)

  function pushMark(m: DistributiveOmit<RitualMark, 'id' | 'atIndex'>) {
    setMarks((prev) => [
      ...prev,
      { ...m, id: `mark-${markSeq.current++}`, atIndex: messagesRef.current.length } as RitualMark,
    ])
  }

  function setBeat(next: string | null) {
    currentBeatRef.current = next
    setCurrentBeat(next)
  }

  // Shared node-crossing logic: both the render_beat signal (onBridgeBeat,
  // reliable per the note below) and the Bash `next`-result inference can
  // observe a new node id, and whichever gets there first must reset the
  // per-node trail/position and log the crossing mark. lastNodeIdRef is the
  // single source of truth both paths read/write, so whichever one runs
  // second for the same nodeId sees lastNodeIdRef.current already equal to
  // it and no-ops instead of double-firing.
  function crossToNode(nodeId: string) {
    if (lastNodeIdRef.current !== null && lastNodeIdRef.current !== nodeId) {
      pushMark({ kind: 'crossing', nodeId })
      setBeatTrail(new Map())
      setNodePosition(null)
      setWhyChainOpen(false)
    }
    lastNodeIdRef.current = nodeId
    setCurrentNodeId(nodeId)
  }

  // The full set of per-session ephemera that must never leak from one topic/session
  // into the next — shared by backToTopics (leaving the session view entirely) and
  // openTopic's preamble (switching into a topic, whether resumed or fresh). Does NOT
  // include started/activeTopic/viewingHistoryId/refreshTopics — those vary by caller.
  function resetSessionEphemera() {
    setMessages([])
    setJobs([])
    setContextUsage(null)
    setBeat(null)
    setCurrentNodeId(null)
    setBeatTrail(new Map())
    setNodePosition(null)
    setSessionGrades([])
    setStreakDays(null)
    setAttachedFiles([])
    nextCallsSeen.current = 0
    setMarks([])
    setGradingPending(false)
    pendingStashToolUseIds.current.clear()
    pendingNewTopicSettings.current = null
    setLastWalk(null)
    pendingAddTopic.current = null
    lastNodeIdRef.current = null
    setWalkNumber(null)
    setCommitment(null)
    setClosedUnexpectedly(false)
    setChamber(false)
    setSessionPhase(null)
    setSuggestedActions([])
    setProgressNote(null)
    setTopicGraphCache(null)
    setWhyChainOpen(false)
    intentionalStopRef.current = false
    // NeuralField is app-global and this view stays mounted — a new session must not
    // inherit the previous topic's leftover warmth.
    setAmbientLevel(0)
  }

  function refreshTopics() {
    // The palette's search index caches topics/nodes/receipts/artifacts at
    // module scope — this is the one place a topic's node states (and thus
    // what the palette should show) actually change, so invalidate here
    // rather than on every view switch.
    invalidateSearchIndex()
    window.engram.topics().then((list) => {
      setTopics(list)
      Promise.all(list.map((t) => window.engram.lastSessionFor('learn', t.topic).then((id) => [t.topic, id] as const))).then(
        (pairs) => setResumableTopics(new Set(pairs.filter(([, id]) => id !== null).map(([topic]) => topic))),
      )
    })
  }

  useEffect(() => {
    refreshTopics()
    const offEvent = window.engram.onSessionEvent((sid, event) => {
      if (sid !== sessionIdRef.current) return
      handleSessionEvent(event)
    })
    const offAsk = window.engram.onBridgeAsk((req) => {
      if (req.sessionId !== sessionIdRef.current) return
      setAskRequest(req)
    })
    // The model reliably calls the render_beat MCP tool with the real current
    // beat (confirmed against a live transcript: 21/21 calls correctly
    // named) — a much more reliable signal than the text-regex fallback
    // below, which depends on the model also emitting a bolded **LABEL**
    // convention in its prose that it doesn't consistently follow. This was
    // fully plumbed end-to-end (mcpBridgeWorker -> bridgeServer -> bridge:beat
    // IPC -> preload's onBridgeBeat) but never actually consumed here — the
    // stepper was relying solely on the flaky regex path, which is why it
    // never lit up despite the model doing everything asked of it.
    const offBeat = window.engram.onBridgeBeat((req) => {
      if (req.sessionId !== sessionIdRef.current) return
      // The beat we're leaving joins the trail as 'visited' — unless Task 5's
      // bridge:ui outcome wiring already inked it 'confirmed'/'partial'/'missed',
      // in which case that richer signal must not be clobbered by the plain
      // "a step was taken" default.
      const prevBeat = currentBeatRef.current
      if (prevBeat && prevBeat !== req.beat) {
        setBeatTrail((trail) => {
          if (trail.has(prevBeat)) return trail
          const next = new Map(trail)
          next.set(prevBeat, 'visited')
          return next
        })
      }
      setBeat(req.beat)
      // render_beat's node id is at least as reliable as the Bash `next`-result
      // inference and can arrive first — run the same crossing logic here so
      // the trail/position don't lag a node behind currentNodeId.
      if (req.node) crossToNode(req.node)
      if (req.position) setNodePosition(req.position)
      pushMark({ kind: 'beat', beat: req.beat, content: req.content })
      if (req.beat === 'resolve') emitPulse('resolve')
    })
    // Generic tutor-driven UI signals (Task 5) — bridge:ui's payload is the MCP tool's
    // raw (zod-validated-at-the-worker, but untrusted-here) input, so every field is
    // typeof-checked before use and unknown tool names / malformed payloads are
    // silently ignored rather than throwing or rendering garbage.
    const offUi = window.engram.onBridgeUi((req) => {
      if (req.sessionId !== sessionIdRef.current) return
      if (typeof req.payload !== 'object' || req.payload === null) return
      const payload = req.payload
      switch (req.tool) {
        case 'session_phase': {
          if (typeof payload.phase !== 'string') return
          setSessionPhase(payload.phase)
          if (payload.phase === 'grading') setGradingPending(true)
          break
        }
        case 'beat_outcome': {
          if (typeof payload.beat !== 'string' || !KNOWN_BEATS.has(payload.beat)) return
          if (typeof payload.outcome !== 'string' || !KNOWN_OUTCOMES.has(payload.outcome)) return
          const beat = payload.beat
          const outcome = payload.outcome as BeatOutcome
          // outcome is always one of confirmed/partial/missed here (KNOWN_OUTCOMES excludes
          // 'visited'), so this always inks a richer signal than the plain "step taken"
          // default onBridgeBeat sets — never the other way around.
          setBeatTrail((trail) => {
            const next = new Map(trail)
            next.set(beat, outcome)
            return next
          })
          break
        }
        case 'show_figure': {
          if (typeof payload.body !== 'string') return
          const title = typeof payload.title === 'string' ? payload.title : null
          pushMark({ kind: 'figure', title, body: payload.body })
          break
        }
        case 'suggest_action': {
          if (!Array.isArray(payload.actions) || payload.actions.length > 3) return
          const actions: SuggestedAction[] = []
          for (const a of payload.actions) {
            if (typeof a !== 'object' || a === null) return
            const rec = a as Record<string, unknown>
            if (typeof rec.label !== 'string') return
            if (typeof rec.kind !== 'string' || !KNOWN_ACTION_KINDS.has(rec.kind)) return
            if (rec.arg !== undefined && typeof rec.arg !== 'string') return
            actions.push({ label: rec.label, kind: rec.kind as SuggestedAction['kind'], arg: rec.arg as string | undefined })
          }
          setSuggestedActions(actions)
          break
        }
        case 'progress_note': {
          if (typeof payload.text !== 'string') return
          setProgressNote(payload.text)
          break
        }
        case 'spotlight_node': {
          if (typeof payload.topic !== 'string' || typeof payload.node !== 'string') return
          onSpotlight?.({ topicId: payload.topic, nodeId: payload.node })
          break
        }
        default:
          break
      }
    })
    return () => {
      offEvent()
      offAsk()
      offBeat()
      offUi()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    onActivity?.({ active: started && sessionId != null, busy })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, sessionId, busy])

  useEffect(() => {
    if (!deepLinkTopicId || !topics) return
    if (started) {
      if (activeTopic?.topic === deepLinkTopicId) {
        // Already looking at this topic's session — nothing to do.
        onDeepLinkConsumed?.()
        return
      }
      // A DIFFERENT topic was requested while a session is active: park the
      // current session (it keeps running server-side, same as leaving via
      // "All topics") and switch. openTopic below re-resets ephemera, but
      // the explicit reset here also detaches the old session id so no
      // stray events land while the switch is in flight.
      const match = topics.find((t) => t.topic === deepLinkTopicId)
      if (!match) {
        onDeepLinkConsumed?.()
        return
      }
      sessionIdRef.current = null
      setSessionId(null)
      resetSessionEphemera()
      openTopic(match)
      onDeepLinkConsumed?.()
      return
    }
    const match = topics.find((t) => t.topic === deepLinkTopicId)
    if (match) {
      openTopic(match)
      onDeepLinkConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkTopicId, topics])

  // ⌘N / the menu bar's "New Topic" bumps openNewTopicSignal — pop the modal
  // open on change only, never on mount (a fresh signal of 0 must not fire this).
  // Baseline 0, NOT the incoming prop: a cold ⌘N mounts this view with the
  // signal already bumped to 1 (App batches setView + setNewTopicRequest), and
  // seeding the ref from the prop would swallow that very first request.
  const openNewTopicSignalRef = useRef(0)
  useEffect(() => {
    if (openNewTopicSignal !== undefined && openNewTopicSignal !== openNewTopicSignalRef.current) {
      setNewTopicOpen(true)
    }
    openNewTopicSignalRef.current = openNewTopicSignal ?? openNewTopicSignalRef.current
  }, [openNewTopicSignal])

  function handleSessionEvent(event: SessionEvent) {
    switch (event.type) {
      case 'text':
        // Append to the running assistant message if we're mid-turn (deltas arrive as
        // several small 'text' events); start a fresh bubble the moment the last message
        // was the user's — that's the actual turn boundary in a real conversation.
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.role === 'assistant') {
            const text = last.text + event.text
            // Best-effort fallback only: the bolded-label convention rarely
            // appears in real prose, so a null here means "no signal", not
            // "no beat" — never let it wipe what the reliable render_beat
            // MCP call (onBridgeBeat above) already set, or the stepper
            // grays out on the first text delta after every beat change.
            const label = latestBeatLabel(text)
            if (label) setBeat(label)
            return [...prev.slice(0, -1), { ...last, text }]
          }
          const label = latestBeatLabel(event.text)
          if (label) setBeat(label)
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', text: event.text }]
        })
        break
      case 'tool_use':
        if (event.name === 'Bash' && looksLikeNextNodeCall(event.input)) {
          pendingNextToolUseId.current = event.id
          // First sight of the engine-minted topic id: persist any settings
          // given in the New Topic modal as this topic's real TopicSettings.
          if (pendingNewTopicSettings.current) {
            const m = String((event.input as { command?: unknown }).command ?? '').match(/--topic\s+"?([^"\s]+)"?/)
            if (m) {
              const settings = pendingNewTopicSettings.current
              pendingNewTopicSettings.current = null
    setLastWalk(null)
    pendingAddTopic.current = null
              void window.engram.setTopicSettings(m[1], settings)
            }
          }
        }
        if (event.name === 'Bash' && looksLikeReceiptCall(event.input)) {
          pendingReceiptToolUseId.current = event.id
          setGradingPending(true)
        }
        if (event.name === 'Bash' && looksLikeStashCall(event.input)) {
          pendingStashToolUseIds.current.add(event.id)
        }
        if (event.name === 'Task' && JSON.stringify(event.input).includes('curriculum-architect')) {
          // The architect starts drawing long before add-topic saves — open the
          // "atlas being drawn" plate now so the wait itself is the show.
          if (!pendingAddTopic.current) {
            const markId = `mark-${markSeq.current++}`
            pendingAddTopic.current = { toolUseId: '', markId }
            setMarks((prev) => [...prev, { id: markId, atIndex: messagesRef.current.length, kind: 'atlas', topic: null }])
          }
        }
        if (event.name === 'Bash' && looksLikeAddTopicCall(event.input)) {
          if (pendingAddTopic.current) {
            // Reuse the mark the architect spawn opened; just watch this call's result.
            pendingAddTopic.current = { ...pendingAddTopic.current, toolUseId: event.id }
          } else {
            const markId = `mark-${markSeq.current++}`
            pendingAddTopic.current = { toolUseId: event.id, markId }
            setMarks((prev) => [...prev, { id: markId, atIndex: messagesRef.current.length, kind: 'atlas', topic: null }])
          }
        }
        if (event.name === 'Bash') {
          const path = looksLikeArtifactSet(event.input)
          if (path) {
            setJobs((prev) => {
              const idx = prev.findIndex((j) => j.status === 'running' && !j.artifactPath)
              if (idx === -1) return [...prev, { id: event.id, label: 'Explorable ready', status: 'done', artifactPath: path }]
              const copy = [...prev]
              copy[idx] = { ...copy[idx], status: 'done', artifactPath: path }
              return copy
            })
            emitPulse('synthesis') // a job just flipped to done — the explorable is ready
          }
        }
        if (event.name === 'Bash') {
          const pretestedNode = looksLikePretestRate(event.input)
          if (pretestedNode) {
            setJobs((prev) => [
              ...prev,
              { id: event.id, label: `Pretested: ${humanizeNodeId(pretestedNode)} ✓`, status: 'done', artifactPath: null },
            ])
            emitPulse('recalled') // a pretest rate call only ever fires on a solid answer (SKILL.md §2) — a real hit
          }
        }
        if (event.name === 'Task' && isArtifactSmithSpawn(event.input)) {
          setJobs((prev) => [...prev, { id: event.id, label: 'Building explorable…', status: 'running', artifactPath: null }])
        }
        break
      case 'tool_result':
        if (event.toolUseId === pendingNextToolUseId.current) {
          pendingNextToolUseId.current = null
          nextCallsSeen.current += 1
          const nodeId = parseNextNodeId(event.content)
          if (nodeId) {
            // If render_beat already reported this same node (it can arrive first),
            // lastNodeIdRef.current === nodeId here and crossToNode no-ops instead
            // of double-firing the crossing mark/trail reset.
            crossToNode(nodeId)
          }
          // The first `next` call starts node 1 of the session — nothing to roll over yet.
          // Every call after that means the previous node's VERIFY landed (stashed) and a
          // new one is starting, which is the real per-node boundary for /learn (see
          // spike/FINDINGS.md Finding 5.2 — /learn stashes-then-batch-grades, so a `rate`
          // call is not a reliable per-node signal the way it is for /review).
          if (nextCallsSeen.current > 1) {
            setBeat(null) // new node, fresh walk through the stepper — history stays intact
          }
        }
        if (pendingAddTopic.current && event.toolUseId === pendingAddTopic.current.toolUseId) {
          const { markId } = pendingAddTopic.current
          pendingAddTopic.current = null
          let topicSlug: string | null = null
          try {
            const parsed = JSON.parse(String(event.content)) as { ok?: unknown; topic?: unknown }
            if (parsed.ok === true && typeof parsed.topic === 'string') topicSlug = parsed.topic
          } catch {
            // Malformed/failed add-topic — the mark stays in its drawing state.
          }
          if (topicSlug && !event.isError) {
            const slug = topicSlug
            // The atlas is born: stage-draw it, and wake the masthead — the
            // topic now exists on disk even though this session began without one.
            setMarks((prev) => prev.map((k) => (k.id === markId ? { ...k, kind: 'atlas' as const, topic: slug } : k)))
            fetchTopicGraphCache(slug)
            refreshTopics()
            window.engram.topics().then((ts) => {
              const match = ts.find((t) => t.topic === slug)
              if (match) setActiveTopic(match)
            })
            window.engram
              .sessionHistoryFor('learn', slug)
              .then((h) => setWalkNumber(h.length + 1))
              .catch(() => setWalkNumber(null))
            // Any instructions/files from the New Topic modal persist as the
            // freshly-minted topic's settings (same as the next-call path).
            if (pendingNewTopicSettings.current) {
              const settings = pendingNewTopicSettings.current
              pendingNewTopicSettings.current = null
              void window.engram.setTopicSettings(slug, settings)
            }
          }
        }
        if (event.toolUseId === pendingReceiptToolUseId.current) {
          pendingReceiptToolUseId.current = null
          setGradingPending(false)
          const results = parseGradeResults(event.content)
          if (results.length > 0) {
            // A receipt just landed — the node's state (and the palette's
            // stale-cached view of it) has changed.
            invalidateSearchIndex()
            // One soft tone per receipt batch when at least one memory held —
            // never per-item (a six-card batch shouldn't chime six times).
            if (results.some((r) => r.grade === 'recalled')) warmTone()
            setSessionGrades((prev) => {
              const next = [...prev, ...results]
              const recalledCount = next.filter((r) => r.grade === 'recalled').length
              setAmbientLevel(Math.min(1, recalledCount / 6))
              return next
            })
            window.engram.stats().then((s) => setStreakDays(s.streak_days))
          }
        }
        if (pendingStashToolUseIds.current.has(event.toolUseId)) {
          pendingStashToolUseIds.current.delete(event.toolUseId)
          if (!event.isError) pushMark({ kind: 'stamp' })
        }
        setJobs((prev) =>
          prev.map((j) =>
            j.id === event.toolUseId && j.status === 'running'
              ? { ...j, status: event.isError ? 'failed' : j.status }
              : j,
          ),
        )
        break
      case 'rate_limit':
        setRateLimit(event.status === 'allowed' ? null : { status: event.status, resetsAt: event.resetsAt })
        break
      case 'usage':
        setContextUsage({ usedTokens: event.usedTokens, contextWindow: event.contextWindow })
        break
      case 'turn_ended':
        setBusy(false)
        if (event.isError && event.resultText) setError(event.resultText)
        break
      case 'closed':
        // This handler is subscribed once (see the []-deps effect below), so it
        // only ever sees the mount render's closure — never read state here,
        // only refs and functional setters.
        if (intentionalStopRef.current) {
          intentionalStopRef.current = false
          setBusy(false)
        } else if (sessionIdRef.current != null) {
          setClosedUnexpectedly(true)
          setBusy(false)
        }
        break
      case 'error':
        setError(event.message)
        break
    }
  }

  // Populates the sticky header the moment a topic is opened, ahead of the model's own
  // first `next`/`receipt` tool call — without this, currentNodeId/streakDays stay blank
  // until whatever turn happens to touch them, which can be many messages in on a resume.
  // Best-effort only: `next` and `stats` are read-only engram.py calls, but if either fails
  // the banner just stays blank until the live session's own signals populate it, same as
  // before this prefetch existed.
  // The return commitment ("cue → action") set via `engram:commit` lives on the
  // learner model, not the session — fetched once per session open rather than
  // per-topic, since it's a standing intention independent of which topic is active.
  function fetchCommitment() {
    window.engram
      .model()
      .then((m) => {
        const c = m.settings.commitment
        setCommitment(c ? `${c.cue} → ${c.action}` : null)
        // Same fetch carries the momentum opt-out — the inkwell is app-side
        // cosmetic, but the learner's "no momentum language" choice governs
        // it too (dialogue-grammar.md's opt-out, honored beyond the dialogue).
        setMomentumOn(m.settings.momentum !== 'off')
      })
      .catch(() => setCommitment(null))
  }

  // Fetched once per topic at session entry (not per-node) — the why-chain panel
  // reads from this cache rather than issuing a fresh IPC call on every node crossing.
  function fetchTopicGraphCache(topicId: string) {
    window.engram
      .topicGraph(topicId)
      .then((g) => setTopicGraphCache(looksLikeTopicGraph(g) ? g : null))
      .catch(() => setTopicGraphCache(null))
  }

  function prefetchBanner(topicId: string) {
    window.engram
      .nextNode(topicId)
      .then((r) => setCurrentNodeId(r.id))
      .catch(() => {})
    window.engram
      .stats()
      .then((s) => setStreakDays(s.streak_days))
      .catch(() => {})
  }

  // One call handles both cases: continues this topic's last session if one exists
  // (session:resume looks it up by topic id — see sessionIndex.ts), or starts fresh
  // if not. The message is safe to resend either way — the skill's own re-anchor
  // discipline always re-checks state from disk rather than trusting prior turns.
  async function openTopic(topic: TopicSummary) {
    setActiveTopic(topic)
    setStarted(true)
    resetSessionEphemera()
    prefetchBanner(topic.topic)
    fetchTopicGraphCache(topic.topic)
    window.engram
      .sessionHistoryFor('learn', topic.topic)
      .then((h) => setWalkNumber(h.length + 1))
      .catch(() => setWalkNumber(null))
    fetchCommitment()

    // Hydrate prior chat history BEFORE spawning — resumeSession continues the same
    // session id when one exists (see sessionIndex.ts), so its transcript file is the
    // right one to replay from. A brand-new topic has no prior id and starts empty.
    const priorId = await window.engram.lastSessionFor('learn', topic.topic)
    if (priorId) {
      const lines = await window.engram.getTranscript(priorId)
      const history = parseTranscriptToMessages(lines)
      setMessages(history)
      // Initialize the gauge from history immediately — otherwise it stays blank until
      // the next turn completes, even though a resumed session already has real usage.
      setContextUsage(extractLastUsageFromTranscript(lines))
      // Populate the loop banner INSTANTLY from the transcript's own record of
      // render_beat/beat_outcome calls — the same signals that drive it live —
      // instead of sitting gray until the tutor's next call. The prose-regex
      // fallback below only fires when the transcript carries no beat calls at
      // all (e.g. a session predating the bridge tools).
      const banner = extractBannerFromTranscript(lines)
      setLastWalk(extractLastWalkFromTranscript(lines))
      if (banner.beat) {
        setBeat(banner.beat)
        setBeatTrail(banner.trail)
        setNodePosition(banner.position)
        if (banner.node) {
          setCurrentNodeId(banner.node)
          // Prime the crossing ref too, so the first live render_beat for this
          // same node doesn't fire a spurious crossing mark / trail reset.
          lastNodeIdRef.current = banner.node
        }
      } else {
        const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')
        setBeat(lastAssistant ? latestBeatLabel(lastAssistant.text) : null)
      }
    } else {
      setMessages([])
      setContextUsage(null)
      setBeat(null)
    }
    // Resuming sends no kickoff turn (SessionManager skips it — the model already has
    // full context), so there's nothing to wait on: go straight to "ready for your input".
    // A fresh start still waits on the model's first response as before.
    setBusy(!priorId)

    const message = `Use the /engram:learn skill to continue the "${topic.title}" topic (topic id: "${topic.topic}") specifically — I've already picked it from the app's topic list, no need to ask which topic.`
    const { sessionId: sid } = await window.engram.resumeSession(message, 'learn', topic.topic)
    sessionIdRef.current = sid
    setSessionId(sid)
  }

  // Deliberately bypasses the resume-if-exists behavior in openTopic — for when you
  // want to abandon a topic's in-progress thread and begin that same topic over from
  // scratch, rather than continuing where you left off.
  async function startFreshForTopic(topic: TopicSummary) {
    setAmbientLevel(0) // new session entry point — same reasoning as openTopic above.
    setActiveTopic(topic)
    setStarted(true)
    setMessages([])
    setBeat(null)
    setBusy(true)
    setMarks([])
    setGradingPending(false)
    pendingStashToolUseIds.current.clear()
    pendingNewTopicSettings.current = null
    setLastWalk(null)
    pendingAddTopic.current = null
    lastNodeIdRef.current = null
    setTopicGraphCache(null)
    setWhyChainOpen(false)
    prefetchBanner(topic.topic)
    fetchTopicGraphCache(topic.topic)
    window.engram
      .sessionHistoryFor('learn', topic.topic)
      .then((h) => setWalkNumber(h.length + 1))
      .catch(() => setWalkNumber(null))
    fetchCommitment()
    const message = `Use the /engram:learn skill to start a fresh session on the "${topic.title}" topic (topic id: "${topic.topic}") — I've explicitly chosen to start over rather than continue any prior session on this topic.`
    const { sessionId: sid } = await window.engram.startSession(message, 'learn', topic.topic)
    sessionIdRef.current = sid
    setSessionId(sid)
  }

  async function startNewTopic(goal: string, systemPromptExtra = '', contextFiles: string[] = []) {
    setAmbientLevel(0) // new session entry point — same reasoning as openTopic above.
    setNewTopicOpen(false)
    setActiveTopic(null)
    setStarted(true)
    setBeat(null)
    setBusy(true)
    setMarks([])
    setGradingPending(false)
    pendingStashToolUseIds.current.clear()
    pendingNewTopicSettings.current = null
    setLastWalk(null)
    pendingAddTopic.current = null
    lastNodeIdRef.current = null
    setTopicGraphCache(null)
    setWhyChainOpen(false)
    fetchCommitment()
    // The topic id doesn't exist until the engine mints it, so these can't be
    // written as TopicSettings yet — they ride the kickoff message for THIS
    // session, and persist as the topic's settings the moment the first
    // `next --topic <id>` call reveals the id (see the tool_use handler).
    if (systemPromptExtra || contextFiles.length > 0) {
      pendingNewTopicSettings.current = { systemPromptExtra, contextFiles }
    } else {
      pendingNewTopicSettings.current = null
    setLastWalk(null)
    pendingAddTopic.current = null
    }
    let message = `Use the /engram:learn skill to start a brand new topic — I don't have an existing topic for this yet. What I want to learn: "${goal}". Please run the new-topic intake (asking about prior exposure and interests as usual) and build the curriculum.`
    if (systemPromptExtra) {
      message += `\n\nStanding instructions for this topic (treat like per-topic settings): ${systemPromptExtra}`
    }
    if (contextFiles.length > 0) {
      message += `\n\nContext files to Read and draw on while building the curriculum:\n${contextFiles.map((p) => `- ${p}`).join('\n')}`
    }
    const { sessionId: sid } = await window.engram.startSession(message, 'learn')
    sessionIdRef.current = sid
    setSessionId(sid)
  }

  function backToTopics() {
    setStarted(false)
    setSessionId(null)
    sessionIdRef.current = null
    setActiveTopic(null)
    setViewingHistoryId(null)
    // Deliberately not reset on tab switches — a live session keeping its ambient
    // warmth while hidden matches the sidebar-dot "session alive in the background"
    // metaphor. Only actually leaving the session (here) or starting a new one
    // (openTopic/startFreshForTopic/startNewTopic) clears it.
    resetSessionEphemera()
    refreshTopics()
  }

  async function attachFiles() {
    const picked = await window.engram.pickFiles()
    setAttachedFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  async function submitProduction() {
    if (!sessionId || !production.trim() || busy) return
    const text = production.trim()
    const files = attachedFiles
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text, attachments: files }])
    setBusy(true)
    setProduction('')
    setAttachedFiles([])
    setSuggestedActions([])
    // The model already has the Read tool allowlisted (see permissionConfig.ts) — naming
    // the paths here is enough for it to pull the content in itself, no upload needed.
    const sentText =
      files.length > 0
        ? `${text}\n\n[Attached files — read these for context: ${files.join(', ')}]`
        : text
    await window.engram.sendMessage(sessionId, sentText)
  }

  async function answerAsk(chosen: string[] | null) {
    if (!askRequest) return
    // Mirror the confidence pick locally before forwarding — best-effort, never
    // blocks the real answer even if the topic/node aren't known yet.
    if (askRequest.header === 'Confidence' && chosen && chosen[0] && activeTopic?.topic && currentNodeId) {
      const index = askRequest.options.findIndex((o) => o.label === chosen[0])
      recordConfidence(activeTopic.topic, currentNodeId, chosen[0], index >= 0 ? index : undefined)
    }
    await window.engram.answerBridgeQuestion(askRequest.requestId, { chosen })
    setAskRequest(null)
  }

  // Pulls a prior answer back into the composer to revise and send as a new follow-up —
  // the original bubble in history is never touched, so nothing about what was already
  // stashed/graded server-side is affected. Only offered on your own latest message (see
  // ChatMessageView's onEditResend prop usage below).
  function editResend(text: string, attachments: string[]) {
    if (busy) return
    setProduction(text)
    setAttachedFiles(attachments)
  }

  // Acting on a suggested action never sends anything by itself — prefill only fills the
  // composer, and every other kind is a navigation/reveal, not a submit. Chips always
  // clear after acting, matching "replaced by the next call or cleared on send" (worker
  // tool description) since a stale chip pointing at a now-irrelevant node/artifact is
  // worse than no chip.
  async function handleSuggestedAction(a: SuggestedAction) {
    setSuggestedActions([])
    if (a.kind === 'prefill') {
      setProduction(a.arg ?? '')
      return
    }
    if (a.kind === 'open_explorable') {
      if (!a.arg) return
      const jobPaths = jobs.map((j) => j.artifactPath).filter((p): p is string => p !== null)
      if (jobPaths.includes(a.arg)) {
        window.engram.openArtifact(a.arg)
        return
      }
      let list = knownArtifacts
      if (list === null) {
        list = await window.engram.artifactList().catch(() => [] as ArtifactEntry[])
        setKnownArtifacts(list)
      }
      if (list.some((e) => e.artifact === a.arg)) {
        window.engram.openArtifact(a.arg)
      }
      return
    }
    if (a.kind === 'show_on_map') {
      if (activeTopic && currentNodeId) onSpotlight?.({ topicId: activeTopic.topic, nodeId: currentNodeId })
      return
    }
    if (a.kind === 'go_review') {
      onGoReview?.()
    }
  }

  function stopSession() {
    if (!sessionId) return
    intentionalStopRef.current = true
    window.engram.abortSession(sessionId)
    setBusy(false)
  }

  async function openHistory() {
    if (!activeTopic) return
    const entries = await window.engram.sessionHistoryFor('learn', activeTopic.topic)
    setHistoryEntries(entries)
    setHistoryOpen(true)
  }

  async function selectHistoryEntry(id: string) {
    const lines = await window.engram.getTranscript(id)
    setHistoryMessages(parseTranscriptToMessages(lines))
    setViewingHistoryId(id)
    setHistoryOpen(false)
  }

  const rateLimitBlocking = rateLimit !== null && isBlockingRateLimitStatus(rateLimit.status)
  const lastUserMessageId = useMemo(() => [...messages].reverse().find((m) => m.role === 'user')?.id ?? null, [messages])
  const latestTicket = useMemo(() => extractTicketFromMessages(messages), [messages])
  // The ticket sliding onto the table gets its paper sound — once per session,
  // live only (not on history replay hydration, hence the started gate).
  const ticketSoundPlayed = useRef(false)
  useEffect(() => {
    if (latestTicket && started && !ticketSoundPlayed.current) {
      ticketSoundPlayed.current = true
      paperSlide()
    }
    if (!latestTicket) ticketSoundPlayed.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestTicket, started])
  const whyChain = useMemo(
    () => (currentNodeId && topicGraphCache ? topicGraphCache.nodes[currentNodeId]?.why_chain ?? [] : []),
    [currentNodeId, topicGraphCache],
  )

  return (
    // h-full from <main>'s flex-1 (see App.tsx); min-h-0 is required for the flex
    // children below to be allowed to shrink and scroll instead of growing forever.
    <div className="h-full min-h-0 flex flex-col p-8 gap-4 w-full">
      <header className="shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          {/* In a session, the topic IS the page — one serif title, no static
              "Learn" h1, no repeated title on the opening plate below. */}
          {started ? (
            <div className="flex items-baseline gap-3 min-w-0">
              <h1 className="font-[var(--font-serif)] text-xl text-[var(--color-text-primary)] truncate">
                {activeTopic ? activeTopic.title : 'New topic'}
              </h1>
              {walkNumber != null && (
                <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-text-faint)] shrink-0 uppercase">
                  walk {walkNumber}
                </span>
              )}
            </div>
          ) : (
            <h1 className="font-[var(--font-display)] text-2xl text-[var(--color-text-primary)]">Learn</h1>
          )}
          <div className="flex items-center gap-4">
            {started && momentumOn && <FlowChain chain={trailingRecalled(sessionGrades)} />}
            {started && momentumOn && sessionGrades.length > 0 && <InkWell results={sessionGrades} />}
            {started && contextUsage && (
              <ContextGauge usedTokens={contextUsage.usedTokens} contextWindow={contextUsage.contextWindow} />
            )}
            {started && activeTopic && (
              <button onClick={openHistory} className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]">
                History
              </button>
            )}
            {started && (
              <button
                onClick={backToTopics}
                title="Leave this session view (the session keeps running)"
                className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
              >
                ← All topics
              </button>
            )}
          </div>
        </div>
        {started && (
          <div key={currentNodeId ?? 'none'} className="flex items-center gap-2">
            {currentNodeId && (
              <span className="label-data text-xs text-[var(--color-ink-warm)] shrink-0">{humanizeNodeId(currentNodeId)}</span>
            )}
            {currentNodeId && whyChain.length > 0 && (
              <button
                onClick={() => setWhyChainOpen((v) => !v)}
                className="focus-ring shrink-0 text-xs text-[var(--color-text-faint)] hover:text-[var(--color-ink-cool)] transition-colors"
              >
                why?
              </button>
            )}
            {nodePosition && (
              <span className="label-data text-xs text-[var(--color-text-faint)] shrink-0">node {nodePosition}</span>
            )}
            <BeatStepper current={currentBeat} trail={beatTrail} />
            {progressNote && <span className="ml-auto fig-caption truncate min-w-0">{progressNote}</span>}
          </div>
        )}
        {started && whyChainOpen && whyChain.length > 0 && (
          <div className="panel px-4 py-3 flex flex-col gap-2">
            <div className="fig-caption">Fig. — why this is true</div>
            {whyChain.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <InkNode id={`why-${i}`} variant="outlined" color="var(--color-ink-cool)" size={10} />
                <span className="text-xs font-[var(--font-serif)] text-[var(--color-text-dim)]">{step}</span>
              </div>
            ))}
          </div>
        )}
      </header>

      {rateLimit && (
        <div className="shrink-0">
          <RateLimitBanner status={rateLimit.status} resetsAt={rateLimit.resetsAt} onRetry={() => setRateLimit(null)} />
        </div>
      )}
      {error && (() => {
        const fe = friendlyErrorText(error)
        return (
        <div className="shrink-0 panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)] flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div>{fe.headline}</div>
            {fe.detail && (
              <details className="mt-1 text-xs text-[var(--color-text-faint)]">
                <summary className="cursor-pointer">raw error</summary>
                <div className="mt-1">{fe.detail}</div>
              </details>
            )}
          </div>
          <Button variant="ghost" onClick={() => setError(null)} className="shrink-0 px-2 py-1">
            ×
          </Button>
        </div>
        )
      })()}

      {!started && (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
          {topics === null && (
            <>
              <div className="fig-caption">reading your topics…</div>
              <TopicListSkeleton />
            </>
          )}
          {topics !== null && topics.length === 0 && (
            <Card className="px-5 py-4 flex flex-col gap-3">
              <div className="fig-caption">Fig. — no territories mapped yet</div>
              <div className="font-[var(--font-serif)] text-[length:var(--text-display)] text-[var(--color-text-primary)]">Every topic starts as a first-principles map.</div>
            </Card>
          )}
          {topics?.map((t) => (
            <TopicCard
              key={t.topic}
              topic={t}
              resumable={resumableTopics.has(t.topic)}
              onOpen={() => openTopic(t)}
              onSettings={() => setSettingsFor(t)}
              onStartFresh={() => startFreshForTopic(t)}
            />
          ))}

          <Button
            variant="primary"
            onClick={() => setNewTopicOpen(true)}
            disabled={rateLimitBlocking}
            className="w-full flex items-center gap-3"
          >
            <span className="text-lg leading-none">+</span>
            <span className="text-sm">Start a new topic</span>
          </Button>
        </div>
      )}

      {started && viewingHistoryId && (
        <div className="flex-1 min-h-0 flex flex-col gap-4">
          <div className="shrink-0 panel border-[var(--color-ink-cool-dim)] px-4 py-2.5 flex items-center justify-between">
            <span className="text-xs text-[var(--color-ink-cool)]">Viewing a past session, read-only</span>
            <button onClick={() => setViewingHistoryId(null)} className="focus-ring text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]">
              ← Back to current
            </button>
          </div>
          <ChatScrollRegion deps={[historyMessages]}>
            <div className="transcript-measure flex flex-col gap-5">
              {historyMessages.map((m) => (
                <ChatMessageView key={m.id} message={m} />
              ))}
            </div>
          </ChatScrollRegion>
        </div>
      )}

      {started && !viewingHistoryId && (
        <div className="flex-1 min-h-0 flex flex-col gap-4">
          {latestTicket && (
            <div className="shrink-0 max-w-sm">
              <TicketCard ticket={latestTicket} walkNumber={walkNumber} compact />
            </div>
          )}
          {sessionGrades.length > 0 && (
            <div className="shrink-0">
              <SessionCeremony
                results={sessionGrades}
                streakDays={streakDays}
                commitment={commitment}
                heading="The walk, recorded"
                label="graded"
              />
            </div>
          )}

          <div className="shrink-0">
            <JobsRail jobs={jobs} onOpenArtifact={(p) => window.engram.openArtifact(p)} />
          </div>

          {/* The only scrolling region in the session view — header and input stay anchored. */}
          {/* Must be a flex column: ChatScrollRegion sizes itself with
              flex-1/min-h-0 and loses its height bound (killing scrolling)
              inside a plain block wrapper. */}
          <div className={`flex-1 min-h-0 flex flex-col${chamber ? ' chamber-blur' : ''}`}>
            <ChatScrollRegion deps={[messages, busy]}>
              <div className="transcript-measure flex flex-col gap-5">
                {activeTopic != null && sessionPhase !== 'intake' && (
                  <SessionOpenPlate walkNumber={walkNumber} date={new Date()} recap={lastWalk} />
                )}
                {marks.filter((k) => k.atIndex === 0).map((k) => (
                  <MarkView key={k.id} mark={k} />
                ))}
                {messages.map((m, i) => (
                  <Fragment key={m.id}>
                    <ChatMessageView
                      message={m}
                      onEditResend={m.role === 'user' && m.id === lastUserMessageId && !busy ? editResend : undefined}
                    />
                    {marks
                      .filter((k) => k.atIndex === i + 1 || (i === messages.length - 1 && k.atIndex > messages.length))
                      .map((k) => (
                        <MarkView key={k.id} mark={k} />
                      ))}
                  </Fragment>
                ))}
                {busy && (
                  <div className="flex items-center gap-2">
                    {gradingPending ? <GradingShimmer /> : <TypingIndicator />}
                    <button
                      onClick={stopSession}
                      className="focus-ring text-xs px-2.5 py-1 rounded-lg text-[var(--color-text-faint)] hover:text-[var(--color-ink-danger)] hover:bg-[var(--color-surface-3)]"
                    >
                      Stop
                    </button>
                  </div>
                )}
              </div>
            </ChatScrollRegion>
          </div>

          {closedUnexpectedly && (
            <div className="shrink-0 panel border-[var(--color-ink-danger-dim)] px-4 py-3 flex items-center justify-between gap-3 text-sm text-[var(--color-ink-danger)]">
              <span>The session process ended unexpectedly. Your progress is stashed on disk — safe to reopen.</span>
              <Button variant="ghost" onClick={() => activeTopic && openTopic(activeTopic)}>
                Resume session
              </Button>
            </div>
          )}

          {!busy && suggestedActions.length > 0 && (
            <div className="shrink-0">
              <ActionChips actions={suggestedActions} onAct={handleSuggestedAction} />
            </div>
          )}

          {!busy && (
            <MessageComposer
              production={production}
              onProductionChange={setProduction}
              attachedFiles={attachedFiles}
              onRemoveAttachment={(path) => setAttachedFiles((prev) => prev.filter((p) => p !== path))}
              onAttach={attachFiles}
              markdownPreview={markdownPreview}
              onToggleMarkdownPreview={() => setMarkdownPreview((v) => !v)}
              onSubmit={submitProduction}
              chamber={chamber}
              onChamberChange={setChamber}
              inviteChamber={currentBeat === 'verify'}
            />
          )}
        </div>
      )}

      {askRequest && <AskDialog request={askRequest} onAnswer={answerAsk} />}
      {historyOpen && (
        <SessionHistoryModal
          entries={historyEntries}
          currentSessionId={sessionId}
          onSelect={selectHistoryEntry}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {settingsFor && (
        <TopicSettingsModal topicId={settingsFor.topic} topicTitle={settingsFor.title} onClose={() => setSettingsFor(null)} />
      )}
      {newTopicOpen && <NewTopicModal onClose={() => setNewTopicOpen(false)} onStart={startNewTopic} />}
    </div>
  )
}
