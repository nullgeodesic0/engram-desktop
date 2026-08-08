import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionEvent } from '../../../shared/sessionEvents'
import type {
  TopicListEntry,
  ArtifactEntry,
  TopicGraph,
  ExportSittingFormat,
  EnvironmentCheckResult,
  NewTopicPrefill,
} from '../../../shared/types'
import { RateLimitBanner } from '../components/RateLimitBanner'
import { isBlockingRateLimitStatus } from '../../../shared/rateLimit'
import { ChatMessageView } from '../components/ChatMessageView'
import { MathRenderer } from '../components/MathRenderer'
import { MessageComposer } from '../components/MessageComposer'
import { JobsRail, type Job } from '../components/JobsRail'
import { TopicSettingsModal } from '../components/TopicSettingsModal'
import { NewTopicModal } from '../components/NewTopicModal'
import { ContextGauge } from '../components/ContextGauge'
import { SittingClock } from '../components/SittingClock'
import { BeatStepper, type BeatOutcome } from '../components/BeatStepper'
import { ActivityLine } from '../components/ActivityLine'
import { ChatScrollRegion } from '../components/ChatScrollRegion'
import { useEquationCopy } from '../components/useEquationCopy'
import { useNodeChipClick } from '../components/useNodeChipClick'
import { TranscriptMinimap } from '../components/TranscriptMinimap'
import { deriveInstrumentMoments, type InstrumentMoment } from '../shared/instrumentMoments'
import { jumpToCheckpoint } from '../shared/jumpToCheckpoint'
import { decideModalPrefillOnOpenSignal } from '../shared/newTopicPrefillFlow'
import { allProbeHeaders } from '../../../shared/reviewCrossing'
import { endsWithBareProbeHeader, mergeAssistantText } from '../../../shared/probeHeader'
import { useTutorActivity, composerDisabledReason } from '../shared/tutorActivity'
import { parseTranscriptToMessages, type ChatMessage } from '../../../shared/chatMessages'
import { extractLastUsageFromTranscript } from '../../../shared/sessionUsage'
import { latestBeatLabel } from '../../../shared/beatLabelParser'
import { extractBannerFromTranscript, extractLastWalkFromTranscript } from '../../../shared/bannerFromTranscript'
import {
  deriveRitualMarks,
  createDiagnosticGate,
  diagnosticGateOnPhase,
  diagnosticGateOnNextNode,
  type DiagnosticGate,
  type DiagnosticItem,
} from '../../../shared/ritualFromTranscript'
import {
  isNextNodeCommand,
  pretestRateNode,
  parseMisconceptionAdds,
  parseMisconceptionResolves,
  looksLikeArtifactSetCommand,
  isArtifactSmithSpawnEvent,
  isSubagentSpawnTool,
  explorableTitleFromDescription,
  explorableNodeFromPrompt,
  isReceiptCommand,
  isStashCommand,
  classifyEngramBashFailure,
  isMarkBoundaryToolUse,
  type ToolFailureKind,
} from '../../../shared/signals/tutorSignals'
import { parsePretestGradeResults, verdictFromGrade, isStabilityMilestone } from '../../../shared/gradeResult'
import { parseCurriculumReturn } from '../../../shared/taskNotification'
import { invalidateSearchIndex } from '../shared/searchIndex'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { emitPulse, setAmbientLevel } from '../../../shared/neuralFieldBus'
import { recordConfidence } from '../shared/calibrationStore'
import { SessionHistoryDrawer, exportSittingTranscript } from '../components/SessionHistoryDrawer'
import { SessionMasthead } from '../components/SessionMasthead'
import { SummaryOverlay, makePeek } from '../components/ritual/SummaryOverlay'
import { parseGradeResults, type GradeResult } from '../../../shared/gradeResult'
import { MarkView, type RitualMark } from '../components/ritual/Marks'
import { bridgeUiIntent } from '../../../shared/bridgeUiIntents'
import { ActionChips, type SuggestedAction } from '../components/ritual/ActionChips'
import { SessionOpenPlate, SessionCeremony } from '../components/ritual/Bookends'
import { Button } from '../components/ui/Button'
import { ErrorPanel } from '../components/ErrorPanel'
import { Card } from '../components/ui/Card'
import { SkeletonBar } from '../components/Skeleton'
import { InkNode } from '../components/ui/InkNode'
import { PinTackIcon } from '../components/ui/PinTackIcon'
import { TopicCard } from '../components/TopicCard'
import { SectionBanner } from '../components/ui/SectionBanner'
import { PlateFigure } from '../components/ui/PlateFigure'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { topicBucket } from '../shared/topicShelf'
import { sortTopics, TOPIC_SORT_OPTIONS, type TopicSortKey } from '../shared/topicSort'
import { loadTopicSort, saveTopicSort, loadTopicGroup, saveTopicGroup, type TopicGroupKey } from '../shared/topicSortPrefs'
import { groupTopicsByFolder, TOPIC_GROUP_OPTIONS } from '../shared/topicFolders'
import {
  loadFolderRegistry,
  saveFolderRegistry,
  addFolderToRegistry,
  removeFolderFromRegistry,
  allFolderNames,
} from '../shared/folderRegistry'
import { FolderShelf } from '../components/FolderShelf'
import { EnvironmentSteps } from '../components/EnvironmentSteps'
import { extractTicketFromMessages, type ParsedTicket } from '../shared/ticketParser'
import { TicketCard } from '../components/ritual/TicketCard'
import { InkWell } from '../components/ritual/InkWell'
import { ExportCommand } from '../components/ui/ExportCommand'
import { FlowChain } from '../components/ritual/FlowChain'
import { trailingRecalled } from '../../../shared/gradeResult'
import { paperSlide, warmTone } from '../shared/soundscape'

// isNextNodeCommand / pretestRateNode / parseMisconceptionAdds /
// looksLikeArtifactSetCommand / isArtifactSmithSpawnEvent / isSubagentSpawnTool /
// explorableTitleFromDescription / explorableNodeFromPrompt now live in
// shared/signals/tutorSignals.ts (imported above) — the single copies this
// view, ReviewSessionView, and shared/ritualFromTranscript.ts's replay walk
// all share.

// `python3 "$ENGRAM" receipt --file <assessor-output.json>` (SKILL.md step 4) is
// the batch-grade call — the one place /learn's tool_result carries an ARRAY of
// per-node grade results (cmd_receipt in engram.py), unlike the single-item
// shape a bare `rate` call would return.
// (Task 7) Delegates to shared/signals/tutorSignals.ts's `isReceiptCommand` —
// the same predicate `classifyEngramBashFailure` uses to recognize a receipt
// call's FAILURE, so success and failure detection can never quietly drift
// off two separately-maintained copies of the same substring check.
function looksLikeReceiptCall(input: Record<string, unknown>): boolean {
  return isReceiptCommand(String(input.command ?? ''))
}

// `add-topic --file <tmp>` is the architect's curriculum-save moment — the one
// call that mints a topic. Its success output carries {ok, topic, nodes}.
function looksLikeAddTopicCall(input: Record<string, unknown>): boolean {
  const command = String(input.command ?? '')
  return command.includes('add-topic')
}

// Stash is the "production filed for later grading" moment (spike/FINDINGS.md
// Finding 5.2). (Task 7) Delegates to shared/signals/tutorSignals.ts's
// `isStashCommand` — same reason as `looksLikeReceiptCall` above.
function looksLikeStashCall(input: Record<string, unknown>): boolean {
  return isStashCommand(String(input.command ?? ''))
}

// Plain Omit<Union, K> collapses a discriminated union to its common fields
// (Pick over a union's keyof, not a per-member distribution) — this variant
// distributes over each member first so `kind: 'beat'` still requires `beat`
// while `kind: 'stamp'` doesn't.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

// The dialogue-grammar beats the app knows how to render/step through (mirrors
// BeatStepper's STEPS keys) — beat_outcome payloads naming anything else are ignored,
// since bridge:ui payloads are untrusted model output, not a validated internal call.

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

/** Matches the shared shelf TopicCard's geometry (panel, HealthRing-sized leading circle, title +
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

/** A group of shelf rows under a small subheading — hidden entirely (no
 * heading, no empty stack) when the bucket is empty, same discipline as
 * Home's TopicGroup (HomeView.tsx) — same three-bucket grammar, just laid out
 * as a vertical shelf instead of a grid. */
function LearnTopicGroup({
  heading,
  caption,
  topics,
  resumableTopics,
  onOpen,
  onSettings,
  onStartFresh,
  hideFolderChip,
}: {
  heading: string
  caption?: string
  topics: TopicListEntry[]
  resumableTopics: Set<string>
  onOpen: (t: TopicListEntry) => void
  onSettings: (t: TopicListEntry) => void
  onStartFresh: (t: TopicListEntry) => void
  /** True when this group's own heading IS the folder name. */
  hideFolderChip?: boolean
}) {
  if (topics.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <SectionBanner label={heading} count={topics.length} />
      {caption && <span className="text-xs text-[var(--color-text-faint)]">{caption}</span>}
      <div className="flex flex-col gap-3">
        {topics.map((t) => (
          <TopicCard
            key={t.topic}
            variant="shelf"
            topic={t}
            hideFolderChip={hideFolderChip}
            resumable={resumableTopics.has(t.topic)}
            onOpen={() => onOpen(t)}
            onSettings={() => onSettings(t)}
            onStartFresh={() => onStartFresh(t)}
          />
        ))}
      </div>
    </div>
  )
}

/** The shelf's last card — a dashed hairline panel replacing the old
 * full-width primary Button, so "start something new" reads as one more
 * territory on the atlas rather than a form action bolted below the list.
 * Stays a real button (focus-ring, disabled semantics) under the hood; the
 * blocked (rate-limited) state is drawn ON the card itself — dimmed, with an
 * explicit reason — rather than silently disabling it with no explanation,
 * which the old floating Button did. */
