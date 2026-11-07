import { memo } from 'react'
import { GradeTally } from '../GradeTally'
import type { GradeResult } from '../../../../shared/gradeResult'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { StabilityMovement } from '../charts/StabilityMovement'
import { MathRenderer } from '../MathRenderer'
import { PlateFigure } from '../ui/PlateFigure'
import { latestPickFor } from '../../shared/calibrationStore'
import { sittingPayoff, confidentMisses } from '../../shared/sittingPayoff'

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

/** End-of-walk ceremony — payoff, stability movements, tally, next-due, and
 * the return commitment as the closing act. Shared by Learn (fires when a
 * receipt batch lands) and Review (done phase). `.tilt-card-soft` — a
 * chat-transcript card, missed in the first tilt pass. */
export const SessionCeremony = memo(function SessionCeremony({
  results,
  commitment,
  heading,
  label,
  momentumOn = true,
}: {
  results: GradeResult[]
  /** settings.momentum !== 'off'. A learner who opted out of momentum
   * language gets the plain graded-count headline, never the payoff line. */
  momentumOn?: boolean
  /** Accepted for call-site compatibility and deliberately not rendered. */
  streakDays?: number | null
  commitment: string | null
  heading: string
  label: string
}) {
  const nextDue =
    results.length > 0
      ? Math.min(...results.map((r) => r.intervalDays ?? Infinity).filter((d) => d !== Infinity))
      : null
  const nextDueValue = results.length > 0 && nextDue !== Infinity ? nextDue : null
  const payoff = sittingPayoff(results)
  const misses = confidentMisses(results, (node) => latestPickFor(node)?.label ?? null)
  return (
    <div className="tilt-card-soft panel-raised p-4 flex flex-col gap-3 max-w-md">
      {/* Payoff first: memories that hold longer than they did this morning.
          When nothing strengthened (a sitting of lapses), the figure falls
          back to the graded count — never a zero dressed as a headline. */}
      {momentumOn && payoff.strengthened > 0 ? (
        <PlateFigure
          value={payoff.strengthened}
          tone="warm"
          title={payoff.strengthened === 1 ? 'memory now holds longer' : 'memories now hold longer'}
          note={
            payoff.holdWeek > 0
              ? `${payoff.holdWeek} newly holding a week or more · ${results.length} ${label} · ${heading.toLowerCase()}`
              : `${results.length} ${label} · ${heading.toLowerCase()}`
          }
        />
      ) : (
        <PlateFigure value={results.length} tone="warm" title={heading} note={`${label} this sitting`} />
      )}
      <StabilityMovement results={results} />
      <GradeTally results={results} label={label} omitTotal />
      {misses.length > 0 && (
        <div className="text-xs text-[var(--color-ink-cool)] leading-relaxed flex flex-col gap-0.5">
          <span>
            <span aria-hidden="true" className="text-[9px] mr-1">△</span>
            Felt sure, came back different — the easiest kind to fix with a second look soon:
          </span>
          <span className="label-data text-[11px] text-[var(--color-text-dim)]">
            {misses.map((n) => humanizeNodeId(n)).join(' · ')}
          </span>
        </div>
      )}
      {nextDueValue != null && (
        <div className="fig-caption">
          Fig. — earliest return in {nextDueValue} {nextDueValue === 1 ? 'day' : 'days'}
        </div>
      )}
      {/* The return commitment is the closing act, not a footnote: an
          if-then plan is one of the best-supported tools for the step after
          this one (Gollwitzer & Sheeran 2006, d = 0.65), and in ADHD it
          specifically (Gawrilow & Gollwitzer 2008). */}
      {commitment ? (
        <div className="border-t border-[var(--color-hairline)] pt-3 flex flex-col gap-1">
          <span className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]">your return plan</span>
          <div className="font-(family-name:--font-serif) text-sm text-[var(--color-ink-warm)] flex items-baseline gap-1 flex-wrap">
            <MathRenderer text={commitment} inlineOnly />
            <span className="label-data text-[10px] text-[var(--color-text-faint)]">— signed</span>
          </div>
        </div>
      ) : (
        <div className="border-t border-[var(--color-hairline)] pt-3 text-xs text-[var(--color-text-dim)] leading-relaxed">
          No return plan yet. Before you go, tell the tutor <em>when</em> you will be back and what you will do
          first (“after dinner on Thursday, I open a 15-minute review”). A specific when-then plan makes coming
          back much more likely.
        </div>
      )}
    </div>
  )
})
