import { memo } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import type { StabilityMilestoneScale } from '../../../../shared/gradeResult'

const SCALE_TEXT: Record<StabilityMilestoneScale, string> = {
  week: 'holding for a week now',
  month: 'holding for a month now',
}

// Fix (chat refine round): the paired case's own vocabulary — threshold
// IDENTITY, never a restated number. `isStabilityMilestone` (gradeResult.ts)
// already tells us exactly which of the two thresholds this result crossed
// (its return value IS this scale), so this is the one honest fact this card
// can add beside its own grade card that isn't already that card's numbers.
const PAIRED_SCALE_TEXT: Record<StabilityMilestoneScale, string> = {
  week: 'first time past week-scale',
  month: 'first time past a month',
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
 * `rate`/`receipt` result a resumed sitting's transcript already carries.
 *
 * Fix (chat refine round): a real transcript showed this card sitting right
 * beside its own GradeResultCard restating the SAME `sBefore`/`sAfter`
 * numbers that card had just stated a moment earlier — literal duplication.
 * `pairedWithGradeCard` (set by the caller — ReviewSessionView.tsx /
 * SessionHistoryDrawer.tsx — whenever a grade batch containing THIS
 * milestone's own `node` resolved to the SAME render position, via the same
 * `nextProbeHeaderAt` anchoring both already share) drops the numbers line
 * and states the threshold identity instead: which scale was crossed, a
 * fact the grade card never states itself. Unpaired — the replay edge where
 * no grade card renders alongside this milestone (a resumed sitting whose
 * batch already scrolled past, or Learn's live view, which never renders
 * GradeResultCard inline at all — see LearnSessionView's own doctrine
 * comment) — the numbers stay exactly as before this fix: they're the only
 * record of what grew. */
export const MilestoneCard = memo(function MilestoneCard({
  node,
  scale,
  sBefore,
  sAfter,
  pairedWithGradeCard = false,
}: {
  node: string
  scale: StabilityMilestoneScale
  sBefore: number
  sAfter: number
  pairedWithGradeCard?: boolean
}) {
  return (
    <div className="flex justify-start my-1.5 pl-1">
      <div className="max-w-[92%] flex flex-col gap-1 rounded-md border border-[var(--color-ink-warm-dim)] px-3 py-2.5 ritual-misconception-in">
        <span className="text-xs text-[var(--color-ink-warm)]">
          {humanizeNodeId(node)} — {pairedWithGradeCard ? PAIRED_SCALE_TEXT[scale] : SCALE_TEXT[scale]}
        </span>
        {!pairedWithGradeCard && (
          <span className="fig-caption">
            stability {sBefore.toFixed(1)} → {sAfter.toFixed(1)} days
          </span>
        )}
      </div>
    </div>
  )
})
