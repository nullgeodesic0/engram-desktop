import { memo } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { MarkFrame } from './MarkFrame'

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
    <MarkFrame
      accent="violet"
      label="ARCHITECT RETURNED"
      gap="tight"
      glyph={
        <>
          <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.1" />
          <path d="M7 1.2 V4.8 M7 9.2 V12.8 M1.2 7 H4.8 M9.2 7 H12.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </>
      }
    >
      <div className="fig-caption">
        curriculum — {humanizeNodeId(topic)} · {nodeCount} nodes, filed to the atlas
      </div>
    </MarkFrame>
  )
})
