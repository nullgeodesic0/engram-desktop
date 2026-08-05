import { useState } from 'react'
import type { TopicListEntry } from '../../../shared/types'
import { TopicCard } from './TopicCard'
import { SectionBanner } from './ui/SectionBanner'
import { IconButton } from './ui/IconButton'
import { UNFILED, type FolderGroup } from '../shared/topicFolders'

/** The MIME-ish key the drag carries. A custom type (not text/plain) so a
 * topic dragged out of this app lands as nothing, and so a stray text drag
 * from elsewhere can never be mistaken for a topic. */
const DRAG_TYPE = 'application/x-engram-topic'

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M2.5 3.5h8M5 3.5V2.5h3v1M3.5 3.5l.5 7h5l.5-7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * One folder's row of topics, and — while organizing — a drop target.
 *
 * The drop target is the whole group, header and body together, rather than
 * just the heading: a folder with six topics in it has a heading a few
 * pixels tall and a body a few hundred, and aiming for the label is the kind
 * of precision a drag shouldn't demand.
 */
function FolderGroupView({
  group,
  organizing,
  resumableTopics,
  allFolders,
  onOpen,
  onSettings,
  onStartFresh,
  onFile,
  onDeleteFolder,
}: {
  group: FolderGroup
  organizing: boolean
  resumableTopics: Set<string>
  allFolders: string[]
  onOpen: (t: TopicListEntry) => void
  onSettings: (t: TopicListEntry) => void
  onStartFresh: (t: TopicListEntry) => void
  onFile: (topicId: string, folder: string | null) => void
  onDeleteFolder: (name: string) => void
}) {
  const [over, setOver] = useState(false)
  // The folder this group files into — null for Unfiled, which is how a
  // topic gets back OUT of a folder.
  const target = group.unfiled ? null : group.name

  return (
    <div
      onDragOver={
        organizing
          ? (e) => {
              // Only claim drags that actually carry a topic — preventDefault
              // is what marks this element as a valid drop target at all.
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setOver(true)
            }
          : undefined
      }
      onDragLeave={organizing ? () => setOver(false) : undefined}
      onDrop={
        organizing
          ? (e) => {
              e.preventDefault()
              setOver(false)
              const id = e.dataTransfer.getData(DRAG_TYPE)
              if (id) onFile(id, target)
            }
          : undefined
      }
      className={`flex flex-col gap-2 transition-colors duration-[var(--dur-fast)] ${
        organizing ? 'px-3 -mx-3 py-2 -my-2 border border-dashed' : ''
      } ${
        over
          ? 'border-[var(--color-ink-warm)] bg-[color-mix(in_srgb,var(--color-ink-warm)_8%,transparent)]'
          : organizing
            ? 'border-[var(--color-hairline)]'
            : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <SectionBanner label={group.name} count={group.topics.length} />
        </div>
        {/* Only an EMPTY folder offers deletion, and only while organizing:
            a folder with topics in it isn't deleted, it's emptied — which
            the drag itself does, one topic at a time, visibly. */}
        {organizing && !group.unfiled && group.topics.length === 0 && (
          <IconButton
            onClick={() => onDeleteFolder(group.name)}
            title={`Remove the empty folder "${group.name}"`}
            aria-label={`Remove the empty folder ${group.name}`}
          >
            <TrashIcon />
          </IconButton>
        )}
      </div>
      {group.unfiled && group.topics.length > 0 && (
        <span className="text-xs text-[var(--color-text-faint)]">not filed in a folder yet</span>
      )}
      {group.topics.length === 0 ? (
        <div className="text-xs text-[var(--color-text-faint)] italic py-2">
          {group.unfiled ? 'everything is filed — drop a topic here to unfile it' : 'empty — drop a topic here'}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {group.topics.map((t) => (
            <TopicCard
              key={t.topic}
              variant="shelf"
              topic={t}
              hideFolderChip
              resumable={resumableTopics.has(t.topic)}
              onOpen={() => onOpen(t)}
              onSettings={() => onSettings(t)}
              onStartFresh={() => onStartFresh(t)}
              organizing={organizing}
              dragType={DRAG_TYPE}
              folderOptions={allFolders}
              currentFolder={target}
              onFile={(folder) => onFile(t.topic, folder)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** The whole folder-grouped shelf: every group, plus the organize-mode drop
 * behavior. Kept out of LearnSessionView so the shelf's own render stays a
 * list of groups rather than a list of groups plus a drag state machine. */
export function FolderShelf({
  groups,
  organizing,
  resumableTopics,
  allFolders,
  onOpen,
  onSettings,
  onStartFresh,
  onFile,
  onDeleteFolder,
}: {
  groups: FolderGroup[]
  organizing: boolean
  resumableTopics: Set<string>
  allFolders: string[]
  onOpen: (t: TopicListEntry) => void
  onSettings: (t: TopicListEntry) => void
  onStartFresh: (t: TopicListEntry) => void
  onFile: (topicId: string, folder: string | null) => void
  onDeleteFolder: (name: string) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <FolderGroupView
          key={g.unfiled ? UNFILED : g.name}
          group={g}
          organizing={organizing}
          resumableTopics={resumableTopics}
          allFolders={allFolders}
          onOpen={onOpen}
          onSettings={onSettings}
          onStartFresh={onStartFresh}
          onFile={onFile}
          onDeleteFolder={onDeleteFolder}
        />
      ))}
    </div>
  )
}

export { DRAG_TYPE }
