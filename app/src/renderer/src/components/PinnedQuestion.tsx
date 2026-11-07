import { useEffect, useState } from 'react'
import { ProseMarkdown } from './ProseMarkdown'

/** The "Answering" strip: the tutor's current question, repeated just above
 * the composer, but only once the question itself has scrolled out of view.
 *
 * While the question is on screen the strip stays hidden, so a short
 * exchange never shows the same sentence twice. As soon as the learner
 * scrolls up to reread something, or a long message pushes the question
 * above the fold, the strip appears and they can keep answering without
 * scrolling back to find what was asked.
 *
 * "On screen" is measured against the question's own message (its
 * `data-msg-index` root inside the scroll container): the question is the
 * last thing that message says, so the message's bottom edge is where it
 * sits. */
export function PinnedQuestion({
  text,
  msgIndex,
  scrollEl,
  nodeIds,
  nodeChipTopic,
}: {
  text: string
  msgIndex: number
  scrollEl: HTMLElement | null
  nodeIds?: Set<string>
  nodeChipTopic?: string
}) {
  const [offscreen, setOffscreen] = useState(false)

  useEffect(() => {
    if (!scrollEl) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const msg = scrollEl.querySelector(`[data-msg-index="${msgIndex}"]`)
        if (!msg) return setOffscreen(false)
        const box = scrollEl.getBoundingClientRect()
        const bottom = msg.getBoundingClientRect().bottom
        // A little slack each way: a question peeking 1px over the edge has
        // not been read, and one 1px under it still has.
        setOffscreen(bottom < box.top + 32 || bottom > box.bottom + 8)
      })
    }
    measure()
    scrollEl.addEventListener('scroll', measure, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(scrollEl)
    return () => {
      cancelAnimationFrame(frame)
      scrollEl.removeEventListener('scroll', measure)
      ro.disconnect()
    }
  }, [scrollEl, msgIndex, text])

  if (!offscreen) return null
  return (
    <div
      className="transcript-measure shrink-0 flex items-baseline gap-3 px-3 py-2 border border-[var(--color-hairline)] border-l-2 border-l-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-surface)_96%,transparent)]"
      aria-live="polite"
    >
      <span className="label-data text-[11px] uppercase tracking-[0.1em] text-[var(--color-ink-warm)] shrink-0">Answering</span>
      <ProseMarkdown
        text={text}
        nodeIds={nodeIds}
        nodeChipTopic={nodeChipTopic}
        className="text-sm text-[var(--color-text-primary)] min-w-0 [&_p]:m-0 line-clamp-2"
      />
    </div>
  )
}
