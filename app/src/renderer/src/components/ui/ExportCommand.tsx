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
    <span className="group inline-flex items-center shrink-0">
      <button
        type="button"
        disabled={exporting !== null}
        title="Export this sitting"
        aria-haspopup="true"
        className="focus-ring cmd-item label-data text-[10px] uppercase tracking-[0.16em] disabled:opacity-50"
      >
        {exporting !== null ? 'Exporting…' : 'Export'}
      </button>
      {/* Collapsed at rest via the house 0fr↔1fr grid trick — a true-width
          unfold (never max-width guessing), horizontal here like the session
          ticket's slide. group-hover/group-focus-within reveal keeps the pair
          reachable by mouse and keyboard alike: the format buttons stay in
          the tab order even at zero width, and focusing one expands the
          column — so Tab onto Export opens it, Tab again lands on .md. The
          inner pl-3 stands in for the outer gap so nothing leaks when folded. */}
      <span className="grid grid-cols-[0fr] opacity-0 group-hover:grid-cols-[1fr] group-hover:opacity-100 group-focus-within:grid-cols-[1fr] group-focus-within:opacity-100 transition-[grid-template-columns,opacity] duration-[var(--dur-base)] ease-[var(--ease-out-soft)]">
        <span className="min-w-0 overflow-hidden inline-flex items-center gap-3 pl-3">
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
    </span>
  )
}
