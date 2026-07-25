import { memo, useState } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { ExplorableViewer } from '../ExplorableViewer'
import { Button } from '../ui/Button'

/** A card marking the moment the artifact-smith's explorable landed (or,
 * derived from a replayed transcript, was spawned) — violet ink to keep it
 * visually distinct from the danger-toned `MisconceptionPin` and the warm
 * beat/diagnostic marks. `path` is best-effort: a live spawn only carries a
 * title/node until a subsequent `artifact set` call (or, offline, none at
 * all — see `shared/ritualFromTranscript.ts`'s doctrine comment on why the
 * smith's own registration call is usually invisible to the transcript this
 * card is derived from).
 *
 * Open button resolves at CLICK time, not mount time (no eager existence
 * check for every card in a long history) — `engram:openExplorable` doubles
 * as the "cheap existence check" (it returns `{error}` instead of throwing
 * when the file's gone) before handing off to the in-app viewer; on failure
 * this offers the same "Open in browser" escape hatch `ExplorableViewer`
 * itself uses (`engram:openArtifact`, a raw `loadFile` that can occasionally
 * succeed where the stricter resolve-and-allowlist path fails — see that
 * IPC handler's comment in main/index.ts) alongside an honest caption. */
export const ExplorableForged = memo(function ExplorableForged({
  title,
  path,
  node,
}: {
  title: string
  path?: string
  node?: string
}) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'missing'>('idle')
  const [viewerOpen, setViewerOpen] = useState(false)

  async function handleOpen() {
    if (!path) return
    setStatus('checking')
    try {
      const res = await window.engram.openExplorable(path)
      if ('error' in res) {
        setStatus('missing')
      } else {
        setStatus('idle')
        setViewerOpen(true)
      }
    } catch {
      setStatus('missing')
    }
  }

  return (
    <div className="flex justify-start my-1.5 pl-1">
      <div className="panel max-w-[92%] flex flex-col gap-2 px-3.5 py-3 border-[var(--color-ink-violet-dim)] ritual-explorable-in">
        <div className="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
            className="shrink-0 text-[var(--color-ink-violet)]"
          >
            <path d="M7 1.5 L12.5 7 L7 12.5 L1.5 7 Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
            <circle cx="7" cy="7" r="1.4" fill="currentColor" />
          </svg>
          <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-violet)]">EXPLORABLE FORGED</span>
        </div>
        <div className="font-[var(--font-serif)] text-sm text-[var(--color-text-primary)]">{title}</div>
        {node && <div className="fig-caption">for {humanizeNodeId(node)}</div>}

        {path && status !== 'missing' && (
          <div className="flex items-center gap-2 pt-0.5">
            <Button variant="ghost" disabled={status === 'checking'} onClick={handleOpen} className="!text-[var(--color-ink-violet)] !border-[var(--color-ink-violet-dim)]">
              {status === 'checking' ? 'Opening…' : 'Open'}
            </Button>
          </div>
        )}
        {(!path || status === 'missing') && (
          <div className="flex items-center gap-2 pt-0.5">
            <div className="fig-caption">artifact no longer on disk</div>
            {path && (
              <button
                onClick={() => window.engram.openArtifact(path)}
                className="focus-ring text-[10px] label-data text-[var(--color-ink-violet)] hover:text-[var(--color-text-primary)]"
              >
                Open in browser ↗
              </button>
            )}
          </div>
        )}
      </div>

      {viewerOpen && path && (
        <ExplorableViewer path={path} title={title} nodeId={node} onClose={() => setViewerOpen(false)} />
      )}
    </div>
  )
})
