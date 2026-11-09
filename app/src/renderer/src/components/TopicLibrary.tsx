import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Misconception, ReceiptsHistory, TopicListEntry } from '../../../shared/types'
import { TopicCard } from './TopicCard'
import { SectionBanner } from './ui/SectionBanner'
import { Button } from './ui/Button'
import { PopoverMenu, type MenuItem } from './ui/PopoverMenu'
import { topicBucket } from '../shared/topicShelf'
import { sortTopics, TOPIC_SORT_OPTIONS, type TopicSortKey } from '../shared/topicSort'
import { groupTopicsByFolder, UNFILED } from '../shared/topicFolders'
import type { TopicGroupKey } from '../shared/topicSortPrefs'
import { formatArchivedDate, partitionArchived } from '../shared/archive'
import { computeShownTopicGrade } from '../shared/topicGrade'
import { allPicks } from '../shared/calibrationStore'
import { punctualityCounts } from '../shared/gradePrefs'

/**
 * Learn's topic library: a rail of places on the left (All topics, Due now,
 * the learner's folders, Archived), one list on the right, a compact toolbar
 * above it, a ⋯ menu on every row, and an Organize mode with multi-select.
 *
 * Folders are still a VIEW over the list (topicFolders.ts) — nothing moves
 * on disk. Archived topics follow archive.ts: never in the work groups, never
 * the "pick up where you left off" card, gathered into one collapsed line at
 * the bottom of the list and a view of their own with a Restore button.
 */

export type LibraryView =
  | { kind: 'all' }
  | { kind: 'due' }
  | { kind: 'folder'; name: string }
  | { kind: 'unfiled' }
  | { kind: 'archived' }

export const DRAG_TYPE = 'application/x-engram-topic'

/** Dropdown labels — the shared option set, with "Due" spelled out the way
 * a menu reads it. */
const SORT_LABEL: Record<TopicSortKey, string> = { due: 'Most due', title: 'A–Z', progress: 'Progress', size: 'Size' }

function sameFolder(a: string | null | undefined, b: string): boolean {
  return (a ?? '').trim().toLowerCase() === b.toLowerCase()
}

function inView(t: TopicListEntry, view: LibraryView): boolean {
  switch (view.kind) {
    case 'all':
    case 'archived':
      return true
    case 'due':
      return t.due > 0
    case 'folder':
      return sameFolder(t.folder, view.name)
    case 'unfiled':
      return !t.folder?.trim()
  }
}

function matches(t: TopicListEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [t.title, t.goal, t.folder ?? '', t.topic].some((s) => s?.toLowerCase().includes(q))
}

// ------------------------------------------------------------------ toolbar

export function LibraryToolbar({
  query,
  onQuery,
  group,
  onGroup,
  sort,
  onSort,
  organizing,
  onOrganize,
}: {
  query: string
  onQuery: (q: string) => void
  group: TopicGroupKey
  onGroup: (g: TopicGroupKey) => void
  sort: TopicSortKey
  onSort: (s: TopicSortKey) => void
  /** Learn's Organize mode. Left out where a surface only reads the
   * library (the Topic Map's rail), and the button goes with it. */
  organizing?: boolean
  onOrganize?: () => void
}) {
  const dd =
    'flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] border border-[var(--color-edge)] bg-[color-mix(in_srgb,var(--color-surface)_80%,transparent)] text-[var(--color-text-primary)] hover:border-[var(--color-text-faint)]'
  const key = 'label-data text-[10px] uppercase tracking-[0.1em] text-[var(--color-text-faint)]'
  return (
    <div className="flex items-center gap-2.5 flex-wrap justify-end">
      <label className="flex items-center gap-2 px-2.5 py-1.5 min-w-[13rem] border border-[var(--color-edge)] bg-[color-mix(in_srgb,var(--color-surface)_80%,transparent)] focus-within:border-[var(--color-text-faint)]">
        <span aria-hidden="true" className="text-[var(--color-text-faint)] text-xs">
          ⌕
        </span>
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onQuery('')
          }}
          placeholder="Find a topic"
          aria-label="Find a topic"
          className="bg-transparent outline-none text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)] w-full"
        />
      </label>
      <PopoverMenu
        label="Group topics by"
        align="right"
        triggerClassName={dd}
        trigger={
          <>
            <span className={key}>group</span> {group === 'state' ? 'State' : 'Folder'}{' '}
            <span aria-hidden="true" className="text-[var(--color-text-faint)] text-[9px]">
              ▾
            </span>
          </>
        }
        items={[
          { kind: 'caption', label: 'Group by' },
          { label: 'State', mark: group === 'state' ? '✓' : '', onSelect: () => onGroup('state') },
          { label: 'Folder', mark: group === 'folder' ? '✓' : '', onSelect: () => onGroup('folder') },
        ]}
      />
      <PopoverMenu
        label="Sort topics"
        align="right"
        triggerClassName={dd}
        trigger={
          <>
            <span className={key}>sort</span> {SORT_LABEL[sort]}{' '}
            <span aria-hidden="true" className="text-[var(--color-text-faint)] text-[9px]">
              ▾
            </span>
          </>
        }
        items={[
          { kind: 'caption', label: 'Sort by' },
          ...TOPIC_SORT_OPTIONS.map((o) => ({
            label: SORT_LABEL[o.value],
            mark: sort === o.value ? '✓' : '',
            onSelect: () => onSort(o.value),
          })),
        ]}
      />
      {onOrganize && (
        <Button variant={organizing ? 'primary' : 'ghost'} onClick={onOrganize}>
          {organizing ? 'Done' : 'Organize'}
        </Button>
      )}
    </div>
  )
}

