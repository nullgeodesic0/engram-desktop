import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createPairingStore } from './pairing'

/**
 * Pairing is the only thing standing between a LAN and a learner's session.
 * These tests pin the properties that matter if the Mac is ever on a network
 * shared with someone else: a pairing window that closes, codes that cannot be
 * reused, tokens that are not readable off disk, and revocation that bites.
 */

let dir: string
let file: string
let now: number

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pairing-'))
  file = join(dir, 'nested', 'paired-devices.json')
  now = Date.parse('2026-08-09T18:00:00.000Z')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function store() {
  return createPairingStore({ filePath: file, now: () => now })
}

describe('createPairingStore', () => {
  test('issues a token that then verifies', async () => {
    const s = store()
    const offer = await s.beginPairing()

    const paired = await s.completePairing(offer.code, 'Tyler’s iPhone')

    expect(paired).not.toBeNull()
    expect(await s.verifyToken(paired!.token)).toMatchObject({ deviceName: 'Tyler’s iPhone' })
  })

  test('refuses a token it never issued', async () => {
    const s = store()
    await s.completePairing((await s.beginPairing()).code, 'iPhone')

    expect(await s.verifyToken('not-a-real-token')).toBeNull()
  })

  test('refuses an empty token', async () => {
    const s = store()
    await s.completePairing((await s.beginPairing()).code, 'iPhone')

    expect(await s.verifyToken('')).toBeNull()
  })

  test('burns a pairing code after one use', async () => {
    const s = store()
    const offer = await s.beginPairing()
    expect(await s.completePairing(offer.code, 'iPhone')).not.toBeNull()

    expect(await s.completePairing(offer.code, 'someone else')).toBeNull()
  })

  test('refuses a pairing code once its window has closed', async () => {
    const s = store()
    const offer = await s.beginPairing()

    now = offer.expiresAt + 1

    expect(await s.completePairing(offer.code, 'iPhone')).toBeNull()
  })

  test('refuses a wrong pairing code', async () => {
    const s = store()
    await s.beginPairing()

    expect(await s.completePairing('000000', 'iPhone')).toBeNull()
  })

  test('never writes a usable token to disk', async () => {
    const s = store()
    const paired = await s.completePairing((await s.beginPairing()).code, 'iPhone')

    const onDisk = readFileSync(file, 'utf-8')
    expect(onDisk).not.toContain(paired!.token)
  })

  test('stops honouring a revoked device', async () => {
    const s = store()
    const paired = await s.completePairing((await s.beginPairing()).code, 'iPhone')

    await s.revoke(paired!.deviceId)

    expect(await s.verifyToken(paired!.token)).toBeNull()
  })

  test('remembers a completed pairing across a restart', async () => {
    const s = store()
    const paired = await s.completePairing((await s.beginPairing()).code, 'iPhone')

    expect(await store().verifyToken(paired!.token)).not.toBeNull()
  })

  test('does not carry an in-flight pairing window across a restart', async () => {
    // An offer is deliberately in-memory: an unfinished pairing should die
    // with the app rather than leave a usable code on disk for later.
    const offer = await store().beginPairing()

    expect(await store().completePairing(offer.code, 'iPhone')).toBeNull()
  })
})
