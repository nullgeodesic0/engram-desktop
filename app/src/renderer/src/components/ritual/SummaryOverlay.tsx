import type { MutableRefObject, ReactNode } from 'react'
import { PinTackIcon } from '../ui/PinTackIcon'
import { ACCENT, type EnvAccent } from '../../shared/controlChrome'

/** Shared peek/tuck pair — `armed` guards against continuous motion pushing
 * the tuck deadline forward forever. Extracted verbatim from
 * ReviewSessionView (which still uses it for its probe/ticket floats too):
 * clear + rearm on tuck, so a card can only fold once the pointer has
 * genuinely settled away from it — the "armed deadline stands" variant let
 * the tuck fire while the cursor was mid-flight toward the card (mousemove
 * sampling has holes at the edges), folding the target under the very click
 * aimed at it. */
export const makePeek = (
  timer: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  set: (v: boolean) => void,
) => ({
  peek: () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    set(true)
  },
  tuck: () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      set(false)
    }, 400)
  },
})

/** The end-of-sitting summary overlay both chat environments share — floats
 * OVER the transcript on the container's BOTTOM edge, mirroring the probe's
 * grid-collapse grammar (same 0fr↔1fr technique, same 340ms/-dur-base
 * directional timings, same direct onMouseEnter claim), with the loose
 * closing cards seated in ONE `panel-raised` backing plate: a scrollable
 * card stack over a `detail-footer` that seats the pin tack and a
 * fig-caption slot. Absolute — never participates in the flex column, so
 * the transcript keeps its full height whether the sitting just finished
 * or not.
 *
 * Stateless: `pinned`/`peek` and the peek controller live in the view
 * (KeepMounted discipline — LearnSessionView appends its copies at the END
 * of its hook list, never between). */
export function SummaryOverlay({
  accent,
  pinned,
  peek,
  onPeek,
  onTogglePin,
  caption,
  children,
}: {
  /** Environment chrome identity — the reveal nub's hover ink and the
   * pinned tack follow it (Learn warm / Review cool). */
  accent: EnvAccent
  pinned: boolean
  peek: boolean
  /** Direct-hover claim (authoritative over the view's sampled container-
   * mousemove geometry) — wire to the view's own peek controller. */
  onPeek: () => void
  onTogglePin: () => void
  /** Optional fig-caption seated in the plate's footer beside the pin. */
  caption?: ReactNode
  children: ReactNode
}) {
  const a = ACCENT[accent]
  const out = pinned || peek
  const nubHover = accent === 'warm' ? 'group-hover:bg-[var(--color-ink-warm-dim)]' : 'group-hover:bg-[var(--color-ink-cool-dim)]'
  return (
    <>
      {!out && (
        <div
          className="absolute bottom-0 left-0 right-0 z-20 h-2 flex items-center justify-center group cursor-default"
          onMouseEnter={onPeek}
          aria-hidden="true"
        >
          <span className={`h-px w-12 rounded bg-[var(--color-edge)] ${nubHover} transition-colors duration-[var(--dur-fast)]`} />
        </div>
      )}
      <div
        onMouseEnter={onPeek}
        className={`absolute bottom-0 left-0 right-0 z-20 grid transition-[grid-template-rows] ${
          out
            ? 'duration-[var(--dur-base)] ease-[var(--ease-out-soft)]'
            : 'duration-[340ms] ease-[cubic-bezier(0.45,0.05,0.25,1)]'
        }`}
        style={{ gridTemplateRows: out ? '1fr' : '0fr' }}
      >
        <div
          className={`min-h-0 overflow-hidden transition-[opacity] ${
            out
              ? 'duration-[var(--dur-base)] ease-[var(--ease-out-soft)] opacity-100'
              : 'duration-[340ms] ease-[cubic-bezier(0.45,0.05,0.25,1)] opacity-0'
          }`}
        >
          <div className="pt-7 pb-2 px-2">
            <div className="panel-raised max-w-2xl mx-auto flex flex-col">
              <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto px-5 pt-4 pb-3">{children}</div>
              <div className="detail-footer px-5 py-2">
                <span className="fig-caption">{caption}</span>
                <button
                  onClick={onTogglePin}
                  aria-label={pinned ? 'Unpin session summary' : 'Pin session summary'}
                  title={pinned ? 'Unpin — tuck away unless the cursor visits the bottom edge' : 'Pin — keep the summary out'}
                  className={`focus-ring no-press h-5 w-5 shrink-0 flex items-center justify-center transition-colors duration-[var(--dur-fast)] ${
                    pinned
                      ? 'bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)]'
                      : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]'
                  }`}
                  style={pinned ? { color: a.ink } : undefined}
                >
                  <PinTackIcon pinned={pinned} size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
