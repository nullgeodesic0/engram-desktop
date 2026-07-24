import { app } from 'electron'

// TODO: point this at wherever built .dmg/.zip releases actually get hosted —
// GitHub Releases is the natural default, but this project has no git remote
// configured yet. Until then this URL 404s/fails silently and the checker is a
// harmless no-op (see checkForUpdate's catch below) rather than an error state.
const MANIFEST_URL = 'https://example.invalid/engram-desktop/latest.json'

interface UpdateManifest {
  version: string
  downloadUrl: string
  notes?: string
}

export interface UpdateCheckResult {
  available: boolean
  latestVersion?: string
  downloadUrl?: string
}

function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

/**
 * Deliberately NOT a silent auto-installer — this is an unsigned build (no
 * Apple Developer ID), and Squirrel.Mac-style silent updates are unreliable
 * under Gatekeeper without code signing. Instead: fetch a small JSON manifest,
 * compare versions, and if newer, hand back a download link for the user to
 * grab manually (same right-click-Open flow as the initial install, documented
 * in README.md).
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { available: false }
    const manifest = (await res.json()) as UpdateManifest
    const current = app.getVersion()
    if (isNewer(manifest.version, current)) {
      return { available: true, latestVersion: manifest.version, downloadUrl: manifest.downloadUrl }
    }
    return { available: false }
  } catch {
    return { available: false } // offline, manifest not hosted yet, malformed JSON — all non-fatal
  }
}
