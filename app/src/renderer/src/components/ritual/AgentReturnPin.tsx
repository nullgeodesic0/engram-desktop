import { memo } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'

/** A background subagent's completion, pinned instead of printed — the
 * curriculum architect's return lands as a `<task-notification>` user turn
 * whose `<result>` body is the full add-topic payload (claims, probes,
 * rubrics: material the loop deliberately keeps out of the transcript).
 * This pin is the visible receipt of that moment; the payload itself never
 * renders. Violet by decree: synthesis/creation is the third signal, neither
 * warm consolidation nor cool not-yet. Derived identically live
 * (LearnSessionView's `task_notification` case) and on replay
 * (`ritualFromTranscript.ts`'s walk) from `parseCurriculumReturn`. */
export const AgentReturnPin = memo(function AgentReturnPin({ topic, nodeCount }: { topic: string; nodeCount: number }) {
  return (
    <div className="flex justify-start my-1.5 pl-1">
      <div className="tilt-card-soft max-w-[92%] flex flex-col gap-1 rounded-md border border-[var(--color-ink-violet-dim)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" className="shrink-0 text-[var(--color-ink-violet)]">
            <circle cx="6.5" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.1" />
            <path d="M6.5 1 V4.5 M6.5 8.5 V12 M1 6.5 H4.5 M8.5 6.5 H12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
          <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-violet)]">ARCHITECT RETURNED</span>
        </div>
        <div className="fig-caption">
          curriculum — {humanizeNodeId(topic)} · {nodeCount} nodes, filed to the atlas
        </div>
      </div>
    </div>
  )
})
