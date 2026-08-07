import { memo } from 'react'
import { MarkFrame } from './MarkFrame'
import type { ToolFailureKind } from '../../../../shared/signals/tutorSignals'

/** Headline per failure kind — names what was actually being attempted rather
 * than a generic "something went wrong". Kept as full, already-punctuated
 * sentences (not composed from a fragment) so each kind's grammar reads
 * naturally on its own. */
const FAILURE_HEADLINE: Record<ToolFailureKind, string> = {
  pretest: 'The pretest check didn’t land.',
  receipt: 'The grading receipt didn’t land.',
  stash: 'The production wasn’t filed.',
  next: 'Picking the next node didn’t land.',
  'artifact-set': 'The explorable didn’t register.',
  misconception: 'That misconception ledger call didn’t land.',
  'review-rate': 'The grade didn’t land.',
  'engram-bash': 'An engram call didn’t land.',
}

/** Honest, calm record of an engram call whose `tool_result` came back
 * `isError` — today those fail silently (see the brief for `classify
 * EngramBashFailure`, shared/signals/tutorSignals.ts, and the wiring in both
 * session views' `tool_use`/`tool_result` handlers). No alarm-red: real
 * transcripts inspected before writing this (see task-6-7 report) show the
 * tutor overwhelmingly retries the SAME call within the same turn or the
 * next one — this is friction, not a stoppage, so it gets the same warm ink
 * LapseRite/MilestoneCard use for "a fact worth naming, not a crisis" rather
 * than MisconceptionPin's/GradeResultCard's danger red (reserved for content
 * this app is already confident is bad news: a caught misconception, a
 * lapsed grade). Derivable — see deriveRitualMarks in
 * shared/ritualFromTranscript.ts, which rebuilds this mark from the same
 * failed tool_result a resumed sitting's transcript already carries. */
export const ToolFailureCard = memo(function ToolFailureCard({ failureKind }: { failureKind: ToolFailureKind }) {
  // The frame carries the warm ink through to the ENTRANCE too. This card
  // previously wore `.ritual-misconception-in` — a danger-toned wash on a
  // warm-bordered card, which briefly read as an alarm every time an ordinary
  // retryable call hiccuped. Exactly the accent/entrance mismatch MarkFrame
  // exists to make impossible.
  return (
    <MarkFrame
      accent="warm"
      label="CALL DIDN’T LAND"
      gap="tight"
      glyph={
        <>
          <circle cx="7" cy="7" r="5.3" stroke="currentColor" strokeWidth="1.1" />
          <path d="M7 4.2 V7.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="7" cy="9.8" r="0.7" fill="currentColor" />
        </>
      }
    >
      <span className="text-xs text-[var(--color-text-primary)]">{FAILURE_HEADLINE[failureKind]}</span>
      <span className="fig-caption">the tutor usually follows up and retries.</span>
    </MarkFrame>
  )
})
