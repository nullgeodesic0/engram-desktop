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
}: {
  label: string
  value: string
  tone?: 'warm' | 'cool' | 'violet' | 'neutral'
  caption?: string
}) {
  return (
    <div className="panel p-3">
      <div className="text-[length:var(--text-caption)] text-[var(--color-text-dim)] label-data uppercase tracking-wider">
        {label}
      </div>
      <div className={`label-data text-lg mt-0.5 ${TONE[tone]}`}>{value}</div>
      {caption && <div className="fig-caption mt-1">{caption}</div>}
    </div>
  )
}
