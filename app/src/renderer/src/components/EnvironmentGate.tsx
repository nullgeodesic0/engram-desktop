import { useEffect, useState, type ReactNode } from 'react'
import type { EnvironmentCheckResult } from '../../../shared/types'

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

        <div className="flex flex-col gap-3">
          <div className={`panel px-4 py-3 flex items-start gap-3 ${result.claudeOk ? '' : 'border-[var(--color-ink-danger-dim)]'}`}>
            <span className={result.claudeOk ? 'text-[var(--color-ink-warm)]' : 'text-[var(--color-ink-danger)]'}>
              {result.claudeOk ? '✓' : '✕'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--color-text-primary)]">Claude Code CLI</div>
              {result.claudeOk ? (
                <div className="text-xs text-[var(--color-text-faint)] mt-0.5 label-data truncate">{result.claudePath}</div>
              ) : (
                <div className="text-xs text-[var(--color-text-dim)] mt-1">
                  Couldn't run <span className="label-data">claude --version</span>. Install it from{' '}
                  <span className="label-data">claude.ai/code</span> and make sure you're logged in, then relaunch.
                  {result.claudeError && <div className="label-data text-[var(--color-text-faint)] mt-1 truncate">{result.claudeError}</div>}
                </div>
              )}
            </div>
          </div>

          <div className={`panel px-4 py-3 flex items-start gap-3 ${result.pluginOk ? '' : 'border-[var(--color-ink-danger-dim)]'}`}>
            <span className={result.pluginOk ? 'text-[var(--color-ink-warm)]' : 'text-[var(--color-ink-danger)]'}>
              {result.pluginOk ? '✓' : '✕'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--color-text-primary)]">Engram plugin</div>
              {result.pluginOk ? (
                <div className="text-xs text-[var(--color-text-faint)] mt-0.5 label-data">v{result.pluginVersion}</div>
              ) : (
                <div className="text-xs text-[var(--color-text-dim)] mt-1">
                  Not found under <span className="label-data">~/.claude/plugins/cache/engram</span>. Install the Engram
                  plugin in Claude Code, then relaunch.
                  {result.pluginError && <div className="label-data text-[var(--color-text-faint)] mt-1 truncate">{result.pluginError}</div>}
                </div>
              )}
            </div>
          </div>
        </div>

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
