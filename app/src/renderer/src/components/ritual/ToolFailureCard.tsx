import { memo } from 'react'
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
  return (
    <div className="flex justify-start my-1.5 pl-1">
      <div className="tilt-card-soft max-w-[92%] flex flex-col gap-1 rounded-md border border-[var(--color-ink-warm-dim)] px-3 py-2.5 ritual-misconception-in">
        <span className="text-xs text-[var(--color-ink-warm)]">{FAILURE_HEADLINE[failureKind]}</span>
        <span className="fig-caption">the tutor usually follows up and retries.</span>
      </div>
    </div>
  )
})
