import { memo } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { MathRenderer } from '../MathRenderer'

/** A specimen label for a misconception the tutor just logged (`misconception
 * add`, engram.py) — pinned into the transcript the moment it's caught, in
 * the same danger ink GradeResultCard uses for a real lapse, not the warm ink
 * beat cards use for ordinary dialogue moments. Rendered from either the live
 * Bash tool_use (LearnSessionView) or a replayed transcript
 * (`shared/ritualFromTranscript.ts`'s `deriveRitualMarks`) — see
 * `parseMisconceptionAdd` there for the real-transcript signal this reads. */
/** The closing counterpart — a `misconception resolve` observed in the
 * transcript (live Bash tool_use or replay), the same specimen-label
 * skeleton in WARM ink with a check stroke: a demonstrated correction is a
 * consolidation moment, not an alarm. Id-only BY DESIGN, live and replay
 * alike — the resolve command carries only `--id`, and replay (a pure
 * transcript walk, no IPC) could never enrich it; live must not show more
 * than a reopened sitting can rebuild. */
export const MisconceptionResolvedPin = memo(function MisconceptionResolvedPin({ misconceptionId }: { misconceptionId: string }) {
  return (
    <div className="flex justify-start my-1.5 pl-1">
      <div className="tilt-card-soft max-w-[92%] flex flex-col gap-1 rounded-md border border-[var(--color-ink-warm-dim)] px-3 py-2.5 ritual-misconception-in">
        <div className="flex items-center gap-2">
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            aria-hidden="true"
            className="shrink-0 text-[var(--color-ink-warm)]"
          >
            <circle cx="6.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.1" />
            <path d="M6.5 7.5 V11.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            <path d="M8.5 9.5 l1.6 1.6 L13 8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-warm)]">
            MISCONCEPTION RESOLVED
          </span>
        </div>
        <div className="fig-caption">ledger — {misconceptionId.slice(0, 18)}…</div>
      </div>
    </div>
  )
})

export const MisconceptionPin = memo(function MisconceptionPin({ text, node }: { text: string; node?: string }) {
  return (
    <div className="flex justify-start my-1.5 pl-1">
      <div className="tilt-card-soft max-w-[92%] flex flex-col gap-1.5 rounded-md border border-[var(--color-ink-danger-dim)] px-3 py-2.5 ritual-misconception-in">
        <div className="flex items-center gap-2">
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            aria-hidden="true"
            className="shrink-0 text-[var(--color-ink-danger)]"
          >
            <circle cx="6.5" cy="4.5" r="3" stroke="currentColor" strokeWidth="1.1" />
            <path d="M6.5 7.5 V11.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
          <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-danger)]">MISCONCEPTION</span>
        </div>
        <MathRenderer
          text={text}
          className="font-(family-name:--font-serif) text-xs leading-relaxed text-[var(--color-text-dim)]"
        />
        {node && <div className="fig-caption pt-0.5">specimen — {humanizeNodeId(node)}</div>}
      </div>
    </div>
  )
})
