import { Fragment, memo, useMemo, type ReactNode } from 'react'
import type { ChatMessage } from '../../../shared/chatMessages'
import { parseBeatSegments } from '../../../shared/beatLabelParser'
import type { VerdictSegment, ScheduleSegment } from '../../../shared/verdictSegments'
import { BeatCard, PlainDialogueBlock } from './BeatCard'
import { ProseMarkdown } from './ProseMarkdown'
import { InkNode } from './ui/InkNode'
import { splitAroundProbeHeader } from '../../../shared/probeHeader'
import { ProbeCard } from './ritual/ProbeCard'
import { CheckpointAnchor } from './CheckpointAnchor'
import { CanonicalPlate } from './ritual/CanonicalPlate'
import { VerdictEyebrowRail, RatingEchoRow, ScheduleEchoRow, ConfidenceEchoRow } from './ritual/VerdictRows'
import type { EnvAccent } from '../shared/controlChrome'

export function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

/** `HH:MM` local time for a message's hover-revealed clock — `Mon D · `
 * prefixed only when this message's local calendar date differs from the
 * PREVIOUS rendered message's (a multi-day resumed sitting crossed
 * midnight); never prefixed for the very first message in a transcript
 * (`previousTs === undefined`) since there's nothing to differ from. Local-
 * date discipline throughout (getFullYear/Month/Date/Hours/Minutes — never
 * toISOString), same idiom as SessionHistoryDrawer.tsx's `localDateFromIso`. */
