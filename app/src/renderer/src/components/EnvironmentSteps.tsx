import type { EnvironmentCheckResult } from '../../../shared/types'
import { CopyButton } from './ui/CopyButton'

// Verbatim, straight-quoted — copied exactly into the terminal, so no smart
// quotes or paraphrasing here. Kept as named constants so EnvironmentGate's
// prose and friendlyError's plugin-missing copy can't drift from these.
export const PLUGIN_INSTALL_COMMANDS = [
  'claude plugin marketplace add nagisanzenin/engram',
  'claude plugin install engram@engram',
]

function CommandLine({ command }: { command: string }) {
  return (
    <div className="group panel-raised px-2.5 py-1.5 flex items-center justify-between gap-2">
      <code className="label-data text-[11px] text-[var(--color-text-primary)] truncate">{command}</code>
      <CopyButton text={command} alwaysVisible />
    </div>
  )
}

/** The two setup-status rows (claude CLI, Engram plugin) shared by EnvironmentGate's
 * full-screen block and HomeView's first-run guided card — one source of truth for
 * the wording so the two never quietly diverge. */
export function EnvironmentSteps({ result }: { result: EnvironmentCheckResult }) {
  return (
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
              Couldn’t run <span className="label-data">claude --version</span>. Install it from{' '}
              <span className="label-data">claude.ai/code</span> and make sure you’re logged in, then relaunch.
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
            <div className="text-xs text-[var(--color-text-dim)] mt-1 flex flex-col gap-2">
              <div>
                Not found under <span className="label-data">~/.claude/plugins/cache/engram</span>. Install it, then relaunch.
              </div>
              <div className="flex flex-col gap-1.5">
                {PLUGIN_INSTALL_COMMANDS.map((cmd) => (
                  <CommandLine key={cmd} command={cmd} />
                ))}
              </div>
              {result.pluginError && <div className="label-data text-[var(--color-text-faint)] truncate">{result.pluginError}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
