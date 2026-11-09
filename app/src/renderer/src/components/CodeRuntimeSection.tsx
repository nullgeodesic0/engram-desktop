import { useEffect, useState } from 'react'
import type { RuntimeProgress, RuntimeStatus } from '../../../shared/runtime'
import { CELL_LIMIT_CHOICES } from '../../../shared/runtime'
import { Button } from './ui/Button'
import { SectionBanner } from './ui/SectionBanner'
import { SegmentedControl } from './ui/SegmentedControl'

/** Settings → Code runtime: install, inspect, and remove the app-managed Python env. */

const CORE_PACKAGES = ['stim', 'sinter', 'pymatching', 'ldpc', 'numpy', 'scipy', 'matplotlib', 'qutip', 'pytest']

function limitLabel(s: number): string {
  if (s === 0) return 'No limit'
  return s < 120 ? `${s} s` : `${s / 60} min`
}

export function CodeRuntimeSection() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [progress, setProgress] = useState<RuntimeProgress | null>(null)
  const [limit, setLimit] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    void window.engram.runtimeStatus().then(setStatus)
    void window.engram.runtimeGetCellLimit().then(setLimit)
    const offProgress = window.engram.onRuntimeProgress(setProgress)
    const offChanged = window.engram.onRuntimeChanged(setStatus)
    return () => {
      offProgress()
      offChanged()
    }
  }, [])

  async function install() {
    setError(null)
    setStatus((s) => (s ? { ...s, state: 'installing' } : s))
    try {
      setStatus(await window.engram.runtimeInstall())
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
      setStatus(await window.engram.runtimeStatus())
    }
  }

  async function remove() {
    setConfirmRemove(false)
    setError(null)
    try {
      setStatus(await window.engram.runtimeRemove())
      setProgress(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!status) return null
  const installing = status.state === 'installing'

  return (
    <div className="panel px-5 py-5 flex flex-col gap-4" id="settings-code-runtime">
      <div>
        <SectionBanner label="Code runtime" className="border-t-0" />
        <div className="text-xs text-[var(--color-text-faint)] mt-1.5">
          A private Python for Labs and code cells, built from a pinned lockfile into this app’s own data folder. It
          never touches a Python you already have, and removing it removes all of it.
        </div>
      </div>

      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1.5 h-2 w-2 rounded-full shrink-0"
          style={{
            background:
              status.state === 'ready'
                ? 'var(--color-ink-cool)'
                : status.state === 'failed'
                  ? 'var(--color-text-dim)'
                  : 'var(--color-text-faint)',
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--color-text-primary)]">
            {status.state === 'ready' && `Ready · Python ${status.pythonVersion ?? ''}`}
            {status.state === 'missing' && 'Not installed'}
            {status.state === 'installing' && 'Installing…'}
            {status.state === 'failed' && 'The last install did not finish'}
          </div>
          {!status.supported && (
            <div className="text-xs text-[var(--color-text-dim)] mt-1">
              Stim and PyMatching publish no builds for this kind of machine yet, so the runtime cannot install here.
            </div>
          )}
          {status.updateAvailable && (
            <div className="text-xs text-[var(--color-text-dim)] mt-1">
              This version of the app pins newer packages. Cells keep running on the current set until you update; the
              update builds beside it.
            </div>
          )}
          {status.state === 'missing' && status.supported && (
            <div className="text-xs text-[var(--color-text-dim)] mt-1">
              About 650 MB on disk once installed. The download comes from the Python Package Index and the uv project on
              GitHub, and every file is checked against the lockfile’s hashes.
            </div>
          )}
          {installing && progress && (
            <div className="label-data text-xs text-[var(--color-text-dim)] mt-1" aria-live="polite">
              {progress.message}
            </div>
          )}
          {(error || status.error) && !installing && (
            <div className="text-xs text-[var(--color-text-dim)] mt-1 break-words">{error ?? status.error}</div>
          )}
          {status.state === 'ready' && status.envDir && (
            <div className="label-data text-xs text-[var(--color-text-faint)] mt-1 break-all">{status.envDir}</div>
          )}
        </div>
        {installing ? (
          <Button onClick={() => void window.engram.runtimeCancel()} className="shrink-0">
            Cancel
          </Button>
        ) : (
          (status.state !== 'ready' || status.updateAvailable) &&
          status.supported && (
            <Button variant="primary" onClick={install} className="shrink-0">
              {status.updateAvailable ? 'Update' : status.state === 'failed' ? 'Try again' : 'Install'}
            </Button>
          )
        )}
      </div>

      {status.state === 'ready' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-1">
          {CORE_PACKAGES.map((name) => (
            <div key={name} className="flex justify-between gap-2 text-xs">
              <span className="text-[var(--color-text-dim)]">{name}</span>
              <span className="label-data text-[var(--color-text-primary)]">{status.packages[name] ?? '—'}</span>
            </div>
          ))}
        </div>
      )}

      {limit !== null && (
        <div className="flex flex-col gap-2">
          <div>
            <div className="text-sm text-[var(--color-text-primary)]">Cell time limit</div>
            <div className="text-xs text-[var(--color-text-faint)]">
              A cell that runs longer is interrupted. Long Monte Carlo sweeps may want more.
            </div>
          </div>
          <div className="flex">
            <SegmentedControl
              options={CELL_LIMIT_CHOICES.map((s) => ({ value: String(s), label: limitLabel(s) }))}
              value={String(limit)}
              onChange={(v) => {
                void window.engram.runtimeSetCellLimit(Number(v)).then(setLimit)
              }}
            />
          </div>
        </div>
      )}

      {status.state === 'ready' && (
        <div className="flex items-center gap-3">
          {confirmRemove ? (
            <>
              <span className="text-xs text-[var(--color-text-dim)]">
                Remove the runtime? Workbenches are kept; running kernels stop.
              </span>
              <Button variant="danger" size="sm" onClick={remove}>
                Remove
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)}>
              Remove runtime
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
