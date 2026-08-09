import { useCallback, useId, useRef } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { humanMinutes } from '../../../../shared/sittingPace'
import { buildRuler, snapToItem, stepBudget, type Ruler, type RulerItem } from '../../shared/sittingRuler'
import type { PaceModel } from '../../../../shared/sittingPace'

/** The sitting ruler — the queue as a time axis you can cut.
 *
 * The ready room already knew everything needed to plan a sitting and said it
 * in five stacked captions: what a budget covers, how long the first item
 * runs, how overdue the queue is, how the last estimate did. Reading four
 * sentences to answer "if I sit for twenty minutes, what gets done?" is the
 * problem this replaces. Here the queue IS the axis: every item is a segment
 * as wide as it actually costs at this learner's own per-topic pace, and the
 * budget is a line you move across them.
 *
 * SNAPS TO ITEM EDGES. A boundary resting mid-item would draw a budget the
 * sitting cannot honour — it either serves that item or it does not — so the
 * handle only ever lands where an item ends, and the minutes reported are
 * exactly the cost of everything up to that edge.
 *
 * NEVER READS `.probe`. The ready-room doctrine is that the question's exact
 * wording must not be visible before the learner has chosen to sit down,
 * because reading it early IS rehearsal. This shows node NAMES only (the same
 * `humanizeNodeId` the plate's own rows use, which the map already prints
 * wherever a node is due) — and its data module is typed to a subset of
 * DueItem that cannot express a probe at all, so the guarantee is structural
 * rather than a rule to remember.
 *
 * Not pointer-only: the bar is a real slider with arrow-key stepping, one
 * item per press.
 */
