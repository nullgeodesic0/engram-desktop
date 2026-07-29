import { isBlockingRateLimitStatus } from '../../../shared/rateLimit'

interface RateLimitBannerProps {
  status: string
  resetsAt: number | null
  onRetry: () => void
}

export function RateLimitBanner({ status, resetsAt, onRetry }: RateLimitBannerProps) {
  const blocking = isBlockingRateLimitStatus(status)
  const resetText = resetsAt ? new Date(resetsAt * 1000).toLocaleTimeString() : null

  return (
    <div
      className={`panel px-4 py-3 flex items-center justify-between gap-4 ${
        blocking ? 'border-[var(--color-ink-danger-dim)]' : 'border-[var(--color-ink-warm-dim)]'
      }`}
    >
      <div className={`text-sm ${blocking ? 'text-[var(--color-ink-danger)]' : 'text-[var(--color-ink-warm)]'}`}>
        {blocking ? (
          <>Claude usage limit reached ({status}) — Engram can’t start new sessions right now.</>
        ) : (
          <>Approaching your Claude usage limit ({status}) — this session can keep going, but new ones may not start soon.</>
        )}
        {resetText && <span className="text-[var(--color-text-dim)]"> Resets around {resetText}.</span>}
      </div>
      {blocking && (
        <button
          onClick={onRetry}
          className="focus-ring shrink-0 text-xs px-3 py-1.5 rounded-lg bg-[color-mix(in_srgb,var(--color-surface-3)_78%,transparent)] text-[var(--color-text-primary)] hover:bg-[color-mix(in_srgb,var(--color-surface-2)_78%,transparent)]"
        >
          Try again
        </button>
      )}
    </div>
  )
}
