import type { ArtifactEntry, NodeProvenance, ProvenanceEvent } from '../../../shared/types'
import { humanizeNodeId } from '../../../shared/humanizeId'
import { InkNode } from './ui/InkNode'

/** `mtimeMs` is an absolute instant, not a YYYY-MM-DD calendar string like
 * ProvenanceEvent.date — `new Date(ms)` already reads it correctly in local
 * time, so formatting never touches `toISOString`. */
function formatMtime(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Same local-midnight parse as TopicMapView's formatProvenanceDate — never
 * `toISOString`, which would misdate an evening-Pacific sitting by a day. */
function formatProvenanceDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * One artifact's tile — shared by ArtifactGalleryView (every topic, grouped)
 * and TopicDrilldownView (one topic's own artifacts) so the two surfaces
 * can't drift on what a tile shows or how a missing file renders.
 *
 * `exists: false` renders as a visibly broken tile (disabled, dimmed, "File
 * missing on disk") rather than being filtered away — a broken tile is
 * information. Build date comes from `artifact.mtimeMs` (absent if the file
 * couldn't be stat'd); the originating sitting comes from `provenance` where
 * a caller has it — `TopicDrilldownView` already fetches `nodeProvenance`
 * for its own Provenance summary section, and `ArtifactGalleryView` fetches
 * it per distinct topic. Neither is guessed when absent.
 */
export function ArtifactTile({
  artifact,
  provenance,
  showTopic = true,
  onOpen,
  onOpenSitting,
}: {
  artifact: ArtifactEntry
  /** This node's provenance within its topic. Omitted (or with a null
   * `firstEncoded`) simply renders no sitting line — never guessed. */
  provenance?: NodeProvenance
  /** The gallery groups tiles under a topic heading and skips this;
   * TopicDrilldownView is already scoped to one topic and always skips it —
   * matches both surfaces' pre-existing tile, which never showed it inline
   * once already contextualized. */
  showTopic?: boolean
  onOpen: (a: ArtifactEntry) => void
  /** Present only where the caller can actually open a transcript at that
   * sitting (ArtifactGalleryView, via SessionHistoryDrawer) — omitted, the
   * sitting still renders, just as plain text instead of a link. */
  onOpenSitting?: (a: ArtifactEntry, ev: ProvenanceEvent) => void
}) {
  const a = artifact
  const firstEncoded = provenance?.firstEncoded ?? null
  const nodeName = humanizeNodeId(a.node)
  const hasMeta = a.mtimeMs != null || firstEncoded !== null

  return (
    <div
      className={`panel flex flex-col gap-2 px-4 py-3 transition-colors duration-[var(--dur-base)] ${
        a.exists ? 'hover:bg-[var(--color-surface-2)] hover:border-[var(--color-ink-warm-dim)]' : 'opacity-40'
      }`}
    >
      <button
        onClick={() => a.exists && onOpen(a)}
        disabled={!a.exists}
        aria-label={a.exists ? `Open explorable for ${nodeName}` : `${nodeName} — file missing on disk`}
        className={`focus-ring group w-full text-left flex flex-col gap-2 ${a.exists ? '' : 'cursor-not-allowed'}`}
      >
        {showTopic && <div className="text-xs label-data text-[var(--color-text-faint)]">{a.topic}</div>}
        <div className="flex items-center gap-2">
          <InkNode id={`${a.topic}:${a.node}`} variant="filled" color="var(--color-ink-violet)" size={14} />
          <div className="text-sm text-[var(--color-text-primary)]" title={a.node}>{nodeName}</div>
        </div>
        {a.exists ? (
          <span className="self-start rounded-lg px-3 py-1.5 text-sm border border-[var(--color-hairline)] text-[var(--color-text-dim)] group-hover:text-[var(--color-text-primary)]">
            Open explorable →
          </span>
        ) : (
          <div className="text-xs text-[var(--color-ink-danger)]">File missing on disk</div>
        )}
      </button>

      {hasMeta && (
        <div className="flex flex-col items-start gap-0.5 border-t border-[var(--color-hairline)] pt-2 mt-0.5">
          {a.mtimeMs != null && (
            <div className="text-[10px] label-data text-[var(--color-text-faint)]">Built {formatMtime(a.mtimeMs)}</div>
          )}
          {firstEncoded &&
            (onOpenSitting ? (
              <button
                onClick={() => onOpenSitting(a, firstEncoded)}
                aria-label={`Open the sitting from ${formatProvenanceDate(firstEncoded.date)}`}
                className="focus-ring text-[10px] label-data text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)] text-left"
              >
                From the sitting on {formatProvenanceDate(firstEncoded.date)} →
              </button>
            ) : (
              <div className="text-[10px] label-data text-[var(--color-text-faint)]">
                From the sitting on {formatProvenanceDate(firstEncoded.date)}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