export function SittingRuler({
  items,
  pace,
  budgetMins,
  onBudgetChange,
}: {
  items: RulerItem[]
  pace: PaceModel | null
  budgetMins: number
  onBudgetChange: (mins: number) => void
}) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const ruler: Ruler = buildRuler(items, pace, budgetMins)

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = barRef.current
      if (!el) return
      const box = el.getBoundingClientRect()
      if (box.width <= 0) return
      onBudgetChange(snapToItem(ruler, (clientX - box.left) / box.width))
    },
    [ruler, onBudgetChange],
  )

  if (ruler.segments.length === 0) return null

  const last = ruler.segments[Math.max(0, ruler.items - 1)]
  const throughName = last ? humanizeNodeId(last.id) : null
  // The boundary line marks the BUDGET; the fill marks what fits. When a
  // preset lands mid-item those differ, and the gap between them is real time
  // the sitting cannot spend — the next item does not fit in it. Unlabelled
  // it looks like a rendering fault, so it is named whenever it is material.
  // Dragging always snaps to an item edge, so this is normally absent.
  const slackSeconds = Math.max(0, budgetMins * 60 - ruler.plannedSeconds)
  const showSlack = slackSeconds >= 60 && ruler.items < ruler.segments.length

  return (
    <div className="flex flex-col gap-2">
      {/* The readout is the caption pile's replacement: one line, live, and
          it names where the sitting actually stops. */}
      {/* `aria-live` on the readout. `aria-valuetext` covers the slider's own
          value, but "through <node>" and the spare-time line are the parts
          that actually tell you where the sitting STOPS, and they were
          changing silently under every arrow press. Polite, so it queues
          behind the value announcement rather than interrupting it. */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap" aria-live="polite">
        <span className="label-data text-xs text-[var(--color-text-primary)]">
          <span className="text-[var(--color-ink-warm)]">{humanMinutes(ruler.plannedSeconds)}</span>
          {' · '}
          {ruler.items} {ruler.items === 1 ? 'item' : 'items'}
          {throughName && (
            <>
              {' · through '}
              <span className="text-[var(--color-text-dim)]">{throughName}</span>
            </>
          )}
        </span>
        <span className="fig-caption shrink-0">
          {ruler.items === ruler.segments.length
            ? 'the whole queue'
            : `of ${ruler.segments.length} · ${humanMinutes(ruler.totalSeconds)} for all`}
          {showSlack && ` · ${humanMinutes(slackSeconds)} spare, the next item needs more`}
        </span>
      </div>

      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="Sitting budget — how far into the queue this sitting reaches"
        aria-valuemin={1}
        aria-valuemax={ruler.segments.length}
        aria-valuenow={ruler.items}
        aria-valuetext={`${ruler.items} of ${ruler.segments.length} items, about ${humanMinutes(ruler.plannedSeconds)}`}
        aria-describedby={listId}
        className="focus-ring relative h-9 flex items-stretch gap-px cursor-ew-resize touch-none select-none"
        onPointerDown={(e) => {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          setFromClientX(e.clientX)
        }}
        onPointerMove={(e) => {
          // Only while dragging — `buttons` is the cheap test that avoids
          // hijacking an idle pointer crossing the bar.
          if (e.buttons === 1) setFromClientX(e.clientX)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          onBudgetChange(stepBudget(ruler, e.key === 'ArrowRight' ? 1 : -1))
        }}
      >
        {ruler.segments.map((s, i) => (
          <div
            key={s.id}
            title={`${humanizeNodeId(s.id)} — about ${humanMinutes(s.seconds)}${
              s.overdueDays > 0 ? `, ${s.overdueDays} ${s.overdueDays === 1 ? 'day' : 'days'} overdue` : ''
            }${s.measured ? '' : ' (from your overall pace)'}`}
            className="relative min-w-[2px] transition-[background-color,opacity] duration-[var(--dur-fast)]"
            style={{
              flexGrow: Math.max(0.02, s.end - s.start),
              flexBasis: 0,
              // THREE states, and SHAPE carries them — not fill.
              //
              // Measured: a warm fill needs ~55% alpha to clear 3:1 against
              // the neutral rest state, which is a solid amber block that
              // out-shouts the primary CTA on a surface whose job is getting
              // someone into a sitting. So fill stays a tint and the state
              // rides on form, where it already had the contrast: the top rule
              // reads 6.93:1 warm-against-hairline.
              //
              //   inside   — warm top rule, warm wash
              //   next up  — a warm-dim RING and no wash: adjacent to the
              //              sitting without claiming to be in it, and
              //              distinguished by outline rather than by hue, so
              //              it survives a colour-vision difference
              //   rest     — hairline rule, neutral wash
              //
              // "The next item, which does not fit" and "item eight" used to
              // render identically, so the most useful thing the bar could say
              // — what one more minute buys — was invisible.
              background: s.inside
                ? 'color-mix(in srgb, var(--color-ink-warm) 38%, transparent)'
                : i === ruler.items
                  ? 'transparent'
                  : 'color-mix(in srgb, var(--color-surface-3) 55%, transparent)',
              border: i === ruler.items && !s.inside ? '1px solid var(--color-ink-warm-dim)' : undefined,
              borderTop: s.measured
                ? `3px solid ${s.inside ? 'var(--color-ink-warm)' : i === ruler.items ? 'var(--color-ink-warm-dim)' : 'var(--color-hairline)'}`
                : `3px dashed ${s.inside ? 'var(--color-ink-warm-dim)' : 'var(--color-hairline)'}`,
              opacity: s.inside ? 1 : i === ruler.items ? 0.85 : 0.5,
            }}
          >
            {/* Overdue tick — the same danger mark HealthRing already uses for
                a due node, so "at risk" reads the same way in both places. */}
            {s.overdueDays > 0 && (
              <span
                aria-hidden="true"
                className="absolute left-0 right-0 bottom-0 h-[3px]"
                style={{ background: 'var(--color-ink-danger)', opacity: s.inside ? 1 : 0.45 }}
              />
            )}
          </div>
        ))}

        {/* The cut. Drawn over the segments, never intercepting the pointer —
            the bar itself owns the drag. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-[-4px] w-px pointer-events-none"
          style={{
            left: `${(ruler.boundary * 100).toFixed(3)}%`,
            background: 'var(--color-ink-warm)',
          }}
        />
      </div>

      {/* The per-item facts, reachable.
          They lived only in `title` attributes, which is a pointer affordance
          and nothing else — no touch, no keyboard, no screen reader. A child
          of a `role="slider"` is not exposed at all, so labelling the segments
          could never have worked either; the facts have to live OUTSIDE the
          slider and be pointed at. This list is visually hidden, and the bar
          references it with `aria-describedby`. */}
      <ul id={listId} className="sr-only">
        {ruler.segments.map((s, i) => (
          <li key={s.id}>
            {`${humanizeNodeId(s.id)} — about ${humanMinutes(s.seconds)}${
              s.overdueDays > 0 ? `, ${s.overdueDays} ${s.overdueDays === 1 ? 'day' : 'days'} overdue` : ''
            }${s.measured ? '' : ', estimated from your overall pace rather than this topic'}. ${
              s.inside ? 'In this sitting.' : i === ruler.items ? 'Next up — does not fit this budget.' : 'Past the budget.'
            }`}
          </li>
        ))}
      </ul>

      <div className="flex items-baseline justify-between gap-3">
        <span className="fig-caption">
          Fig. — the queue in triage order, {pace ? 'each item as wide as it costs you' : 'all items at the same assumed minute until you have a pace'}; a red foot marks one already overdue
        </span>
        {ruler.overruns && (
          <span className="fig-caption text-[var(--color-ink-warm)] shrink-0">
            the first item alone runs past this
          </span>
        )}
      </div>
    </div>
  )
}
