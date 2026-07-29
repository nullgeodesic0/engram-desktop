import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Catches a render crash anywhere below it and shows a real recovery screen
 * instead of a blank white window — wraps the whole app in main.tsx, outside
 * EnvironmentGate, so a crash in the gate itself is caught too. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[engram-desktop] render crash:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="panel-raised max-w-md w-full p-7 flex flex-col gap-4">
          <div>
            <h1 className="font-(family-name:--font-display) text-xl text-[var(--color-text-primary)]">Something went wrong</h1>
            <p className="text-sm text-[var(--color-text-dim)] mt-2">
              The interface hit an unexpected error. Your Engram data is untouched — it lives entirely outside this
              window — but this screen needs a reload to recover.
            </p>
          </div>
          <div className="panel px-3 py-2 label-data text-xs text-[var(--color-text-faint)] overflow-x-auto">
            {this.state.error.message}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="focus-ring self-start px-4 py-2 rounded-lg text-sm bg-[color-mix(in_srgb,var(--color-surface-3)_68%,transparent)] text-[var(--color-ink-warm)] hover:bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)]"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
