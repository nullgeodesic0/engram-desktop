/** Minimap Precision fix — the checkpoint is the destination, not its
 * neighborhood. Second report on the same bug: the first fix
 * (`scrollIntoView({ block: 'start' })` + a static `scroll-margin-top` on the
 * clicked-near MESSAGE's own root) address neither of the two real causes.
 *
 * H1 (confirmed by reading TranscriptMinimap.tsx, ChatMessageView.tsx,
 * ReviewSessionView.tsx/LearnSessionView.tsx, and components/ritual/Marks.tsx
 * in full) — every rendered checkpoint used to be scrolled-to via the HOST
 * MESSAGE's `[data-msg-index]`, but a checkpoint is routinely NOT the
 * message's own root:
 *   - a mark (crossing/beat/misconception/milestone/ask) interleaves as its
 *     OWN sibling BETWEEN two messages (`k.atIndex === i + 1` renders right
 *     before message `i+1`) — `MarkView` had no DOM anchor of its own at all,
 *     so the only thing to jump to was the NEXT message, leaving the mark
 *     itself sitting above the viewport;
 *   - a probe/grade card renders MID-message, after that message's own
 *     leading commentary (`ChatMessageView`'s `beforeProbeHeader`/`ProbeCard`
 *     flow) — jumping to the message root left the card below the fold when
 *     that commentary was long, or (for Review's grade cards, nested even
 *     deeper inside `beforeProbeHeader`) arbitrarily far from the landing
 *     spot.
 * Fixed by giving every checkpoint-emitting render site its own
 * `CheckpointAnchor` (components/CheckpointAnchor.tsx), tagged with the exact
 * same `id` `deriveInstrumentMoments` (shared/instrumentMoments.ts) assigned
 * that moment — this function resolves THAT element, never the host message.
 *
 * H2 (confirmed) — `.transcript-measure`'s `content-visibility: auto`
 * (index.css) reports `contain-intrinsic-size: auto 120px` for any block the
 * browser has scrolled past. Most blocks between "here" and a distant
 * checkpoint are exactly that: skipped, laid out only to their 120px
 * estimate. The FIRST `scrollIntoView` computes its landing position against
 * those estimates; the moment it scrolls, the newly-revealed blocks along the
 * way get measured for real (routinely nothing like 120px — a diagnostic
 * plate, a multi-result grade stack, a paragraph of verdict prose), which
 * shifts the checkpoint's true position out from under where the browser
 * just landed. A single `scrollIntoView` call can only ever be as accurate as
 * the layout tree it was computed against. Fixed with a bounded settle loop:
 * re-measure the target's offset from its own `scroll-margin-top` a couple of
 * animation frames later, and re-issue an (instant, non-smooth)
 * `scrollIntoView` if it's still off by more than a few px of paint/subpixel
 * jitter — capped at 2 correction passes so a pathological reflow can't spin.
 *
 * H3 (checked, not re-fixed) — the 140px static `scroll-margin-top` a
 * checkpoint anchor now carries could in principle mismatch the real
 * occluding chrome (the 28px fade + a peeked/pinned TicketCard/masthead of
 * varying height) at click time. Left static: H1 was the dominant bug (the
 * scroll target wasn't the checkpoint AT ALL, an error far bigger than any
 * headroom slack), and 140px already comfortably clears the fade plus every
 * floating card's typical collapsed/peeked height in this codebase — dynamic
 * measurement would mean threading ticket/masthead refs cross-component for
 * a few px of marginal accuracy. Revisit only if a real report names a
 * specific chrome state that still clips the landing.
 *
 * INVARIANT: once `jumpToCheckpoint` settles, the checkpoint element's own
 * top edge sits within [0, 8px] of its own `scroll-margin-top` offset from
 * the scroll container's viewport top — two-pass corrected for
 * `content-visibility` layout settling. The checkpoint is the destination,
 * never a neighboring message standing in for it. */
export function jumpToCheckpoint(scrollEl: HTMLDivElement, checkpointId: string, fallbackMessageIndex: number): void {
  function locate(): HTMLElement | null {
    const anchors = scrollEl.querySelectorAll<HTMLElement>('[data-checkpoint-id]')
    for (const el of Array.from(anchors)) {
      if (el.dataset.checkpointId === checkpointId) return el
    }
    // Defensive fallback only — every real InstrumentMoment has a matching
    // CheckpointAnchor by construction (see that component's own doctrine
    // comment); this only ever fires for a stale/mismatched id, and landing
    // near the host message beats doing nothing.
    return scrollEl.querySelector<HTMLElement>(`[data-msg-index="${fallbackMessageIndex}"]`)
  }

  const initial = locate()
  if (!initial) return
  initial.scrollIntoView({ block: 'start', behavior: 'smooth' })

  let pass = 0
  function correct(): void {
    requestAnimationFrame(() => {
      const target = locate()
      if (!target) return
      const rect = target.getBoundingClientRect()
      const chrome = parseFloat(getComputedStyle(target).scrollMarginTop) || 0
      const drift = rect.top - chrome
      pass++
      if (Math.abs(drift) > 4 && pass <= 2) {
        target.scrollIntoView({ block: 'start', behavior: 'auto' })
        correct()
      }
    })
  }
  correct()
}
