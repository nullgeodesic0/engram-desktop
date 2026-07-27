/** Chat Presence, Wave D Task 8 — a renderer-local classifier of "what is the
 * tutor doing right now," fed the same `SessionEvent`s already flowing into
 * both session views' `handleSessionEvent`, plus two renderer-only actions
 * (`ask-opened`/`ask-answered`) mirroring the existing onBridgeAsk/answerAsk
 * call sites.
 *
 * LIVE-ONLY, deliberately: unlike `shared/ritualFromTranscript.ts`'s marks,
 * there is no `deriveTutorActivity(transcript)` replay counterpart, and there
 * must never be one. A resumed session always starts here at `idle` — see
 * `reset()` below, which both views call at the top of `startSession` (fresh
 * AND resume) for exactly that reason. Presence is a live-wire notion (what
 * IS the tutor doing, this instant); a saved transcript has no "instant" to
 * report on.
 *
 * Introduced ADDITIVELY: both session views keep computing their existing
 * `busy` boolean exactly as before. `activity` is a parallel, finer-grained
 * signal — nothing here replaces `busy`, and nothing here is read by replay,
 * history, or export code. */

import { useEffect, useReducer, useState } from 'react'
import type { SessionEvent } from '../../../shared/sessionEvents'
import { isBlockingRateLimitStatus } from '../../../shared/rateLimit'
import {
  isNextNodeCommand,
  isPretestRateCommand,
  isReviewRateCommand,
  isReceiptCommand,
  isStashCommand,
  isSubagentSpawnTool,
  isArtifactSmithSpawnEvent,
  isAssessorSpawnEvent,
} from '../../../shared/signals/tutorSignals'

export type TutorActivity =
  | { kind: 'idle' }
  | { kind: 'streaming' }
  | { kind: 'tool'; label: string; toolName: string }
  | { kind: 'grading'; stage: 'stashing' | 'assessing' }
  | { kind: 'awaiting-ask' }
  | { kind: 'awaiting-learner' }
  | { kind: 'ended'; reason: 'closed' | 'stopped' | 'rate-limited' }

type Action =
  | { type: 'session-event'; event: SessionEvent }
  | { type: 'ask-opened' }
  | { type: 'ask-answered' }
  | { type: 'stopped' }
  | { type: 'grading-phase-entered' }
  | { type: 'reset' }

interface State {
  activity: TutorActivity
  /** The one tool_use id whose tool_result should carry `activity` back to
   * `streaming` — set whenever a `tool_use` is classified into a labeled
   * `tool` activity, cleared (without effect) by any other tool_result. */
  pendingToolUseId: string | null
  /** True from the assessor's spawn until whichever resolves it first: a
   * live `task_notification` (Wave A's audit-verdict wire, Review only) or
   * the batch `receipt --file` call (Learn's own grading path, which never
   * emits a task_notification at all). Sticky across `text`/`turn_ended` —
   * the assessor is a background subagent; the foreground turn ending, or
   * the tutor narrating in the meantime, doesn't mean it finished. */
  assessorPending: boolean
  /** Set by the view's own Stop button (`dispatchStopped`) BEFORE it calls
   * `abortSession` — distinguishes an intentional stop from the process
   * exiting on its own when the `closed` event actually arrives, mirroring
   * both views' existing `abortedRef`/`intentionalStopRef` discipline. */
  stopping: boolean
}

const IDLE_STATE: State = { activity: { kind: 'idle' }, pendingToolUseId: null, assessorPending: false, stopping: false }

function commandOf(input: Record<string, unknown>): string {
  return String((input as { command?: unknown }).command ?? '')
}

/** Bash/spawn `tool_use` -> a labeled `tool` activity, or `null` when this
 * call isn't one of the app's own named vocabulary (a plain `Read`/`Edit`, an
 * `AskUserQuestion`, or an unrelated Bash one-off) — those still count as
 * "streaming" (the tutor is doing SOMETHING) but earn no specific label.
 * Priority mirrors `tutorSignals.ts`'s own discipline: specific checks before
 * the generic `engram.py` fallback. `Write` is folded into "filing your
 * production" alongside the `stash` Bash call itself — a real /learn turn
 * writes the learner's answer to a scratch file immediately before stashing
 * it (SKILL.md's VERIFY step), and both moments are the same narrated act
 * from the learner's side of the glass. */
