import { memo } from 'react'
import type { RatingSegment, ScheduleSegment, ConfidenceSegment } from '../../../../shared/verdictSegments'
import { GRADE_OF_RATING } from '../../../../shared/gradeResult'
import { MathRenderer } from '../MathRenderer'
import { GradeChip } from './GradeChip'

/** Verdict Anatomy's quiet rows — margin notes, not containers. Where
 * `CanonicalPlate` gets a full plate because the reveal is the fixed,
 * published answer, everything here is already stated elsewhere (a
 * GradeResultCard rendered in the same region, or nothing at all yet) —
 * these just give the tutor's own already-graded language a settled,
 * de-emphasized place instead of reading as one more paragraph of prose. */

/** The margin-note seat every row shares — a hairline left rule + indent
 * (designed-but-quiet, hairline not edge: these are interior notes, still
 * subordinate to CanonicalPlate's full bordered plate) so the whole verdict
 * family hangs off one common text edge instead of four loose paddings. */
const NOTE_SEAT = 'border-l border-[var(--color-hairline)] pl-3'

/** The region's first `prose` segment gets this eyebrow immediately above
 * it (never wrapping it — PlainDialogueBlock renders completely untouched
 * right after). Same idiom as Marks.tsx's `BeatMarkCard` row (label-data +
 * trailing hairline stub), deliberately glyph-free: a beat has a hand-drawn
 * glyph per beat kind, but "the verdict has begun" is one recurring idea,
 * not a family of them. */
export const VerdictEyebrowRail = memo(function VerdictEyebrowRail() {
  return (
    <div className={`flex items-center gap-3 ${NOTE_SEAT}`}>
      <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-warm)] shrink-0">VERDICT</span>
      <span className="h-px w-6 shrink-0 bg-[var(--color-hairline)]" aria-hidden="true" />
    </div>
  )
})

// Anchored the same way verdictSegments.ts's own RATING_RE is — a `rating`
// segment's `raw` (trimmed) always starts with exactly this, since that's
// the only way classifyParagraph ever produces kind `rating` in the first
// place. Used only to locate the bolded rating token so it can be swapped
// for the real badge chip instead of MathRenderer's plain `**bold**`;
// everything before and after is still rendered in full either way.
const RATING_PREFIX_RE = /^Rating \*\*(again|hard|good|easy)\*\*/

/** The tutor's own `Rating **good**` declaration, echoed as a full line —
 * every word of `segment.raw` still renders, via MathRenderer, so nothing
 * is lost — but the rating word itself swaps out MathRenderer's plain
 * `**bold**` for the same color-coded chip GradeResultCard's own badge
 * uses (`GradeChip`, resolved from `rating` via the engine's own
 * `GRADE_OF_RATING` table), so the echo visually rhymes with the real grade
 * card sitting in the same region rather than reading as one more line of
 * plain prose. */
export const RatingEchoRow = memo(function RatingEchoRow({ segment }: { segment: RatingSegment }) {
  const trimmed = segment.raw.trim()
  const badge = (
    <GradeChip grade={GRADE_OF_RATING[segment.rating]} className="shrink-0">
      {segment.rating}
    </GradeChip>
  )
  const match = RATING_PREFIX_RE.exec(trimmed)
  // Should always match (see the comment on RATING_PREFIX_RE above) — the
  // fallback still shows every byte of `raw`, just without the inline
  // badge swap, rather than silently dropping the line.
  const after = match ? trimmed.slice(match[0].length) : trimmed
  return (
    <div className={`flex items-center gap-2 flex-wrap ${NOTE_SEAT}`}>
      <span className="label-data text-[10px] tracking-[0.1em] text-[var(--color-text-faint)] shrink-0">Rating</span>
      {badge}
      {after.trim() && (
        <MathRenderer
          text={after.replace(/^[\s—–-]+/, '')}
          inlineOnly
          className="voice-serif text-sm text-[var(--color-text-dim)] flex-1 min-w-0"
        />
      )}
    </div>
  )
})

/** A small hand-drawn clock stroke — the schedule row's own glyph, same
 * 16x16/stroke-only/currentColor idiom as Marks.tsx's `BEAT_GLYPHS`. */
function ClockGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-[var(--color-text-faint)] mt-0.5">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4.5V8l2.6 1.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A `schedule` segment that survived `shouldSuppressSchedule` (bare and
 * redundant with the region's own GradeResultCard) — either a genuinely
 * multi-fact/editorial paragraph, or a bare one the dedupe rule couldn't
 * safely attribute (a multi-result batch, a missing receipt, …). Always the
 * FULL `raw` text (never abbreviated — the binding "never compress or
 * obscure" constraint applies here exactly as everywhere else), just set as
 * a small faint caption rather than a full prose paragraph. */
export const ScheduleEchoRow = memo(function ScheduleEchoRow({ segment }: { segment: ScheduleSegment }) {
  return (
    <div className={`flex items-start gap-2 ${NOTE_SEAT}`}>
      {/* Fixed-width glyph seat so this row's text starts on the same edge
          as the label-led rows above/below it. */}
      <span className="w-4 flex justify-center shrink-0" aria-hidden="true">
        <ClockGlyph />
      </span>
      <MathRenderer
        text={segment.raw.trim()}
        className="label-data text-[10px] text-[var(--color-text-faint)] leading-relaxed"
      />
    </div>
  )
})

/** The tutor's own `Confidence: …` echo — cool ink (Night Atlas's
 * "not yet consolidated" signal, the same register a probe's own open
 * question uses), never truncated to `segment.band`'s first clause alone:
 * real corpus paragraphs sometimes continue past it with real editorial
 * content (e.g. "Confidence: certain (90). Right on all counts — …"), and
 * dropping that would be exactly the information loss the binding
 * constraint forbids — so this always renders the full `raw` text, with
 * the eyebrow supplying the "this is a confidence echo" context `band`
 * would otherwise have carried alone. */
export const ConfidenceEchoRow = memo(function ConfidenceEchoRow({ segment }: { segment: ConfidenceSegment }) {
  return (
    <div className={`flex flex-col gap-1 ${NOTE_SEAT}`}>
      <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-cool)] shrink-0">CONFIDENCE</span>
      <MathRenderer text={segment.raw.trim()} className="voice-serif text-sm text-[var(--color-text-dim)]" />
    </div>
  )
})
