import { memo, useEffect, useState, useSyncExternalStore } from 'react'
import { MarkFrame } from './MarkFrame'
import {
  announceLectureNotesRead,
  lectureNotesLocked,
  requestOpenLectureNotes,
  subscribeLectureNotesLock,
} from '../../shared/lectureNotesBus'

/** Live when the session view has notes open-able; reads the shared lock. */
export function useLectureNotesLocked(): boolean {
  return useSyncExternalStore(subscribeLectureNotesLock, lectureNotesLocked)
}

/**
 * The transcript card for a set of lecture notes the tutor just wrote
 * (publish_lecture_notes). Read notes opens the drawer beside the
 * transcript; Open PDF hands the stored PDF to the system viewer. While the
 * sitting is waiting for the learner to finish reading (`awaitingRead`), the
 * card also carries the one button that starts the concept — it sends the
 * learner's own "I've read them" turn, exactly as if they had typed it.
 *
 * Warm ink: the notes are the loop working as the learner configured it.
 */
export const LectureNotesCard = memo(function LectureNotesCard({
  topic,
  node,
  title,
  awaitingRead,
}: {
  topic: string
  node: string
  title: string
  awaitingRead: boolean
}) {
  const locked = useLectureNotesLocked()
  const [pages, setPages] = useState<number | null>(null)
  const [missing, setMissing] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.engram
      .getLectureNotes(topic, node)
      .then((rec) => {
        if (!alive) return
        if (!rec) setMissing(true)
        else setPages(rec.pages)
      })
      .catch(() => alive && setMissing(true))
    return () => {
      alive = false
    }
  }, [topic, node])

  const ref = { topic, node, title }
  const readMinutes = pages ? Math.max(2, Math.round(pages * 2.5)) : null

  return (
    <MarkFrame
      accent="warm"
      label={awaitingRead ? 'LECTURE NOTES · READ BEFORE YOU START' : 'LECTURE NOTES'}
      fill
      glyph={
        <>
          <rect x="2.5" y="1.5" width="9" height="11" stroke="currentColor" strokeWidth="1" />
          <path d="M4.5 4.5h5M4.5 6.5h5M4.5 8.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </>
      }
    >
      <div className="font-(family-name:--font-serif) text-[17px] text-[var(--color-text-primary)]">{title}</div>
      <div className="label-data text-[11px] tracking-[0.1em] uppercase text-[var(--color-text-dim)]">
        {missing
          ? 'These notes were not saved'
          : [pages ? `${pages} ${pages === 1 ? 'page' : 'pages'}` : null, readMinutes ? `about ${readMinutes} min` : null, 'saved to this concept on your map']
              .filter(Boolean)
              .join(' · ')}
      </div>
      {!missing && (
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <button
            type="button"
            disabled={locked}
            onClick={() => requestOpenLectureNotes(ref)}
            className="focus-ring label-data text-[11px] tracking-[0.1em] uppercase px-3 py-1.5 border border-[var(--color-ink-warm)] bg-[var(--color-ink-warm)] text-[var(--color-void)] disabled:opacity-40"
          >
            Read notes
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              setPdfError(null)
              window.engram
                .openLectureNotesPdf(topic, node)
                .then((r) => !r.ok && setPdfError(r.reason ?? 'Could not open the PDF.'))
                .catch(() => setPdfError('Could not open the PDF.'))
            }}
            className="focus-ring label-data text-[11px] tracking-[0.1em] uppercase px-3 py-1.5 border border-[var(--color-edge)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] disabled:opacity-40"
          >
            Open PDF
          </button>
          {awaitingRead && !locked && (
            <button
              type="button"
              onClick={() => announceLectureNotesRead(ref)}
              className="focus-ring ml-auto label-data text-[11px] tracking-[0.1em] uppercase px-3 py-1.5 border border-[var(--color-ink-warm-dim)] text-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-ink-warm)_14%,transparent)] hover:text-[var(--color-text-primary)]"
            >
              I've read them, start the concept
            </button>
          )}
          {locked && (
            <span className="label-data text-[11px] tracking-[0.1em] uppercase text-[var(--color-text-faint)]">
              Closed for the final check
            </span>
          )}
        </div>
      )}
      {pdfError && <div className="text-xs text-[var(--color-text-dim)]">{pdfError}</div>}
    </MarkFrame>
  )
})