function classifyToolActivity(name: string, input: Record<string, unknown>): { label: string; toolName: string } | null {
  if (name === 'Write') return { label: 'filing your production', toolName: 'stash' }
  if (isSubagentSpawnTool(name)) {
    if (isArtifactSmithSpawnEvent(name, input)) return { label: 'forging an explorable', toolName: 'artifact-smith' }
    if (JSON.stringify(input).includes('curriculum-architect')) return { label: 'drawing the atlas', toolName: 'curriculum-architect' }
    return null
  }
  if (name !== 'Bash') return null
  const command = commandOf(input)
  if (isNextNodeCommand(command)) return { label: 'consulting the schedule', toolName: 'next' }
  if (isStashCommand(command)) return { label: 'filing your production', toolName: 'stash' }
  if (isReceiptCommand(command)) return { label: 'applying the receipts', toolName: 'receipt' }
  if (isPretestRateCommand(command) || isReviewRateCommand(command)) return { label: 'checking your recall', toolName: 'rate' }
  if (command.includes('engram.py')) return { label: 'consulting your record', toolName: 'engram-bash' }
  return null
}

function reduceEvent(state: State, event: SessionEvent): State {
  switch (event.type) {
    case 'text':
      // Grading is sticky (see the `assessorPending` doctrine comment above) —
      // a text delta arriving mid-grade (the tutor narrating while the
      // background assessor works) must not read as "back to plain streaming."
      if (state.assessorPending) return state
      if (state.activity.kind === 'streaming') return state
      return { ...state, activity: { kind: 'streaming' } }
    case 'tool_use': {
      if (isAssessorSpawnEvent(event.name, event.input)) {
        return { ...state, assessorPending: true, pendingToolUseId: null, activity: { kind: 'grading', stage: 'assessing' } }
      }
      if (state.assessorPending) {
        // The OTHER way grading ends: /learn's batch-grade path never spawns
        // a live task_notification at all (see Wave A's report — Learn has
        // no async verification-spawn resolution today), so the `receipt`
        // call landing is the only live signal it gets. Whichever comes
        // first (this, or a `task_notification` below) resolves it; anything
        // else observed while the assessor is pending leaves grading alone.
        if (event.name === 'Bash' && isReceiptCommand(commandOf(event.input))) {
          return {
            ...state,
            assessorPending: false,
            pendingToolUseId: event.id,
            activity: { kind: 'tool', label: 'applying the receipts', toolName: 'receipt' },
          }
        }
        return state
      }
      const classified = classifyToolActivity(event.name, event.input)
      if (!classified) return { ...state, pendingToolUseId: null, activity: { kind: 'streaming' } }
      return { ...state, pendingToolUseId: event.id, activity: { kind: 'tool', label: classified.label, toolName: classified.toolName } }
    }
    case 'tool_result':
      if (event.toolUseId !== state.pendingToolUseId) return state
      return { ...state, pendingToolUseId: null, activity: { kind: 'streaming' } }
    case 'task_notification':
      // Wave A's live audit-verdict wire — Review's own way the assessor's
      // spawn resolves. See the `assessorPending` doctrine comment.
      if (!state.assessorPending) return state
      return { ...state, assessorPending: false, activity: { kind: 'streaming' } }
    case 'rate_limit': {
      const blocking = isBlockingRateLimitStatus(event.status)
      if (blocking) return { ...state, activity: { kind: 'ended', reason: 'rate-limited' } }
      if (state.activity.kind === 'ended' && state.activity.reason === 'rate-limited') {
        return { ...state, activity: { kind: 'streaming' } }
      }
      return state
    }
    case 'turn_ended':
      // Grading can genuinely outlive the foreground turn — a background
      // assessor spawn keeps working after the model's own turn closes
      // (real for Review's audit; see the concrete transcript in the report).
      // Don't clear it here.
      if (state.assessorPending) return state
      if (state.activity.kind === 'idle') return state
      return { ...state, pendingToolUseId: null, activity: { kind: 'idle' } }
    case 'closed':
      return { ...state, activity: { kind: 'ended', reason: state.stopping ? 'stopped' : 'closed' } }
    default:
      return state
  }
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return IDLE_STATE
    case 'ask-opened':
      return { ...state, activity: { kind: 'awaiting-ask' } }
    case 'ask-answered':
      return { ...state, activity: { kind: 'streaming' } }
    case 'stopped':
      return { ...state, stopping: true }
    case 'grading-phase-entered':
      // Learn-only (see `session_phase: 'grading'`, the bridge:ui call this
      // is fed from — Review has no such phase concept): the batch has moved
      // into grading, ahead of the assessor's own spawn. Sticky the same way
      // `assessorPending` already is for the `assessing` stage below — a
      // stray tool_use/text before the real spawn shouldn't flicker back to
      // plain streaming when the loop has already announced it's grading.
      // `isAssessorSpawnEvent` promotes this to `assessing` when the real
      // spawn is observed (checked first in `reduceEvent`'s `tool_use` case,
      // regardless of `assessorPending`'s prior value).
      if (state.assessorPending) return state
      return { ...state, assessorPending: true, activity: { kind: 'grading', stage: 'stashing' } }
    case 'session-event':
      return reduceEvent(state, action.event)
    default:
      return state
  }
}

