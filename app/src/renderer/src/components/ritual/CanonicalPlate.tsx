import { memo } from 'react'
import type { CanonicalSegment } from '../../../../shared/verdictSegments'
import { MathRenderer } from '../MathRenderer'

/** Verdict Anatomy — the canonical-answer reveal, set as an engraved
 * specimen label rather than left as an undifferentiated paragraph of
 * prose. `.panel-plate` (index.css) gives it an inset hairline running the
 * full frame instead of ProbeCard's/BeatCard's left-edge accent bar — a
 * plate under glass, not one item in a column, since this is the fixed,
 * published answer the rest of the verdict refers back to.
 *
 * The eyebrow shows the tutor's OWN marker word verbatim —
 * `segment.marker` is exactly `'Canonical' | 'Reveal' | 'Claim'` as the
 * tutor wrote it (see verdictSegments.ts's `CANONICAL_RE`), uppercased only
 * by CSS (`uppercase`), never paraphrased to a single house term: session
 * vocabulary varies, and this respects it. The body renders through
 * MathRenderer in the tutor's own serif voice, same pipeline every other
 * verdict paragraph uses — `segment.body` is already "everything after the
 * marker and its colon, trimmed" (verdictSegments.ts), i.e. the full
 * reveal, never truncated. */
export const CanonicalPlate = memo(function CanonicalPlate({ segment }: { segment: CanonicalSegment }) {
  return (
    <div className="panel-plate px-5 py-4 flex flex-col gap-2.5">
      <span className="label-data text-[10px] tracking-[0.22em] uppercase text-[var(--color-ink-warm)]">
        {segment.marker}
      </span>
      <MathRenderer text={segment.body} className="voice-serif text-[var(--color-text-primary)]" />
    </div>
  )
})
