import type { EnvironmentCheckResult } from '../../../shared/types'
import { CopyButton } from './ui/CopyButton'

// Verbatim, straight-quoted — copied exactly into the terminal, so no smart
// quotes or paraphrasing here. Kept as named constants so EnvironmentGate's
// prose and friendlyError's plugin-missing copy can't drift from these.
export const PLUGIN_INSTALL_COMMANDS = [
  'claude plugin marketplace add nagisanzenin/engram',
  'claude plugin install engram@engram',
]

export const CODEX_PLUGIN_INSTALL_COMMANDS = [
  'codex plugin marketplace add nagisanzenin/engram',
  'codex plugin add engram@engram',
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
  const usesCodex = result.authMode === 'codexSubscription'
  const cliOk = usesCodex ? result.codexOk === true : result.claudeOk
  const cliPath = usesCodex ? result.codexPath : result.claudePath
  const cliError = usesCodex ? result.codexError : result.claudeError
  const cliName = usesCodex ? 'OpenAI Codex CLI' : 'Claude Code CLI'
  const executable = usesCodex ? 'codex' : 'claude'
  const installCommands = usesCodex ? CODEX_PLUGIN_INSTALL_COMMANDS : PLUGIN_INSTALL_COMMANDS
  return (
    <div className="flex flex-col gap-3">
      <div className={`panel px-4 py-3 flex items-start gap-3 ${cliOk ? '' : 'border-[var(--color-ink-danger-dim)]'}`}>
        <span className={cliOk ? 'text-[var(--color-ink-warm)]' : 'text-[var(--color-ink-danger)]'}>
          {cliOk ? '✓' : '✕'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--color-text-primary)]">{cliName}</div>
          {cliOk ? (
            <div className="text-xs text-[var(--color-text-faint)] mt-0.5 label-data truncate">{cliPath}</div>
          ) : (
            <div className="text-xs text-[var(--color-text-dim)] mt-1">
              Couldn’t run <span className="label-data">{executable} --version</span>. Install {cliName} and make
              sure you’re logged in to your subscription, then check again.
              {cliError && <div className="label-data text-[var(--color-text-faint)] mt-1 truncate">{cliError}</div>}
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
                The Engram learning engine was not found. Install it for {usesCodex ? 'Codex' : 'Claude Code'}, then check again.
              </div>
              <div className="flex flex-col gap-1.5">
                {installCommands.map((cmd) => (
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
