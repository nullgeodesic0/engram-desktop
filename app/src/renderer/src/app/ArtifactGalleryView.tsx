import { useEffect, useState } from 'react'
import type { ArtifactEntry } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { SkeletonCard } from '../components/Skeleton'
import { InkNode } from '../components/ui/InkNode'
import { Button } from '../components/ui/Button'
import { friendlyErrorText } from '../shared/friendlyError'

interface ArtifactGalleryViewProps {
  /** Routes the empty state's one action to Learn — explorables are only ever
   * built during a live session, so that's the one thing to do about "none yet". */
  onGoLearn?: () => void
}

export function ArtifactGalleryView({ onGoLearn }: ArtifactGalleryViewProps = {}) {
  const [artifacts, setArtifacts] = useState<ArtifactEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.engram
      .artifactList()
      .then(setArtifacts)
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="p-8 flex flex-col gap-6 h-full overflow-y-auto">
      <header>
        <h1 className="font-[var(--font-display)] text-2xl text-[var(--color-text-primary)]">Artifacts</h1>
        <p className="text-sm text-[var(--color-text-dim)] mt-1">
          Interactive explorables the artifact-smith has built for threshold concepts.
        </p>
      </header>

      {error && (() => {
        const fe = friendlyErrorText(error)
        return (
          <div className="panel border-[var(--color-ink-danger-dim)] px-4 py-3 text-sm text-[var(--color-ink-danger)]">
            <div>{fe.headline}</div>
            {fe.detail && (
              <details className="mt-1 text-xs text-[var(--color-text-faint)]">
                <summary className="cursor-pointer">raw error</summary>
                <div className="mt-1">{fe.detail}</div>
              </details>
            )}
          </div>
        )
      })()}

      {artifacts === null && !error && (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} lines={3} />
          ))}
        </div>
      )}

      {artifacts?.length === 0 && !error && (
        <div className="flex flex-col items-start gap-2">
          <div className="fig-caption">Fig. — no explorables built yet; threshold concepts earn them.</div>
          <div className="text-sm text-[var(--color-text-dim)]">
            No explorables registered yet — they’re built during /learn sessions on threshold nodes.
          </div>
          {onGoLearn && <Button variant="ghost" onClick={onGoLearn}>Continue learning</Button>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {artifacts?.map((a) => (
          <button
            key={`${a.topic}:${a.node}`}
            onClick={() => a.exists && window.engram.openArtifact(a.artifact)}
            disabled={!a.exists}
            className={`focus-ring group panel text-left px-4 py-3 flex flex-col gap-2 transition-colors duration-[var(--dur-base)] ${
              a.exists ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-ink-warm-dim)]' : 'opacity-40 cursor-not-allowed'
            }`}
          >
            <div className="text-xs label-data text-[var(--color-text-faint)]">{a.topic}</div>
            <div className="flex items-center gap-2">
              <InkNode id={`${a.topic}:${a.node}`} variant="filled" color="var(--color-ink-violet)" size={14} />
              <div className="text-sm text-[var(--color-text-primary)]" title={a.node}>{humanizeNodeId(a.node)}</div>
            </div>
            {a.exists ? (
              <span className="self-start rounded-lg px-3 py-1.5 text-sm border border-[var(--color-hairline)] text-[var(--color-text-dim)] group-hover:text-[var(--color-text-primary)]">
                Open explorable →
              </span>
            ) : (
              <div className="text-xs text-[var(--color-ink-danger)]">File missing on disk</div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
