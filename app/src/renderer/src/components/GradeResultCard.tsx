import { useEffect, useRef, useState } from 'react'
import type { GradeResult } from '../../../shared/gradeResult'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { InkNode } from './ui/InkNode'
import { IntervalLadder } from './IntervalLadder'
import { warmTone } from '../shared/soundscape'
import { GradeChip, GRADE_INK } from './ritual/GradeChip'

function nextReviewText(intervalDays: number | null): string {
  if (intervalDays === null) return ''
  if (intervalDays <= 0) return 'due again now'
  if (intervalDays === 1) return 'back in 1 day'
  return `back in ${Math.round(intervalDays)} days`
}

/** "returns in <n> day(s) · s <b> → <a>" — the return chip's text, built from
 * whichever of intervalDays/sBefore/sAfter the parsed receipt actually
 * carries (all three are optional in shared/gradeResult.ts). Stability only
 * renders when BOTH before/after are present — a lone value isn't a
 * transition and would read as a typo. Returns '' when nothing to show, the
 * chip's own render-only-what-exists cue. */
function returnChipText(result: GradeResult): string {
  const parts: string[] = []
  if (result.intervalDays !== null) {
    const n = Math.round(result.intervalDays)
    parts.push(`returns in ${n} day${n === 1 ? '' : 's'}`)
  }
  if (result.sBefore !== null && result.sAfter !== null) {
    parts.push(`s ${result.sBefore.toFixed(1)} → ${result.sAfter.toFixed(1)}`)
  }
  return parts.join(' · ')
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** One-shot ink-burst — dendrite sparks radiating from the grade badge on a
 * recalled grade. Pure celebration of an honest event; lapses get calm
 * absolution styling and never any effect (dialogue-grammar's oath). */
function InkBurst() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 44 44"
      aria-hidden="true"
      className="ink-burst absolute -top-3 -right-3 pointer-events-none"
    >
      {Array.from({ length: 7 }, (_, i) => {
        const angle = (i / 7) * Math.PI * 2 - Math.PI / 2
        const x1 = 22 + Math.cos(angle) * 8
        const y1 = 22 + Math.sin(angle) * 8
        const x2 = 22 + Math.cos(angle) * (15 + (i % 3) * 3)
        const y2 = 22 + Math.sin(angle) * (15 + (i % 3) * 3)
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="var(--color-ink-warm)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}

/** Tween the displayed stability from before → after so the number is seen
 * EARNED rather than simply stated. Skipped under prefers-reduced-motion. */
function useCountUp(from: number, to: number, durationMs = 700): number {
  const [value, setValue] = useState(reducedMotion() ? to : from)
  useEffect(() => {
    if (reducedMotion() || from === to) {
      setValue(to)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs)
      const eased = 1 - (1 - t) ** 3
      setValue(from + (to - from) * eased)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])
  return value
}

/** A small result card for one graded node — grade badge, a stability bar
 * animating from `sBefore` to `sAfter` (FSRS "s" is memory durability in
 * days; a wider bar after grading means the memory got sturdier), and a
 * plain-language next-review line. All three numbers are the engine's own
 * answer (see shared/gradeResult.ts), never recomputed here. */
export function GradeResultCard({
  result,
  confidenceLabel,
  reveal = false,
  topic,
  asOfDate,
  highlighted,
  onHoverChange,
}: {
  result: GradeResult
  /** The felt-confidence label picked just before this grade landed (see
   * shared/calibrationStore.ts) — null/undefined skips the mirror line
   * entirely, which is also how Learn's ceremony rows opt out of it. */
  confidenceLabel?: string | null
  /** "The turn": mount face-down, hold a beat, flip to reveal the verdict —
   * the anticipation is the point. Default false keeps the instant render
   * (Learn ceremony rows, replayed contexts). Reduced-motion reveals instantly. */
  reveal?: boolean
  /** Narrows the interval ladder's receipt lookup to one topic (see
   * IntervalLadder) — optional because not every caller has a single topic
   * in scope (Review's mixed-topic queue). Purely a filter; `result` itself
   * never carries a topic field. */
  topic?: string
  /** Time-bounds the interval ladder to this card's own sitting (see
   * IntervalLadder's `asOfDate`) — threaded straight through, unused by this
   * component otherwise. Omitted by live surfaces. */
  asOfDate?: string
  /** Chat Instruments Wave B — the grade-card ↔ probe-card hover linkage,
   * mirroring ProbeCard's own `highlighted`/`onHoverChange` pair exactly
   * (see that component's doctrine comment). Matched by node id, the same
   * field the verdict-region/crossing machinery already keys on. */
  highlighted?: boolean
  onHoverChange?: (hovering: boolean) => void
}) {
  const ink = GRADE_INK[result.grade]
  const before = result.sBefore ?? 0
  const after = result.sAfter ?? before
  // Scaled against whichever of the two is larger so the bar always fits —
  // purely a display heuristic, the underlying numbers are exact.
  const scale = Math.max(before, after, 1)
  const beforePct = Math.min(100, (before / scale) * 100)
  const afterPct = Math.min(100, (after / scale) * 100)

  const [stage, setStage] = useState<'facedown' | 'flipping' | 'revealed'>(
    reveal && !reducedMotion() ? 'facedown' : 'revealed',
  )
  useEffect(() => {
    if (stage === 'facedown') {
      const t = setTimeout(() => setStage('flipping'), 500)
      return () => clearTimeout(t)
    }
    if (stage === 'flipping') {
      const t = setTimeout(() => setStage('revealed'), 400)
      return () => clearTimeout(t)
    }
  }, [stage])

  const revealed = stage === 'revealed'
  const displayAfter = useCountUp(before, revealed ? after : before)
  // Celebration fires once per card instance (recalled only), post-reveal.
  const burstFired = useRef(false)
  const showBurst = revealed && result.grade === 'recalled' && !burstFired.current && !reducedMotion()
  useEffect(() => {
    if (!revealed) return
    burstFired.current = true
    if (result.grade === 'recalled') warmTone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed])

  if (stage === 'facedown' || stage === 'flipping') {
    return (
      <div className="card-flip-scene max-w-sm">
        {/* `.tilt-card-soft` composes cleanly with the flip: a running CSS
            animation (flip-away/flip-in) overrides the static tilt transform
            for exactly as long as it runs, then hands back. Soft, not full
            scale — this is a chat-transcript card (see index.css's tilt
            vocabulary for the soft-variant rule). */}
        <div className={`tilt-card-soft panel px-4 py-3 flex items-center gap-3 card-face ${stage === 'flipping' ? 'flip-away' : ''}`}>
          <InkNode id={result.node} variant="filled" size={16} />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="fig-caption">the assessor’s verdict</span>
            <span className="text-sm text-[var(--color-text-dim)] truncate">{humanizeNodeId(result.node)}</span>
          </div>
        </div>
      </div>
    )
  }

  // Return chip: revealed face only (the scheduling verdict is part of "the
  // turn"'s payoff, not something to spoil while the card is still facedown).
  const chipText = returnChipText(result)

  return (
    <div
      className={`tilt-card-soft panel px-4 py-3 flex flex-col gap-2 max-w-sm transition-shadow duration-[var(--dur-fast)] ${reveal && !reducedMotion() ? 'flip-in' : ''} ${highlighted ? 'pair-linked' : ''}`}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-[var(--color-text-primary)]">{humanizeNodeId(result.node)}</span>
        <span className="relative shrink-0">
          {showBurst && <InkBurst />}
          <GradeChip grade={result.grade} className={result.grade === 'partial' ? 'badge-pulse' : ''} />
        </span>
      </div>
      {result.sBefore !== null && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 h-1.5 border border-[var(--color-edge)] bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-[var(--color-ink-cool-dim)] transition-all duration-500"
              style={{ width: `${beforePct}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 transition-all duration-700"
              style={{ width: `${afterPct}%`, background: ink.ink }}
            />
          </div>
          <span className="label-data text-[10px] text-[var(--color-text-faint)] shrink-0">
            {before.toFixed(1)}d → {displayAfter.toFixed(1)}d
          </span>
        </div>
      )}
      {/* The interval ladder: the memory's own return history, one rung per
          real day-gap between successive reviews, plus this grade's own
          interval as the final rung. Revealed face only, same discipline as
          the return chip below — the ladder is part of "the turn"'s payoff,
          not something to show while the card is still facedown. */}
      <IntervalLadder result={result} topic={topic} asOfDate={asOfDate} />
      {/* The chip subsumes the old "back in N days" prose line — one scheduling
          statement per card, not three (the stability bar above keeps its own
          d-values; the chip carries interval + s movement). */}
      {chipText ? (
        <GradeChip grade={result.grade} className="self-start">
          {chipText}
        </GradeChip>
      ) : (
        result.intervalDays !== null && (
          <span className="text-xs text-[var(--color-text-dim)]">{nextReviewText(result.intervalDays)}</span>
        )
      )}
      {confidenceLabel != null &&
        (() => {
          // Addition B (chat refine round) — a miscalibration made visible,
          // never judged: the learner felt high confidence (the dialogue-
          // grammar's own top two Confidence-picker bands — see
          // _shared/dialogue-grammar.md's "⚠ Confidence integrity", "Certain"
          // ~90 and "Pretty sure" ~70 — the ONLY two bands this fires on) and
          // the assessor's grade came back partial or lapsed anyway. Purely a
          // cool accent + marker glyph on the SAME "felt X → grade" line this
          // card already states — no new words, the app still only states
          // facts (dialogue-grammar's own anti-sycophancy oath). Well-
          // calibrated rows (recalled) and low-confidence rows ("Half
          // unsure"/"Just guessing") are unchanged.
          const highConfidence = confidenceLabel === 'Certain' || confidenceLabel === 'Pretty sure'
          const missedGrade = result.grade === 'partial' || result.grade === 'lapsed'
          const miscalibrated = highConfidence && missedGrade
          return (
            <div
              className="fig-caption flex items-center gap-1"
              style={miscalibrated ? { color: 'var(--color-ink-cool)' } : undefined}
            >
              {miscalibrated && (
                <span aria-hidden="true" className="text-[9px]">
                  △
                </span>
              )}
              felt “{confidenceLabel}” → {result.grade}
            </div>
          )
        })()}
    </div>
  )
}
