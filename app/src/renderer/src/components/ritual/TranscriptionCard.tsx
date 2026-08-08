import { memo, useState } from 'react'
import { MathRenderer } from '../MathRenderer'
import { MarkFrame } from './MarkFrame'
import { Button } from '../ui/Button'
import type { TranscriptionPage } from '../../../../shared/bridgeUiIntents'

/** The attestation gate: a transcription of the learner's handwriting, shown
 * for confirmation before it can become their answer.
 *
 * THIS CARD IS THE WHOLE SAFETY ARGUMENT. A model that reads your handwriting
 * while knowing the expected answer will tend to read what it expects — a
 * smudged minus becomes the minus the rubric wants. If that transcription went
 * straight to the assessor, the grade would certify work the learner did not
 * do, in whichever direction the misreading went. Routing it through a
 * confirmation makes the production text the LEARNER signed, not text the
 * model produced, and that is what keeps the receipt honest.
 *
 * So the card is deliberately unhurried about it:
 *   · the LaTeX is editable before you accept it, because catching a misread
 *     is the entire point and a read-only preview would make you retype;
 *   · the source pages are listed and openable, so you can compare against
 *     what you actually wrote;
 *   · anything the transcriber could not read is surfaced per page rather
 *     than smoothed over — a guess presented as a reading is the failure mode
 *     this whole design exists to prevent;
 *   · confirming does NOT send. It fills the composer, and you still press
 *     send, so there is a second look and room to add "I got stuck at (c)".
 *
 * Provenance is stated, not assumed: `blind` is true only when the app
 * actually observed a subagent spawn between the request and the proposal.
 * The tutor cannot assert it. */
export const TranscriptionCard = memo(function TranscriptionCard({
  latex,
  pages,
  note,
  blind,
  live,
  onConfirm,
}: {
  latex: string
  pages: TranscriptionPage[]
  note: string | null
  /** Did a blind subagent produce this, as observed by the app? */
  blind: boolean
  /** False on replay — a transcription from a reopened sitting is a record,
   * not an offer, and must not present a button that would silently refill a
   * composer in a different session. */
  live: boolean
  onConfirm?: (latex: string) => void
}) {
  const [draft, setDraft] = useState(latex)
  const [accepted, setAccepted] = useState(false)
  const edited = draft !== latex

  return (
    <MarkFrame
      accent="cool"
      label={accepted ? 'TRANSCRIPTION ACCEPTED' : 'TRANSCRIPTION — YOUR CHECK'}
      fill
      glyph={
        <>
          <path d="M2 11.5 L4.5 11 L11.5 4 A1.6 1.6 0 0 0 9.2 1.7 L2.2 8.7 Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M1.5 13.2 H12.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </>
      }
    >
      <div className="fig-caption">
        {blind ? 'transcribed blind — the reader was not told the expected answer' : 'transcribed by the tutor, which already knows the expected answer'}
        {' · '}
        {pages.length === 1 ? '1 page' : `${pages.length} pages`}
      </div>

      {note && <div className="fig-caption text-[var(--color-ink-warm)]">{note}</div>}

      {/* Anything unreadable, per page — surfaced, never smoothed over. */}
      {pages.some((p) => p.note) && (
        <ul className="flex flex-col gap-0.5">
          {pages.map((p, i) =>
            p.note ? (
              <li key={i} className="fig-caption text-[var(--color-ink-warm)]">
                page {i + 1}: {p.note}
              </li>
            ) : null,
          )}
        </ul>
      )}

      {accepted ? (
        <MathRenderer text={draft} className="text-xs text-[var(--color-text-dim)] leading-relaxed" />
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(14, Math.max(4, draft.split('\n').length + 1))}
            aria-label="Transcription — edit anything it misread"
            className="focus-ring panel px-3 py-2 text-xs text-[var(--color-text-primary)] resize-none w-full"
          />
          <div className="py-1 overflow-x-auto">
            <MathRenderer text={draft} className="text-[var(--color-text-primary)]" />
          </div>
        </>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        {pages.map((p, i) => (
          <button
            key={i}
            onClick={() => window.engram.openArtifact(p.path)}
            title={p.path}
            className="focus-ring label-data text-[10px] tracking-[0.14em] px-1.5 py-0.5 border border-[var(--color-ink-cool-dim)] text-[var(--color-ink-cool)] hover:text-[var(--color-text-primary)]"
          >
            page {i + 1} ↗
          </button>
        ))}
        <span className="flex-1" />
        {!accepted && live && onConfirm && (
          <>
            {edited && <span className="fig-caption">edited</span>}
            <Button
              variant="ghost"
              onClick={() => {
                setAccepted(true)
                onConfirm(draft)
              }}
            >
              This is what I wrote
            </Button>
          </>
        )}
        {!live && <span className="fig-caption">from a reopened sitting — nothing to confirm</span>}
      </div>

      {!accepted && live && (
        <div className="fig-caption">
          goes to your composer, not to the grader — you still press send
        </div>
      )}
    </MarkFrame>
  )
})
