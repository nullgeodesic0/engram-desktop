import { useRef, type ReactNode } from 'react'
import { useFocusTrap } from '../useFocusTrap'

/** The one modal shell: dim scrim, focus trap, escape-to-close, panel chrome.
 * Content owns its own internal layout; the shell owns positioning and a11y.
 *
 * Guardian anatomy (T3): the title row is a full-bleed `.detail-title-band`
 * (opaque surface-3, hairline bottom — a solid plate, never blurred, unlike
 * the panel's own backdrop-blur) rather than sitting inside the padded body.
 * `subtitle` and `footer` are both optional and additive — every existing
 * caller that only passes `title`/`children` renders identically to before,
 * just with the band/atom styling. No new hooks; `useFocusTrap` keeps its
 * exact prior call site and order. */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  wide = false,
  panelClassName,
  headerExtra,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  /** Optional in-band italic-serif line under the title (e.g. the topic
   * title on TopicSettingsModal). No-op without a `title`. */
  subtitle?: ReactNode
  /** Optional hairline-topped footer row (`.detail-footer`) — conventionally
   * an action on the left, a `.kbd-hint` on the right ("↵ save", "esc — close"). */
  footer?: ReactNode
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
      // `data-app-modal` marks every instance of THIS shell (Help, the
      // confidence/menu picker, session history, …) so App.tsx's global
      // keydown listener can tell "a modal is up" from a DOM query, without
      // every view lifting its own dialog's open-state into App — see that
      // handler's own comment for why (F9: `?`/`⌘0`-`⌘6` used to fire behind
      // an open dialog, since App had no way to know one was there).
      // CommandPalette is a deliberately separate, hand-rolled overlay (not
      // this component) and is NOT marked, so its own `⌘K` toggle and the
      // nav shortcuts still work while it's open, exactly as before.
      data-app-modal="true"
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
        className={`panel-raised max-h-[85vh] overflow-y-auto flex flex-col w-full ${wide ? 'max-w-2xl' : 'max-w-md'}${panelClassName ? ` ${panelClassName}` : ''}`}
      >
        {title && (
          <div className="detail-title-band flex items-start justify-between gap-4 px-6 py-4 shrink-0">
            <div className="min-w-0">
              <h2 className="font-(family-name:--font-display) text-[length:var(--text-heading)] text-[var(--color-text-primary)]">
                {title}
              </h2>
              {subtitle && <div className="detail-subtitle text-[length:var(--text-caption)] mt-0.5">{subtitle}</div>}
            </div>
            {headerExtra}
          </div>
        )}
        <div className="p-6">{children}</div>
        {footer && <div className="detail-footer px-6 py-3 shrink-0">{footer}</div>}
      </div>
    </div>
  )
}
