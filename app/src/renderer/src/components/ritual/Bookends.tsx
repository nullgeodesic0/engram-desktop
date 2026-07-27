import { memo } from 'react'
import { GradeTally } from '../GradeTally'
import type { GradeResult } from '../../../../shared/gradeResult'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { StabilityMovement } from '../charts/StabilityMovement'
import { MathRenderer } from '../MathRenderer'

/** Ceremonial first element of a Learn session's transcript. */
/** A single ceremonial opener line — the topic title and frontier node live
 * in the session masthead now, so the plate only marks the sitting itself. */
export const SessionOpenPlate = memo(function SessionOpenPlate({
  walkNumber,
  date,
  recap = null,
}: {
  walkNumber: number | null
  date: Date
  /** The previous sitting's outcome (extractLastWalkFromTranscript) — the
   * plate acknowledges the story so far. Null on a topic's first walk. */
  recap?: { graded: number; shaky: string[] } | null
}) {
  const dateText = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const recapText =
    recap == null
      ? ''
      : recap.shaky.length === 0
        ? ` · last walk: ${recap.graded} graded, all held`
        : ` · last walk: ${recap.graded} graded, ${recap.shaky.length === 1 ? 'one shaky' : `${recap.shaky.length} shaky`} — ${humanizeNodeId(recap.shaky[0])}`
  return (
    <div className="border-b border-[var(--color-hairline)] pb-3">
      <div className="fig-caption">
        Fig. — {walkNumber != null ? `Walk ${walkNumber}, ` : ''}
        {dateText}
        {recapText}
      </div>
    </div>
  )
})

/** End-of-walk ceremony — tally, stability movements, next-due, and the
 * return commitment framed as a signed ledger entry. Shared by Learn (fires
 * when a receipt batch lands) and Review (done phase). */
export const SessionCeremony = memo(function SessionCeremony({
  results,
  streakDays,
  commitment,
  heading,
  label,
}: {
  results: GradeResult[]
  streakDays: number | null
  commitment: string | null
  heading: string
  label: string
}) {
  const nextDue =
    results.length > 0
      ? Math.min(...results.map((r) => r.intervalDays ?? Infinity).filter((d) => d !== Infinity))
      : null
  const nextDueValue = results.length > 0 && nextDue !== Infinity ? nextDue : null
  return (
    <div className="panel-raised p-4 flex flex-col gap-3 max-w-md">
      <div className="font-[var(--font-serif)] text-[length:var(--text-heading)] text-[var(--color-text-primary)]">
        {heading}
      </div>
      <GradeTally results={results} streakDays={streakDays} label={label} />
      <StabilityMovement results={results} />
      {nextDueValue != null && (
        <div className="fig-caption">
          Fig. — earliest return in {nextDueValue} {nextDueValue === 1 ? 'day' : 'days'}
        </div>
      )}
      {commitment && (
        <div className="border-t border-[var(--color-hairline)] pt-2.5 font-[var(--font-serif)] italic text-xs text-[var(--color-text-dim)] flex items-baseline gap-1 flex-wrap">
          <span>“</span>
          <MathRenderer text={commitment} inlineOnly />
          <span>”</span>
          <span className="not-italic label-data text-[10px] text-[var(--color-text-faint)]">— signed</span>
        </div>
      )}
    </div>
  )
})
