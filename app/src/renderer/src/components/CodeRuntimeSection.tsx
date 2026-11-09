import { useEffect, useState } from 'react'
import type { RuntimeProgress, RuntimeStatus } from '../../../shared/runtime'
import { CELL_LIMIT_CHOICES } from '../../../shared/runtime'
import { Button } from './ui/Button'
import { SectionBanner } from './ui/SectionBanner'
import { SegmentedControl } from './ui/SegmentedControl'

/** Settings → Code runtime: install, inspect, and remove the app-managed Python envs, one per layer. */

function limitLabel(s: number): string {
  if (s === 0) return 'No limit'
  return s < 120 ? `${s} s` : `${s / 60} min`
}

function cleanError(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
}

export function CodeRuntimeSection() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [progress, setProgress] = useState<RuntimeProgress | null>(null)
  const [limit, setLimit] = useState<number | null>(null)
  const [error, setError] = useState<{ layer: string; text: string } | null>(null)
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

  async function install(layerId: string) {
    setError(null)
    setProgress(null)
    setStatus((s) =>
      s
        ? {
            ...s,
            installing: layerId,
            layers: s.layers.map((l) => (l.id === layerId ? { ...l, state: 'installing' } : l)),
          }
        : s,
    )
    try {
      setStatus(await window.engram.runtimeInstall(layerId))
    } catch (e) {
      setError({ layer: layerId, text: cleanError(e) })
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
      setError({ layer: '', text: cleanError(e) })
    }
  }

  if (!status) return null
  const anyReady = status.layers.some((l) => l.state === 'ready')

  return (
    <div className="panel px-5 py-5 flex flex-col gap-4" id="settings-code-runtime">
      <div>
        <SectionBanner label="Code runtime" className="border-t-0" />
        <div className="text-xs text-[var(--color-text-faint)] mt-1.5">
          A private Python for Labs and code cells, built from pinned lockfiles into this app’s own data folder. It
          never touches a Python you already have, and removing it removes all of it. The base layer serves every
          workbench; a content pack can bring a layer of its own.
        </div>
        {!status.supported && (
          <div className="text-xs text-[var(--color-text-dim)] mt-2">
            The runtime does not install on this kind of machine yet: the scientific packages it pins publish no builds
            for it.
          </div>
        )}
      </div>

      {status.layers.map((layer) => {
        const installing = layer.state === 'installing'
        const err = error?.layer === layer.id ? error.text : layer.error
        return (
          <div key={layer.id} className="flex flex-col gap-2 border-t border-[var(--color-hairline)] pt-3">
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-1.5 h-2 w-2 rounded-full shrink-0"
                style={{
                  background:
                    layer.state === 'ready'
                      ? 'var(--color-ink-cool)'
                      : layer.state === 'failed'
                        ? 'var(--color-text-dim)'
                        : 'var(--color-text-faint)',
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[var(--color-text-primary)]">
                  {layer.label}
                  <span className="label-data text-xs text-[var(--color-text-faint)]">
                    {' · '}
                    {layer.id} · from {layer.sourceTitle}
                  </span>
                </div>
                <div className="text-xs text-[var(--color-text-dim)] mt-0.5">
                  {layer.state === 'ready' && `Ready · Python ${layer.pythonVersion ?? ''}`}
                  {layer.state === 'missing' && 'Not installed'}
                  {layer.state === 'installing' && 'Installing…'}
                  {layer.state === 'failed' && 'The last install did not finish'}
                  {layer.description && <span className="text-[var(--color-text-faint)]"> · {layer.description}</span>}
                </div>
                {layer.updateAvailable && (
                  <div className="text-xs text-[var(--color-text-dim)] mt-1">
                    A newer lockfile pins different packages. Cells keep running on the current set until you update;
                    the update builds beside it.
                  </div>
                )}
                {layer.state === 'missing' && layer.id === 'base' && status.supported && (
                  <div className="text-xs text-[var(--color-text-dim)] mt-1">
                    About 450 MB on disk. The download comes from the Python Package Index and the uv project on
                    GitHub, and every file is checked against the lockfile’s hashes.
                  </div>
                )}
                {installing && progress && (
                  <div className="label-data text-xs text-[var(--color-text-dim)] mt-1" aria-live="polite">
                    {progress.message}
                  </div>
                )}
                {err && !installing && (
                  <div className="text-xs text-[var(--color-text-dim)] mt-1 break-words">{err}</div>
                )}
                {layer.state === 'ready' && layer.envDir && (
                  <div className="label-data text-xs text-[var(--color-text-faint)] mt-1 break-all">{layer.envDir}</div>
                )}
              </div>
              {installing ? (
                <Button onClick={() => void window.engram.runtimeCancel()} className="shrink-0">
                  Cancel
                </Button>
              ) : (
                (layer.state !== 'ready' || layer.updateAvailable) &&
                status.supported && (
                  <Button
                    variant="primary"
                    onClick={() => void install(layer.id)}
                    disabled={!!status.installing}
                    className="shrink-0"
                  >
                    {layer.updateAvailable ? 'Update' : layer.state === 'failed' ? 'Try again' : 'Install'}
                  </Button>
                )
              )}
            </div>
            {layer.state === 'ready' && layer.watch.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-1 pl-5">
                {layer.watch.map((name) => (
                  <div key={name} className="flex justify-between gap-2 text-xs">
                    <span className="text-[var(--color-text-dim)]">{name}</span>
                    <span className="label-data text-[var(--color-text-primary)]">{layer.packages[name] ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

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
              options={CELL_LIMIT_CHOICES.map((s) => ({
                value: String(s),
                label: limitLabel(s),
              }))}
              value={String(limit)}
              onChange={(v) => {
                void window.engram.runtimeSetCellLimit(Number(v)).then(setLimit)
              }}
            />
          </div>
        </div>
      )}

      {error?.layer === '' && <div className="text-xs text-[var(--color-text-dim)]">{error.text}</div>}

      {anyReady && (
        <div className="flex items-center gap-3">
          {confirmRemove ? (
            <>
              <span className="text-xs text-[var(--color-text-dim)]">
                Remove the runtime and every layer? Workbenches and labs are kept; running kernels stop.
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