const AWAITING_LEARNER_MS = 90_000

/** The hook both session views mount once. `activity` layers one more thing
 * on top of the pure reducer above: `awaiting-learner`, a wall-clock idle cue
 * (the generic counterpart of Review's own 45s honest-blank timer — see
 * `ReviewSessionView.tsx`'s `honestBlankReady`, which this deliberately does
 * NOT duplicate; callers gate the two independently, see Task 10's wiring).
 * Kept out of the pure reducer itself (`reduceEvent` has no notion of wall
 * time) exactly the way `honestBlankReady` is its own timer effect rather
 * than reducer state. */
export function useTutorActivity() {
  const [state, dispatch] = useReducer(reduce, IDLE_STATE)
  const [idleTimedOut, setIdleTimedOut] = useState(false)

  useEffect(() => {
    setIdleTimedOut(false)
    if (state.activity.kind !== 'idle') return
    const t = setTimeout(() => setIdleTimedOut(true), AWAITING_LEARNER_MS)
    return () => clearTimeout(t)
    // Only re-arms when the activity KIND changes to/from 'idle' — a same-kind
    // no-op dispatch (e.g. a redundant turn_ended) must not restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activity.kind])

  const activity: TutorActivity = idleTimedOut && state.activity.kind === 'idle' ? { kind: 'awaiting-learner' } : state.activity

  return {
    activity,
    dispatchSessionEvent: (event: SessionEvent) => dispatch({ type: 'session-event', event }),
    dispatchAskOpened: () => dispatch({ type: 'ask-opened' }),
    dispatchAskAnswered: () => dispatch({ type: 'ask-answered' }),
    dispatchStopped: () => dispatch({ type: 'stopped' }),
    dispatchGradingPhaseEntered: () => dispatch({ type: 'grading-phase-entered' }),
    reset: () => dispatch({ type: 'reset' }),
  }
}

/** MessageComposer's quiet disabled-reason line (Task 10) — never scolding,
 * just naming what's happening. `null` for `idle`/`awaiting-learner` (the
 * composer is simply waiting for you, nothing to explain) and for `ended`
 * (a different, persistent end-of-sitting line covers that — see both
 * session views' render). */
export function composerDisabledReason(activity: TutorActivity): string | null {
  switch (activity.kind) {
    case 'streaming':
    case 'tool':
      return 'the tutor is mid-thought'
    case 'grading':
      return 'the assessor is examining your work'
    case 'awaiting-ask':
      // The modal AskDialog is today's real surface for this moment (see the
      // module doctrine comment) — this line is here for Wave E's inline
      // card, which will need the composer visible alongside the question.
      return 'answer the question above'
    default:
      return null
  }
}
