import type { WeekDigestOutput } from '../shared/weekDigest'
import { SkeletonBar } from './Skeleton'
import { StatBlock } from './ui/StatBlock'

/** Weekly rollup, atlas-voice — sits above Retention on the Dashboard so the
 * "how did this week go" question is answered before the longer-run trend
 * charts. Honest numbers only: no streak-guilt, no congratulations, no
 * exclamation marks (see feedback_engram_polish_direction memory). */
export function WeekDigest({ digest }: { digest: WeekDigestOutput | null }) {
  if (digest === null) {
    return (
      <div className="panel px-4 py-4 flex flex-col gap-3">
        <SkeletonBar width="50%" height={12} />
        <SkeletonBar width="85%" height={14} />
        <div className="grid grid-cols-3 gap-3 mt-1">
          <SkeletonBar height={48} />
          <SkeletonBar height={48} />
          <SkeletonBar height={48} />
        </div>
      </div>
    )
  }

  const quiet = digest.reviews.thisWeek === 0

  return (
    <div className="tilt-card panel px-4 py-4 flex flex-col gap-3">
      <div className="fig-caption">{digest.caption}</div>

      {!quiet && (
        <div className="grid grid-cols-3 gap-3 mt-1">
          <StatBlock
            label="Reviews"
            value={String(digest.reviews.thisWeek)}
            caption={`${digest.reviews.lastWeek} last week`}
          />
          <StatBlock
            label="Consolidated"
            value={String(digest.consolidated.count)}
            tone={digest.consolidated.count > 0 ? 'warm' : 'neutral'}
            caption={
              digest.consolidated.thresholds.length > 0
                ? digest.consolidated.thresholds.join(', ')
                : undefined
            }
          />
          <StatBlock
            label="Hardest"
            value={digest.hardestNodes[0] ? String(digest.hardestNodes[0].grades) : '—'}
            tone={digest.hardestNodes[0] ? 'cool' : 'neutral'}
            caption={digest.hardestNodes[0]?.node}
          />
        </div>
      )}

      {!quiet && digest.hardestNodes.length > 1 && (
        <div className="flex flex-col gap-1 mt-1">
          {digest.hardestNodes.slice(1).map((n) => (
            <div key={n.node} className="flex items-center justify-between text-xs text-[var(--color-text-dim)]">
              <span className="truncate">{n.node}</span>
              <span className="label-data text-[var(--color-text-faint)]">{n.grades}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
