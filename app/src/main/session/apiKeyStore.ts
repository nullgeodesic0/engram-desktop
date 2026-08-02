/** Encrypted at-rest storage for the Anthropic API key (dual-mode auth).
 *
 * The key deliberately does NOT live in settings.json: that file is plain
 * JSON a user might back up, share in a bug report, or sync. Instead the key
 * is encrypted with Electron's `safeStorage` (macOS Keychain-backed) and
 * written to its own file in userData. The composition root (`index.ts`)
 * injects the real safeStorage functions; tests inject fakes — same DI
 * discipline as every other side-effecting module here.
 *
 * Renderer contract: the full key NEVER crosses the IPC boundary outward.
 * `status()` exposes presence plus the last four characters for the
 * Settings UI's "key stored · ····abcd" readout, nothing more. */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ApiKeyStatus } from '../../shared/types'

export type { ApiKeyStatus }

export interface ApiKeyStoreDeps {
  /** Absolute path of the encrypted key file (e.g. userData/auth-api-key.enc). */
  filePath: string
  encrypt(plaintext: string): Buffer
  decrypt(ciphertext: Buffer): string
  /** Electron: `safeStorage.isEncryptionAvailable()`. When false, storing is
   * refused outright — this module never writes a plaintext fallback. */
  encryptionAvailable(): boolean
}

export interface ApiKeyStore {
  /** Stores (or with null, removes) the key. Throws with a user-facing
   * message when encryption is unavailable — the IPC handler surfaces it. */
  set(key: string | null): void
  /** The decrypted key, or null if absent or undecryptable (e.g. the file
   * was copied to another machine — safeStorage keys are per-user). */
  get(): string | null
  status(): ApiKeyStatus
}

export function createApiKeyStore(deps: ApiKeyStoreDeps): ApiKeyStore {
  function readCiphertext(): Buffer | null {
    try {
      return readFileSync(deps.filePath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  function get(): string | null {
    const ciphertext = readCiphertext()
    if (ciphertext === null) return null
    try {
      const key = deps.decrypt(ciphertext)
      return key.trim() === '' ? null : key
    } catch {
      // Undecryptable (different machine/user, corrupted file): treated as
      // absent rather than fatal — apiKey-mode jobs then fail with the
      // store-a-key message, which is the actionable truth.
      return null
    }
  }

  return {
    set(key: string | null): void {
      if (key === null) {
        try {
          unlinkSync(deps.filePath)
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        }
        return
      }
      if (!deps.encryptionAvailable()) {
        throw new Error('Secure key storage is unavailable on this system — the API key was not saved.')
      }
      mkdirSync(dirname(deps.filePath), { recursive: true })
      writeFileSync(deps.filePath, deps.encrypt(key))
    },
    get,
    status(): ApiKeyStatus {
      const key = get()
      if (key === null) return { present: false, last4: null }
      return { present: true, last4: key.slice(-4) }
    },
  }
}
