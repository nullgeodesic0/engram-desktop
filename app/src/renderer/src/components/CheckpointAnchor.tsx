import type { ReactNode } from 'react'

/** Minimap Precision fix (second report on the same bug — the first fix,
 * `scrollIntoView({ block: 'start' })` + a static `scroll-margin-top` on the
 * MESSAGE root, only ever scrolled to the message a checkpoint happens to be
 * near, never the checkpoint itself. A mark rendered BETWEEN two messages (a
 * crossing, a beat, a milestone — LearnSessionView.tsx/ReviewSessionView.tsx
 * interleave `MarkView` output as its own sibling in `.transcript-measure`)
 * or a probe/grade card rendered MID-message (ChatMessageView's
 * `beforeProbeHeader`/`ProbeCard` flow) is a DIFFERENT DOM element than its
 * host message's own root `[data-msg-index]` — landing on the host left the
 * actual checkpoint sitting off past the viewport edge, exactly the "doesn't
 * land on the checkpoint" report.
 *
 * Every render site that emits an `InstrumentMoment` (shared/instrumentMoments.ts)
 * wraps its card in exactly one of these, tagged with the SAME `id` that
 * moment carries in the minimap:
 *   - `MarkView` (components/ritual/Marks.tsx) — `mark.id` verbatim, for
 *     every mark-derived kind (crossing/beat/misconception/milestone/ask).
 *   - `ProbeCard` (ChatMessageView.tsx) — `probe-${messageIndex}`, matching
 *     `probeMoment`'s id in instrumentMoments.ts.
 *   - `GradeResultCard` (ReviewSessionView.tsx's `renderGradeBatch`) —
 *     `grade-${batchId}-${resultIndex}`, matching `deriveInstrumentMoments`'s
 *     grade-batch loop.
 *   - Review's inline `NodeCrossingDivider` (`inlineForMessage`, the
 *     non-mark crossing source `deriveInstrumentMoments`'s `crossings` input
 *     covers) — `crossing-${messageIndex}-${node}`.
 *
 * `shared/jumpToCheckpoint.ts` resolves THIS element by that id — never a
 * neighboring message used as a stand-in. `scroll-anchor-top` (index.css)
 * carries the same chrome-clearance `scroll-margin-top` the message roots
 * still keep (for the fallback path only); it belongs on the actual
 * destination now. */
export function CheckpointAnchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div data-checkpoint-id={id} className="scroll-anchor-top">
      {children}
    </div>
  )
}