// --------------------------------------------------------------------- rail

function RailItem({
  active,
  icon,
  label,
  count,
  quiet,
  onClick,
  dropTarget,
  onDropTopic,
  children,
}: {
  active: boolean
  icon: string
  label: string
  count?: number
  quiet?: boolean
  onClick: () => void
  /** Organize mode: this place accepts a dragged topic. */
  dropTarget?: boolean
  onDropTopic?: (topicId: string) => void
  children?: ReactNode
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={
        dropTarget
          ? (e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setOver(true)
            }
          : undefined
      }
      onDragLeave={dropTarget ? () => setOver(false) : undefined}
      onDrop={
        dropTarget
          ? (e) => {
              e.preventDefault()
              setOver(false)
              const id = e.dataTransfer.getData(DRAG_TYPE)
              if (id) onDropTopic?.(id)
            }
          : undefined
      }
      className={`group flex items-center border-l-2 ${
        active
          ? 'border-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-surface-2)_70%,transparent)]'
          : 'border-transparent'
      }${over ? ' outline outline-1 outline-dashed outline-[var(--color-ink-warm)]' : ''}`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={`focus-ring flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-left text-[13.5px] ${
          active ? 'text-[var(--color-text-primary)]' : quiet ? 'text-[var(--color-text-faint)]' : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        <span aria-hidden="true" className="w-3.5 text-center text-[11px] text-[var(--color-text-faint)]">
          {icon}
        </span>
        <span className="truncate">{label}</span>
        {count !== undefined && (
          <span
            className={`ml-auto label-data text-[11px] text-[var(--color-text-faint)] tabular-nums${
              children ? ' group-hover:hidden group-focus-within:hidden' : ''
            }`}
          >
            {count}
          </span>
        )}
      </button>
      {children}
    </div>
  )
}

export function LibraryRail({
  view,
  onView,
  liveTopics,
  archivedCount,
  folders,
  organizing,
  onNewFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  canDeleteFolder,
  onDropTopic,
}: {
  view: LibraryView
  onView: (v: LibraryView) => void
  liveTopics: TopicListEntry[]
  archivedCount: number
  /** Every folder, in the learner's own order. */
  folders: string[]
  organizing: boolean
  onNewFolder: () => void
  onRenameFolder: (name: string) => void
  onMoveFolder: (name: string, dir: -1 | 1) => void
  onDeleteFolder: (name: string) => void
  /** Delete is offered only for a folder no topic (live or archived) is
   * filed in — deleting a label must never unfile anything silently. */
  canDeleteFolder: (name: string) => boolean
  onDropTopic: (topicId: string, folder: string | null) => void
}) {
  const heading = 'px-2.5 pt-4 pb-1.5 label-data text-[10.5px] uppercase tracking-[0.12em] text-[var(--color-text-faint)]'
  const tool = 'focus-ring w-6 h-6 flex items-center justify-center text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] disabled:opacity-30'
  const dueCount = liveTopics.filter((t) => t.due > 0).length
  const unfiled = liveTopics.filter((t) => !t.folder?.trim()).length
  return (
    <nav aria-label="Topic library" className="hidden md:flex w-52 shrink-0 flex-col gap-0.5 sticky top-0 self-start">
      <div className={heading}>Library</div>
      <RailItem active={view.kind === 'all'} icon="◇" label="All topics" count={liveTopics.length} onClick={() => onView({ kind: 'all' })} />
      <RailItem active={view.kind === 'due'} icon="◷" label="Due now" count={dueCount} onClick={() => onView({ kind: 'due' })} />
      <div className={heading}>Folders</div>
      {folders.map((name, i) => (
        <RailItem
          key={name}
          active={view.kind === 'folder' && view.name.toLowerCase() === name.toLowerCase()}
          icon="▭"
          label={name}
          count={liveTopics.filter((t) => sameFolder(t.folder, name)).length}
          onClick={() => onView({ kind: 'folder', name })}
          dropTarget={organizing}
          onDropTopic={(id) => onDropTopic(id, name)}
        >
          {organizing && (
            // Revealed on hover/focus so the folder's name keeps the rail's
            // full width the rest of the time.
            <span className="hidden group-hover:flex group-focus-within:flex items-center pr-1">
              <button type="button" className={tool} title={`Rename ${name}`} aria-label={`Rename folder ${name}`} onClick={() => onRenameFolder(name)}>
                ✎
              </button>
              <button type="button" className={tool} title="Move up" aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => onMoveFolder(name, -1)}>
                ↑
              </button>
              <button
                type="button"
                className={tool}
                title="Move down"
                aria-label={`Move ${name} down`}
                disabled={i === folders.length - 1}
                onClick={() => onMoveFolder(name, 1)}
              >
                ↓
              </button>
              {canDeleteFolder(name) && (
                <button type="button" className={tool} title={`Delete ${name}`} aria-label={`Delete folder ${name}`} onClick={() => onDeleteFolder(name)}>
                  ×
                </button>
              )}
            </span>
          )}
        </RailItem>
      ))}
      <RailItem
        active={view.kind === 'unfiled'}
        icon="▭"
        label={UNFILED}
        count={unfiled}
        quiet
        onClick={() => onView({ kind: 'unfiled' })}
        dropTarget={organizing}
        onDropTopic={(id) => onDropTopic(id, null)}
      />
      <button
        type="button"
        onClick={onNewFolder}
        className="focus-ring flex items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-[var(--color-text-faint)] hover:text-[var(--color-text-primary)] border-l-2 border-transparent"
      >
        <span aria-hidden="true" className="w-3.5 text-center">
          +
        </span>
        New folder
      </button>
      <div className="h-px bg-[var(--color-hairline)] mx-1.5 my-2.5" />
      <RailItem
        active={view.kind === 'archived'}
        icon="▤"
        label="Archived"
        count={archivedCount}
        onClick={() => onView({ kind: 'archived' })}
      />
    </nav>
  )
}

// --------------------------------------------------------------------- list

export interface TopicActions {
  onOpen: (t: TopicListEntry) => void
  onOpenMap: (t: TopicListEntry) => void
  onFile: (topicIds: string[], folder: string | null) => void
  onNewFolderFor: (topicIds: string[]) => void
  onRename: (t: TopicListEntry) => void
  onSettings: (t: TopicListEntry) => void
  onStartFresh: (t: TopicListEntry) => void
  onArchive: (ts: TopicListEntry[]) => void
  onRestore: (t: TopicListEntry) => void
}

function moveToItems(folders: string[], current: string | null | undefined, ids: string[], a: TopicActions): MenuItem[] {
  return [
    { kind: 'caption', label: 'File under' },
    ...folders.map((f) => ({ label: f, mark: current && sameFolder(current, f) ? '✓' : '', onSelect: () => a.onFile(ids, f) })),
    { label: UNFILED, quiet: true, mark: current === undefined || current?.trim() ? '' : '✓', onSelect: () => a.onFile(ids, null) },
    { kind: 'separator' },
    { label: 'New folder…', quiet: true, onSelect: () => a.onNewFolderFor(ids) },
  ]
}

export const MORE_TRIGGER =
  'w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)] border border-transparent [&.is-open]:border-[var(--color-edge)] [&.is-open]:bg-[color-mix(in_srgb,var(--color-surface-2)_80%,transparent)]'

export function MoreDots() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx={3.5} cy={8} r={1.25} fill="currentColor" />
      <circle cx={8} cy={8} r={1.25} fill="currentColor" />
      <circle cx={12.5} cy={8} r={1.25} fill="currentColor" />
    </svg>
  )
}

function Checkbox({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      className={`focus-ring w-4 h-4 shrink-0 flex items-center justify-center border-[1.5px] text-[11px] leading-none ${
        checked
          ? 'bg-[var(--color-accent-cta)] border-[var(--color-accent-cta)] text-[var(--color-void)]'
          : 'border-[var(--color-text-faint)] text-transparent'
      }`}
    >
      ✓
    </button>
  )
}

/** Final grades and set-aside misconceptions for archived rows. Learn does
 * not otherwise read receipts, so this fetches once, only when an archived
 * row is actually on screen. */
function useArchivedSummaries(archived: TopicListEntry[], visible: boolean) {
  const [data, setData] = useState<{ history: ReceiptsHistory; misconceptions: Misconception[] } | null>(null)
  useEffect(() => {
    if (!visible || archived.length === 0 || data) return
    let alive = true
    Promise.all([window.engram.receiptsHistory(), window.engram.misconceptions()])
      .then(([history, misconceptions]) => alive && setData({ history, misconceptions }))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [visible, archived.length, data])
  return useMemo(() => {
    const out = new Map<string, { letter: string | null; setAside: number }>()
    if (!data) return out
    for (const t of archived) {
      const g = computeShownTopicGrade({
        receipts: data.history.receipts,
        topicEntry: t,
        misconceptions: data.misconceptions,
        days: data.history.days,
        picks: allPicks(),
        mode: 'completed',
        countPunctuality: punctualityCounts(),
      })
      out.set(t.topic, {
        letter: g.overall.available ? g.overall.letter : null,
        setAside: data.misconceptions.filter((m) => m.topic === t.topic && m.status === 'open').length,
      })
    }
    return out
  }, [data, archived])
}

export function TopicLibraryList({
  view,
  topics,
  group,
  sort,
  query,
  organizing,
  selected,
  onToggleSelect,
  folders,
  resumableTopics,
  morphingTopic,
  hero,
  footer,
  actions: a,
  onDropTopic,
}: {
  view: LibraryView
  topics: TopicListEntry[]
  group: TopicGroupKey
  sort: TopicSortKey
  query: string
  organizing: boolean
  selected: Set<string>
  onToggleSelect: (topicId: string) => void
  folders: string[]
  resumableTopics: Set<string>
  morphingTopic: string | null
  /** The "pick up where you left off" card — shown only on All topics, not
   * while organizing or searching. */
  hero: ReactNode
  /** The "start a new topic" card, last on the shelf. */
  footer: ReactNode
  actions: TopicActions
  onDropTopic: (topicId: string, folder: string | null) => void
}) {
  const [archivedOpen, setArchivedOpen] = useState(false)
  const { live, archived } = partitionArchived(topics)
  const shown = live.filter((t) => inView(t, view) && matches(t, query))
  const archivedHere = sortTopics(
    archived.filter((t) => (view.kind === 'archived' || view.kind === 'all' || inView(t, view)) && matches(t, query)),
    sort,
  )
  const showArchivedRows = view.kind === 'archived' || archivedOpen
  const summaries = useArchivedSummaries(archived, showArchivedRows && archivedHere.length > 0)

  const liveRow = (t: TopicListEntry, hideFolderChip?: boolean) => (
    <TopicCard
      key={t.topic}
      variant="shelf"
      topic={t}
      hideFolderChip={hideFolderChip}
      resumable={resumableTopics.has(t.topic)}
      morphing={morphingTopic === t.topic}
      organizing={organizing}
      dragType={DRAG_TYPE}
      selected={organizing && selected.has(t.topic)}
      onOpen={() => (organizing ? onToggleSelect(t.topic) : a.onOpen(t))}
      leading={
        organizing ? <Checkbox checked={selected.has(t.topic)} label={`Select ${t.title}`} onChange={() => onToggleSelect(t.topic)} /> : undefined
      }
      actions={
        <PopoverMenu
          label={`Actions for ${t.title}`}
          triggerClassName={MORE_TRIGGER}
          trigger={<MoreDots />}
          items={[
            { label: 'Open topic', onSelect: () => a.onOpen(t) },
            { label: 'Open in Topic Map', onSelect: () => a.onOpenMap(t) },
            { kind: 'separator' },
            { label: 'Move to folder', submenu: moveToItems(folders, t.folder ?? null, [t.topic], a) },
            { label: 'Rename…', onSelect: () => a.onRename(t) },
            { label: 'Topic settings…', onSelect: () => a.onSettings(t) },
            { kind: 'separator' },
            ...(resumableTopics.has(t.topic) ? [{ label: 'Start over from scratch', onSelect: () => a.onStartFresh(t) }] : []),
            { label: 'Archive…', onSelect: () => a.onArchive([t]) },
          ]}
        />
      }
    />
  )

  const archivedRow = (t: TopicListEntry) => {
    const s = summaries.get(t.topic)
    const chips = [
      `archived ${formatArchivedDate(t.archivedAt) || 'earlier'}`,
      ...(s?.letter ? [`final grade ${s.letter}`] : []),
      `${t.states.review} of ${t.nodes} consolidated`,
      ...(s && s.setAside > 0 ? [`${s.setAside} misconception${s.setAside === 1 ? '' : 's'} set aside`] : []),
      ...(t.folder?.trim() && view.kind !== 'folder' ? [t.folder.trim()] : []),
    ].map((label) => ({ label, className: 'text-[var(--color-text-faint)] whitespace-nowrap' }))
    return (
      <TopicCard
        key={t.topic}
        variant="shelf"
        topic={t}
        quiet
        chipsOverride={chips}
        onOpen={() => a.onOpenMap(t)}
        actions={
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => a.onRestore(t)}>
              Restore
            </Button>
            <PopoverMenu
              label={`Actions for ${t.title}`}
              triggerClassName={MORE_TRIGGER}
              trigger={<MoreDots />}
              items={[
                { label: 'Open in Topic Map', onSelect: () => a.onOpenMap(t) },
                { label: 'Move to folder', submenu: moveToItems(folders, t.folder ?? null, [t.topic], a) },
                { label: 'Rename…', onSelect: () => a.onRename(t) },
                { label: 'Topic settings…', onSelect: () => a.onSettings(t) },
                { kind: 'separator' },
                { label: 'Restore', onSelect: () => a.onRestore(t) },
              ]}
            />
          </div>
        }
      />
    )
  }

  // ---- the archived view: its own explanation and rows, nothing else.
  if (view.kind === 'archived') {
    return (
      <div className="flex flex-col gap-3">
        <SectionBanner label="Archived" count={archivedHere.length} />
        <p className="text-sm text-[var(--color-text-dim)] leading-relaxed -mt-1">
          Archived topics are finished or parked. They keep their map, grades, sittings and history, but they never come due and
          they stay out of your GPA, Home and Coach numbers. Restoring puts every concept back on its schedule.
        </p>
        {archivedHere.length === 0 && (
          <div className="fig-caption py-2">
            {query ? `No archived topic matches “${query}”.` : 'Nothing archived. Archive a topic from its ⋯ menu when you’re done with it.'}
          </div>
        )}
        <div className="flex flex-col gap-3">{archivedHere.map(archivedRow)}</div>
      </div>
    )
  }

  const byFolder = group === 'folder' && (view.kind === 'all' || view.kind === 'due')
  const sections: { key: string; heading: string; caption?: string; topics: TopicListEntry[]; folder?: string | null }[] = byFolder
    ? groupTopicsByFolder(shown, sort, {
        order: folders,
        alwaysShow: organizing && view.kind === 'all' && !query ? folders : undefined,
        includeEmptyUnfiled: organizing && view.kind === 'all' && !query,
      }).map((g) => ({ key: `f:${g.name}`, heading: g.name, topics: g.topics, folder: g.unfiled ? null : g.name }))
    : [
        { key: 'active', heading: 'Continue learning', topics: sortTopics(shown.filter((t) => topicBucket(t) === 'active'), sort) },
        {
          key: 'consolidated',
          heading: 'Consolidated',
          caption: 'fully encoded — held by review alone',
          topics: sortTopics(shown.filter((t) => topicBucket(t) === 'consolidated'), sort),
        },
        { key: 'notStarted', heading: 'Not started', topics: sortTopics(shown.filter((t) => topicBucket(t) === 'notStarted'), sort) },
      ]

  const empty =
    shown.length === 0
      ? query
        ? `No topic matches “${query}”.`
        : view.kind === 'due'
          ? 'Nothing is due right now.'
          : view.kind === 'folder'
            ? `Nothing filed in ${view.name} yet. Use a topic’s ⋯ menu → Move to folder, or drag topics here in Organize.`
            : view.kind === 'unfiled'
              ? 'Every topic is filed in a folder.'
              : live.length === 0 && archived.length > 0
                ? 'Every topic is archived. Restore one, or start a new topic.'
                : null
      : null

  return (
    <div className="flex flex-col gap-6">
      {view.kind === 'all' && !organizing && !query && hero}
      {empty && <div className="fig-caption py-2">{empty}</div>}
      {sections.map((sec) =>
        sec.topics.length === 0 && !(byFolder && organizing) ? null : (
          <FolderDrop
            key={sec.key}
            enabled={byFolder && organizing}
            onDrop={(id) => onDropTopic(id, sec.folder ?? null)}
          >
            <SectionBanner label={sec.heading} count={sec.topics.length} />
            {sec.caption && <span className="text-xs text-[var(--color-text-faint)] -mt-1">{sec.caption}</span>}
            {sec.topics.length === 0 && <div className="fig-caption py-3">Empty — drop a topic here.</div>}
            <div className="flex flex-col gap-3">{sec.topics.map((t) => liveRow(t, byFolder))}</div>
          </FolderDrop>
        ),
      )}
      {archivedHere.length > 0 && !organizing && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-expanded={archivedOpen}
            onClick={() => setArchivedOpen((v) => !v)}
            className="focus-ring flex items-center gap-4 px-4 py-3 border border-dashed border-[var(--color-hairline)] text-left text-[13px] text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
          >
            <span className="label-data text-[10.5px] uppercase tracking-[0.12em] text-[var(--color-text-faint)] shrink-0">
              Archived · {archivedHere.length}
            </span>
            <span className="truncate min-w-0">{archivedHere.map((t) => t.title).join(', ')}</span>
            <span className="ml-auto shrink-0 text-[var(--color-text-faint)] hidden lg:inline">kept as history · out of live stats</span>
            <span className="shrink-0 text-[var(--color-text-primary)]">{archivedOpen ? 'Hide ▴' : 'Show ▾'}</span>
          </button>
          {archivedOpen && <div className="flex flex-col gap-3">{archivedHere.map(archivedRow)}</div>}
        </div>
      )}
      {!organizing && footer}
    </div>
  )
}

function FolderDrop({ enabled, onDrop, children }: { enabled: boolean; onDrop: (topicId: string) => void; children: ReactNode }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={
        enabled
          ? (e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setOver(true)
            }
          : undefined
      }
      onDragLeave={enabled ? () => setOver(false) : undefined}
      onDrop={
        enabled
          ? (e) => {
              e.preventDefault()
              setOver(false)
              const id = e.dataTransfer.getData(DRAG_TYPE)
              if (id) onDrop(id)
            }
          : undefined
      }
      className={`flex flex-col gap-2${over ? ' outline outline-1 outline-dashed outline-offset-4 outline-[var(--color-ink-warm)]' : ''}`}
    >
      {children}
    </div>
  )
}

// ----------------------------------------------------------------- bulk bar

export function BulkBar({
  count,
  folders,
  onMove,
  onNewFolder,
  onArchive,
  onClear,
}: {
  count: number
  folders: string[]
  onMove: (folder: string | null) => void
  onNewFolder: () => void
  onArchive: () => void
  onClear: () => void
}) {
  if (count === 0) return null
  return (
    <div
      role="toolbar"
      aria-label="Selected topics"
      className="panel-raised fixed left-1/2 -translate-x-1/2 bottom-6 z-40 flex items-center gap-3 px-3.5 py-2.5 text-[13px] text-[var(--color-text-primary)] shadow-[0_10px_30px_rgba(40,30,20,0.2)]"
    >
      <span className="font-medium">{count} selected</span>
      <span className="w-px h-5 bg-[var(--color-hairline)]" />
      <PopoverMenu
        label="Move selected to folder"
        align="left"
        triggerClassName="rounded-lg border border-[var(--color-edge)] px-3 py-1.5 text-sm text-[var(--color-text-dim)] hover:text-[var(--color-text-primary)]"
        trigger={<>Move to… ▾</>}
        items={[
          { kind: 'caption', label: 'File under' },
          ...folders.map((f) => ({ label: f, onSelect: () => onMove(f) })),
          { label: UNFILED, quiet: true, onSelect: () => onMove(null) },
          { kind: 'separator' },
          { label: 'New folder…', quiet: true, onSelect: onNewFolder },
        ]}
      />
      <Button variant="ghost" onClick={onArchive}>
        Archive…
      </Button>
      <Button variant="ghost" onClick={onClear} className="border-transparent">
        Clear
      </Button>
    </div>
  )
}
