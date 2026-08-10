import { app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'
import { createCardPackStore, type CardPackStore } from './cardPackStore'
import { createLinkServer, type LinkServer } from './LinkServer'
import { createOutboxStore, type OutboxStore } from './outboxStore'
import { createPairingStore, type PairedDevice, type PairingStore } from './pairing'

/**
 * Owns the phone-facing link: its stores, its server, and its lifecycle.
 *
 * Starts with the app so a paired phone can reach the Mac the moment Engram
 * Desktop is running — no script to remember, which was the whole point of
 * asking for it. Already-paired devices connect with no interaction at all;
 * only a NEW device needs a code, and only then does anything appear on screen.
 *
 * ## Two deliberate defaults
 *
 * **Loopback until asked otherwise.** There is no transport encryption yet, so
 * binding every interface by default would put a learner's productions on the
 * network in cleartext because they launched an app. `link:expose` opts in
 * per-run and says so; nothing persists that choice, because a setting the
 * learner cannot see is not consent.
 *
 * **A pairing window opens only on request.** The server is always listening,
 * but `completePairing` needs a live offer, and offers are in-memory and
 * short-lived. So an unpaired stranger on the same network finds a port that
 * answers `/link/health` and refuses everything else.
 */

let server: LinkServer | null = null
let pairing: PairingStore | null = null
let outbox: OutboxStore | null = null
let packs: CardPackStore | null = null
let boundHost = '127.0.0.1'

export interface LinkStatus {
  running: boolean
  port: number
  /** The address a phone should be pointed at, or null on loopback. */
  lanUrl: string | null
  exposed: boolean
  devices: PairedDevice[]
  /** Items waiting for a session to settle them. */
  queued: number
}

function userDataPath(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}

function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return null
}

function ensureStores(): void {
  pairing ??= createPairingStore({ filePath: userDataPath('paired-devices.json') })
  outbox ??= createOutboxStore({ filePath: userDataPath('outbox.jsonl') })
  packs ??= createCardPackStore({ rootDir: userDataPath('card-packs') })
}

/** Starts (or restarts, on a bind change) the link server. */
export async function startLinkServer(options: { exposeToLan?: boolean } = {}): Promise<LinkStatus> {
  ensureStores()
  const host = options.exposeToLan ? '0.0.0.0' : '127.0.0.1'
  if (server && host === boundHost) return linkStatus()
  if (server) await server.stop()

  boundHost = host
  server = createLinkServer({
    pairing: pairing!,
    outbox: outbox!,
    packs: packs!,
    host,
    // A fixed port so a paired phone keeps working across restarts. An
    // ephemeral port would force re-entry of the host every launch, which is
    // exactly the friction this service exists to remove.
    port: 8787,
  })
  await server.start()
  return linkStatus()
}

export async function stopLinkServer(): Promise<void> {
  await server?.stop()
  server = null
}

export async function linkStatus(): Promise<LinkStatus> {
  ensureStores()
  const exposed = boundHost !== '127.0.0.1'
  return {
    running: server !== null,
    port: server?.port ?? 0,
    lanUrl: exposed && server ? `http://${lanAddress() ?? '0.0.0.0'}:${server.port}` : null,
    exposed,
    devices: await pairing!.list(),
    queued: (await outbox!.pending()).length,
  }
}

export function registerLinkHandlers(): void {
  ipcMain.handle('link:status', () => linkStatus())

  /** Opens a short pairing window and returns the code to show the learner. */
  ipcMain.handle('link:beginPairing', async () => {
    ensureStores()
    const offer = await pairing!.beginPairing()
    const status = await linkStatus()
    return {
      code: offer.code,
      expiresAt: offer.expiresAt,
      // What the phone needs typed in. On loopback this is only reachable
      // from a simulator on this Mac, which is stated rather than implied.
      url: status.lanUrl ?? `http://127.0.0.1:${status.port}`,
      loopbackOnly: !status.exposed,
    }
  })

  ipcMain.handle('link:expose', (_event, exposeToLan: boolean) => startLinkServer({ exposeToLan }))
  ipcMain.handle('link:revoke', async (_event, deviceId: string) => {
    ensureStores()
    await pairing!.revoke(deviceId)
    return linkStatus()
  })
}

/**
 * Opens a pairing window and shows the code.
 *
 * A dialog rather than a settings pane, because pairing is an EVENT: a code
 * that is redeemable for two minutes and burned on first use. Parking it in
 * Settings would imply a standing state and invite leaving it open.
 *
 * The dialog states the reachable address and, on loopback, says plainly that
 * only this Mac can reach it — a learner staring at a code that cannot work
 * from their phone deserves to be told why rather than left to guess.
 */
export async function showPairingCode(): Promise<void> {
  ensureStores()
  if (!server) await startLinkServer()
  const offer = await pairing!.beginPairing()
  const status = await linkStatus()
  const address = status.lanUrl ?? `http://127.0.0.1:${status.port}`
  const minutes = Math.max(1, Math.round((offer.expiresAt - Date.now()) / 60000))

  const detail = status.exposed
    ? `On your phone, enter this host and code.\n\nHost  ${address}\nCode  ${offer.code}\n\nThe code is single-use and expires in about ${minutes} minute(s). This connection is NOT encrypted — only use it on a network you trust.`
    : `Host  ${address}\nCode  ${offer.code}\n\nThe code is single-use and expires in about ${minutes} minute(s).\n\nThe link is currently loopback-only, so only this Mac can reach it — a simulator will connect, a real phone will not. Choose “Allow on this network” to expose it. There is no transport encryption yet, so only do that on a network you trust.`

  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: 'Link a phone',
    detail,
    buttons: status.exposed ? ['Done'] : ['Done', 'Allow on this network'],
    defaultId: 0,
    cancelId: 0,
  })

  if (!status.exposed && response === 1) {
    await startLinkServer({ exposeToLan: true })
    // Re-offer: the previous code is still live, but the host changed, and a
    // learner who just switched networks should see the address they need.
    await showPairingCode()
  }
}
