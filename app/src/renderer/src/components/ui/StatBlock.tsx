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
}: {
  label: string
  value: string
  tone?: 'warm' | 'cool' | 'violet' | 'neutral'
  caption?: string
  /** Tight variant for narrow tiles (e.g. the topic map's territory readout)
   * where the full-size label/value overflow. */
  compact?: boolean
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
      <div className={`label-data mt-0.5 ${compact ? 'text-sm' : 'text-lg'} ${TONE[tone]}`}>{value}</div>
      {caption && <div className="fig-caption mt-1">{caption}</div>}
    </div>
  )
}
