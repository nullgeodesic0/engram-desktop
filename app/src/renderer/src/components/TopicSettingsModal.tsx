import { useEffect, useState } from 'react'
import { Modal } from './ui/Modal'
import { folderNames, normalizeFolderName } from '../shared/topicFolders'

interface TopicSettingsModalProps {
  topicId: string
  topicTitle: string
  onClose: () => void
}

const EXAMPLE = 'Use LaTeX ($...$ for inline, $$...$$ for display) for every equation and mathematical expression.'

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

export function TopicSettingsModal({ topicId, topicTitle, onClose }: TopicSettingsModalProps) {
  const [value, setValue] = useState('')
  const [contextFiles, setContextFiles] = useState<string[]>([])
  const [targetDate, setTargetDate] = useState<string | null>(null)
  const [displayTitle, setDisplayTitle] = useState('')
  const [folder, setFolder] = useState('')
  // Folders already in use — the datalist behind the folder input. Derived
  // from the same topics() read below (every entry carries its filing, via
  // getTopicsCached's overlay), so filing needs no store of its own.
  const [knownFolders, setKnownFolders] = useState<string[]>([])
  // The engine's own generated title, for the rename field's reference line —
  // `topicTitle` (the prop) may already BE a rename, so it can't serve as
  // "what the engine calls this". getTopicsCached preserves the original as
  // `engineTitle` whenever a rename is active.
  const [engineTitle, setEngineTitle] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  // ── Close-out state ──────────────────────────────────────────────────────
  // Archive rides the engine's own reversible `retire --topic` (see the
  // D1-pinned mutation door); Delete is topicTrash.ts's custody transfer
  // (D2.trashGate). `counts` drives which face the section shows.
  const [counts, setCounts] = useState<{ nodes: number; retired: number } | null>(null)
  const [archiveArmed, setArchiveArmed] = useState(false)
  const [deleteSlug, setDeleteSlug] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [closingOut, setClosingOut] = useState(false)
  const [closeOutError, setCloseOutError] = useState<string | null>(null)

  useEffect(() => {
    window.engram.getTopicSettings(topicId).then((s) => {
      setValue(s.systemPromptExtra)
      setContextFiles(s.contextFiles)
      setTargetDate(s.targetDate ?? null)
      setDisplayTitle(s.displayTitle ?? '')
      setFolder(s.folder ?? '')
      setLoaded(true)
    })
    window.engram.topics().then((list) => {
      setKnownFolders(folderNames(list))
      const entry = list.find((t) => t.topic === topicId)
      if (entry) {
        setEngineTitle(entry.engineTitle ?? entry.title)
        setCounts({ nodes: entry.nodes, retired: entry.retired ?? 0 })
      }
    })
  }, [topicId])

  const fullyArchived = counts !== null && counts.nodes > 0 && counts.retired >= counts.nodes

  async function archiveOrRestore(restore: boolean) {
    setClosingOut(true)
    setCloseOutError(null)
    try {
      await window.engram.retireTopic(topicId, restore)
      const list = await window.engram.topics()
      const entry = list.find((t) => t.topic === topicId)
      if (entry) setCounts({ nodes: entry.nodes, retired: entry.retired ?? 0 })
      setArchiveArmed(false)
    } catch (err) {
      setCloseOutError(err instanceof Error ? err.message : String(err))
    } finally {
      setClosingOut(false)
    }
  }

  async function deleteTopic() {
    setClosingOut(true)
    setCloseOutError(null)
    try {
      await window.engram.deleteTopic(topicId)
      // The topic no longer exists — the modal has nothing left to edit.
      // onClose triggers the caller's topics refetch, which drops the shelf row.
      onClose()
    } catch (err) {
      setCloseOutError(err instanceof Error ? err.message : String(err))
      setClosingOut(false)
    }
  }

  async function addFiles() {
    const picked = await window.engram.pickFiles()
    setContextFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))])
  }

  function removeFile(path: string) {
    setContextFiles((prev) => prev.filter((p) => p !== path))
  }

  async function save() {
    setSaving(true)
    await window.engram.setTopicSettings(topicId, {
      systemPromptExtra: value.trim(),
      contextFiles,
      targetDate,
      displayTitle: displayTitle.trim() || null,
      folder: normalizeFolderName(folder),
    })
    setSaving(false)
    onClose()
  }

  return (
    // Scrim/escape dismissal is a deliberate no-op — an accidental click or
    // Escape must not discard in-progress instructions/context edits; use
    // the explicit Cancel/Save buttons in the footer instead.
    <Modal
      open
      onClose={() => {}}
      title="Topic settings"
      subtitle={topicTitle}
      wide
      footer={
        <>
          <div className="flex gap-2">
            <button onClick={onClose} className="focus-ring text-xs text-[var(--color-text-faint)] px-3 py-1.5">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving || !loaded}
              className="focus-ring text-xs text-[var(--color-ink-warm)] px-3 py-1.5 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      }
    >
      <div
        className="flex flex-col gap-4"
        // The footer's "↵ save" kbd-hint chip promised this and nothing
        // implemented it — a bordered key-cap that LOOKS like a second Save
        // button but did nothing when clicked or pressed (reported live as
        // "two save buttons, only one clickable"). Enter now genuinely
        // saves from any single-line field; inside the textarea plain Enter
        // must keep inserting newlines, so ⌘/Ctrl+Enter saves from there.
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || saving || !loaded) return
          const inTextarea = (e.target as HTMLElement).tagName === 'TEXTAREA'
          if (inTextarea && !(e.metaKey || e.ctrlKey)) return
          e.preventDefault()
          void save()
        }}
      >
        <div className="flex flex-col gap-2">
          <label className="text-sm text-[var(--color-text-primary)]">Display name</label>
          <p className="text-xs text-[var(--color-text-faint)]">
            Shown across the app in place of the engine’s generated title. Display only — the engine’s own records
            never change. Leave empty to use the engine’s title.
          </p>
          <input
            type="text"
            value={displayTitle}
            onChange={(e) => setDisplayTitle(e.target.value)}
            disabled={!loaded}
            placeholder={engineTitle ?? topicTitle}
            className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] disabled:opacity-50"
          />
          {engineTitle && displayTitle.trim() && (
            <div className="label-data text-[10px] text-[var(--color-text-faint)] truncate" title={engineTitle}>
              engine’s title: {engineTitle}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="topic-folder" className="text-sm text-[var(--color-text-primary)]">
            Folder
          </label>
          <p className="text-xs text-[var(--color-text-faint)]">
            Groups this topic with others across Learn and the Topic Map. Display only — nothing moves on disk and the
            engine never sees it. Type a new name or pick one you already use; leave empty to keep it unfiled.
          </p>
          {/* A datalist, not a select: filing into an EXISTING folder should
              be one pick (retyping is how near-duplicate folders appear),
              but a new folder must not need a separate "create folder" step
              first — the folder set is exactly the names in use. */}
          <input
            id="topic-folder"
            type="text"
            list="topic-folder-options"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            disabled={!loaded}
            placeholder="Unfiled"
            className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] disabled:opacity-50"
          />
          <datalist id="topic-folder-options">
            {knownFolders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-[var(--color-text-primary)]">Extra instructions for this topic</label>
          <p className="text-xs text-[var(--color-text-faint)]">
            Appended to the tutor’s system prompt every time you learn or review this topic. Example: “{EXAMPLE}”
          </p>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!loaded}
            rows={5}
            placeholder={EXAMPLE}
            className="focus-ring panel px-3 py-2 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] resize-none disabled:opacity-50"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-[var(--color-text-primary)]">Initial context files</label>
          <p className="text-xs text-[var(--color-text-faint)]">
            Read by the tutor at the start of every fresh session for this topic (a syllabus, exam PDF, reference notes…).
          </p>
          {contextFiles.length > 0 && (
            <div className="flex flex-col gap-1">
              {contextFiles.map((path) => (
                <div key={path} className="flex items-center justify-between gap-2 panel px-3 py-1.5 text-xs">
                  <span className="text-[var(--color-text-primary)] truncate" title={path}>
                    {fileName(path)}
                  </span>
                  <button
                    onClick={() => removeFile(path)}
                    className="focus-ring shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-ink-danger)]"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={addFiles}
            disabled={!loaded}
            className="focus-ring self-start text-xs text-[var(--color-ink-warm)] hover:underline disabled:opacity-40"
          >
            + Add file…
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm text-[var(--color-text-primary)]">Target date</label>
          <p className="text-xs text-[var(--color-text-faint)]">
            An optional deadline for this topic. While set, the Topic Map shows nodes remaining, days left, the pace
            that would close the gap, and the pace you've actually kept — arithmetic only, never a reminder or a
            notification. Clearing it removes the figure.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={targetDate ?? ''}
              onChange={(e) => setTargetDate(e.target.value || null)}
              disabled={!loaded}
              aria-label="Target date"
              className="focus-ring panel px-3 py-1.5 text-sm bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)] disabled:opacity-50"
            />
            {targetDate && (
              <button
                onClick={() => setTargetDate(null)}
                className="focus-ring text-xs text-[var(--color-text-faint)] hover:text-[var(--color-ink-danger)]"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* ── Close out ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 border-t border-[var(--color-hairline)] pt-4">
          <label className="text-sm text-[var(--color-text-primary)]">Close out this topic</label>

          {/* Archive — the engine's own reversible retire verb. */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-[var(--color-text-faint)]">
              {fullyArchived
                ? 'Archived — every node is retired: no reviews come due and the frontier is closed, but the map, grades, and history all stay browsable. Restoring puts the nodes back on their schedules.'
                : 'Archive stops the loop without erasing anything: every node retires, reviews stop coming due, and the topic quiets — map, grades, and history stay browsable. Reversible any time.'}
            </p>
            {fullyArchived ? (
              <button
                onClick={() => archiveOrRestore(true)}
                disabled={closingOut}
                className="focus-ring self-start text-xs text-[var(--color-ink-warm)] px-3 py-1.5 border border-[var(--color-ink-warm-dim)] disabled:opacity-40"
              >
                {closingOut ? 'Working…' : 'Restore topic'}
              </button>
            ) : archiveArmed ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => archiveOrRestore(false)}
                  disabled={closingOut}
                  className="focus-ring text-xs text-[var(--color-ink-warm)] px-3 py-1.5 border border-[var(--color-ink-warm-dim)] bg-[color-mix(in_srgb,var(--color-ink-warm)_16%,transparent)] disabled:opacity-40"
                >
                  {closingOut ? 'Working…' : `Confirm — retire all ${counts?.nodes ?? ''} nodes`}
                </button>
                <button
                  onClick={() => setArchiveArmed(false)}
                  disabled={closingOut}
                  className="focus-ring text-xs text-[var(--color-text-faint)] px-2 py-1.5"
                >
                  Keep it live
                </button>
              </div>
            ) : (
              <button
                onClick={() => setArchiveArmed(true)}
                disabled={closingOut || counts === null}
                className="focus-ring self-start text-xs text-[var(--color-text-dim)] hover:text-[var(--color-ink-warm)] px-3 py-1.5 border border-[var(--color-hairline)] disabled:opacity-40"
              >
                Archive topic…
              </button>
            )}
          </div>

          {/* Delete — custody transfer out of the learning home. */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-[var(--color-text-faint)]">
              Delete removes the topic from the app entirely — graph and receipts move out of the engine’s files into
              this app’s local storage (recoverable by hand, never destroyed). Refused while a session is live.
            </p>
            {!deleteOpen ? (
              <button
                onClick={() => setDeleteOpen(true)}
                disabled={closingOut}
                className="focus-ring self-start text-xs text-[var(--color-text-dim)] hover:text-[var(--color-ink-danger)] px-3 py-1.5 border border-[var(--color-hairline)] disabled:opacity-40"
              >
                Delete topic…
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-[var(--color-ink-danger)]">
                  Type the topic’s id — <span className="label-data">{topicId}</span> — to confirm.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={deleteSlug}
                    onChange={(e) => setDeleteSlug(e.target.value)}
                    placeholder={topicId}
                    aria-label="Type the topic id to confirm deletion"
                    className="focus-ring panel px-3 py-1.5 text-xs bg-[color-mix(in_srgb,var(--color-surface-2)_68%,transparent)] text-[var(--color-text-primary)]"
                  />
                  <button
                    onClick={deleteTopic}
                    disabled={closingOut || deleteSlug !== topicId}
                    className="focus-ring text-xs text-[var(--color-ink-danger)] px-3 py-1.5 border border-[var(--color-ink-danger-dim)] disabled:opacity-40"
                  >
                    {closingOut ? 'Working…' : 'Delete'}
                  </button>
                  <button
                    onClick={() => {
                      setDeleteOpen(false)
                      setDeleteSlug('')
                    }}
                    disabled={closingOut}
                    className="focus-ring text-xs text-[var(--color-text-faint)] px-2 py-1.5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {closeOutError && <p className="text-xs text-[var(--color-ink-danger)]">{closeOutError}</p>}
        </div>
      </div>
    </Modal>
  )
}
