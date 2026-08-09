import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Pairing between Engram Desktop and the iOS companion.
 *
 * This is the only thing between a shared network and a learner's session, so
 * the shape follows the boring, well-worn rules rather than anything clever:
 *
 * - **A pairing window that closes.** `beginPairing` mints a short-lived code
 *   held only in memory. An unfinished pairing dies with the app instead of
 *   leaving a usable code on disk for whoever reads it later.
 * - **Single use.** A code is burned the moment it is redeemed, so a shoulder-
 *   surfed QR cannot be redeemed a second time by someone quicker.
 * - **Tokens are stored hashed.** The file is a list of SHA-256 digests, not
 *   credentials — reading it does not let you speak to the server.
 * - **Constant-time comparison.** Token checks run through `timingSafeEqual`
 *   over fixed-length digests, so a wrong token leaks no information about how
 *   nearly right it was.
 *
 * Transport security is a separate concern and is NOT provided here: this
 * module authenticates a caller, it does not encrypt the channel.
 */

/** How long a pairing code stays redeemable. Long enough to walk to the phone
 * and scan, short enough that a code left on screen stops mattering. */
const PAIRING_WINDOW_MS = 2 * 60 * 1000

export interface PairingStoreDeps {
  /** Absolute path to the paired-device list. Parents created on demand. */
  filePath: string
  /** Injected clock, so the expiry window is testable. */
  now?: () => number
}

export interface PairingOffer {
  /** Six digits, shown on the desktop and carried in the QR payload. */
  code: string
  expiresAt: number
}

export interface PairedDevice {
  deviceId: string
  deviceName: string
  pairedAt: string
}

export interface CompletedPairing extends PairedDevice {
  /** Returned exactly once, at pairing time. Never recoverable afterwards. */
  token: string
}

interface StoredDevice extends PairedDevice {
  tokenHash: string
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf-8').digest('hex')
}

/** Compares two hex digests without leaking how far the match got. Lengths are
 * checked first because `timingSafeEqual` throws on a mismatch — that check is
 * safe to do in variable time, since digest length is not a secret. */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export interface PairingStore {
  beginPairing(): Promise<PairingOffer>
  completePairing(code: string, deviceName: string): Promise<CompletedPairing | null>
  verifyToken(token: string): Promise<PairedDevice | null>
  revoke(deviceId: string): Promise<void>
  list(): Promise<PairedDevice[]>
}

export function createPairingStore(deps: PairingStoreDeps): PairingStore {
  const { filePath } = deps
  const now = deps.now ?? (() => Date.now())

  // In memory on purpose — see the module comment.
  let offer: { code: string; expiresAt: number } | null = null

  async function read(): Promise<StoredDevice[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, 'utf-8'))
      return Array.isArray(parsed) ? (parsed as StoredDevice[]) : []
    } catch {
      return []
    }
  }

  async function write(devices: StoredDevice[]): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(devices, null, 2), 'utf-8')
  }

  return {
    async beginPairing() {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
      const expiresAt = now() + PAIRING_WINDOW_MS
      offer = { code, expiresAt }
      return { code, expiresAt }
    },

    async completePairing(code, deviceName) {
      if (!offer) return null
      if (now() > offer.expiresAt) {
        offer = null
        return null
      }
      if (!digestsMatch(hashToken(offer.code), hashToken(code))) return null
      // Burn the code before doing anything else, so a second redemption
      // cannot race the first.
      offer = null

      const token = randomBytes(32).toString('base64url')
      const device: StoredDevice = {
        deviceId: randomBytes(8).toString('hex'),
        deviceName: deviceName.slice(0, 64),
        pairedAt: new Date(now()).toISOString(),
        tokenHash: hashToken(token),
      }
      await write([...(await read()), device])
      const { tokenHash: _omit, ...pub } = device
      return { ...pub, token }
    },

    async verifyToken(token) {
      if (!token) return null
      const candidate = hashToken(token)
      for (const device of await read()) {
        if (digestsMatch(device.tokenHash, candidate)) {
          const { tokenHash: _omit, ...pub } = device
          return pub
        }
      }
      return null
    },

    async revoke(deviceId) {
      await write((await read()).filter((d) => d.deviceId !== deviceId))
    },

    async list() {
      return (await read()).map(({ tokenHash: _omit, ...pub }) => pub)
    },
  }
}
