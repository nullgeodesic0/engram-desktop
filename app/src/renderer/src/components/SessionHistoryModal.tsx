import type { SessionIndexEntry } from '../../../shared/types'
import { Modal } from './ui/Modal'

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** Lists past sessions for a topic/kind (newest first, from sessionIndex.ts's
 * now-append-only history) so an older one can be reopened read-only — see
 * LearnSessionView.tsx/ReviewSessionView.tsx's `viewingHistory` state for the
 * replay side of this. */
export function SessionHistoryModal({
  entries,
  currentSessionId,
  onSelect,
  onClose,
}: {
  entries: SessionIndexEntry[]
  currentSessionId: string | null
  onSelect: (sessionId: string) => void
  onClose: () => void
}) {
  return (
    <Modal open onClose={onClose} title="Session history" wide>
      <div className="flex flex-col">
        <div className="overflow-y-auto py-1.5">
          {entries.length === 0 && <div className="px-5 py-4 text-sm text-[var(--color-text-faint)]">No past sessions yet.</div>}
          {entries.map((entry, i) => (
            <button
              key={entry.sessionId}
              onClick={() => onSelect(entry.sessionId)}
              className="focus-ring no-press w-full flex items-center justify-between px-5 py-3 text-left hover:bg-[var(--color-surface-3)]"
            >
              <div className="flex flex-col">
                <span className="text-sm text-[var(--color-text-primary)]">
                  {i === 0 ? 'Most recent' : `${i + 1} sessions ago`}
                </span>
                <span className="text-xs text-[var(--color-text-faint)] label-data mt-0.5">{formatWhen(entry.startedAt)}</span>
              </div>
              {entry.sessionId === currentSessionId && (
                <span className="text-[10px] label-data px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-ink-warm)]">
                  current
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
