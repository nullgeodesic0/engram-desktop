import { useEffect, useMemo, useState } from 'react'
import 'katex/dist/katex.min.css'
import { renderMarkdownWithMath } from '../shared/markdownWithMath'
import { humanizeNodeId } from '../../../shared/humanizeId'
import type { LectureNotesRecord } from '../../../shared/lectureNotes'

/**
 * The lecture-notes reader: the same notes the PDF holds, rendered in the
 * app's own type so they can sit beside the transcript (Learn) or over the
 * map (Topic Map) without sending the learner to another window.
 *
 * A side drawer, not a modal: in a sitting the learner reads with the
 * transcript still in view, and nothing here traps focus or blocks the
 * composer. The caller positions it; this component only fills the box.
 *
 * Design rules from the UI overhaul (DESIGN.md): 11px uppercase labels at
 * 0.1em, right-angle corners, and a surface at least 92% opaque so the
 * ambient field never shows through body text.
 */
export function LectureNotesPanel({
  topic,
  node,
  onClose,
}: {
  topic: string
  node: string
  onClose: () => void
}) {
  const [record, setRecord] = useState<LectureNotesRecord | null | 'loading'>('loading')
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setRecord('loading')
    setNote(null)
    window.engram
      .getLectureNotes(topic, node)
      .then((r) => alive && setRecord(r))
      .catch(() => alive && setRecord(null))
    return () => {
      alive = false
    }
  }, [topic, node])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const html = useMemo(
    () => (record && record !== 'loading' ? renderMarkdownWithMath(record.markdown) : ''),
    [record],
  )

  const written =
    record && record !== 'loading'
      ? new Date(record.writtenAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null

  async function openPdf(): Promise<void> {
    setNote(null)
    const r = await window.engram.openLectureNotesPdf(topic, node).catch(() => ({ ok: false, reason: undefined }))
    if (!r.ok) setNote(r.reason ?? 'Could not open the PDF.')
  }

  async function saveCopy(): Promise<void> {
    setNote(null)
    const r = await window.engram.saveLectureNotesPdf(topic, node).catch(() => ({ ok: false, reason: undefined, path: undefined }))
    if (r.ok && r.path) setNote(`Saved to ${r.path}`)
    else if (r.reason && r.reason !== 'canceled') setNote(r.reason)
  }

  const label = 'label-data text-[11px] uppercase tracking-[0.1em]'
  const btn = `focus-ring ${label} px-2.5 py-1.5 border border-[var(--color-edge)] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] disabled:opacity-40`

  return (
    <aside
      aria-label="Lecture notes"
      className="lecture-notes-panel h-full w-full flex flex-col border border-[var(--color-edge)] border-t-2 border-t-[var(--color-ink-warm)] shadow-[-24px_0_48px_rgba(0,0,0,0.35)]"
      style={{ background: 'var(--color-surface)' }}
    >
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--color-hairline)]">
        <div className={`${label} text-[var(--color-ink-warm)] flex-1 min-w-0 truncate`}>
          Lecture notes · {record && record !== 'loading' ? record.title : humanizeNodeId(node)}
        </div>
        <button type="button" className={btn} onClick={openPdf} disabled={!record || record === 'loading'}>
          Open PDF
        </button>
        <button type="button" className={btn} onClick={saveCopy} disabled={!record || record === 'loading'}>
          Save copy
        </button>
        <button type="button" className={`${btn} px-2`} onClick={onClose} aria-label="Close lecture notes">
          ×
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-7 py-6">
        {record === 'loading' && <div className="fig-caption">Opening the notes…</div>}
        {record === null && (
          <div className="text-sm text-[var(--color-text-dim)]">
            No lecture notes are saved for this concept yet. The tutor writes them the first time you start it with
            Lecture notes turned on in Settings.
          </div>
        )}
        {record && record !== 'loading' && (
          <div className="lecture-notes-doc md-prose voice-serif" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>

      <div className={`shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-t border-[var(--color-hairline)] ${label} text-[var(--color-text-faint)]`}>
        <span className="truncate">{note ?? (record && record !== 'loading' && record.pages ? `${record.pages} ${record.pages === 1 ? 'page' : 'pages'} as PDF` : '')}</span>
        {written && <span className="shrink-0">Written {written}</span>}
      </div>
    </aside>
  )
}
