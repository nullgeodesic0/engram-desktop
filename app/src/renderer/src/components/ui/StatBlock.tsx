const TONE: Record<string, string> = {
  warm: 'text-[var(--color-ink-warm)]',
  cool: 'text-[var(--color-ink-cool)]',
  violet: 'text-[var(--color-ink-violet)]',
  neutral: 'text-[var(--color-text-primary)]',
}

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
        {value}
      </div>
      {caption && <div className="fig-caption mt-1">{caption}</div>}
    </div>
  )
}
