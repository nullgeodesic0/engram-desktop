import { friendlyErrorText } from '../shared/friendlyError'
import { Button } from './ui/Button'

/** The session-error banner shared by LearnSessionView and ReviewSessionView —
 * both hand-rolled the identical block (friendlyErrorText headline, a
 * `<details>` raw-error disclosure, a dismiss button) before this existed.
 * Purely presentational: callers own the `error` state and its `onDismiss`. */
export function ErrorPanel({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  const fe = friendlyErrorText(error)
  return (
    <div className="shrink-0 panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)] flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div>{fe.headline}</div>
        {fe.detail && (
          <details className="mt-1 text-xs text-[var(--color-text-faint)]">
            <summary className="cursor-pointer">raw error</summary>
            <div className="mt-1">{fe.detail}</div>
          </details>
        )}
      </div>
      <Button variant="ghost" onClick={onDismiss} aria-label="Dismiss error" className="shrink-0 px-2 py-1">
        ×
      </Button>
    </div>
  )
}
