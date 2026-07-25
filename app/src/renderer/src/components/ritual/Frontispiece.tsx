import { memo } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'

/** Exact copy map from the design brief — every phase `session_phase` names
 * (mcpBridgeWorker.mjs's `session_phase` tool: intake/pretest/walk/grading/
 * closing) gets its own act title. An unrecognized phase (future addition,
 * or a stray value) falls back to a humanized version of the raw string
 * rather than rendering nothing. */
const PHASE_TITLE: Record<string, string> = {
  intake: 'Taking measure',
  pretest: 'The diagnostic',
  walk: 'The walk begins',
  grading: 'The assessor sits',
  closing: 'Closing the loop',
}

/** Full-width divider marking a session's move into a new phase — dendrite
 * hairlines flanking a small ink glyph and the act's serif title. Fires once
 * per phase change, live (LearnSessionView's session_phase handler) or
 * replayed (ritualFromTranscript.ts's `phase` mark). */
export const Frontispiece = memo(function Frontispiece({ phase }: { phase: string }) {
  const title = PHASE_TITLE[phase] ?? humanizeNodeId(phase)
  return (
    <div className="flex items-center gap-4 my-6" role="separator" aria-label={title}>
      <span className="h-px flex-1 bg-[var(--color-ink-warm-dim)] origin-right ritual-frontispiece-line" />
      <div className="flex items-center gap-2.5 shrink-0 ritual-frontispiece-glyph">
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true" className="text-[var(--color-ink-warm)]">
          <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1" />
          <path d="M7.5 3.5 V11.5 M3.5 7.5 H11.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
        <span className="font-[var(--font-serif)] italic text-sm text-[var(--color-text-primary)] tracking-wide whitespace-nowrap">
          {title}
        </span>
      </div>
      <span className="h-px flex-1 bg-[var(--color-ink-warm-dim)] origin-left ritual-frontispiece-line" />
    </div>
  )
})
