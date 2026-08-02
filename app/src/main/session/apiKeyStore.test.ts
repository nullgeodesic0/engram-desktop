import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApiKeyStore, type ApiKeyStoreDeps } from './apiKeyStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apikeystore-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Reversible fake "encryption" (prefix + base64) — the tests exercise the
 * store's file/lifecycle logic, not cryptography. */
function deps(overrides: Partial<ApiKeyStoreDeps> = {}): ApiKeyStoreDeps {
  return {
    filePath: join(dir, 'nested', 'auth-api-key.enc'),
    encrypt: (s) => Buffer.from('enc:' + Buffer.from(s).toString('base64')),
    decrypt: (b) => {
      const raw = b.toString()
      if (!raw.startsWith('enc:')) throw new Error('bad ciphertext')
      return Buffer.from(raw.slice(4), 'base64').toString()
    },
    encryptionAvailable: () => true,
    ...overrides,
  }
}

describe('createApiKeyStore', () => {
  it('round-trips a key and reports presence with the last four characters only', () => {
    const store = createApiKeyStore(deps())
    store.set('sk-ant-api-0123abcd')
    expect(store.get()).toBe('sk-ant-api-0123abcd')
    expect(store.status()).toEqual({ present: true, last4: 'abcd' })
  })

  it('reports absent before any key is stored, and after removal', () => {
    const store = createApiKeyStore(deps())
    expect(store.get()).toBeNull()
    expect(store.status()).toEqual({ present: false, last4: null })
    store.set('sk-key')
    store.set(null)
    expect(store.get()).toBeNull()
    expect(store.status()).toEqual({ present: false, last4: null })
  })

  it('removing when nothing is stored is a no-op, not an error', () => {
    expect(() => createApiKeyStore(deps()).set(null)).not.toThrow()
  })

  it('refuses to store when encryption is unavailable — never a plaintext fallback', () => {
    const store = createApiKeyStore(deps({ encryptionAvailable: () => false }))
    expect(() => store.set('sk-key')).toThrow('Secure key storage is unavailable')
    expect(store.get()).toBeNull()
  })

  it('treats an undecryptable file as absent rather than throwing', () => {
    const d = deps()
    const store = createApiKeyStore(d)
    store.set('sk-key')
    writeFileSync(d.filePath, Buffer.from('garbage-from-another-machine'))
    expect(store.get()).toBeNull()
    expect(store.status()).toEqual({ present: false, last4: null })
  })

  it('never writes the key in plaintext', () => {
    const d = deps()
    createApiKeyStore(d).set('sk-super-secret')
    const onDisk = readFileSyncSafe(d.filePath)
    expect(onDisk).not.toContain('sk-super-secret')
  })
})

function readFileSyncSafe(p: string): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  return readFileSync(p).toString()
}
