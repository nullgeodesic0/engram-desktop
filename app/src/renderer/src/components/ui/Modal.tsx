import { useRef, type ReactNode } from 'react'
import { useFocusTrap } from '../useFocusTrap'

/** The one modal shell: dim scrim, focus trap, escape-to-close, panel chrome.
 * Content owns its own internal layout; the shell owns positioning and a11y. */
export function Modal({
  open,
  onClose,
  title,
  wide = false,
  panelClassName,
  headerExtra,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  wide?: boolean
  /** Extra classes appended to the panel (the `panel-raised` div) — e.g. to
   * override its border color for a conditional treatment. */
  panelClassName?: string
  /** Rendered beside the title in the same row (e.g. an explicit Close
   * button for content with no other focusable element — see HelpSheet).
   * No-op without a `title`, since there'd be no header row to join. */
  headerExtra?: ReactNode
  children: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(containerRef, open)
  if (!open) return null
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`panel-raised max-h-[85vh] overflow-y-auto p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-md'}${panelClassName ? ` ${panelClassName}` : ''}`}
      >
        {title && (
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className="font-[var(--font-display)] text-[length:var(--text-heading)] text-[var(--color-text-primary)]">
              {title}
            </h2>
            {headerExtra}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
