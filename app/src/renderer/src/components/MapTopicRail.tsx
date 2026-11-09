import { useState } from 'react'
import type { TopicListEntry } from '../../../shared/types'
import type { MapIndex } from '../shared/mapTopicIndex'
import { formatArchivedDate } from '../shared/archive'
import { UNFILED } from '../shared/topicFolders'
import { PopoverMenu, type MenuItem } from './ui/PopoverMenu'
import { MoreDots } from './TopicLibrary'

/**
 * The Topic Map's topic index: the rail beside the plate, replacing the
 * strip of topic tabs above it. Drawn in the grammar of Learn's library rail
 * (the same headings, the same warm left rule on the current row, the same ⋯
 * menu), so moving between the two screens never changes how the library
 * reads. Which topics go where is mapTopicIndex.ts's job; this only draws.
 *
 * Archived topics sit below a hairline in one section that stays collapsed
 * until asked for, opens on its own while the open map is an archived one,
 * and opens while a search matches one. Their rows are quiet, say when they
 * were archived instead of a due count, and offer Restore in place of
 * Archive.
 */

export interface MapRailActions {
  onOpenInLearn: (t: TopicListEntry) => void
  onFile: (t: TopicListEntry, folder: string | null) => void
  onNewFolderFor: (t: TopicListEntry) => void
  onRename: (t: TopicListEntry) => void
  onArchive: (t: TopicListEntry) => void
  onRestore: (t: TopicListEntry) => void
}

const HEADING = 'label-data text-[10.5px] uppercase tracking-[0.12em]'

const ROW_MORE =
  'w-6 h-6 flex items-center justify-center text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [&.is-open]:opacity-100'

