import { useEffect, useState } from 'react'
import type { UpdateCheckResult } from '../../../shared/types'

const CHECK_INTERVAL_MS = 6 * 60 * 60_000 // every 6h — this is a manifest fetch, not disruptive to poll

/** Check-and-notify, deliberately not silent/automatic — see updateChecker.ts for
 * why a fully seamless auto-update isn't reliable for this unsigned build. Just
 * a quiet banner with a manual download link when a newer version exists. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    function check() {
      window.engram.checkForUpdate().then((r) => {
        if (r.available) setUpdate(r)
      })
    }
    check()
    const id = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  if (!update?.available || dismissed) return null

  return (
    <div className="shrink-0 panel border-[var(--color-ink-cool-dim)] px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
      <span className="text-[var(--color-text-dim)]">
        Engram Desktop {update.latestVersion} is available.
      </span>
      <div className="flex items-center gap-3 shrink-0">
        <a
          href={update.downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="focus-ring text-[var(--color-ink-cool)] hover:underline"
        >
          Download
        </a>
        <button
          onClick={() => setDismissed(true)}
          className="focus-ring text-[var(--color-text-faint)] hover:text-[var(--color-text-dim)]"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
