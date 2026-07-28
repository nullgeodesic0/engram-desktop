import { memo } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'

export type AuditVerdict = 'pending' | 'agreed' | 'disputed'

/** SKILL.md §3's honesty check ("keep self-grading honest") made visible: once
 * a /review sitting crosses its own thresholds (≥8 items, any disputed grade,
 * or ≥3 partials), the tutor stashes the borderline items and spawns
 * engram-assessor — blind to the tutoring dialogue — to independently re-grade
 * them and say whether it agrees.
 *
 * Rendered from a replayed transcript only. A live sitting only ever sees the
 * SPAWN (`verdict: 'pending'`, permanently — see the AUDIT doctrine comment
 * above `isAssessorAuditSpawnEvent` in shared/ritualFromTranscript.ts): the
 * assessor runs as a background agent, and its completion lands as a
 * `<task-notification>` string that SessionManager.ts's live event parser
 * doesn't forward at all today. `disputedNodes` names exactly the nodes the
 * assessor disagreed on, parsed from its own documented `audit.agree` output
 * contract (`agents/engram-assessor.md`) — never invented, never guessed;
 * a parse failure anywhere in the verdict just leaves the mark at `pending`. */
export const AuditCard = memo(function AuditCard({
  itemCount,
  verdict,
  disputedNodes,
}: {
  itemCount: number | null
  verdict: AuditVerdict
  disputedNodes: string[]
}) {
  const tone =
    verdict === 'disputed' ? 'var(--color-ink-danger)' : verdict === 'agreed' ? 'var(--color-ink-cool)' : 'var(--color-text-faint)'
  const borderTone =
    verdict === 'disputed' ? 'var(--color-ink-danger-dim)' : verdict === 'agreed' ? 'var(--color-ink-cool-dim)' : 'var(--color-hairline)'

  return (
    <div className="flex justify-start my-1.5 pl-1">
      <div className="tilt-card max-w-[92%] flex flex-col gap-1.5 rounded-md border px-3 py-2.5 ritual-audit-in" style={{ borderColor: borderTone }}>
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true" className="shrink-0" style={{ color: tone }}>
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.1" />
            <path d="M4.3 6.6 5.8 8.1 8.9 4.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="label-data text-[10px] tracking-[0.14em]" style={{ color: tone }}>
            ASSESSOR AUDIT
          </span>
        </div>
        <div className="text-xs text-[var(--color-text-dim)]">
          {itemCount !== null
            ? `${itemCount} item${itemCount === 1 ? '' : 's'} independently re-graded, blind to this session`
            : 'Items independently re-graded, blind to this session'}
        </div>
        {/* Honest about where the verdict actually appears: the assessor's
            result arrives as a background-agent notification the live event
            stream never forwards (see the AUDIT doctrine comment in
            shared/ritualFromTranscript.ts), so this card can only resolve when
            the sitting is reopened or read in History. An "awaiting…" ellipsis
            would promise an update this view will never receive. */}
        {verdict === 'pending' && (
          <div className="fig-caption">verdict lands in this sitting’s record — reopen to read it</div>
        )}
        {verdict === 'agreed' && <div className="fig-caption">grading held — no disagreement</div>}
        {verdict === 'disputed' && (
          <div className="fig-caption">disagreed on {disputedNodes.map((n) => humanizeNodeId(n)).join(', ')}</div>
        )}
      </div>
    </div>
  )
})
