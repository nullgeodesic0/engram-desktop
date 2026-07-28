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
export const MisconceptionPin = memo(function MisconceptionPin({ text, node }: { text: string; node?: string }) {
  return (
    <div className="flex justify-start my-1.5 pl-1">
      <div className="tilt-card max-w-[92%] flex flex-col gap-1.5 rounded-md border border-[var(--color-ink-danger-dim)] px-3 py-2.5 ritual-misconception-in">
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
          className="font-[var(--font-serif)] text-xs leading-relaxed text-[var(--color-text-dim)]"
        />
        {node && <div className="fig-caption pt-0.5">specimen — {humanizeNodeId(node)}</div>}
      </div>
    </div>
  )
})
