import { Fragment, memo, useMemo, type ReactNode } from 'react'
import type { ChatMessage } from '../../../shared/chatMessages'
import { parseBeatSegments } from '../../../shared/beatLabelParser'
import { BeatCard, PlainDialogueBlock } from './BeatCard'
import { MathRenderer } from './MathRenderer'
import { InkNode } from './ui/InkNode'
import { splitAroundProbeHeader } from '../../../shared/probeHeader'
import { ProbeCard } from './ritual/ProbeCard'

export function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

interface ChatMessageViewProps {
  message: ChatMessage
  /** Only offered on your own most-recent message — "fix a typo" shouldn't be
   * available on older turns, since it reads as editing history rather than
   * what it actually is (composing a follow-up, pre-filled). */
  onEditResend?: (text: string, attachments: string[]) => void
  /** Rendered right before this message's own probe-header card, if it has
   * one — Review's pending grade card(s) and node-crossing divider for the
   * item that just finished (see shared/reviewCrossing.ts). A real /review
   * reply often narrates the full verdict AND announces the next probe in
   * one continuous turn, so those belong AFTER this message's own leading
   * commentary (rendered by the `probe.before` block below) and immediately
   * BEFORE the new probe — never before the message as a whole, which would
   * land them ahead of the very commentary they're the receipt for. Ignored
   * (and never rendered) when this message carries no header. */
  beforeProbeHeader?: ReactNode
}

/** One turn, rendered like a normal chat exchange — a right-aligned bubble for
 * what you typed, and the beat-card treatment (parsed per-message; gracefully
 * falls back to plain text if no beat labels are present, which is the normal
 * case in /review — it has no dialogue-grammar beats) for the assistant's reply.
 * Shared between LearnSessionView and ReviewSessionView. */
/** Memoized — without this, every message in a session re-renders (and, pre-memo,
 * re-ran KaTeX / beat-segment parsing) on every unrelated re-render of the parent
 * session view, e.g. every keystroke in the composer textarea below the chat log. */
export const ChatMessageView = memo(function ChatMessageView({ message, onEditResend, beforeProbeHeader }: ChatMessageViewProps) {
  const segments = useMemo(
    () => (message.role === 'user' ? [] : parseBeatSegments(message.text)),
    [message.role, message.text],
  )

  if (message.role === 'user') {
    return (
      <div className="group flex justify-end items-start gap-1.5">
        <div className="mt-3.5 shrink-0">
          <InkNode id="voice-learner" variant="outlined" color="var(--color-ink-cool)" size={12} />
        </div>
        {onEditResend && (
          <button
            onClick={() => onEditResend(message.text, message.attachments ?? [])}
            title="Edit & resend as a follow-up — the original stays in history untouched"
            aria-label="Edit and resend"
            className="focus-ring no-press opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--dur-fast)] mt-3 text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] text-xs shrink-0"
          >
            <span aria-hidden="true">↺</span>
          </button>
        )}
        <div className="panel px-4 py-3 max-w-[92%] bg-[var(--color-surface-3)] flex flex-col gap-2">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {message.attachments.map((path) => (
                <span
                  key={path}
                  title={path}
                  className="label-data text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-dim)]"
                >
                  📎 {fileName(path)}
                </span>
              ))}
            </div>
          )}
          <MathRenderer text={message.text} className="text-sm text-[var(--color-text-primary)] leading-relaxed" />
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 max-w-[97%]">
      <div className="mt-1 shrink-0">
        <InkNode id="voice-tutor" variant="filled" size={12} />
      </div>
      <div className="flex flex-col gap-3 flex-1 min-w-0">
        {segments.map((seg, i) => {
          if (seg.beat) return <BeatCard key={i} beat={seg.beat} text={seg.text} />
          // A per-item progress marker means this is the moment of asking —
          // set it as a probe card. The marker doesn't have to open the
          // segment (a tutor often leads with a line of transition), so any
          // prose before it still renders as prose. Falls through entirely
          // when there's no marker, which is most segments.
          const probe = splitAroundProbeHeader(seg.text)
          if (probe) {
            return (
              <Fragment key={i}>
                {probe.before && <PlainDialogueBlock text={probe.before} />}
                {beforeProbeHeader}
                <ProbeCard header={probe.header} />
              </Fragment>
            )
          }
          return <PlainDialogueBlock key={i} text={seg.text} />
        })}
      </div>
    </div>
  )
})
