import { useEffect, useRef, useState, type ReactNode } from 'react'

/** The scrollable message region shared by Learn and Review. Auto-sticks to the
 * bottom as new content streams in — but only while you're already at the
 * bottom; if you've scrolled up to reread something, new content no longer
 * yanks you back down, and a "Jump to latest" pill appears instead. */
export function ChatScrollRegion({ children, deps }: { children: ReactNode; deps: unknown[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)

  function onScroll() {
    const el = containerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setStick(distanceFromBottom < 80)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el || !stick) return
    el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  function jumpToBottom() {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setStick(true)
  }

  return (
    <div className="relative flex-1 min-h-0">
      {/* `scroll-fade-top`: content dissolves into the top edge instead of
          being guillotined by it, so the transcript reads as continuing past
          the viewport rather than being clipped at an arbitrary line — and
          the strip the masthead/probe cards tuck into stops looking like a
          hard boundary. See index.css. */}
      <div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto flex flex-col gap-4 scroll-fade-top">
        {children}
      </div>
      {!stick && (
        <button
          onClick={jumpToBottom}
          className="focus-ring absolute bottom-3 left-1/2 -translate-x-1/2 panel px-3 py-1.5 text-xs text-[var(--color-ink-warm)] bg-[var(--color-surface-2)] shadow-lg"
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  )
}
