import { memo } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import type { StabilityMilestoneScale } from '../../../../shared/gradeResult'

const SCALE_TEXT: Record<StabilityMilestoneScale, string> = {
  week: 'holding for a week now',
  month: 'holding for a month now',
}

/** A fact about durability, stated once — the first time a node's stability
 * crosses into week- or month-scale retention (`isStabilityMilestone`,
 * shared/gradeResult.ts). Understated on purpose: this is growth the engine
 * itself measured, not a performance to applaud — no InkBurst (that
 * celebration is GradeResultCard's alone, reserved for the immediate
 * "recalled" moment; this card can follow one, minutes or months later, and
 * doubling up would cheapen both). Warm ink, no exclamation, same
 * house-voice discipline as LapseRite's calm "a lapse resets the interval,
 * not the work." Derivable — see deriveRitualMarks in
 * shared/ritualFromTranscript.ts, which rebuilds this mark from the same
 * `rate`/`receipt` result a resumed sitting's transcript already carries. */
export const MilestoneCard = memo(function MilestoneCard({
  node,
  scale,
  sBefore,
  sAfter,
}: {
  node: string
  scale: StabilityMilestoneScale
  sBefore: number
  sAfter: number
}) {
  return (
    <div className="flex justify-start my-1.5 pl-1">
      <div className="max-w-[92%] flex flex-col gap-1 rounded-md border border-[var(--color-ink-warm-dim)] px-3 py-2.5 ritual-misconception-in">
        <span className="text-xs text-[var(--color-ink-warm)]">
          {humanizeNodeId(node)} — {SCALE_TEXT[scale]}
        </span>
        <span className="fig-caption">
          stability {sBefore.toFixed(1)} → {sAfter.toFixed(1)} days
        </span>
      </div>
    </div>
  )
})
