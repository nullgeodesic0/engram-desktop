/** Persists the auth mode (dual-mode auth) in its own userData JSON —
 * same tiny read-merge-write pattern as `notifierState.ts`. The API key
 * itself never lives here: it's encrypted in `apiKeyStore.ts`'s own file. */

import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import type { AuthMode, AuthSettings } from '../../shared/types'
import { DEFAULT_LOCAL_BASE_URL } from './localModel'

const DEFAULTS: AuthSettings = { authMode: 'subscription', localBaseUrl: DEFAULT_LOCAL_BASE_URL, localModel: '' }

const MODES: AuthMode[] = ['subscription', 'apiKey', 'local']

function statePath(): string {
  return join(app.getPath('userData'), 'auth-settings.json')
}

export async function getAuthSettings(): Promise<AuthSettings> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf-8')) as Partial<AuthSettings>
    return {
      // An unknown mode from a hand-edited or future-version file falls back
      // to subscription rather than throwing: the safe mode is the one that
      // bills the way the user already expects.
      authMode: MODES.includes(parsed.authMode as AuthMode) ? (parsed.authMode as AuthMode) : DEFAULTS.authMode,
      localBaseUrl: typeof parsed.localBaseUrl === 'string' && parsed.localBaseUrl.trim() !== '' ? parsed.localBaseUrl : DEFAULTS.localBaseUrl,
      localModel: typeof parsed.localModel === 'string' ? parsed.localModel : DEFAULTS.localModel,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

/** Read-merge-write, so setting the mode never clears the local-model
 * fields (and vice versa) — the picker writes them independently. */
async function persist(next: AuthSettings): Promise<AuthSettings> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(statePath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export async function setAuthMode(mode: AuthMode): Promise<AuthSettings> {
  return persist({ ...(await getAuthSettings()), authMode: mode })
}

export async function setLocalModelSettings(baseUrl: string, model: string): Promise<AuthSettings> {
  const current = await getAuthSettings()
  return persist({
    ...current,
    localBaseUrl: baseUrl.trim() === '' ? DEFAULTS.localBaseUrl : baseUrl.trim(),
    localModel: model.trim(),
  })
}
