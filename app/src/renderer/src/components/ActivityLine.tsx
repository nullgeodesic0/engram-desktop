import type { TutorActivity } from '../shared/tutorActivity'
import { GradingShimmer } from './ritual/Marks'

const GRADING_LABEL: Record<'stashing' | 'assessing', string> = {
  stashing: 'filing the sitting for the assessor',
  assessing: 'the assessor is examining your work',
}

/** Chat Presence Wave D — replaces `TypingIndicator` at both session views'
 * busy-tail call sites. The three-dot pulse stays for plain `streaming`
 * (unclassified, or nothing more specific to say); `tool`/`grading` compose
 * a classified label into the SAME row height, so swapping between them
 * (or back to the plain dots) never jumps the transcript's layout — the
 * fixed-height row exists whether or not there's a label to show.
 *
 * `grading` states hand off to `GradingShimmer` entirely (a different, taller
 * treatment — the shimmer IS the composed "shimmer + label" the brief asks
 * for; there is no second shimmer to add on top of it). */
export function ActivityLine({ activity }: { activity: TutorActivity }) {
  if (activity.kind === 'grading') {
    return <GradingShimmer label={GRADING_LABEL[activity.stage]} />
  }
  const label = activity.kind === 'tool' ? `${activity.label}…` : 'the tutor is writing…'
  return (
    <div className="flex items-center gap-2 px-1 py-2 min-h-[1.75rem]" aria-label={label}>
      <div className="flex items-center gap-1.5 shrink-0">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-[var(--color-ink-warm)] animate-bounce"
            style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.9s' }}
          />
        ))}
      </div>
      <span key={label} className="fig-caption activity-label-in truncate">
        {label}
      </span>
    </div>
  )
}