function AddTerritoryCard({ onClick, blocked }: { onClick: () => void; blocked: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={blocked}
      title={blocked ? 'Blocked until the current rate limit resets' : undefined}
      className="focus-ring panel border-dashed px-5 py-4 flex items-center gap-3 text-left hover:bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] hover:border-[var(--color-ink-warm-dim)] transition-colors duration-[var(--dur-base)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
    >
      <span className="text-lg leading-none text-[var(--color-text-faint)]">+</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-[var(--color-text-dim)]">Chart a new territory</span>
        {blocked && (
          <span className="label-data text-[10px] text-[var(--color-ink-danger)]">blocked — rate limit in effect</span>
        )}
      </div>
    </button>
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
  /** Set by App.tsx alongside an `openNewTopicSignal` bump when it came from
   * an engram:// deep link (Observatory's paper→topic hand-off) rather than
   * a plain ⌘N — already shape-guarded and filesystem-checked in main (see
   * main/deepLink.ts). Read into the modal-open state the moment the signal
   * fires, then reported back via onNewTopicPrefillConsumed so App.tsx can
   * clear it — a later plain ⌘N, or the shelf's own "New Topic" affordances,
   * must never reopen the modal with a stale prefill (see
   * shared/newTopicPrefillFlow.ts's decideModalPrefillOnOpenSignal for the
   * exact, unit-tested rule this promise is built on — a real regression
   * here, a stale prefill resurfacing after Start was clicked without going
   * through modalPrefill's other clear sites, was caught by a coordinator
   * review and is what that module's tests guard). Prefill only: the
   * learner still reviews and hits Start themselves. */
  newTopicPrefill?: NewTopicPrefill | null
  onNewTopicPrefillConsumed?: () => void
  /** Chat Instruments Wave B — node-name chips' deep link. App.tsx's own
   * `goToNode` (the SAME callback ArtifactGalleryView's `onOpenNode` and
   * TopicDrilldownView's `onGoNode` already use for "a click landed on a
   * specific node, take me there") — a real navigation (switches to the
   * Topic Map, selects the topic, opens the node), not the softer
   * `onSpotlight` nudge above: a chip is a deliberate click on a link-shaped
   * thing, not an ambient tutor signal, and `onSpotlight`'s own doctrine
   * comment in TopicMapView.tsx is explicit that it only pans an ALREADY-
   * open map, never switches topics — which would silently no-op a chip
   * click for any node outside whatever topic the map last had open. */
  onOpenNode?: (topicId: string, nodeId: string) => void
}

export function LearnSessionView({
  deepLinkTopicId,
  onDeepLinkConsumed,
  onActivity,
  onSpotlight,
  onGoReview,
  openNewTopicSignal,
  newTopicPrefill,
  onNewTopicPrefillConsumed,
  onOpenNode,
}: LearnSessionViewProps = {}) {
  // Topic-list state
  const [topics, setTopics] = useState<TopicListEntry[] | null>(null)
  const [settingsFor, setSettingsFor] = useState<TopicListEntry | null>(null)
  const [newTopicOpen, setNewTopicOpen] = useState(false)
  // Fields to seed the New Topic modal with on its next open — set only from
  // an engram:// deep link (see newTopicPrefill above); null for every plain
  // ⌘N / "New Topic" click, including ones that follow a deep-link open, so
  // a stale prefill can never leak into an unrelated fresh topic.
  const [modalPrefill, setModalPrefill] = useState<NewTopicPrefill | null>(null)
  // Bumped only when a NEW prefill actually lands AND the modal was not
  // already open (see the openNewTopicSignal effect below), and used as
  // NewTopicModal's `key` — forces a remount so the freshly-opened instance
  // seeds from the new prefill. NewTopicModal seeds its fields from props
  // only via a lazy useState initializer (it deliberately does not re-sync
  // on a later prop change — see its own doc comment), so without a key
  // change here, a same-instance prop update would be silently ignored and
  // the new prefill lost.
  //
  // Deliberately NOT bumped when the modal is already open: an earlier
  // version of this fix bumped unconditionally, which meant a second deep
  // link (or any repeat "New Topic" trigger) arriving while the learner was
  // already mid-typing into an open modal would force a remount and wipe
  // what they'd written — trading "prefill silently lost" for "the
  // learner's own typing silently lost," which is worse. The current
  // choice: if the modal is already open, a new prefill is simply ignored
  // (not queued for after the modal closes) — there's no reliable in-modal
  // signal of "still pristine vs. already edited" without lifting
  // NewTopicModal's internal state up, and the deep link's URL isn't
  // retained anywhere to safely retry from later. See
  // shared/newTopicPrefillFlow.ts's decideModalPrefillOnOpenSignal for the
  // exact (tested) decision table this and modalPrefill above follow.
  const [prefillEpoch, setPrefillEpoch] = useState(0)
  // True while a deep link arrived and was ignored (see above) because the
  // modal was already open — surfaced as a banner note so the learner isn't
  // left wondering why the window came forward with no visible change.
  // Reset to false by every genuine open (fresh seed or fresh blank) and by
  // the modal's own close, so it never lingers into an unrelated later open.
  const [newerLinkIgnored, setNewerLinkIgnored] = useState(false)
  // Only consulted for the empty-shelf guided card below — same gate HomeView
  // uses (EnvironmentGate already blocks the app on a broken environment, but
  // its "Continue anyway" escape hatch can still land you here with topics
  // still unmapped and Claude/the plugin unresolved).
  const [envCheck, setEnvCheck] = useState<EnvironmentCheckResult | null>(null)
  // Which topics have a resumable session — shown as a hint on each TopicCard so opening
  // a topic's "continue vs. fresh start" behavior (see openTopic) isn't a surprise.
  const [resumableTopics, setResumableTopics] = useState<Set<string>>(new Set())

  // Session state
  const [activeTopic, setActiveTopic] = useState<TopicListEntry | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  // Addition D (chat refine round) — set alongside every `setSessionId(sid)`
  // below (fresh start, resume, or a brand-new topic), never on a `null`
  // reset (SittingClock's own doctrine comment covers why a resumed sitting
  // counts from resume, not a recovered original start time).
  const [sittingStartedAt, setSittingStartedAt] = useState<number | null>(null)
  const [started, setStarted] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  // Watchdog (Phase 3) — true from a `stall` SessionEvent until the next
  // genuine activity of any other kind. Purely informational (Stop already
  // exists below for anyone who wants to act on it); this just turns "gone
  // quiet" into a stated fact instead of an indistinguishable long think.
  const [stalled, setStalled] = useState(false)
  const [production, setProduction] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
  const [markdownPreview, setMarkdownPreview] = useState(false)
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
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<ExportSittingFormat | null>(null)
  const [exportStatus, setExportStatus] = useState<{ text: string; failed: boolean } | null>(null)
  const [marks, setMarks] = useState<RitualMark[]>([])
  // The tutor's structured session ticket (render_ticket), when it sent one.
  // Cleared per sitting alongside the other transcript state.
  const [structuredTicket, setStructuredTicket] = useState<ParsedTicket | null>(null)
  // Chat Presence Wave D — renderer-local, live-only "what's the tutor doing
  // right now" (shared/tutorActivity.ts's doctrine comment has the full
  // rationale). Additive alongside `busy` above: nothing here replaces it.
  // Retires the old `gradingPending` flag this state used to sit next to —
  // that one toggled on the SOFT `session_phase: 'grading'` bridge signal and
  // off at the `receipt` tool_result, so the shimmer only ever started once
  // the assessor had ALREADY finished (see Task 8's doctrine comment in
  // tutorActivity.ts). `activity`'s `grading:assessing` instead reacts to the
  // assessor's own spawn tool_use — a hard signal, real for /learn too (its
  // SKILL.md step 4 spawns `engram-assessor` exactly as /review's audit
  // does; Wave A's finding was that no UI listened for it yet, not that the
  // spawn doesn't happen).
  const tutorActivity = useTutorActivity()
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
  // Once the conversation is under way the masthead auto-collapses so the
  // transcript owns the window; moving the cursor to the top strip (or tabbing
  // into the hidden header) peeks it back open. The leave timer keeps it from
  // flickering when the pointer grazes the boundary.
  const [mastheadPeek, setMastheadPeek] = useState(false)
  const [mastheadPinned, setMastheadPinned] = useState(false)
  const peekLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mastheadRef = useRef<HTMLElement | null>(null)
  const peekMasthead = () => {
    if (peekLeaveTimer.current) clearTimeout(peekLeaveTimer.current)
    peekLeaveTimer.current = null
    setMastheadPeek(true)
  }
  const scheduleMastheadCollapse = () => {
    // Motion defers the deadline (clear + rearm): the collapse may only fire
    // after the pointer has genuinely SETTLED below the header. The previous
    // "armed deadline stands" variant was the root cause of the dead back
    // button: a standing 250ms deadline kept ticking while the cursor was
    // mid-flight toward (or hovering over) the header — mousemove sampling
    // has holes at the top edge — so the masthead folded under the cursor
    // and the click landed on a 0fr overflow-hidden row.
    if (peekLeaveTimer.current) clearTimeout(peekLeaveTimer.current)
    peekLeaveTimer.current = setTimeout(() => {
      peekLeaveTimer.current = null
      setMastheadPeek(false)
    }, 400)
  }
  /** Pointer-position tracking over the whole session view — runs at the
   * device's own mousemove rate (no throttle; the handler is a couple of
   * rect reads and ref-guarded setState no-ops), so reveal/collapse react to
   * position, not to crossing a thin event target. Above the container
   * (drag bar) never collapses; only settling below the open header does. */
  // The floating session ticket mirrors the masthead's grammar on the left
  // edge: cursor near the edge slides it out, drifting away tucks it back,
  // and a pin toggle keeps it out regardless of the cursor.
  const [ticketPeek, setTicketPeek] = useState(false)
  const [ticketPinned, setTicketPinned] = useState(false)
  const ticketLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const peekTicket = () => {
    if (ticketLeaveTimer.current) clearTimeout(ticketLeaveTimer.current)
    ticketLeaveTimer.current = null
    setTicketPeek(true)
  }
  const scheduleTicketTuck = () => {
    // Clear + rearm — same settled-pointer discipline as the masthead above.
    if (ticketLeaveTimer.current) clearTimeout(ticketLeaveTimer.current)
    ticketLeaveTimer.current = setTimeout(() => {
      ticketLeaveTimer.current = null
      setTicketPeek(false)
    }, 400)
  }
  const handleSessionPointer = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    // Masthead: top edge reveals; settling below the open header tucks it.
    // Pinned ignores the cursor entirely.
    if (!mastheadPinned) {
      if (e.clientY - rect.top <= 28) {
        peekMasthead()
      } else {
        const header = mastheadRef.current
        if (header && e.clientY <= header.getBoundingClientRect().bottom + 12) {
          peekMasthead()
        } else {
          scheduleMastheadCollapse()
        }
      }
    }
    // Closing summary: bottom edge reveals once any grades exist — the
    // mirror of Review's own bottom-edge branch (its height holds it open).
    // Pinned ignores the cursor. State/controller are declared at the END of
    // the hook list (KeepMounted append rule); this handler only runs on
    // real pointer events, long after every declaration has evaluated.
    if (sessionGrades.length > 0 && !summaryPinned) {
      const yFromBottom = rect.bottom - e.clientY
      if (yFromBottom <= (summaryPeek ? 360 : 28)) summaryCtl.peek()
      else summaryCtl.tuck()
    }
    // Ticket: left edge reveals; while out, the whole card width holds it
    // open (hysteresis); past that it tucks. A pinned ticket ignores all of it.
    if (ticketPinned) return
    const x = e.clientX - rect.left
    if (x <= (ticketPeek ? 340 : 28)) {
      peekTicket()
    } else {
      scheduleTicketTuck()
    }
  }
  useEffect(() => () => {
    if (peekLeaveTimer.current) clearTimeout(peekLeaveTimer.current)
    if (ticketLeaveTimer.current) clearTimeout(ticketLeaveTimer.current)
  }, [])

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
  // Task 3: `explorable` marks pushed at the artifact-smith spawn (no path
  // yet) get their path filled in by a later `artifact set` call for the
  // same node, keyed here by node id — mirrors JobsRail's own (cruder,
  // first-running-job) matching just above. Node id may be unknown (best-
  // effort prompt parse failed), in which case that mark is never linked and
  // simply stays path-less — the card degrades to its "no longer on disk"
  // caption, same as if the file really had vanished.
  //
  // A QUEUE of mark ids per node, not a single slot: re-encoding a
  // repeatedly-lapsing node (the artifact-smith agent's own stated use case)
  // spawns a second smith for the SAME node in one sitting. A single-slot map
  // would let the second spawn's `.set()` clobber the first spawn's pending
  // mark id, so the first smith's `artifact set` (smiths finish in spawn
  // order) would find nothing pending, fall through to a stray extra card,
  // while the second smith's `artifact set` would wrongly attach its path to
  // whichever mark id happened to still be indexed (Open opens the wrong
  // file). FIFO — append on spawn, shift the oldest id on `artifact set` —
  // matches same-node respawns to their own registration in completion order.
  const pendingExplorableByNode = useRef<Map<string, string[]>>(new Map())
  // Pretest diagnostic plate (Task 2) — pendingPretestToolUseIds watches each
  // `rate --kind pretest` Bash call for its tool_result (a single call can
  // rate several nodes at once, see parsePretestGradeResults); pretestItems
  // accumulates every verdict seen so far this sitting; diagnosticGate is the
  // shared shared/ritualFromTranscript.ts state machine deciding WHEN the
  // plate fires — the same rule the derivation uses, so a resumed session's
  // history agrees with what the live sitting showed.
  const pendingPretestToolUseIds = useRef<Set<string>>(new Set())
  const pretestItemsRef = useRef<DiagnosticItem[]>([])
  const diagnosticGateRef = useRef<DiagnosticGate>(createDiagnosticGate())
  // Task 7's claimed-tool-use registry: every Bash tool_use
  // `classifyEngramBashFailure` (shared/signals/tutorSignals.ts) recognizes —
  // the six specifically-named calls, plus the generic `engram-bash` bucket —
  // gets its id claimed here at dispatch time, so a later `tool_result` with
  // `isError` can push the matching specific `tool-failure` mark. A Bash call
  // the classifier returns `null` for (a build step, `ls`, a one-off debug
  // script) is never claimed, so its failure renders nothing — deliberate
  // scope, see ToolFailureCard's doctrine comment.
  const toolFailureRegistry = useRef<Map<string, ToolFailureKind>>(new Map())
  // Mirrors currentBeat synchronously (unlike the state itself, which only
  // settles after a render) so onBridgeBeat can read "the beat we're leaving"
  // as a plain value in the handler body instead of reaching for it inside a
  // setState updater — see setBeat below.
  const currentBeatRef = useRef<string | null>(null)
  // The bubble-split boundary (the interleave fix — see isMarkBoundaryToolUse's
  // doctrine comment in shared/signals/tutorSignals.ts): set by the 'tool_use'
  // handler the instant a mark-producing call fires, consumed by the very next
  // 'text' event, which then STARTS A NEW ChatMessage instead of appending to
  // the growing one. Marks pin between messages by atIndex, so without this
  // split, prose streamed AFTER a mid-turn ask/phase/beat signal merged into
  // the same bubble that renders BEFORE the mark — the exact mis-ordering the
  // 2026-07-27 hamilton-jacobi-theory sprint sitting surfaced. Replay applies
  // the identical split via the same shared predicate (chatMessages.ts /
  // buildHistoryTimeline / deriveRitualMarks), so live and replayed
  // segmentation agree by construction.
  const assistantBoundaryRef = useRef(false)

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
    setStructuredTicket(null)
    pendingStashToolUseIds.current.clear()
    pendingNewTopicSettings.current = null
    setLastWalk(null)
    pendingAddTopic.current = null
    lastNodeIdRef.current = null
    assistantBoundaryRef.current = false
    pendingPretestToolUseIds.current.clear()
    pretestItemsRef.current = []
    diagnosticGateRef.current = createDiagnosticGate()
    pendingExplorableByNode.current.clear()
    toolFailureRegistry.current.clear()
    setWalkNumber(null)
    setCommitment(null)
    setClosedUnexpectedly(false)
    setChamber(false)
    setSessionPhase(null)
    setSuggestedActions([])
    setProgressNote(null)
    setTopicGraphCache(null)
    setWhyChainOpen(false)
    setTicketPeek(false)
    setTicketPinned(false)
    setMastheadPinned(false)
    intentionalStopRef.current = false
    // NeuralField is app-global and this view stays mounted — a new session must not
    // inherit the previous topic's leftover warmth.
    setAmbientLevel(0)
    // Chat Presence Wave D — live-only, no replay obligation: every call site
    // of this reset (fresh topic, resume, new-topic, deep-link switch) starts
    // `activity` fresh at `idle`, regardless of how much history the rest of
    // this reset (or the caller's own hydration) rebuilds. See
    // shared/tutorActivity.ts's doctrine comment.
    tutorActivity.reset()
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
    window.engram.environmentCheck().then(setEnvCheck)
    const offEvent = window.engram.onSessionEvent((sid, event) => {
      if (sid !== sessionIdRef.current) return
      handleSessionEvent(event)
    })
    const offAsk = window.engram.onBridgeAsk((req) => {
      if (req.sessionId !== sessionIdRef.current) return
      // Wave E, Task 11 — the ask lands as an inline transcript mark instead
      // of opening the AskDialog modal. Pinned at the current transcript end
      // (`pushMark` stamps `atIndex: messagesRef.current.length`), same
      // convention every other live mark uses. `answerAsk` below resolves it
      // in place by `requestId` once the learner picks.
      pushMark({
        kind: 'ask',
        requestId: req.requestId,
        header: req.header,
        question: req.question,
        options: req.options,
        multiSelect: req.multiSelect,
        answer: null,
        live: true,
      })
      tutorActivity.dispatchAskOpened()
    })
    // A relayed ask whose connection died before an answer (worker gone,
    // session killed) can never resolve — orphan the card rather than leave
    // it inviting a click that goes nowhere. AskCard already renders the
    // honest "no answer was given" state for live:false + answer:null.
    const offAskDropped = window.engram.onBridgeAskDropped((req) => {
      if (req.sessionId !== sessionIdRef.current) return
      setMarks((prev) =>
        prev.map((m) => (m.kind === 'ask' && m.requestId === req.requestId ? { ...m, live: false } : m)),
      )
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
    // Generic tutor-driven UI signals — the payload is the MCP tool's raw
    // (zod-validated-at-the-worker, but untrusted-here) input, so it goes
    // through `bridgeUiIntent`: ONE shared, unit-tested classifier both this
    // view and ReviewSessionView call, rather than the hand-written typeof
    // ladder that used to live here and had no counterpart in Review at all.
    // Every guard this switch used to perform now lives there; what remains
    // is purely "what does THIS view do about it."
    const offUi = window.engram.onBridgeUi((req) => {
      if (req.sessionId !== sessionIdRef.current) return
      const intent = bridgeUiIntent(req.tool, req.payload)
      if (!intent) return
      switch (intent.kind) {
        case 'phase': {
          const nextPhase = intent.phase
          const prevPhase = diagnosticGateRef.current.phase
          // Diagnostic plate first (if this transition is the one leaving
          // pretest) so it reads as "here's how pretest went" immediately
          // ahead of the new phase's own frontispiece — see the shared
          // gate's doctrine comment in ritualFromTranscript.ts.
          if (diagnosticGateOnPhase(diagnosticGateRef.current, nextPhase, pretestItemsRef.current.length)) {
            pushMark({ kind: 'diagnostic', items: [...pretestItemsRef.current] })
          }
          if (prevPhase !== nextPhase) pushMark({ kind: 'phase', phase: nextPhase })
          setSessionPhase(nextPhase)
          // Chat Presence Wave D — the batch has moved into grading, ahead
          // of the assessor's own spawn tool_use (which promotes this to
          // `grading:assessing` — see tutorActivity.ts's doctrine comment).
          if (nextPhase === 'grading') tutorActivity.dispatchGradingPhaseEntered()
          break
        }
        case 'beat-outcome': {
          // The intent's `outcome` is always confirmed/partial/missed (the
          // router excludes 'visited'), so this always inks a richer signal
          // than the plain "step taken" default onBridgeBeat sets — never the
          // other way around.
          setBeatTrail((trail) => {
            const next = new Map(trail)
            next.set(intent.beat, intent.outcome as BeatOutcome)
            return next
          })
          // The verify seal: only a confirmed verify beat earns it — partial/
          // missed outcomes get nothing, since the seal itself means
          // "confirmed" and stamping it for less would counterfeit the
          // receipt (same honesty oath as InkBurst never firing for a lapse).
          if (intent.beat === 'verify' && intent.outcome === 'confirmed') pushMark({ kind: 'verify-seal' })
          break
        }
        case 'figure':
          pushMark({ kind: 'figure', title: intent.title, body: intent.body })
          break
        case 'comparison':
          pushMark({ kind: 'comparison', title: intent.title, left: intent.left, right: intent.right })
          break
        case 'steps':
          pushMark({ kind: 'steps', title: intent.title, steps: intent.steps })
          break
        case 'formula':
          pushMark({ kind: 'formula', latex: intent.latex, caption: intent.caption, where: intent.where })
          break
        case 'citation':
          pushMark({ kind: 'citation', label: intent.label, locator: intent.locator, note: intent.note })
          break
        case 'checks':
          pushMark({ kind: 'checks', title: intent.title, checks: intent.checks })
          break
        case 'timeline':
          pushMark({ kind: 'timeline', title: intent.title, events: intent.events })
          break
        case 'definition':
          pushMark({
            kind: 'definition',
            term: intent.term,
            definition: intent.definition,
            aka: intent.aka,
            notToBeConfusedWith: intent.notToBeConfusedWith,
          })
          break
        case 'plot':
          pushMark({ kind: 'plot', title: intent.title, xLabel: intent.xLabel, yLabel: intent.yLabel, series: intent.series, markers: intent.markers })
          break
        case 'ticket':
          // Held as state, NOT pushed as a transcript mark. A tutor that
          // both calls render_ticket AND types the ticket in prose (observed
          // live 2026-08-05 — same sitting, one structured, one fenced) used
          // to draw TWO ticket cards: the mark inline and the prose-parsed
          // one in the pinned slot. Feeding the structured payload into the
          // same slot the prose parse feeds gives exactly one card, sourced
          // from the better data when it exists.
          setStructuredTicket(intent.ticket)
          break
        case 'actions':
          setSuggestedActions(intent.actions)
          break
        case 'progress-note':
          setProgressNote(intent.text)
          break
        case 'spotlight':
          onSpotlight?.({ topicId: intent.topicId, nodeId: intent.nodeId })
          break
        default:
          // `verdict-hint` (Review's own channel) and `annotate` (handled in
          // main, not here) reach this view but have nothing to do in it.
          break
      }
    })
    return () => {
      offEvent()
      offAsk()
      offAskDropped()
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
      setSittingStartedAt(null)
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
      // App.tsx batches newTopicPrefill alongside every signal bump that
      // came from a deep link (null/undefined for a plain ⌘N or shelf
      // click), so this closure already has the matching value from the
      // same render — see the comment above for why the ref, not the prop,
      // is the change-detection guard.
      //
      // `newTopicOpen` (read directly, not via a ref — its value here is
      // this render's committed state, from BEFORE the setNewTopicOpen(true)
      // below takes effect) plus `newTopicPrefill` fully determine what
      // happens to `modalPrefill` — see shared/newTopicPrefillFlow.ts's
      // decideModalPrefillOnOpenSignal (unit tested there) for the decision
      // table. In particular: 'clear' (not just "leave modalPrefill alone")
      // on ANY reopen of a closed modal with no new prefill is what fixes a
      // real regression a coordinator review caught — clicking Start closes
      // the modal (LearnSessionView's startNewTopic) without clearing
      // modalPrefill, so a later plain ⌘N would otherwise silently reseed
      // the form with an earlier deep link's (possibly attacker-controlled)
      // text on a modal the learner believed they'd opened fresh.
      const decision = decideModalPrefillOnOpenSignal(newTopicOpen, newTopicPrefill)
      switch (decision.action) {
        case 'seed':
          setModalPrefill(decision.prefill)
          setPrefillEpoch((n) => n + 1)
          setNewerLinkIgnored(false)
          break
        case 'clear':
          setModalPrefill(null)
          setNewerLinkIgnored(false)
          break
        case 'keepAndNoteDropped':
          // Modal already open with a prefill (or blank form) the learner
          // may be mid-typing into — leave modalPrefill untouched, but say
          // so, rather than silently focusing the window with no visible
          // change (see NewTopicModal's own notice for the learner-facing
          // wording).
          setNewerLinkIgnored(true)
          break
        case 'keep':
          break
      }
      setNewTopicOpen(true)
      // Consumed (reported back to App.tsx) whenever a prefill arrived,
      // whether it was applied or ignored above — either way App.tsx's copy
      // must not linger and get silently applied to some LATER, unrelated
      // signal bump (e.g. a plain ⌘N after this one).
      if (newTopicPrefill) onNewTopicPrefillConsumed?.()
    }
    openNewTopicSignalRef.current = openNewTopicSignal ?? openNewTopicSignalRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNewTopicSignal])

  function handleSessionEvent(event: SessionEvent) {
    // Chat Presence Wave D — fed every SessionEvent this handler sees, same
    // as `deriveRitualMarks` gets every walked transcript event; unlike that
    // function, this one is live-only and has no replay counterpart.
    tutorActivity.dispatchSessionEvent(event)
    if (event.type === 'stall') {
      setStalled(true)
      return
    }
    if (stalled) setStalled(false)
    switch (event.type) {
      case 'text': {
        // Append to the running assistant message if we're mid-turn (deltas arrive as
        // several small 'text' events); start a fresh bubble the moment the last message
        // was the user's — that's the actual turn boundary in a real conversation — OR
        // the moment a mark-producing tool_use fired since the last delta (the
        // interleave fix — see assistantBoundaryRef's doctrine comment above): the
        // mark pinned at that boundary must render between the prose that preceded
        // the signal and the prose now arriving after it.
        const breakBubble = assistantBoundaryRef.current
        assistantBoundaryRef.current = false
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          // Bare-probe-header exception (see `endsWithBareProbeHeader`'s own
          // doctrine comment) — a header-only bubble absorbs the text that
          // follows a mark-boundary tool call (typically `render_beat`
          // posting the probe itself) instead of starting a new bubble.
          if (last && last.role === 'assistant' && (!breakBubble || endsWithBareProbeHeader(last.text))) {
            const text = mergeAssistantText(last.text, breakBubble, event.text)
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
          // `Date.now()` at append time — SessionEvent carries no timestamp
          // of its own (see shared/sessionEvents.ts), so this is honest as
          // "when the app received it", the same discipline ChatMessage's
          // own doctrine comment documents.
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', text: event.text, timestamp: Date.now() }]
        })
        break
      }
      case 'tool_use':
        // The interleave fix — flag the bubble split FIRST, before any of the
        // specific-signal branches (see assistantBoundaryRef's doctrine
        // comment above). Same shared predicate replay uses, applied at the
        // same point in the event order.
        if (isMarkBoundaryToolUse(event.name, event.input)) {
          assistantBoundaryRef.current = true
        }
        // Task 7 — claim this Bash call's id for tool-failure purposes BEFORE
        // any of the specific-signal branches below run, so the registry is
        // populated no matter which (if any) of them also fires for the same
        // command.
        if (event.name === 'Bash') {
          const failureKind = classifyEngramBashFailure(String((event.input as { command?: unknown }).command ?? ''))
          if (failureKind) toolFailureRegistry.current.set(event.id, failureKind)
        }
        if (event.name === 'Bash' && isNextNodeCommand(String((event.input as { command?: unknown }).command ?? ''))) {
          pendingNextToolUseId.current = event.id
          // Fallback diagnostic-plate trigger (shared/ritualFromTranscript.ts's
          // DiagnosticGate): if the model never called session_phase to leave
          // 'pretest', the first real per-node teaching selection still fires
          // the plate, as long as at least one pretest item is in hand.
          if (diagnosticGateOnNextNode(diagnosticGateRef.current, pretestItemsRef.current.length)) {
            pushMark({ kind: 'diagnostic', items: [...pretestItemsRef.current] })
          }
          // First sight of the engine-minted topic id: persist any settings
          // given in the New Topic modal as this topic's real TopicSettings.
          if (pendingNewTopicSettings.current) {
            const m = String((event.input as { command?: unknown }).command ?? '').match(/--topic\s+"?([^"\s]+)"?/)
            if (m) {
              const settings = pendingNewTopicSettings.current
              pendingNewTopicSettings.current = null
              void window.engram.setTopicSettings(m[1], settings)
            }
          }
        }
        if (event.name === 'Bash' && looksLikeReceiptCall(event.input)) {
          pendingReceiptToolUseId.current = event.id
        }
        if (event.name === 'Bash' && looksLikeStashCall(event.input)) {
          pendingStashToolUseIds.current.add(event.id)
        }
        if (isSubagentSpawnTool(event.name) && JSON.stringify(event.input).includes('curriculum-architect')) {
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
          const artifactSet = looksLikeArtifactSetCommand(String((event.input as { command?: unknown }).command ?? ''))
          const path = artifactSet?.path
          if (path) {
            setJobs((prev) => {
              const idx = prev.findIndex((j) => j.status === 'running' && !j.artifactPath)
              if (idx === -1) return [...prev, { id: event.id, label: 'Explorable ready', status: 'done', artifactPath: path }]
              const copy = [...prev]
              copy[idx] = { ...copy[idx], status: 'done', artifactPath: path }
              return copy
            })
            emitPulse('synthesis') // a job just flipped to done — the explorable is ready
            // Fill in an already-pushed spawn mark's path (see
            // pendingExplorableByNode above) or, if the tutor ran `artifact
            // set` directly per SKILL.md's registration-failed fallback with
            // no matching spawn mark in this sitting, push a fresh one.
            const node = artifactSet?.node
            const queue = node ? pendingExplorableByNode.current.get(node) : undefined
            const pendingMarkId = queue?.length ? queue.shift() : undefined
            if (pendingMarkId) {
              setMarks((prev) => prev.map((m) => (m.id === pendingMarkId && m.kind === 'explorable' ? { ...m, path } : m)))
              if (queue && queue.length === 0 && node) pendingExplorableByNode.current.delete(node)
            } else {
              pushMark({ kind: 'explorable', title: node ? humanizeNodeId(node) : 'Explorable', path, node })
            }
          }
        }
        if (event.name === 'Bash') {
          const pretestedNode = pretestRateNode(String((event.input as { command?: unknown }).command ?? ''))
          if (pretestedNode) {
            setJobs((prev) => [
              ...prev,
              { id: event.id, label: `Pretested: ${humanizeNodeId(pretestedNode)} ✓`, status: 'done', artifactPath: null },
            ])
            emitPulse('recalled') // a pretest rate call only ever fires on a solid answer (SKILL.md §2) — a real hit
            // Watch this call's result for the diagnostic plate — a single Bash
            // call can rate several frontier nodes at once (SKILL.md §2), so
            // the node parsePretestGradeResults later pulls from the result
            // JSON itself, not from `pretestedNode` above (which only ever
            // captures the first --node in the command).
            pendingPretestToolUseIds.current.add(event.id)
          }
        }
        if (event.name === 'Bash') {
          const bashCommand = String((event.input as { command?: unknown }).command ?? '')
          for (const misconception of parseMisconceptionAdds(bashCommand)) {
            pushMark({ kind: 'misconception', text: misconception.text, node: misconception.node })
          }
          for (const resolvedId of parseMisconceptionResolves(bashCommand)) {
            pushMark({ kind: 'misconception-resolved', misconceptionId: resolvedId })
          }
        }
        if (isArtifactSmithSpawnEvent(event.name, event.input)) {
          setJobs((prev) => [...prev, { id: event.id, label: 'Building explorable…', status: 'running', artifactPath: null }])
          const input = event.input as { description?: unknown; prompt?: unknown }
          const title = explorableTitleFromDescription(input.description) ?? 'Explorable'
          const node = explorableNodeFromPrompt(input.prompt)
          const markId = `mark-${markSeq.current++}`
          setMarks((prev) => [...prev, { id: markId, atIndex: messagesRef.current.length, kind: 'explorable', title, node }])
          if (node) {
            const queue = pendingExplorableByNode.current.get(node)
            if (queue) queue.push(markId)
            else pendingExplorableByNode.current.set(node, [markId])
          }
        }
        break
      case 'tool_result': {
        // Task 7 — resolve any claimed tool-failure BEFORE the specific
        // success-side branches below (which already no-op on error content
        // themselves; this ordering only affects render order within the
        // same atIndex, not correctness).
        const failureKind = toolFailureRegistry.current.get(event.toolUseId)
        if (failureKind !== undefined) {
          toolFailureRegistry.current.delete(event.toolUseId)
          if (event.isError) pushMark({ kind: 'tool-failure', failureKind })
        }
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
            // Task 6 — the same shared predicate ReviewSessionView and
            // deriveRitualMarks use, checked per-node since one receipt batch
            // can carry several independently-milestone-worthy nodes.
            for (const r of results) {
              const scale = isStabilityMilestone(r)
              if (scale) pushMark({ kind: 'milestone', node: r.node, scale, sBefore: r.sBefore as number, sAfter: r.sAfter as number })
            }
          }
        }
        if (pendingStashToolUseIds.current.has(event.toolUseId)) {
          pendingStashToolUseIds.current.delete(event.toolUseId)
          if (!event.isError) pushMark({ kind: 'stamp' })
        }
        if (pendingPretestToolUseIds.current.has(event.toolUseId)) {
          pendingPretestToolUseIds.current.delete(event.toolUseId)
          for (const r of parsePretestGradeResults(event.content)) {
            pretestItemsRef.current.push({ node: r.node, verdict: verdictFromGrade(r.grade) })
            // Task 6 — a pretest result's sBefore is always null on a fresh
            // cold probe (nothing to grow FROM yet), so this never fires in
            // practice; checked anyway for the same-predicate-everywhere
            // discipline rather than special-casing pretest as exempt.
            const scale = isStabilityMilestone(r)
            if (scale) pushMark({ kind: 'milestone', node: r.node, scale, sBefore: r.sBefore as number, sAfter: r.sAfter as number })
          }
        }
        setJobs((prev) =>
          prev.map((j) =>
            j.id === event.toolUseId && j.status === 'running'
              ? { ...j, status: event.isError ? 'failed' : j.status }
              : j,
          ),
        )
        break
      }
      case 'rate_limit':
        setRateLimit(event.status === 'allowed' ? null : { status: event.status, resetsAt: event.resetsAt })
        break
      case 'task_notification': {
        // A background subagent's completion envelope. Never rendered as
        // prose (SessionManager already keeps it out of the message stream);
        // here it resolves into at most one structured pin: the curriculum
        // architect's return — mirrored exactly by deriveRitualMarks'
        // task_notification branch, so replay shows the identical pin.
        const curriculum = parseCurriculumReturn(event.content)
        if (curriculum) pushMark({ kind: 'agent-return', topic: curriculum.topic, nodeCount: curriculum.nodeCount })
        break
      }
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
  async function openTopic(topic: TopicListEntry) {
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
      // instead of sitting gray until the tutor's next call. The banner only
      // replays BRIDGE calls, though, and some beats (VERIFY chief among
      // them — see beatEvents.ts's doctrine comment: the tutor never calls
      // render_beat for it) only ever show up as a bolded prose label. A
      // sitting that ends text-only after its last bridge call (e.g. …RESOLVE
      // via render_beat, then a plain "**VERIFY — cold, no notes.**") would
      // otherwise reopen with the stepper stuck on the stale bridge beat. The
      // last assistant message is by construction at least as recent as any
      // bridge call within it, so a real text-tier label there wins; same
      // "null means no signal, not no beat" rule the live path already uses.
      const banner = extractBannerFromTranscript(lines)
      setLastWalk(extractLastWalkFromTranscript(lines))
      const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')
      const textBeat = lastAssistant ? latestBeatLabel(lastAssistant.text) : null
      if (banner.beat || textBeat) {
        setBeat(textBeat ?? banner.beat)
        setBeatTrail(banner.trail)
        setNodePosition(banner.position)
        if (banner.node) {
          setCurrentNodeId(banner.node)
          // Prime the crossing ref too, so the first live render_beat for this
          // same node doesn't fire a spurious crossing mark / trail reset.
          lastNodeIdRef.current = banner.node
        }
      } else {
        setBeat(null)
      }
      // Same replay for the beat cards + crossing dividers themselves — a
      // resumed sitting shouldn't open to a bare transcript when the same
      // render_beat calls that fed the banner above also carry everything
      // needed to redraw them. resetSessionEphemera() (called at the top of
      // this function) already cleared marks to [], but guard with the same
      // "only when empty" check the live path implicitly gets for free, so a
      // live session's own marks (should this ever race a second hydration)
      // are never clobbered.
      setMarks((prev) => (prev.length === 0 ? deriveRitualMarks(lines) : prev))
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
    setSittingStartedAt(Date.now())
  }

  // Deliberately bypasses the resume-if-exists behavior in openTopic — for when you
  // want to abandon a topic's in-progress thread and begin that same topic over from
  // scratch, rather than continuing where you left off.
  async function startFreshForTopic(topic: TopicListEntry) {
    setActiveTopic(topic)
    setStarted(true)
    // Same full-ephemera reset openTopic uses (see its comment above) — a fresh
    // start must not inherit the previous topic's diagnostic gate, pretest items,
    // or pending explorable-by-node queue any more than a resumed one should.
    resetSessionEphemera()
    setBusy(true)
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
    setSittingStartedAt(Date.now())
  }

  async function startNewTopic(goal: string, systemPromptExtra = '', contextFiles: string[] = []) {
    setNewTopicOpen(false)
    setActiveTopic(null)
    setStarted(true)
    // Same full-ephemera reset openTopic/startFreshForTopic use — a brand new
    // topic must not inherit the previous session's diagnostic gate, pretest
    // items, or pending explorable-by-node queue either.
    resetSessionEphemera()
    setBusy(true)
    fetchCommitment()
    // The topic id doesn't exist until the engine mints it, so these can't be
    // written as TopicSettings yet — they ride the kickoff message for THIS
    // session, and persist as the topic's settings the moment the first
    // `next --topic <id>` call reveals the id (see the tool_use handler).
    // resetSessionEphemera() above already nulled pendingNewTopicSettings —
    // only the truthy case needs setting here.
    if (systemPromptExtra || contextFiles.length > 0) {
      pendingNewTopicSettings.current = { systemPromptExtra, contextFiles }
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
    setSittingStartedAt(Date.now())
  }

  function backToTopics() {
    setStarted(false)
    setSessionId(null)
    setSittingStartedAt(null)
    sessionIdRef.current = null
    setActiveTopic(null)
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
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text, attachments: files, timestamp: Date.now() }])
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

  async function answerAsk(requestId: string, chosen: string[] | null) {
    const mark = marks.find((m): m is Extract<RitualMark, { kind: 'ask' }> => m.kind === 'ask' && m.requestId === requestId)
    if (!mark) return
    // Mirror the confidence pick locally before forwarding — best-effort, never
    // blocks the real answer even if the topic/node aren't known yet.
    if (mark.header === 'Confidence' && chosen && chosen[0] && activeTopic?.topic && currentNodeId) {
      const index = mark.options.findIndex((o) => o.label === chosen[0])
      recordConfidence(activeTopic.topic, currentNodeId, chosen[0], index >= 0 ? index : undefined)
    }
    await window.engram.answerBridgeQuestion(requestId, { chosen })
    // `chosen ?? []` — an explicit Skip (`chosen: null` on the wire) becomes
    // an empty array here, never `null`: this mark's `answer: null` means
    // "still open," so a real skip must land on the non-null side of that
    // distinction (see RitualMark's doctrine comment in Marks.tsx).
    setMarks((prev) => prev.map((m) => (m.kind === 'ask' && m.requestId === requestId ? { ...m, answer: chosen ?? [] } : m)))
    tutorActivity.dispatchAskAnswered()
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
    tutorActivity.dispatchStopped()
    window.engram.abortSession(sessionId)
    setBusy(false)
  }

  // Exports the OPEN sitting via the same path SessionHistoryDrawer's own
  // per-sitting Export buttons use (see exportSittingTranscript) — it rebuilds
  // from a fresh `getTranscript` read rather than this view's own live
  // `messages`/`sessionGrades` state, so what a mid-session export contains is
  // exactly whatever's landed on disk so far (same as replaying this sitting
  // in the history drawer would show right now).
  async function exportCurrentSitting(format: ExportSittingFormat) {
    if (!sessionId || !activeTopic) return
    setExportingFormat(format)
    setExportStatus(null)
    try {
      const history = await window.engram.sessionHistoryFor('learn', activeTopic.topic)
      const startedAt = history.find((e) => e.sessionId === sessionId)?.startedAt ?? new Date().toISOString()
      const result = await exportSittingTranscript(sessionId, format, { title: activeTopic.title, startedAt })
      if (result.ok) setExportStatus({ text: `Saved to ${result.path}`, failed: false })
      else if (result.reason !== 'canceled') setExportStatus({ text: `Export failed: ${result.reason}`, failed: true })
    } finally {
      setExportingFormat(null)
    }
  }

  const rateLimitBlocking = rateLimit !== null && isBlockingRateLimitStatus(rateLimit.status)
  const lastUserMessageId = useMemo(() => [...messages].reverse().find((m) => m.role === 'user')?.id ?? null, [messages])
  // Structured (render_ticket) wins over the prose parse when both exist —
  // see the render_ticket handler for why they must never both draw.
  const latestTicket = useMemo(
    () => structuredTicket ?? extractTicketFromMessages(messages),
    [structuredTicket, messages],
  )
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

  // Chat Instruments Wave A — wired at the whole session pane's own root
  // below (not just the transcript's ChatScrollRegion), so it also covers
  // SessionCeremony's commitment line and ActionChips' suggested-action
  // labels, both of which render as siblings of the transcript inside the
  // same pane, plus the composer's own MarkdownPreview (separately wired at
  // its own root too — see that component — so it stays correct even if
  // ever mounted somewhere else; nesting is safe, see useEquationCopy's own
  // doctrine comment on `stopPropagation`). A callback ref: this pane's root
  // is itself behind the `started` conditional below, which unmounts and
  // remounts across "back to topics" / re-open — exactly the case
  // `useEquationCopy`'s callback-ref design exists for.
  const equationCopyRef = useEquationCopy()
  // Chat Instruments Wave B — node-name chips' click delegation, same pane
  // root as equation-copy above (same remount reasoning), merged onto the
  // same DOM node via `setSessionPaneRef` below (a node only accepts one
  // `ref` prop). No-ops harmlessly if `onOpenNode` was never passed in.
  const nodeChipClickRef = useNodeChipClick((topicId, nodeId) => onOpenNode?.(topicId, nodeId))
  const setSessionPaneRef = useCallback(
    (node: HTMLDivElement | null) => {
      equationCopyRef(node)
      nodeChipClickRef(node)
    },
    [equationCopyRef, nodeChipClickRef],
  )
  // The currently loaded topic graph's own node ids — EXACT match only, no
  // fuzzy/cross-topic guessing (see nodeChip.ts/markdownWithMath.ts). No new
  // fetch: `topicGraphCache` already exists for the why-chain panel above,
  // fetched once per topic open (`fetchTopicGraphCache`) and cleared on
  // every session reset/crossing — this just reads its `nodes` keys.
  const chipNodeIds = useMemo(
    () => (topicGraphCache ? new Set(Object.keys(topicGraphCache.nodes)) : new Set<string>()),
    [topicGraphCache],
  )

  // Chat Instruments Wave B — the transcript minimap. `learnProbes` is
  // reused as-is by `deriveInstrumentMoments` below (never re-parsed a
  // second time for a different purpose). Learn passes no `gradeBatches`/
  // `crossings` of its own: it never renders GradeResultCard inline (grades
  // surface only in the SessionCeremony stack/tally — see that component's
  // own render below), and its node-crossings arrive through `marks`
  // (`kind: 'crossing'`, pushed by `crossToNode`) rather than a separately
  // derived list the way Review's `deriveReviewCrossings` works.
  const learnProbes = useMemo(() => allProbeHeaders(messages), [messages])
  const minimapMoments = useMemo(() => deriveInstrumentMoments({ marks, probes: learnProbes }), [marks, learnProbes])

  // The closing-summary overlay's peek/pin state (ritual/SummaryOverlay) —
  // these hooks are APPENDED at the end of the existing hook list by
  // KeepMounted decree: this view mounts once and never remounts, so new
  // hooks may only ever be added after every existing one, never between.
  const [summaryPeek, setSummaryPeek] = useState(false)
  const [summaryPinned, setSummaryPinned] = useState(false)
  const summaryLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (summaryLeaveTimer.current) clearTimeout(summaryLeaveTimer.current)
    },
    [],
  )
  const summaryCtl = makePeek(summaryLeaveTimer, setSummaryPeek)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  // The shelf's ordering pick (appended hook, KeepMounted append rule) —
  // applied INSIDE each of the three buckets, never across them: the
  // bucketing answers "what state is this topic in", the sort answers
  // "which one first", and collapsing the two would lose the first
  // question. Persisted (topicSortPrefs) — a list-view preference, unlike
  // the sitting style's deliberate per-sitting reset.
  const [topicSort, setTopicSort] = useState<TopicSortKey>(loadTopicSort)
  // How the shelf partitions before sorting: the three state buckets
  // (default, unchanged behavior) or the learner's own folders.
  const [topicGroup, setTopicGroup] = useState<TopicGroupKey>(loadTopicGroup)
  // Organize mode + the empty-folder registry it needs (folderRegistry.ts's
  // doc comment explains why empty folders have to be a thing at all).
  // Organizing is deliberately NOT persisted: it's a mode you're in, not a
  // preference you hold, and coming back to a shelf still in jiggle-mode
  // would be a small surprise every time.
  const [organizing, setOrganizing] = useState(false)
  const [folderRegistry, setFolderRegistry] = useState<string[]>(loadFolderRegistry)
  const [newFolderDraft, setNewFolderDraft] = useState<string | null>(null)

  /** Writes one topic's folder, preserving every other setting — the
   * settings record is read-modify-written rather than reconstructed, so
   * filing can never clobber a topic's instructions or context files. */
  async function fileTopic(topicId: string, folder: string | null) {
    const current = await window.engram.getTopicSettings(topicId)
    await window.engram.setTopicSettings(topicId, { ...current, folder })
    refreshTopics()
  }

  function createFolder(raw: string) {
    const next = addFolderToRegistry(folderRegistry, raw)
    setFolderRegistry(next)
    saveFolderRegistry(next)
    setNewFolderDraft(null)
    // A brand-new folder is only visible in folder mode — switch there
    // rather than creating something the learner can't see.
    if (topicGroup !== 'folder') {
      setTopicGroup('folder')
      saveTopicGroup('folder')
    }
  }

  function deleteEmptyFolder(name: string) {
    const next = removeFolderFromRegistry(folderRegistry, name)
    setFolderRegistry(next)
    saveFolderRegistry(next)
  }
  // Minimap Precision fix (second report on the same bug) — jumps straight to
  // the checkpoint's OWN `CheckpointAnchor`, never the host message; see
  // shared/jumpToCheckpoint.ts's doctrine comment for the full root-cause
  // (H1: no per-checkpoint DOM anchor existed at all — a mark rendered
  // BETWEEN two messages had nothing of its own to scroll to, so the jump
  // landed on the NEXT message instead, leaving the checkpoint above the
  // viewport; H2: `content-visibility` layout settling drifts the landing
  // spot after the first scroll, corrected with a bounded two-pass re-check).
  function jumpToCheckpointMoment(moment: InstrumentMoment) {
    if (!scrollEl || messages.length === 0) return undefined
    const fallbackIndex = Math.min(Math.max(moment.atIndex, 0), messages.length - 1)
    // Returned (not fire-and-forget) so TranscriptMinimap can re-measure
    // glyph positions once the jump has actually settled — see that
    // component's own doctrine comment.
    return jumpToCheckpoint(scrollEl, moment.id, fallbackIndex)
  }

  return (
    // h-full from <main>'s flex-1 (see App.tsx); min-h-0 is required for the flex
    // children below to be allowed to shrink and scroll instead of growing forever.
    // In a live session the padding tightens — the transcript owns the window.
    <div
      // In a session the masthead rides right up against the window chrome
      // (pt-0.5) and the gap below it does the separating instead — the chat
      // gains the room the old top padding was holding.
      className={`h-full min-h-0 flex flex-col w-full ${started ? 'px-6 pt-0.5 pb-5 gap-3' : 'p-8 gap-4'}`}
      onMouseMove={started && messages.length > 0 ? handleSessionPointer : undefined}
    >
      {(() => {
        const mastheadCollapsed = started && messages.length > 0 && !mastheadPeek && !whyChainOpen && !mastheadPinned
        return (
          <>
            {mastheadCollapsed && (
              <div
                className="shrink-0 h-2 -mx-6 flex items-center justify-center group cursor-default"
                onMouseEnter={peekMasthead}
                aria-hidden="true"
              >
                <span className="h-px w-12 rounded bg-[var(--color-edge)] group-hover:bg-[var(--color-ink-warm-dim)] transition-colors duration-[var(--dur-fast)]" />
              </div>
            )}
            {started ? (
              <SessionMasthead
                accent="warm"
                eyebrow="LEARN"
                collapsed={mastheadCollapsed}
                headerRef={mastheadRef}
                onPeek={messages.length > 0 ? peekMasthead : undefined}
                onFocusPeek={peekMasthead}
                // In a session, the topic IS the page — one serif title, no
                // static "Learn" h1, no repeated title on the opening plate.
                title={activeTopic ? activeTopic.title : 'New topic'}
                // The identity sub-line: current node · position · walk, in
                // one compact mono lockup under the title. The why-chain
                // disclosure rides here, attached to the node it explains.
                identity={
                  currentNodeId || nodePosition || walkNumber != null ? (
                    <div
                      key={currentNodeId ?? 'none'}
                      className="label-data text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-faint)] flex items-center gap-1.5 min-w-0"
                    >
                      {currentNodeId && (
                        <span className="text-[var(--color-ink-warm)] truncate">{humanizeNodeId(currentNodeId)}</span>
                      )}
                      {nodePosition && (
                        <>
                          {currentNodeId && <span aria-hidden="true">·</span>}
                          <span className="shrink-0">node {nodePosition}</span>
                        </>
                      )}
                      {walkNumber != null && (
                        <>
                          {(currentNodeId || nodePosition) && <span aria-hidden="true">·</span>}
                          <span className="shrink-0">walk {walkNumber}</span>
                        </>
                      )}
                      {currentNodeId && whyChain.length > 0 && (
                        <button
                          onClick={() => setWhyChainOpen((v) => !v)}
                          className="focus-ring cmd-item shrink-0 lowercase tracking-[0.14em]"
                        >
                          why?
                        </button>
                      )}
                    </div>
                  ) : undefined
                }
                commands={
                  <>
                    {activeTopic && (
                      <button
                        onClick={() => setHistoryDrawerOpen(true)}
                        className="focus-ring cmd-item label-data text-[10px] uppercase tracking-[0.16em] shrink-0"
                      >
                        History
                      </button>
                    )}
                    {activeTopic && sessionId && (
                      <ExportCommand exporting={exportingFormat} onExport={exportCurrentSitting} />
                    )}
                    <button
                      onClick={backToTopics}
                      title="Leave this session view (the session keeps running)"
                      className="focus-ring cmd-item label-data text-[10px] uppercase tracking-[0.16em] shrink-0"
                    >
                      All topics
                    </button>
                    {messages.length > 0 && (
                      <span className="h-4 w-px bg-[var(--color-hairline)] shrink-0" aria-hidden="true" />
                    )}
                    {messages.length > 0 && (
                      <button
                        onClick={() => setMastheadPinned((v) => !v)}
                        aria-label={mastheadPinned ? 'Unpin header' : 'Pin header'}
                        title={mastheadPinned ? 'Unpin — tuck away unless the cursor visits the top' : 'Pin — keep the header out'}
                        className={`focus-ring no-press h-5 w-5 shrink-0 flex items-center justify-center transition-colors duration-[var(--dur-fast)] ${
                          mastheadPinned
                            ? 'text-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)]'
                            : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
                        }`}
                      >
                        <PinTackIcon pinned={mastheadPinned} size={14} />
                      </button>
                    )}
                  </>
                }
                instruments={
                  <>
                    <BeatStepper current={currentBeat} trail={beatTrail} />
                    {momentumOn && <FlowChain chain={trailingRecalled(sessionGrades)} />}
                    {momentumOn && sessionGrades.length > 0 && <InkWell results={sessionGrades} />}
                    {exportStatus && (
                      <span
                        className={`text-xs truncate max-w-[12rem] ${exportStatus.failed ? 'text-[var(--color-ink-danger)]' : 'text-[var(--color-text-faint)]'}`}
                        title={exportStatus.text}
                      >
                        {exportStatus.text}
                      </span>
                    )}
                    {/* Right instrument cluster — the sitting clock and
                        context gauge live on the instruments register now
                        (both environments read identically); the progress
                        note keeps its truncating right-aligned seat beside
                        them. Clock is live-only (see SittingClock's own
                        doctrine comment) — never in a replay. */}
                    <div className="ml-auto flex items-center gap-4 shrink-0 min-w-0">
                      {progressNote && (
                        <MathRenderer text={progressNote} inlineOnly className="fig-caption truncate min-w-0" />
                      )}
                      {sittingStartedAt !== null && <SittingClock startedAt={sittingStartedAt} running label="this sitting" />}
                      {contextUsage && (
                        <ContextGauge usedTokens={contextUsage.usedTokens} contextWindow={contextUsage.contextWindow} />
                      )}
                    </div>
                  </>
                }
                extra={
                  whyChainOpen && whyChain.length > 0 ? (
                    <div className="panel px-4 py-3 flex flex-col gap-2">
                      <div className="fig-caption">Fig. — why this is true</div>
                      {whyChain.map((step, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <InkNode id={`why-${i}`} variant="outlined" color="var(--color-ink-cool)" size={10} />
                          <span className="text-xs font-(family-name:--font-serif) text-[var(--color-text-dim)]">{step}</span>
                        </div>
                      ))}
                    </div>
                  ) : undefined
                }
              />
            ) : (
              /* The shelf header — not a session masthead: the static Learn
                 h1 with its briefing figure, under the same full-width
                 hairline command-bar band as before the plate extraction. */
              <header className="shrink-0 -mx-8 px-8 pb-2 border-b border-[var(--color-hairline)] flex flex-col gap-2">
                <h1 className="font-(family-name:--font-serif) text-[length:var(--text-display)] text-[var(--color-text-primary)]">Learn</h1>
                {/* The shelf's briefing figure (ui/PlateFigure — the ready-room
                    grammar): territory count as the headline, the atlas-wide due
                    total as its note. Same numbers the old faint one-line
                    subtitle carried, read off the same already-fetched `topics`
                    list (each entry's own `.due`), not a second fetch. Hidden
                    until topics have loaded so it never flashes "0 territories"
                    before the real count lands. */}
                {topics !== null && topics.length > 0 && (() => {
                  const atlasDue = topics.reduce((sum, t) => sum + t.due, 0)
                  return (
                    <div className="flex items-end justify-between gap-4">
                      <PlateFigure
                        value={topics.length}
                        tone="primary"
                        title={topics.length === 1 ? 'territory in the atlas' : 'territories in the atlas'}
                        note={
                          atlasDue > 0 ? (
                            <span className="text-[var(--color-ink-warm)]">{atlasDue} due across the atlas</span>
                          ) : (
                            'nothing due across the atlas'
                          )
                        }
                      />
                      {/* Hidden below two topics — a control that cannot
                          change anything is noise. Orders WITHIN each shelf
                          group; the groups themselves never move. */}
                      {topics.length > 1 && (
                        <div className="flex items-center gap-4 shrink-0 pb-1 flex-wrap justify-end">
                          <div className="flex items-center gap-2">
                            <span
                              id="learn-topic-group-label"
                              className="label-data text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-faint)]"
                            >
                              group
                            </span>
                            <SegmentedControl<TopicGroupKey>
                              ariaLabelledBy="learn-topic-group-label"
                              options={TOPIC_GROUP_OPTIONS}
                              value={topicGroup}
                              onChange={(v) => {
                                setTopicGroup(v)
                                saveTopicGroup(v)
                              }}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              id="learn-topic-sort-label"
                              className="label-data text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-faint)]"
                            >
                              sort
                            </span>
                            <SegmentedControl<TopicSortKey>
                              ariaLabelledBy="learn-topic-sort-label"
                              options={TOPIC_SORT_OPTIONS}
                              value={topicSort}
                              onChange={(v) => {
                                setTopicSort(v)
                                saveTopicSort(v)
                              }}
                            />
                          </div>
                          {/* Filing affordances. "New folder" is always
                              offered (creating one switches to folder view,
                              since an invisible new folder would be a dead
                              end); Organize only makes sense once you're
                              looking at folders. */}
                          <div className="flex items-center gap-2">
                            <Button variant="ghost" onClick={() => setNewFolderDraft('')}>
                              New folder
                            </Button>
                            {topicGroup === 'folder' && (
                              <Button
                                variant={organizing ? 'primary' : 'ghost'}
                                onClick={() => setOrganizing((v) => !v)}
                              >
                                {organizing ? 'Done' : 'Organize'}
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                      {newFolderDraft !== null && (
                        <form
                          className="flex items-center gap-2 justify-end"
                          onSubmit={(e) => {
                            e.preventDefault()
                            createFolder(newFolderDraft)
                          }}
                        >
                          <input
                            autoFocus
                            value={newFolderDraft}
                            onChange={(e) => setNewFolderDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setNewFolderDraft(null)
                            }}
                            placeholder="Folder name"
                            aria-label="New folder name"
                            className="focus-ring panel px-3 py-1.5 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)]"
                          />
                          <Button variant="primary" type="submit" disabled={newFolderDraft.trim().length === 0}>
                            Create
                          </Button>
                          {/* type="button" — a bare <button> inside a form
                              defaults to submit, so Cancel would create the
                              folder it means to abandon. */}
                          <Button variant="ghost" type="button" onClick={() => setNewFolderDraft(null)}>
                            Cancel
                          </Button>
                        </form>
                      )}
                    </div>
                  )
                })()}
              </header>
            )}
          </>
        )
      })()}

      {rateLimit && (
        <div className="shrink-0">
          <RateLimitBanner status={rateLimit.status} resetsAt={rateLimit.resetsAt} onRetry={() => setRateLimit(null)} />
        </div>
      )}
      {error && <ErrorPanel error={error} onDismiss={() => setError(null)} />}

      {!started && (() => {
        // Same three-bucket partition Home uses (topicBucket's doc comment) —
        // exhaustive, so whenever topics.length > 0 at least one group below
        // is non-empty.
        // Sorted within each bucket (see the topicSort hook's own comment for
        // why the two layers stay separate) — one shared ordering with the
        // map's tab strip, archived topics last, ties broken on title.
        const active = sortTopics(topics?.filter((t) => topicBucket(t) === 'active') ?? [], topicSort)
        const consolidated = sortTopics(topics?.filter((t) => topicBucket(t) === 'consolidated') ?? [], topicSort)
        const notStarted = sortTopics(topics?.filter((t) => topicBucket(t) === 'notStarted') ?? [], topicSort)
        const envBroken = envCheck !== null && !(envCheck.claudeOk && envCheck.pluginOk)
        return (
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
            {topics === null && (
              <>
                <div className="fig-caption">reading your topics…</div>
                <TopicListSkeleton />
              </>
            )}
            {/* Same envCheck gate as HomeView's empty state — topics() routinely
                resolves before environmentCheck() (up to ~10s spawning `claude
                --version`), so the guided-vs-plain decision waits on it too. */}
            {topics !== null && topics.length === 0 && envCheck === null && <TopicListSkeleton />}
            {topics !== null && topics.length === 0 && envBroken && envCheck && (
              <div className="flex flex-col items-start gap-3 py-10 w-full max-w-lg">
                <div className="fig-caption">Fig. — setup needed before your first topic</div>
                <div className="font-(family-name:--font-serif) text-[length:var(--text-display)] text-[var(--color-text-primary)]">
                  Two things first.
                </div>
                <p className="text-sm text-[var(--color-text-dim)] max-w-md">
                  Engram Desktop scripts the Claude Code CLI directly — both of these need to be in place before a
                  topic can start.
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
              <Card className="px-5 py-4 flex flex-col gap-3 items-start">
                <div className="fig-caption">Fig. — no territories mapped yet</div>
                <div className="font-(family-name:--font-serif) text-[length:var(--text-display)] text-[var(--color-text-primary)]">
                  Every topic starts as a first-principles map.
                </div>
                <Button
                  variant="primary"
                  onClick={() => {
                    setModalPrefill(null)
                    setNewerLinkIgnored(false)
                    setNewTopicOpen(true)
                  }}
                  disabled={rateLimitBlocking}
                >
                  Start your first topic
                </Button>
              </Card>
            )}

            {topics !== null && topics.length > 0 && (
              <div className="flex flex-col gap-6">
                {topicGroup === 'folder' ? (
                  // The learner's own filing replaces the state buckets —
                  // one grouping at a time, because two nested groupings on
                  // one shelf read as a filing cabinet, not a shelf. Every
                  // topic still appears exactly once (groupTopicsByFolder is
                  // a partition), sorted inside its folder by the same key.
                  // While organizing, empty folders and an empty Unfiled
                  // stay drawn so every drop target exists before the drag.
                  <FolderShelf
                    groups={groupTopicsByFolder(topics, topicSort, {
                      alwaysShow: organizing ? allFolderNames(topics, folderRegistry) : undefined,
                      includeEmptyUnfiled: organizing,
                    })}
                    organizing={organizing}
                    allFolders={allFolderNames(topics, folderRegistry)}
                    resumableTopics={resumableTopics}
                    onOpen={openTopic}
                    onSettings={setSettingsFor}
                    onStartFresh={startFreshForTopic}
                    onFile={(id, folder) => void fileTopic(id, folder)}
                    onDeleteFolder={deleteEmptyFolder}
                  />
                ) : (
                  <>
                <LearnTopicGroup
                  heading="Continue learning"
                  topics={active}
                  resumableTopics={resumableTopics}
                  onOpen={openTopic}
                  onSettings={setSettingsFor}
                  onStartFresh={startFreshForTopic}
                />
                <LearnTopicGroup
                  heading="Consolidated"
                  caption="fully encoded — held by review alone"
                  topics={consolidated}
                  resumableTopics={resumableTopics}
                  onOpen={openTopic}
                  onSettings={setSettingsFor}
                  onStartFresh={startFreshForTopic}
                />
                <LearnTopicGroup
                  heading="Not started"
                  topics={notStarted}
                  resumableTopics={resumableTopics}
                  onOpen={openTopic}
                  onSettings={setSettingsFor}
                  onStartFresh={startFreshForTopic}
                />
                  </>
                )}
                {/* The shelf's last card, not a floating button below the list —
                    see AddTerritoryCard's doctrine comment. */}
                <AddTerritoryCard
                  onClick={() => {
                    setModalPrefill(null)
                    setNewerLinkIgnored(false)
                    setNewTopicOpen(true)
                  }}
                  blocked={rateLimitBlocking}
                />
              </div>
            )}
          </div>
        )
      })()}

      {started && (
        <div ref={setSessionPaneRef} className="flex-1 min-h-0 flex flex-col gap-4">
          <div className="shrink-0">
            <JobsRail jobs={jobs} onOpenArtifact={(p) => window.engram.openArtifact(p)} />
          </div>

          {/* The only scrolling region in the session view — header and input stay anchored. */}
          {/* Must be a flex column: ChatScrollRegion sizes itself with
              flex-1/min-h-0 and loses its height bound (killing scrolling)
              inside a plain block wrapper. `relative` hosts the floating
              session ticket so the transcript flows underneath it instead of
              ceding a whole layout row. */}
          <div className={`relative flex-1 min-h-0 flex flex-col${chamber ? ' chamber-blur' : ''}`}>
            {latestTicket && (() => {
              const ticketOut = ticketPinned || ticketPeek
              return (
                <>
                  {!ticketOut && (
                    <div className="absolute left-0 top-2 z-10 h-16 w-3.5 flex items-center justify-start" aria-hidden="true">
                      <span className="w-px h-12 rounded bg-[var(--color-hairline)]" />
                    </div>
                  )}
                  {/* Unfolds left→right: grid 0fr↔1fr animates to the card's
                      true width, and the inner fixed-width layer keeps the
                      content from reflowing as the column opens — so it reads
                      as the card being unclipped from the edge, not squeezed.
                      Horizontal twin of the masthead's 0fr↔1fr collapse. */}
                  <div
                    className={`absolute top-1 left-0 z-10 grid transition-[grid-template-columns,opacity] ${
                      ticketOut
                        ? 'duration-[var(--dur-base)] ease-[var(--ease-out-soft)] opacity-100'
                        : 'duration-[340ms] ease-[cubic-bezier(0.45,0.05,0.25,1)] opacity-0'
                    }`}
                    style={{ gridTemplateColumns: ticketOut ? '1fr' : '0fr' }}
                  >
                    <div className="min-w-0 overflow-hidden">
                    <div className="relative w-72">
                      <TicketCard ticket={latestTicket} walkNumber={walkNumber} compact pinned={ticketPinned} />
                      <button
                        onClick={() => setTicketPinned((v) => !v)}
                        aria-label={ticketPinned ? 'Unpin session ticket' : 'Pin session ticket'}
                        title={ticketPinned ? 'Unpin — tuck away unless the cursor visits the left edge' : 'Pin — keep the ticket out'}
                        className={`focus-ring no-press absolute bottom-1.5 right-1.5 h-5 w-5 flex items-center justify-center transition-colors duration-[var(--dur-fast)] ${
                          ticketPinned
                            ? 'text-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)]'
                            : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
                        }`}
                      >
                        <PinTackIcon pinned={ticketPinned} size={14} />
                      </button>
                    </div>
                    </div>
                  </div>
                </>
              )
            })()}
            <ChatScrollRegion
              deps={[messages, busy, marks]}
              onContainerRef={setScrollEl}
              railSlot={
                <TranscriptMinimap
                  moments={minimapMoments}
                  totalMessages={messages.length}
                  containerEl={scrollEl}
                  onJump={jumpToCheckpointMoment}
                />
              }
            >
              <div className="transcript-measure flex flex-col gap-5 pt-4">
                {activeTopic != null && sessionPhase !== 'intake' && (
                  <SessionOpenPlate walkNumber={walkNumber} date={new Date()} recap={lastWalk} />
                )}
                {marks.filter((k) => k.atIndex === 0).map((k) => (
                  <MarkView key={k.id} mark={k} onAnswerAsk={answerAsk} suppressBeatExcerpt={messages[k.atIndex]?.role === 'assistant'} />
                ))}
                {messages.map((m, i) => (
                  <Fragment key={m.id}>
                    <ChatMessageView
                      message={m}
                      onEditResend={m.role === 'user' && m.id === lastUserMessageId && !busy ? editResend : undefined}
                      // Chat Presence Wave D Task 9 — only the transcript's
                      // very last message, only while it's the live growing
                      // assistant bubble.
                      trailingCaret={busy && i === messages.length - 1 && m.role === 'assistant' && tutorActivity.activity.kind === 'streaming'}
                      previousTimestamp={messages[i - 1]?.timestamp}
                      dataIndex={i}
                      nodeIds={chipNodeIds}
                      nodeChipTopic={activeTopic?.topic}
                      probeAccent="warm"
                    />
                    {marks
                      .filter((k) => k.atIndex === i + 1 || (i === messages.length - 1 && k.atIndex > messages.length))
                      .map((k) => (
                        // suppressBeatExcerpt: `messages[k.atIndex]` is the very
                        // message this mark renders immediately before — when
                        // it's assistant prose (the beat's own full text, since
                        // the interleave fix), the marker drops its redundant
                        // excerpt; a tail mark (atIndex past the end) keeps it.
                        <MarkView key={k.id} mark={k} onAnswerAsk={answerAsk} suppressBeatExcerpt={messages[k.atIndex]?.role === 'assistant'} />
                      ))}
                  </Fragment>
                ))}
                {busy && (
                  <div className="flex items-center gap-2">
                    <ActivityLine activity={tutorActivity.activity} />
                    <button
                      onClick={stopSession}
                      className="focus-ring text-xs px-2.5 py-1 rounded-lg text-[var(--color-text-faint)] hover:text-[var(--color-ink-danger)] hover:bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)]"
                    >
                      Stop
                    </button>
                  </div>
                )}
                {busy && stalled && (
                  <div className="fig-caption text-[var(--color-ink-warm)]">
                    No response in over a minute — the app is still running; Stop above cancels it if you'd rather not wait.
                  </div>
                )}
              </div>
            </ChatScrollRegion>
            {/* The walk's running ceremony — no longer an inline shrink-0
                block stealing transcript height: the shared bottom-edge
                overlay (ritual/SummaryOverlay, same grammar as Review's
                closing summary) holds it, revealed by the container's
                bottom strip or the nub, pinned to stay out. */}
            {sessionGrades.length > 0 && (
              <SummaryOverlay
                accent="warm"
                pinned={summaryPinned}
                peek={summaryPeek}
                onPeek={summaryCtl.peek}
                onTogglePin={() => setSummaryPinned((v) => !v)}
                caption="the walk’s record so far"
              >
                <SessionCeremony
                  results={sessionGrades}
                  streakDays={streakDays}
                  commitment={commitment}
                  heading="The walk, recorded"
                  label="graded"
                />
              </SummaryOverlay>
            )}
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

          {/* Chat Presence Wave D Task 10 — the generic 90s idle cue (Review's
              own, earlier 45s honest-blank affordance has no Learn
              equivalent, so there's nothing here to double-fire alongside). */}
          {tutorActivity.activity.kind === 'awaiting-learner' && !busy && (
            <div className="shrink-0 fig-caption px-1">still here — whenever you're ready</div>
          )}
          {tutorActivity.activity.kind === 'ended' && (
            <div className="shrink-0 fig-caption px-1">this sitting has closed · session history holds the record</div>
          )}

          {/* Chat Presence Wave E, Task 11 — the composer stays mounted (just
              disabled, via disabledReason below) while an ask is open, so
              the inline AskCard sits alongside a visibly-locked composer
              rather than the composer vanishing outright the way it did
              under the old modal. Every other `busy` reason still hides it
              exactly as before. */}
          {(!busy || tutorActivity.activity.kind === 'awaiting-ask') && (
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
              disabledReason={composerDisabledReason(tutorActivity.activity)}
            />
          )}
        </div>
      )}

      {activeTopic && (
        <SessionHistoryDrawer
          historyKey={activeTopic.topic}
          title={activeTopic.title}
          open={historyDrawerOpen}
          onClose={() => setHistoryDrawerOpen(false)}
        />
      )}
      {settingsFor && (
        <TopicSettingsModal
          topicId={settingsFor.topic}
          topicTitle={settingsFor.title}
          onClose={() => {
            setSettingsFor(null)
            // A save may have just changed this topic's display name — and
            // this view is KeepMounted (never remounts), so without an
            // explicit refetch the shelf would keep the old title until the
            // app restarts. getTopicsCached applies the rename overlay per
            // call, so one refetch is all it takes.
            refreshTopics()
          }}
        />
      )}
      {newTopicOpen && (
        <NewTopicModal
          key={prefillEpoch}
          onClose={() => {
            setNewTopicOpen(false)
            setModalPrefill(null)
            setNewerLinkIgnored(false)
          }}
          onStart={startNewTopic}
          initialGoal={modalPrefill?.goal}
          initialInstructions={modalPrefill?.instructions}
          initialFiles={modalPrefill?.contextFiles}
          externalOrigin={modalPrefill !== null}
          droppedContextFileCount={modalPrefill?.droppedContextFileCount}
          newerLinkIgnored={newerLinkIgnored}
        />
      )}
    </div>
  )
}
