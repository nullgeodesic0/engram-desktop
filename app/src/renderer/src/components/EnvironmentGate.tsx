import { useEffect, useState, type ReactNode } from 'react'
import type { EnvironmentCheckResult } from '../../../shared/types'
import { EnvironmentSteps } from './EnvironmentSteps'

/** Blocks the app behind a real diagnostic screen if either dependency this whole
 * app is built on isn't resolvable — the Engram plugin, or the `claude` CLI itself
 * (which a packaged/GUI-launched app can fail to find even when it's installed, see
 * claudeResolver.ts). Without this, either failure mode used to be a silent
 * console.error and a blank or broken-feeling app. Best-effort by design: a
 * "Continue anyway" escape hatch exists in case this check itself is wrong. */
export function EnvironmentGate({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<EnvironmentCheckResult | 'loading'>('loading')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.engram.environmentCheck().then(setResult)
  }, [])

  if (result === 'loading') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-sm text-[var(--color-text-dim)]">Checking environment…</div>
      </div>
    )
  }

  const ok = result.pluginOk && result.claudeOk
  if (ok || dismissed) return <>{children}</>

  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="panel-raised max-w-lg w-full p-7 flex flex-col gap-5">
        <div>
          <h1 className="font-[var(--font-display)] text-xl text-[var(--color-text-primary)]">Setup needed</h1>
          <p className="text-sm text-[var(--color-text-dim)] mt-1">
            Engram Desktop scripts the Claude Code CLI directly — it needs both of these in place before a
            learning session can run.
          </p>
        </div>

        <EnvironmentSteps result={result} />

        <div className="flex items-center justify-between">
          <button
            onClick={() => window.engram.environmentCheck().then(setResult)}
            className="focus-ring px-4 py-2 rounded-lg text-sm bg-[var(--color-surface-3)] text-[var(--color-ink-warm)] hover:bg-[var(--color-surface-2)]"
          >
            Check again
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]"
          >
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  )
}
