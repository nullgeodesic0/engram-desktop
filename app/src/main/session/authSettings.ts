/** Persists the auth mode (dual-mode auth) in its own userData JSON —
 * same tiny read-merge-write pattern as `notifierState.ts`. The API key
 * itself never lives here: it's encrypted in `apiKeyStore.ts`'s own file. */

import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import type { AuthMode, AuthSettings } from '../../shared/types'

const DEFAULTS: AuthSettings = { authMode: 'subscription' }

function statePath(): string {
  return join(app.getPath('userData'), 'auth-settings.json')
}

export async function getAuthSettings(): Promise<AuthSettings> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf-8')) as Partial<AuthSettings>
    return parsed.authMode === 'apiKey' ? { authMode: 'apiKey' } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function setAuthMode(mode: AuthMode): Promise<AuthSettings> {
  const next: AuthSettings = { authMode: mode }
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(statePath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
