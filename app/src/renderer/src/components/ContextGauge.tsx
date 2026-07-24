const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Ring icon showing context-window consumption, à la Claude Code's own status line.
 * Sized and colored to actually stand out in the header — a thin, dim, tiny version
 * of this is easy to miss against a dark background. */
export function ContextGauge({ usedTokens, contextWindow }: { usedTokens: number; contextWindow: number }) {
  const pct = Math.min(1, usedTokens / contextWindow)
  const color = pct < 0.5 ? 'var(--color-ink-cool)' : pct < 0.8 ? 'var(--color-ink-warm)' : 'var(--color-ink-danger)'
  const offset = CIRCUMFERENCE * (1 - pct)

  const explainer = 'session depth — how much of the model’s working memory this conversation has used'

  return (
    <div
      title={explainer}
      role="img"
      aria-label={explainer}
      className="flex items-center gap-2 text-xs label-data text-[var(--color-text-primary)] panel px-2.5 py-1.5"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" className="shrink-0">
        <circle cx="12" cy="12" r={RADIUS} fill="none" stroke="var(--color-surface-3)" strokeWidth="3.5" />
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth="3.5"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
        />
      </svg>
      <span className="font-medium">{Math.round(pct * 100)}%</span>
      <span className="text-[var(--color-text-faint)]">context</span>
    </div>
  )
}
