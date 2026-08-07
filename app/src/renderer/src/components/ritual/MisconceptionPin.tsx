import { memo } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { MathRenderer } from '../MathRenderer'
import { MarkFrame } from './MarkFrame'

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
    <MarkFrame
      accent="warm"
      label="MISCONCEPTION RESOLVED"
      gap="tight"
      glyph={
        <>
          <circle cx="6.5" cy="4.7" r="3" stroke="currentColor" strokeWidth="1.1" />
          <path d="M6.5 7.7 V12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M8.6 9.8 l1.6 1.6 L13.2 8.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </>
      }
    >
      <div className="fig-caption">ledger — {misconceptionId.slice(0, 18)}…</div>
    </MarkFrame>
  )
})

export const MisconceptionPin = memo(function MisconceptionPin({ text, node }: { text: string; node?: string }) {
  return (
    <MarkFrame
      accent="danger"
      label="MISCONCEPTION"
      glyph={
        <>
          <circle cx="7" cy="5" r="3.2" stroke="currentColor" strokeWidth="1.1" />
          <path d="M7 8.2 V12.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </>
      }
    >
      {text ? (
        <MathRenderer
          text={text}
          className="font-(family-name:--font-serif) text-xs leading-relaxed text-[var(--color-text-dim)]"
        />
      ) : (
        // File-mediated add (see parseMisconceptionAdds) — the wording
        // travels by file, not in the command, so the honest render points
        // at where it actually lives.
        <div className="fig-caption">filed — the full wording lives in the misconception ledger.</div>
      )}
      {node && <div className="fig-caption pt-0.5">specimen — {humanizeNodeId(node)}</div>}
    </MarkFrame>
  )
})
