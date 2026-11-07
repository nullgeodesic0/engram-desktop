import { useEffect, useState } from 'react'
import type { TopicListEntry } from '../../../shared/types'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'

/**
 * The archive confirmation — says exactly what archiving changes, in the
 * order of archive.ts's rules, so the learner never has to guess what an
 * archived topic still counts toward. Handles one topic or several (Learn's
 * organize-mode bulk action). Archive rides the engine's own reversible
 * `retire --topic`; nothing is deleted.
 *
 * No danger ink on the confirm: DESIGN.md reserves danger for the learner's
 * struggle, and this is reversible besides.
 */
export function ArchiveTopicDialog({
  topics,
  onArchived,
  onClose,
}: {
  topics: TopicListEntry[]
  onArchived: () => void
  onClose: () => void
}) {
  const [openMisconceptions, setOpenMisconceptions] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = new Set(topics.map((t) => t.topic))
  const one = topics.length === 1 ? topics[0] : null
  const nodeCount = topics.reduce((sum, t) => sum + t.nodes, 0)

  useEffect(() => {
    let alive = true
    window.engram
      .misconceptions()
      .then((rows) => {
        if (alive) setOpenMisconceptions(rows.filter((m) => m.status === 'open' && ids.has(m.topic)).length)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function archive() {
    setBusy(true)
    setError(null)
    try {
      // The engine takes one topic per call and holds a lock while it writes,
      // so these run one after another rather than in parallel.
      for (const t of topics) await window.engram.retireTopic(t.topic, false)
      onArchived()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      onArchived() // some may have gone through — refresh either way
    } finally {
      setBusy(false)
    }
  }

  const rows: { mark: string; ink: string; text: React.ReactNode }[] = [
    {
      mark: 'stops',
      ink: 'var(--color-ink-warm)',
      text: (
        <>
          {one ? `All ${nodeCount} concepts retire` : `All ${nodeCount} concepts across ${topics.length} topics retire`}: no reviews
          come due, and {one ? 'it leaves' : 'they leave'} the review queue, forecast, due badge and phone.
        </>
      ),
    },
    {
      mark: 'leaves',
      ink: 'var(--color-ink-cool)',
      text: (
        <>
          Your GPA, and Home and Coach’s live numbers. {one ? 'Its grade is' : 'Their grades are'} frozen as a{' '}
          <span className="font-medium">final grade</span> on the day you archive.
        </>
      ),
    },
    {
      mark: 'parks',
      ink: 'var(--color-ink-cool)',
      text:
        openMisconceptions && openMisconceptions > 0
          ? `${openMisconceptions} open misconception${openMisconceptions === 1 ? ' is' : 's are'} set aside, so ${openMisconceptions === 1 ? 'it stops' : 'they stop'} counting against you.`
          : 'Any open misconceptions are set aside, so they stop counting against you.',
    },
    {
      mark: 'keeps',
      ink: 'var(--color-text-faint)',
      text: 'The map, every sitting and receipt, your streak and activity history.',
    },
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title={one ? `Archive ${one.title}?` : `Archive ${topics.length} topics?`}
      subtitle="Nothing is deleted, and you can restore any time."
    >
      <div className="flex flex-col gap-4 px-6 py-5">
        <ul className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <li key={r.mark} className="flex gap-3 text-sm leading-snug text-[var(--color-text-primary)]">
              <span className="label-data text-[11px] uppercase tracking-[0.08em] w-14 shrink-0 pt-0.5" style={{ color: r.ink }}>
                {r.mark}
              </span>
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
        {!one && (
          <div className="text-xs text-[var(--color-text-faint)] line-clamp-2">{topics.map((t) => t.title).join(' · ')}</div>
        )}
        {error && <div className="text-xs text-[var(--color-text-dim)]">Couldn’t archive everything: {error}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void archive()} disabled={busy}>
            {busy ? 'Archiving…' : 'Archive'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
