import { StatFraction } from './StatFraction'

const TONE: Record<string, string> = {
  warm: 'text-[var(--color-ink-warm)]',
  cool: 'text-[var(--color-ink-cool)]',
  violet: 'text-[var(--color-ink-violet)]',
  neutral: 'text-[var(--color-text-primary)]',
}

/** Matches "n/m"-shaped values (e.g. "4/12") so existing StatBlock callers
 * that already pass a fraction as a plain string (TopicMapView, TopicDrilldownView)
 * upgrade to the Guardian `.stat-fraction` markup for free, with no call-site
 * changes. Anything else renders as plain text, exactly as before. */
const FRACTION_RE = /^(\d+)\s*\/\s*(\d+)$/

export function StatBlock({
  label,
  value,
  tone = 'neutral',
  caption,
  compact = false,
  pulse = false,
  onPulseEnd,
}: {
  label: string
  value: string
  tone?: 'warm' | 'cool' | 'violet' | 'neutral'
  caption?: string
  /** Tight variant for narrow tiles (e.g. the topic map's territory readout)
   * where the full-size label/value overflow. */
  compact?: boolean
  /** One-shot emphasis on the value (e.g. Home's due-now chip ticking up) —
   * caller owns the trigger condition and clears it via `onPulseEnd`, fired
   * on the CSS animation's `animationend`. */
  pulse?: boolean
  onPulseEnd?: () => void
}) {
  const fraction = FRACTION_RE.exec(value)
  return (
    <div className={`panel ${compact ? 'p-2 min-w-0' : 'p-3'}`}>
      <div
        className={`text-[var(--color-text-dim)] label-data uppercase truncate ${
          compact ? 'text-[9px] tracking-wide' : 'text-[length:var(--text-caption)] tracking-wider'
        }`}
      >
        {label}
      </div>
      <div
        className={`label-data mt-0.5 ${compact ? 'text-sm' : 'text-lg'} ${TONE[tone]} ${pulse ? 'pulse-once' : ''}`}
        onAnimationEnd={pulse ? onPulseEnd : undefined}
      >
        {fraction ? <StatFraction n={fraction[1]} d={fraction[2]} /> : value}
      </div>
      {caption && <div className="fig-caption mt-1">{caption}</div>}
    </div>
  )
}
