/** Composition point for dual-mode auth: the safeStorage-backed key store
 * singleton (lazy — `app.getPath` wants the app name settled first) and the
 * IPC input guard. Mode persistence is `authSettings.ts`; the env itself is
 * built in `sessionEnv.ts`. */

import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { createApiKeyStore, type ApiKeyStore } from './apiKeyStore'

let instance: ApiKeyStore | null = null

export function apiKeyStore(): ApiKeyStore {
  if (instance === null) {
    instance = createApiKeyStore({
      filePath: join(app.getPath('userData'), 'auth-api-key.enc'),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b),
      encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    })
  }
  return instance
}

/** A plausible Anthropic API key: printable ASCII, no whitespace/control
 * characters, bounded length. Deliberately not format-pinned to `sk-ant-`
 * — key formats change; the real validation is the first API call. */
export function isPlausibleApiKey(x: unknown): x is string {
  return typeof x === 'string' && x.length >= 8 && x.length <= 256 && /^[\x21-\x7e]+$/.test(x)
}
