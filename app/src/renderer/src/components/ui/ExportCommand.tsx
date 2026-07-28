import type { ExportSittingFormat } from '../../../../shared/types'

/** One EXPORT item for the masthead command bar, collapsing the two formats
 * behind a single disclosure. At rest it reads as one tracked nav item;
 * hovering it (or focusing it with the keyboard — click focuses too) reveals
 * the two format items inline, in the same idiom, so choosing a format is a
 * single further click. Inline reveal rather than a floating menu on purpose:
 * the masthead's collapsing wrapper is overflow-hidden (the 0fr fold), which
 * would clip any absolutely-positioned popover — and the row can absorb the
 * extra width because the identity block on the left truncates, never the
 * controls. Both formats stay real, independently focusable buttons. */
export function ExportCommand({
  exporting,
  onExport,
}: {
  exporting: ExportSittingFormat | null
  onExport: (format: ExportSittingFormat) => void
}) {
  return (
    <span className="group inline-flex items-center gap-3 shrink-0">
      <button
        type="button"
        disabled={exporting !== null}
        title="Export this sitting"
        aria-haspopup="true"
        className="focus-ring cmd-item label-data text-[10px] uppercase tracking-[0.16em] disabled:opacity-50"
      >
        {exporting !== null ? 'Exporting…' : 'Export'}
      </button>
      {/* Hidden at rest; group-hover/group-focus-within reveal keeps the pair
          reachable by mouse and keyboard alike (Tab onto Export opens it,
          Tab again lands on .md). */}
      <span className="hidden group-hover:inline-flex group-focus-within:inline-flex items-center gap-3">
        <button
          type="button"
          onClick={() => onExport('md')}
          disabled={exporting !== null}
          title="Export this sitting as a Markdown file"
          className="focus-ring cmd-item label-data text-[10px] uppercase tracking-[0.16em] disabled:opacity-50"
        >
          .md
        </button>
        <button
          type="button"
          onClick={() => onExport('pdf')}
          disabled={exporting !== null}
          title="Export this sitting as a PDF"
          className="focus-ring cmd-item label-data text-[10px] uppercase tracking-[0.16em] disabled:opacity-50"
        >
          .pdf
        </button>
      </span>
    </span>
  )
}