/** A drawn disclosure chevron: the ▸/▾ glyphs fall back to a dot in the
 * label face at this size. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}>
      <path d="M2.5 1.5 L5.5 4 L2.5 6.5" fill="none" stroke="currentColor" strokeWidth={1.1} />
    </svg>
  )
}

function sameFolder(a: string | null | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.toLowerCase()
}

function moveToItems(t: TopicListEntry, folders: string[], a: MapRailActions): MenuItem[] {
  const filed = t.folder?.trim()
  return [
    { kind: 'caption', label: 'File under' },
    ...folders.map((f) => ({ label: f, mark: filed && sameFolder(filed, f) ? '✓' : '', onSelect: () => a.onFile(t, f) })),
    { label: UNFILED, quiet: true, mark: filed ? '' : '✓', onSelect: () => a.onFile(t, null) },
    { kind: 'separator' },
    { label: 'New folder…', quiet: true, onSelect: () => a.onNewFolderFor(t) },
  ]
}

function Row({
  t,
  active,
  archived,
  folders,
  actions: a,
  onSelect,
}: {
  t: TopicListEntry
  active: boolean
  archived: boolean
  folders: string[]
  actions: MapRailActions
  onSelect: () => void
}) {
  const items: MenuItem[] = archived
    ? [
        { label: 'Restore', onSelect: () => a.onRestore(t) },
        { kind: 'separator' },
        { label: 'Move to folder', submenu: moveToItems(t, folders, a) },
        { label: 'Rename…', onSelect: () => a.onRename(t) },
      ]
    : [
        { label: 'Open in Learn', onSelect: () => a.onOpenInLearn(t) },
        { kind: 'separator' },
        { label: 'Move to folder', submenu: moveToItems(t, folders, a) },
        { label: 'Rename…', onSelect: () => a.onRename(t) },
        { kind: 'separator' },
        { label: 'Archive…', onSelect: () => a.onArchive(t) },
      ]
  return (
    <div
      className={`group relative flex items-center border-l-2 ${
        active
          ? 'border-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-surface-2)_70%,transparent)]'
          : 'border-transparent hover:bg-[color-mix(in_srgb,var(--color-surface-2)_35%,transparent)]'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        title={archived ? `${t.title} (archived)` : t.title}
        className={`focus-ring flex-1 min-w-0 flex items-baseline gap-2 pl-3 pr-8 py-1.5 text-left text-[13px] ${
          active
            ? 'text-[var(--color-text-primary)]'
            : archived
              ? 'text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]'
              : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <span className="truncate">{t.title || t.topic}</span>
        {archived ? (
          <span className="ml-auto shrink-0 label-data text-[10.5px] text-[var(--color-text-faint)] group-hover:invisible">
            {formatArchivedDate(t.archivedAt)}
          </span>
        ) : (
          t.due > 0 && (
            <span
              className="ml-auto shrink-0 label-data text-[11px] tabular-nums text-[var(--color-ink-warm)] group-hover:invisible"
              title={`${t.due} due for review`}
            >
              {t.due}
            </span>
          )
        )}
      </button>
      <span className="absolute right-1 top-1/2 -translate-y-1/2">
        <PopoverMenu label={`Actions for ${t.title}`} align="left" triggerClassName={ROW_MORE} trigger={<MoreDots />} items={items} />
      </span>
    </div>
  )
}

export function MapTopicRail({
  index,
  selected,
  onSelect,
  query,
  archivedOpen,
  onToggleArchived,
  folders,
  actions,
}: {
  index: MapIndex
  selected: string | null
  onSelect: (topicId: string) => void
  query: string
  /** Effective state: the parent opens it for an archived map or a match. */
  archivedOpen: boolean
  onToggleArchived: () => void
  folders: string[]
  actions: MapRailActions
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const searching = query.trim().length > 0
  const hasArchived = index.archivedTotal > 0
  return (
    <nav aria-label="Topics" className="w-60 shrink-0 min-h-0 flex flex-col overflow-y-auto pr-1 -ml-1">
      {index.liveShown === 0 && (
        <div className="fig-caption px-3 py-2">
          {searching ? `No topic matches “${query.trim()}”.` : hasArchived ? 'Every topic is archived.' : 'No topics yet.'}
        </div>
      )}
      {index.sections.map((sec) => {
        // A search shows every match; a collapsed section still keeps the
        // open map's own row in view, so the rail never hides where you are.
        const shut = collapsed.has(sec.key) && !searching
        const rows = shut ? sec.topics.filter((t) => t.topic === selected) : sec.topics
        return (
          <section key={sec.key} aria-label={sec.heading} className="flex flex-col">
            <button
              type="button"
              aria-expanded={!shut}
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev)
                  if (next.has(sec.key)) next.delete(sec.key)
                  else next.add(sec.key)
                  return next
                })
              }
              className={`focus-ring flex items-center gap-1.5 px-3 pt-3.5 pb-1.5 text-left ${HEADING} ${
                sec.quiet ? 'text-[var(--color-text-faint)]' : 'text-[var(--color-ink-warm-dim)]'
              } hover:text-[var(--color-text-primary)]`}
            >
              <span className="w-2.5 flex text-[var(--color-text-faint)]">
                <Chevron open={!shut} />
              </span>
              <span className="truncate">{sec.heading}</span>
              <span className="ml-auto tabular-nums text-[var(--color-text-faint)]">{sec.topics.length}</span>
            </button>
            {rows.map((t) => (
              <Row
                key={t.topic}
                t={t}
                active={t.topic === selected}
                archived={false}
                folders={folders}
                actions={actions}
                onSelect={() => onSelect(t.topic)}
              />
            ))}
          </section>
        )
      })}
      {hasArchived && (
        <section aria-label="Archived topics" className="flex flex-col mt-3">
          <div className="h-px bg-[var(--color-hairline)] mx-3 mb-2" />
          <button
            type="button"
            aria-expanded={archivedOpen}
            onClick={onToggleArchived}
            className="focus-ring flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)]"
          >
            <span aria-hidden="true" className="w-3 text-center text-[11px]">
              ▤
            </span>
            <span>Archived</span>
            <span className="ml-auto label-data text-[11px] tabular-nums">
              {searching ? `${index.archived.length} of ${index.archivedTotal}` : index.archivedTotal}
            </span>
            <Chevron open={archivedOpen} />
          </button>
          {archivedOpen && (
            <>
              <p className="px-3 pb-1.5 text-[11.5px] leading-snug text-[var(--color-text-faint)]">
                Kept as history. Nothing in them comes due.
              </p>
              {index.archived.length === 0 && searching && (
                <div className="px-3 py-1 text-[12px] text-[var(--color-text-faint)]">No archived topic matches.</div>
              )}
              {index.archived.map((t) => (
                <Row
                  key={t.topic}
                  t={t}
                  active={t.topic === selected}
                  archived
                  folders={folders}
                  actions={actions}
                  onSelect={() => onSelect(t.topic)}
                />
              ))}
            </>
          )}
        </section>
      )}
    </nav>
  )
}
