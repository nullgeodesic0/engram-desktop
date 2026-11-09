import { useEffect, useState } from 'react'
import type { PackSummary } from '../../../shared/labs'
import { Button } from './ui/Button'
import { SectionBanner } from './ui/SectionBanner'

/**
 * Settings → Content packs: the folders of labs the learner has added. The
 * app reads a pack where it sits and never changes it; removing one forgets
 * the folder and keeps the learner's work. See docs/content-packs.md.
 */

function cleanError(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
}

export function ContentPacksSection() {
  const [packs, setPacks] = useState<PackSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  useEffect(() => {
    void window.engram.packsList(true).then(setPacks)
    return window.engram.onPacksChanged(setPacks)
  }, [])

  async function add() {
    setError(null)
    try {
      const next = await window.engram.packsAdd()
      if (next) setPacks(next)
    } catch (e) {
      setError(cleanError(e))
    }
  }

  async function remove(folder: string) {
    setConfirm(null)
    setError(null)
    try {
      setPacks(await window.engram.packsRemove(folder))
    } catch (e) {
      setError(cleanError(e))
    }
  }

  if (!packs) return null

  return (
    <div className="panel px-5 py-5 flex flex-col gap-4" id="settings-content-packs">
      <div>
        <SectionBanner label="Content packs" className="border-t-0" />
        <div className="text-xs text-[var(--color-text-faint)] mt-1.5">
          A content pack is a folder of labs, each with milestones, visible smoke checks and hidden tests, and sometimes
          a runtime layer of its own. Add the folder here and its labs appear in Labs. The app reads the pack where it
          sits and never changes it.
        </div>
      </div>

      {packs.length === 0 && <div className="text-sm text-[var(--color-text-dim)]">No packs added yet.</div>}

      {packs.map((p) => (
        <div key={p.folder} className="flex items-start gap-3 border-t border-[var(--color-hairline)] pt-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[var(--color-text-primary)]">
              {p.title}
              {p.version && <span className="label-data text-xs text-[var(--color-text-faint)]"> · v{p.version}</span>}
            </div>
            {p.description && <div className="text-xs text-[var(--color-text-dim)] mt-0.5">{p.description}</div>}
            <div className="label-data text-xs text-[var(--color-text-faint)] mt-1">
              {p.labs.length} {p.labs.length === 1 ? 'lab' : 'labs'} · runs on {p.layer}
            </div>
            <div className="label-data text-xs text-[var(--color-text-faint)] mt-0.5 break-all">{p.folder}</div>
            {p.error && <div className="text-xs text-[var(--color-ink-danger)] mt-1 break-words">{p.error}</div>}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {confirm === p.folder ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-text-dim)]">Forget this pack? Your work in it is kept.</span>
                <Button size="sm" variant="danger" onClick={() => void remove(p.folder)}>
                  Remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => void window.engram.packsReveal(p.folder)}>
                  Folder
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(p.folder)}>
                  Remove
                </Button>
              </div>
            )}
          </div>
        </div>
      ))}

      {error && <div className="text-xs text-[var(--color-text-dim)] break-words">{error}</div>}

      <div>
        <Button onClick={() => void add()}>Add a pack folder…</Button>
      </div>
    </div>
  )
}
