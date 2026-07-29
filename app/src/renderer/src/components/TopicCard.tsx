import type { TopicListEntry } from '../../../shared/types'
import { InkNode } from './ui/InkNode'
import { HealthRing } from './ui/HealthRing'
import { IconButton } from './ui/IconButton'
import { topicChips } from '../shared/topicShelf'

/** 16px stroked refresh glyph — replaces Learn's old text-glyph `↻` button. */
function RefreshIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13 4.5a5.5 5.5 0 1 0 1.3 5.7M14 2.5v3.2h-3.2"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 16px stroked gear glyph — replaces Learn's old text-glyph `⚙` button. */
function GearIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx={8} cy={8} r={2.3} stroke="currentColor" strokeWidth={1.4} />
      <path
        d="M8 1.8v1.4M8 12.8v1.4M14.2 8h-1.4M3.2 8H1.8M12.1 3.9l-1 1M4.9 11.1l-1 1M12.1 12.1l-1-1M4.9 4.9l-1-1"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </svg>
  )
}

interface TopicCardProps {
  /** `tile` = Home's original grid card (InkNode + HealthRing + title +
   * chips), like-for-like. `shelf` = Learn's full-width atlas-shelf row
   * (adds the `continuing` chip, goal line, and settings/start-fresh
   * affordances). */
  variant: 'tile' | 'shelf'
  topic: TopicListEntry
  onOpen: () => void
  /** Shelf-only: an in-progress session exists for this topic. */
  resumable?: boolean
  onSettings?: () => void
  onStartFresh?: () => void
}

/** One topic card, shared by Home's grid and Learn's shelf — same InkNode +
 * HealthRing + title + chip vocabulary (shared/topicShelf.ts), styled two
 * ways for two layouts instead of the two views hand-rolling their own
 * (Learn's old local card omitted InkNode and the `learning` chip entirely;
 * Home's never showed a due chip since HealthRing's danger notch already
 * carries that signal here). */
export function TopicCard({ variant, topic: t, onOpen, resumable = false, onSettings, onStartFresh }: TopicCardProps) {
  const total = t.states.new + t.states.learning + t.states.review

  if (variant === 'tile') {
    // Byte-identical to Home's original TopicTile: same markup, same
    // classes — the due-danger chip is filtered out because the tile never
    // rendered it (HealthRing's danger notch already carries that signal).
    const chips = topicChips(t).filter((c) => !c.className.includes('ink-danger'))
    return (
      <button
        onClick={onOpen}
        // Guardian anatomy: the old bespoke hover (own border/bg swap) is
        // replaced by the shared `.frame-hover` vocabulary (a floating
        // hairline frame + a one-step-lighter wash, see index.css's doctrine
        // comment) — not stacked with it. `.dogear` is scarce: only the one
        // "Continue learning" card with an actual in-progress session earns
        // it (see TopicGroup's `resumableTopics` in HomeView.tsx).
        // `.tilt-card` = card physics (useCardPhysics.ts) — the frame and
        // dogear are pseudo-elements of this same box, so they tilt with it.
        className={`focus-ring frame-hover tilt-card panel text-left px-4 py-3 flex flex-col gap-2${resumable ? ' dogear' : ''}`}
      >
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <InkNode id={t.topic} variant={t.states.review > 0 ? 'filled' : 'outlined'} size={16} />
          <HealthRing consolidated={t.states.review} total={total} due={t.due} size={18} />
          <span className="line-clamp-1">{t.title}</span>
        </div>
        <div className="flex gap-3 text-xs label-data">
          {chips.map((c) => (
            <span key={c.label} className={c.className}>
              {c.label}
            </span>
          ))}
        </div>
      </button>
    )
  }

  return (
    // Same `.frame-hover`/`.dogear` swap as the tile branch above — one
    // shared hover/selection vocabulary for both layouts, not a bespoke
    // border/bg toggle per variant.
    <div className={`frame-hover tilt-card panel px-5 py-4 flex items-center justify-between gap-4${resumable ? ' dogear' : ''}`}>
      <InkNode id={t.topic} variant={t.states.review > 0 ? 'filled' : 'outlined'} size={16} />
      <HealthRing consolidated={t.states.review} total={total} due={t.due} />
      <button onClick={onOpen} className="focus-ring flex-1 min-w-0 text-left flex flex-col gap-1">
        <div className="text-sm text-[var(--color-text-primary)] flex items-center gap-2">
          <span className="truncate">{t.title}</span>
          {resumable && (
            <span className="label-data text-[10px] px-1.5 py-0.5 rounded text-[var(--color-ink-cool)] bg-[color-mix(in_srgb,var(--color-surface-3)_78%,transparent)] shrink-0">
              continuing
            </span>
          )}
        </div>
        <div className="text-xs text-[var(--color-text-faint)] line-clamp-1">{t.goal}</div>
        <div className="flex gap-3 text-xs label-data mt-1">
          {topicChips(t).map((c) => (
            <span key={c.label} className={c.className}>
              {c.label}
            </span>
          ))}
        </div>
      </button>
      {resumable && onStartFresh && (
        <IconButton
          onClick={(e) => {
            e.stopPropagation()
            onStartFresh()
          }}
          title="Abandon the in-progress session and start this topic over from scratch"
          aria-label="Start topic over"
        >
          <RefreshIcon />
        </IconButton>
      )}
      {onSettings && (
        <IconButton onClick={onSettings} title="Topic settings" aria-label="Topic settings">
          <GearIcon />
        </IconButton>
      )}
    </div>
  )
}
