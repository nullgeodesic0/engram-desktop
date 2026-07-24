import { MarkdownPreview } from './MarkdownPreview'
import { fileName } from './ChatMessageView'

interface MessageComposerProps {
  production: string
  onProductionChange: (v: string) => void
  attachedFiles: string[]
  onRemoveAttachment: (path: string) => void
  onAttach: () => void
  markdownPreview: boolean
  onToggleMarkdownPreview: () => void
  onSubmit: () => void
  placeholder?: string
  /** Recall-chamber state (Task 7): when set, this composer offers a toggle that blurs
   * the transcript above it so free recall can't peek back at prior turns. Omit both
   * chamber props entirely to opt a call site out of the chamber button. */
  chamber?: boolean
  onChamberChange?: (on: boolean) => void
  /** Pulses the toggle to invite entry (e.g. at a verify beat) without forcing it. */
  inviteChamber?: boolean
}

/** The response box shared by Learn and Review: attachment chips, a textarea that
 * optionally splits into a live Markdown+LaTeX preview pane, and the attach/preview
 * toggle/submit row. Kept as one component so both session views stay in sync. */
export function MessageComposer({
  production,
  onProductionChange,
  attachedFiles,
  onRemoveAttachment,
  onAttach,
  markdownPreview,
  onToggleMarkdownPreview,
  onSubmit,
  placeholder = 'Your answer…',
  chamber,
  onChamberChange,
  inviteChamber,
}: MessageComposerProps) {
  function submit() {
    onSubmit()
    onChamberChange?.(false)
  }

  return (
    <div className="shrink-0 flex flex-col gap-2">
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachedFiles.map((path) => (
            <span
              key={path}
              title={path}
              className="label-data text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-text-dim)] flex items-center gap-1"
            >
              📎 {fileName(path)}
              <button onClick={() => onRemoveAttachment(path)} className="focus-ring hover:text-[var(--color-ink-danger)]">
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {chamber && <div className="fig-caption">recall chamber — nothing to look back at</div>}
      <div className={markdownPreview ? 'grid grid-cols-2 gap-3 w-full' : 'w-full'}>
        <textarea
          value={production}
          onChange={(e) => onProductionChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              if (production.trim()) submit()
            } else if (e.key === 'Escape') {
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }}
          placeholder={placeholder}
          rows={chamber ? 12 : markdownPreview ? 8 : 4}
          className="focus-ring panel px-4 py-3 text-sm bg-[var(--color-surface-2)] text-[var(--color-text-primary)] resize-none w-full"
        />
        {markdownPreview && (
          <div className="panel px-4 py-3 overflow-y-auto" style={{ maxHeight: '13rem' }}>
            <MarkdownPreview source={production} />
          </div>
        )}
      </div>
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1">
          <button
            onClick={onAttach}
            title="Attach files"
            className="focus-ring px-3 py-2 rounded-lg text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)]"
          >
            📎 Attach
          </button>
          <button
            onClick={onToggleMarkdownPreview}
            title="Toggle a live rendered preview of your answer (Markdown + LaTeX) alongside the input"
            aria-pressed={markdownPreview}
            className={`focus-ring px-3 py-2 rounded-lg text-xs hover:bg-[var(--color-surface-3)] ${
              markdownPreview ? 'text-[var(--color-ink-warm)]' : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            ◧ Markdown Preview
          </button>
          {onChamberChange && (
            <button
              onClick={() => onChamberChange(!chamber)}
              title="A blurred transcript, so recall comes from you, not the page above"
              aria-pressed={chamber}
              className={`focus-ring px-3 py-2 rounded-lg text-xs hover:bg-[var(--color-surface-3)] ${
                chamber ? 'text-[var(--color-ink-warm)]' : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
              } ${inviteChamber && !chamber ? 'chamber-invite' : ''}`}
            >
              {chamber ? '✕ Leave chamber' : '◐ Begin recall'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] label-data text-[var(--color-text-faint)]">⌘⏎</span>
          <button
            onClick={submit}
            disabled={!production.trim()}
            className="focus-ring px-4 py-2 rounded-lg text-sm bg-[var(--color-surface-3)] text-[var(--color-ink-warm)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}
