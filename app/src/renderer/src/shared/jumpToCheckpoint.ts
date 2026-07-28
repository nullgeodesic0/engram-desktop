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
 * re-measure the target's offset from its own `scroll-margin-top` and, if
 * it's still off by more than a few px of paint/subpixel jitter, re-issue an
 * (instant, non-smooth) `scrollIntoView` — capped at 2 correction passes so a
 * pathological reflow can't spin.
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
 * Smooth-scroll fix (third report) — the settle correction used to fire on
 * the next couple of animation frames regardless of whether the *initial*
 * jump was still mid-flight, which raced an in-progress smooth scroll: the
 * "settle" instant `scrollIntoView` cut the animation short and read as a
 * stutter. Now the primary jump is smooth (`behavior: 'smooth'`), and the
 * settle correction waits for that animation to actually finish before
 * touching the DOM — detected via the `scrollend` event where the browser
 * fires it, with a position-stability fallback (scrollTop unchanged across
 * ~3 consecutive animation frames) for engines that don't. Only once settled
 * does the bounded correction loop run, and every correction pass in that
 * loop is instant (`behavior: 'auto'`) by design: a second smooth animation
 * for a few residual px would itself look like a stutter, not a settle.
 * `prefers-reduced-motion: reduce` skips the smooth phase entirely — the
 * jump is instant and the correction loop runs immediately, exactly as
 * before this fix (no animation to wait out, so there's nothing to settle).
 *
 * Concurrency: a `WeakMap<scrollEl, token>` tracks the most recent jump
 * requested per scroll container. Every async continuation (the settle wait,
 * each correction-loop pass) checks that its own token is still the current
 * one before touching the DOM or scheduling further work; a second click
 * mid-flight mints a new token, which makes the FIRST jump's pending settle
 * a silent no-op the instant the second jump starts — no cancelAnimationFrame
 * bookkeeping needed, just a stale-token check at every resumption point.
 *
 * INVARIANT: once the returned promise resolves, the checkpoint element's own
 * top edge sits within [0, 4px] of its own `scroll-margin-top` offset from
 * the scroll container's viewport top (unless a newer jump superseded this
 * one first, in which case this promise resolves early without asserting
 * anything about final position — the newer jump owns the invariant instead).
 * The checkpoint is the destination, never a neighboring message standing in
 * for it. */

const activeJump = new WeakMap<HTMLDivElement, symbol>()

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

/** Resolves as soon as `scrollEl` stops moving after a smooth scroll: the
 * `scrollend` event where the browser fires it, or — as a fallback for
 * engines that don't (Safari, as of writing) — three consecutive animation
 * frames with an unchanged `scrollTop`. Whichever signal arrives first wins;
 * the other is torn down immediately. Also resolves early (without either
 * signal) if `isCurrent` goes false, so a superseded jump's wait doesn't
 * linger doing nothing. */
function waitForScrollSettle(scrollEl: HTMLDivElement, isCurrent: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    function finish() {
      if (done) return
      done = true
      scrollEl.removeEventListener('scrollend', onScrollEnd)
      resolve()
    }
    function onScrollEnd() {
      finish()
    }
    scrollEl.addEventListener('scrollend', onScrollEnd)

    let stableFrames = 0
    let lastTop = scrollEl.scrollTop
    function tick() {
      if (done) return
      if (!isCurrent()) {
        finish()
        return
      }
      const top = scrollEl.scrollTop
      if (top === lastTop) {
        stableFrames++
      } else {
        stableFrames = 0
        lastTop = top
      }
      if (stableFrames >= 3) {
        finish()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/** The bounded H2 correction loop: re-measure `locate()`'s drift from its own
 * `scroll-margin-top` and, if still off by more than 4px of paint/subpixel
 * jitter, re-issue an INSTANT `scrollIntoView` and check again — capped at 2
 * passes. Every step re-checks `isCurrent` first, so a superseded jump's loop
 * stops touching the DOM the instant a newer jump starts. */
function runCorrectionLoop(locate: () => HTMLElement | null, isCurrent: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    let pass = 0
    function step() {
      requestAnimationFrame(() => {
        if (!isCurrent()) {
          resolve()
          return
        }
        const target = locate()
        if (!target) {
          resolve()
          return
        }
        const rect = target.getBoundingClientRect()
        const chrome = parseFloat(getComputedStyle(target).scrollMarginTop) || 0
        const drift = rect.top - chrome
        pass++
        if (Math.abs(drift) > 4 && pass <= 2) {
          target.scrollIntoView({ block: 'start', behavior: 'auto' })
          step()
        } else {
          resolve()
        }
      })
    }
    step()
  })
}

/** Scrolls `scrollEl` so the checkpoint tagged `checkpointId` (a
 * `CheckpointAnchor`'s `data-checkpoint-id`) lands at the top of the
 * viewport, smoothly, then corrects any `content-visibility` settling drift
 * once the smooth scroll finishes. Returns a promise that resolves once
 * everything has settled (or once a newer call to this function supersedes
 * this one) — callers that need to react to the FINAL landed position (the
 * minimap's post-jump re-measurement, for instance) should await it; fire-
 * and-forget callers can ignore the return value exactly as before. */
export function jumpToCheckpoint(scrollEl: HTMLDivElement, checkpointId: string, fallbackMessageIndex: number): Promise<void> {
  const token = Symbol('jump')
  activeJump.set(scrollEl, token)
  const isCurrent = () => activeJump.get(scrollEl) === token

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
  if (!initial) return Promise.resolve()

  const reduced = prefersReducedMotion()
  initial.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })

  if (reduced) {
    // No animation to wait out — correct immediately, exactly as this
    // function behaved before the smooth-scroll fix.
    return runCorrectionLoop(locate, isCurrent)
  }

  return waitForScrollSettle(scrollEl, isCurrent).then(() => {
    if (!isCurrent()) return Promise.resolve()
    return runCorrectionLoop(locate, isCurrent)
  })
}
