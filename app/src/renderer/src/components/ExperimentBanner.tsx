import type { ActiveExperiment } from '../../../shared/types'

/** `ts` here is a local YYYY-MM-DD string (engram.py's `today().isoformat()`)
 * — parsed without a `Z` suffix so it reads as local midnight, same
 * discipline every other date display in this app follows (see
 * MisconceptionLedger's formatTs). */
function formatSince(started: string): string {
  const d = new Date(`${started}T00:00:00`)
  if (Number.isNaN(d.getTime())) return started
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The coach's own n-of-1 experiment, surfaced plainly wherever the learner
 * already looks (Home, Coach) — not a feature announcement, not hype, just
 * "here's what's being tested and since when." Only one experiment can be
 * active at a time (engram.py refuses to start a second), so this renders
 * at most one line.
 *
 * Renders nothing at all when there's no active experiment — the common
 * case today, since no experiment has ever run on a fresh install. Never
 * invents placeholder chrome for the absent state. */
export function ExperimentBanner({ experiment }: { experiment: ActiveExperiment | null }) {
  if (!experiment) return null
  // What it would take to settle: the arms being compared and the measure
  // that decides between them. Both are written by the engine at start and
  // were previously fetched, shape-guarded, and then never shown — leaving
  // the banner saying an experiment exists without saying what would end it.
  // Each renders only if genuinely present; nothing is inferred.
  const arms = experiment.arms?.filter((a) => typeof a === 'string' && a.length > 0) ?? []
  return (
    <div className="tilt-card panel px-4 py-3 flex flex-col gap-1">
      <div className="text-xs label-data text-[var(--color-text-faint)] uppercase tracking-wide">
        A teaching experiment is running · since {formatSince(experiment.started)}
      </div>
      <p className="text-sm text-[var(--color-text-dim)]">{experiment.question}</p>
      {(arms.length > 0 || experiment.metric) && (
        <div className="fig-caption">
          Fig. — {arms.length > 0 ? `comparing ${arms.join(' vs ')}` : 'comparing approaches'}
          {experiment.metric ? `, measured by ${experiment.metric}` : ''}
        </div>
      )}
    </div>
  )
}