function formatMessageClock(ts: number, previousTs: number | undefined): string {
  const d = new Date(ts)
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (previousTs === undefined) return time
  const p = new Date(previousTs)
  const sameLocalDate = d.getFullYear() === p.getFullYear() && d.getMonth() === p.getMonth() && d.getDate() === p.getDate()
  return sameLocalDate ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${time}`
}

/** The row's own hover-revealed clock — anchored to the voice icon (via the
 * icon wrapper's `relative`) rather than the row, so it reads as "when this
 * turn was sent" regardless of which side the icon sits on. Absolutely
 * positioned: never reserves layout space, appears only on `group-hover` of
 * the enclosing row (see the three call sites below), fades with
 * `--dur-fast`. `aria-hidden` — decorative supplementary detail, same
 * treatment CopyButton gives its glyph. */
function MessageClock({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap label-data text-[9px] text-[var(--color-text-faint)] opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--dur-fast)]"
    >
      {label}
    </span>
  )
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
  /** Chat Presence Wave D Task 9 — a small pulsing ink caret at the end of
   * this message's own last rendered segment, shown only while THIS message
   * is the live growing assistant bubble (`activity.kind === 'streaming'`
   * AND it's the latest message) — callers pass `true` only on that one
   * message, never persisted, gone the instant streaming stops (the next
   * render simply omits the prop). Ignored on user messages (the caret is a
   * "the tutor is composing" signal, never shown on the learner's own turn). */
  trailingCaret?: boolean
  /** Verdict Anatomy (Wave 2) — when present, this message's assistant text
   * is entirely owned by a `deriveVerdictRegions` region: `parseBeatSegments`
   * is skipped (Review never emits beat labels, so this can never collide
   * with Learn's rendering) and this pre-segmented list renders instead, via
   * `segmentVerdictText` on the region's own clip of this message's text
   * (`shared/verdictSegments.ts`'s `verdictRegionMessageRenders` — the ONE
   * place live and replay both compute it, so they can never disagree).
   * `undefined` (the default, and Learn's/Coach's only state) renders
   * byte-identically to before this wave. May legitimately be `[]` (not
   * `undefined`) for a boundary message whose entire text IS its own probe
   * header, with nothing before it to segment — the probe-header flow below
   * still renders correctly in that case (see `verdictRegionMessageTexts`'s
   * `boundaryPrefixOnly` clip). */
  verdictSegments?: VerdictSegment[]
  /** The index into `verdictSegments` of the region's own FIRST `prose`
   * segment — "first prose of the region" is a region-wide fact that lands
   * on exactly one message across a (usually multi-message) span, so the
   * caller resolves it once and threads it here; every other message in the
   * same region gets `undefined`/`null`, and every later `prose` segment in
   * THIS message (if `verdictSegments` holds more than one) stays
   * unornamented too — only this one index ever gets the VERDICT eyebrow. */
  verdictEyebrowIndex?: number | null
  /** THE shared dedupe predicate (`shouldSuppressSchedule`,
   * `shared/verdictSegments.ts`), pre-bound by the caller to this segment's
   * own region/batch/anchor-date/streaming-tail context — ChatMessageView
   * itself never reaches into grade batches or dates, it just asks "does
   * this one segment stay suppressed." A suppressed schedule segment renders
   * nothing at all (not even a placeholder); see the empty-bubble guard
   * below for what happens when THAT was the message's only content. */
  suppressSchedule?: (segment: ScheduleSegment) => boolean
  /** Chat Instruments Wave A — the PREVIOUS rendered message's own
   * `timestamp`, threaded through by the caller (which already walks the
   * `messages` array) so this component never has to see the array itself.
   * Same "caller resolves it once, passes it down" convention as
   * `verdictEyebrowIndex` above. Used only to decide whether THIS message's
   * hover clock needs a date prefix (see `formatMessageClock`) — `undefined`
   * for the transcript's first message, or when the caller doesn't track it. */
  previousTimestamp?: number
  /** Chat Instruments Wave B — this message's own index into the caller's
   * `messages` array, stamped onto the rendered root as `data-msg-index` so
   * the transcript minimap's click-to-jump can locate a message's real DOM
   * node without any parallel bookkeeping of its own (`element.closest`/
   * `querySelector('[data-msg-index="n"]')` from the scroll container the
   * minimap already holds a reference to). `undefined` renders no attribute —
   * a caller that never wires the minimap pays nothing for this. */
  dataIndex?: number
  /** Chat Instruments Wave B — the grade-card ↔ probe-card hover linkage.
   * `probeHighlighted` true when a GradeResultCard for the SAME node
   * (matched by the caller, which already resolves grade-batch node vs
   * probe-header node for other reasons — see ReviewSessionView's/
   * SessionHistoryDrawer's own `hoveredPairNode` wiring) is currently
   * hovered elsewhere in the transcript; forwarded straight to this
   * message's own `ProbeCard`, if it has one. `onProbeHoverChange` reports
   * this card's OWN hover state back up, so the caller can highlight ITS
   * partner grade card in turn. Both undefined for any caller that never
   * wires the linkage (Learn's live view — see instrumentMoments.ts's own
   * doctrine comment on why Learn never renders GradeResultCard inline). */
  probeHighlighted?: boolean
  onProbeHoverChange?: (hovering: boolean) => void
  /** Chat Instruments Wave B — node-name chips. The CURRENTLY LOADED topic
   * graph's own node ids (exact-match only, never fuzzy) and the topic they
   * belong to, threaded down to every assistant-prose renderer this message
   * uses (ProseMarkdown via PlainDialogueBlock/BeatCard) so a backticked
   * token matching one chips instead of rendering as plain inline code. Both
   * undefined (or an empty set) renders byte-identically to before this
   * wave — see ProseMarkdown's own doctrine comment for the chip mechanics,
   * and LearnSessionView's for where `nodeIds` actually comes from (nothing
   * new is fetched for this: the topic graph cache the why-chain panel
   * already holds). Never threaded to the user's OWN bubble — chips are a
   * reading aid for the tutor's prose, not something to detect in a
   * learner's own typed text. */
  nodeIds?: Set<string>
  nodeChipTopic?: string
  /** Environment chrome identity for this message's ProbeCard (see
   * shared/controlChrome.ts) — Learn passes 'warm', Review's cool is the
   * default. Threshold violet still wins inside the card regardless. */
  probeAccent?: EnvAccent
}

/** One turn, rendered like a normal chat exchange — a right-aligned bubble for
 * what you typed, and the beat-card treatment (parsed per-message; gracefully
 * falls back to plain text if no beat labels are present, which is the normal
 * case in /review — it has no dialogue-grammar beats) for the assistant's reply.
 * Shared between LearnSessionView and ReviewSessionView. */
/** Memoized — without this, every message in a session re-renders (and, pre-memo,
 * re-ran KaTeX / beat-segment parsing) on every unrelated re-render of the parent
 * session view, e.g. every keystroke in the composer textarea below the chat log. */
export const ChatMessageView = memo(function ChatMessageView({
  message,
  onEditResend,
  beforeProbeHeader,
  trailingCaret,
  verdictSegments,
  verdictEyebrowIndex,
  suppressSchedule,
  previousTimestamp,
  dataIndex,
  probeHighlighted,
  onProbeHoverChange,
  nodeIds,
  nodeChipTopic,
  probeAccent,
}: ChatMessageViewProps) {
  const segments = useMemo(
    () => (message.role === 'user' || verdictSegments !== undefined ? [] : parseBeatSegments(message.text)),
    [message.role, message.text, verdictSegments],
  )
  const clockLabel = message.timestamp !== undefined ? formatMessageClock(message.timestamp, previousTimestamp) : null

  if (message.role === 'user') {
    return (
      <div className="group flex justify-end items-start gap-1.5 scroll-anchor-top" data-msg-index={dataIndex}>
        <div className="mt-3.5 shrink-0 relative">
          <InkNode id="voice-learner" variant="outlined" color="var(--color-ink-cool)" size={12} />
          {clockLabel && <MessageClock label={clockLabel} />}
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
        <div className="tilt-card-soft panel px-4 py-3 max-w-[92%] bg-[color-mix(in_srgb,var(--color-surface-3)_80%,transparent)] flex flex-col gap-2">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {message.attachments.map((path) => (
                <span
                  key={path}
                  title={path}
                  className="label-data text-[10px] px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-dim)]"
                >
                  📎 {fileName(path)}
                </span>
              ))}
            </div>
          )}
          <ProseMarkdown text={message.text} className="text-sm text-[var(--color-text-primary)] leading-relaxed" />
        </div>
      </div>
    )
  }

  if (verdictSegments !== undefined) {
    // Verdict Anatomy (Wave 2) — see the prop doctrine comments above. The
    // probe-header flow is UNTOUCHED: `verdictSegments` already covers only
    // the region's own clip of this message's text (never the header, which
    // `verdictRegionMessageTexts`'s `boundaryPrefixOnly` split excludes at
    // the source — see shared/verdictSegments.ts), so this message's own
    // header is located directly off `message.text`, exactly the same
    // `splitAroundProbeHeader` call the non-verdict path below makes off
    // `seg.text` (which, for a beat-less /review message, IS `message.text`
    // — `parseBeatSegments` returns a single `{ text: message.text }`
    // segment when no beat label is present, so this is the same lookup,
    // never a different one).
    const probe = splitAroundProbeHeader(message.text)
    const renderedSegments = verdictSegments.map((seg, i) => {
      // Same caret discipline as the non-verdict path below: never on any
      // segment when this message ends in a probe header (the header line
      // is what "still growing" would apply to, not the verdict prose
      // before it — and a message that already resolved its next probe
      // isn't the live tail anyway), otherwise only the truly last segment.
      const isLastSegment = i === verdictSegments.length - 1 && !probe
      const caret = isLastSegment && trailingCaret
      if (seg.kind === 'canonical') return <CanonicalPlate key={i} segment={seg} />
      if (seg.kind === 'rating') return <RatingEchoRow key={i} segment={seg} />
      if (seg.kind === 'confidence') return <ConfidenceEchoRow key={i} segment={seg} />
      if (seg.kind === 'schedule') {
        // A suppressed schedule paragraph renders NOTHING — the dedupe rule
        // (shouldSuppressSchedule) already established the same fact is
        // stated structurally by this region's own GradeResultCard; see the
        // empty-bubble guard below for what happens when that was this
        // message's only content.
        if (suppressSchedule?.(seg)) return null
        return <ScheduleEchoRow key={i} segment={seg} />
      }
      // prose — the region's own first prose segment (at most one message,
      // at most one segment index, across the whole region) gets the quiet
      // VERDICT eyebrow immediately above it; every other prose segment
      // (including later ones in THIS message) renders completely
      // unornamented, same PlainDialogueBlock either way.
      if (i === verdictEyebrowIndex) {
        return (
          <Fragment key={i}>
            <VerdictEyebrowRail />
            <PlainDialogueBlock text={seg.raw} trailingCaret={caret} nodeIds={nodeIds} nodeChipTopic={nodeChipTopic} />
          </Fragment>
        )
      }
      return <PlainDialogueBlock key={i} text={seg.raw} trailingCaret={caret} nodeIds={nodeIds} nodeChipTopic={nodeChipTopic} />
    })
    // Empty-bubble guard — a message whose every segment is a suppressed
    // schedule paragraph (real corpus shape: a region-spanning message
    // whose ENTIRE text is one bare "Back in N days." paragraph, already
    // stated by the region's own GradeResultCard) has nothing left to show.
    // Never true when this message carries its own probe header (`probe`)
    // or the caller resolved other marks/crossings to render here
    // (`beforeProbeHeader`) — both always render something regardless of
    // `verdictSegments`.
    const hasVisibleContent = renderedSegments.some((node) => node !== null)
    if (!hasVisibleContent && !probe && !beforeProbeHeader) return null
    return (
      <div className="group flex items-start gap-2 max-w-[97%] scroll-anchor-top" data-msg-index={dataIndex}>
        <div className="mt-1 shrink-0 relative">
          <InkNode id="voice-tutor" variant="filled" size={12} />
          {clockLabel && <MessageClock label={clockLabel} />}
        </div>
        <div className="flex flex-col gap-3 flex-1 min-w-0">
          {renderedSegments}
          {probe && (
            <Fragment>
              {beforeProbeHeader}
              {/* Minimap Precision fix — `probe-${dataIndex}`, matching
                  `probeMoment`'s id (shared/instrumentMoments.ts); the probe
                  header renders mid-message (after this message's own leading
                  verdict prose), so the message's own root is the wrong jump
                  target — see CheckpointAnchor.tsx's doctrine comment. */}
              <CheckpointAnchor id={`probe-${dataIndex}`}>
                <ProbeCard header={probe.header} highlighted={probeHighlighted} onHoverChange={onProbeHoverChange} accent={probeAccent} />
              </CheckpointAnchor>
            </Fragment>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-2 max-w-[97%] scroll-anchor-top" data-msg-index={dataIndex}>
      <div className="mt-1 shrink-0 relative">
        <InkNode id="voice-tutor" variant="filled" size={12} />
        {clockLabel && <MessageClock label={clockLabel} />}
      </div>
      <div className="flex flex-col gap-3 flex-1 min-w-0">
        {segments.map((seg, i) => {
          // The caret only ever belongs on the LAST segment's own trailing
          // edge — a growing message's earlier segments are already settled
          // text, even mid-stream.
          const isLastSegment = i === segments.length - 1
          const caret = isLastSegment && trailingCaret
          if (seg.beat) {
            return (
              <BeatCard key={i} beat={seg.beat} text={seg.text} trailingCaret={caret} nodeIds={nodeIds} nodeChipTopic={nodeChipTopic} />
            )
          }
          // A per-item progress marker means this is the moment of asking —
          // set it as a probe card. The marker doesn't have to open the
          // segment (a tutor often leads with a line of transition), so any
          // prose before it still renders as prose. Falls through entirely
          // when there's no marker, which is most segments.
          const probe = splitAroundProbeHeader(seg.text)
          if (probe) {
            return (
              <Fragment key={i}>
                {probe.before && <PlainDialogueBlock text={probe.before} nodeIds={nodeIds} nodeChipTopic={nodeChipTopic} />}
                {beforeProbeHeader}
                {/* Minimap Precision fix — see the twin comment above. */}
                <CheckpointAnchor id={`probe-${dataIndex}`}>
                  <ProbeCard header={probe.header} highlighted={probeHighlighted} onHoverChange={onProbeHoverChange} accent={probeAccent} />
                </CheckpointAnchor>
              </Fragment>
            )
          }
          return (
            <PlainDialogueBlock key={i} text={seg.text} trailingCaret={caret} nodeIds={nodeIds} nodeChipTopic={nodeChipTopic} />
          )
        })}
      </div>
    </div>
  )
})
