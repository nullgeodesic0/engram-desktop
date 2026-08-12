import { app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'
import { createCardPackStore, type CardPackStore } from './cardPackStore'
import { createLinkServer, type LinkServer } from './LinkServer'
import { createOutboxStore, type OutboxStore } from './outboxStore'
import { createPairingStore, type PairingStore } from './pairing'
import { linkReadDeps, makeWalkableFor } from './linkDeps'
import { dueNodeIds } from '../session/mobileOverview'
import { composePackTopUpKickoff } from '../../shared/mobileKickoff'
import { PACK_FLOOR, topUpPacksNow } from '../session/packScheduler'
import { deskGradedPacks, receiptSinceProvider } from '../session/walkablePacks'
import { drainOutbox, type DrainResult } from './mobileDrain'
import { startSession, anySessionRunning } from '../ipc/sessionHandlers'
import { withSessionStartLock } from '../session/sessionStartLock'
import { receiptSince } from '../session/mobileReceipts'
import { getTopicSettings, setTopicSettings } from '../session/topicSettings'
import { tmpdir } from 'node:os'
import type { LinkStatus } from '../../shared/types'

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
let lastError: string | null = null

// The renderer sees this too, so the shape lives in shared/types.ts and this
// module consumes it rather than declaring a second copy that could drift.
export type { LinkStatus } from '../../shared/types'

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

/** The last topic the phone asked to have packed, and when. */
let lastPackRequest: { topic: string; at: number } | null = null

/** Long enough that tapping an empty topic twice does not queue two sittings,
 * short enough that a learner who genuinely moved on to another topic is not
 * told to wait. */
const PACK_REQUEST_COOLDOWN_MS = 15 * 60_000

/**
 * "Nothing packed for this topic" is a fact about SUPPLY, and supply is
 * something the Mac can act on.
 *
 * Learn is the one mode with no floor under it. A review can always be served
 * as free recall on a probe the engine already holds, but eight beats of
 * teaching cannot be synthesised from the record — and inventing them on the
 * phone would put this app in the business of writing curriculum, which is the
 * one line it does not cross. So the honest move is to ask the desk, and say
 * so.
 *
 * Guarded by the same rules as every other sitting: never on top of one that
 * is running, and never twice for the same topic inside a quarter of an hour.
 * A learner tapping an empty topic repeatedly is expressing one wish, not
 * several.
 */
/** How rarely a phone-presence nudge may itself trigger a top-up PASS.
 *
 * Not a gate on starting a sitting — `topUpPacksNow`'s own cooldowns already
 * own that decision, tightened for exactly this by the concurrency guard in
 * packScheduler.ts. This is only about not re-reading the topic list and
 * every pack directory on every one of a menu's several requests; the memo
 * layer already collapses the engine reads, so this is a second, cheap
 * belt for the same buckle. */
const PHONE_NUDGE_COOLDOWN_MS = 60_000
let lastNudgeAt = 0

function nudgePackTopUp(): void {
  const now = Date.now()
  if (now - lastNudgeAt < PHONE_NUDGE_COOLDOWN_MS) return
  lastNudgeAt = now
  void topUpPacksNow(packSchedulerDeps(), now).catch(() => {})
}

async function requestPacksFor(topic: string): Promise<{ started: boolean; reason: string }> {
  // The whole decide-then-start sequence, not just the `anySessionRunning()`
  // read, is behind the lock. `dueNodeIds` below is a real async gap — an
  // engine read — and a second call (from another ASK tap, or the
  // background scheduler landing at the same moment) that raced in during
  // that gap used to see the same "nothing running" this call sees, because
  // nothing was registered in `sessions` yet. See sessionStartLock.ts.
  return withSessionStartLock(async () => {
    if (anySessionRunning()) {
      return { started: false, reason: 'Your Mac is mid-sitting. It will pack this when that finishes.' }
    }
    const now = Date.now()
    if (
      lastPackRequest &&
      lastPackRequest.topic === topic &&
      now - lastPackRequest.at < PACK_REQUEST_COOLDOWN_MS
    ) {
      return { started: false, reason: 'Already asked — your Mac is working on it.' }
    }
    lastPackRequest = { topic, at: now }
    try {
      const dueUnpacked = (await dueNodeIds(topic).catch(() => new Set<string>())).size > 0
      await startSession(
        composePackTopUpKickoff({ topic, count: PACK_FLOOR, dueUnpacked }),
        'learn',
        undefined,
        topic,
        // Headless — nobody is at the desk to send a next turn. See
        // startSession's own doc comment on why this must not be left off.
        true,
      )
      return { started: true, reason: 'Your Mac is writing cards for this now.' }
    } catch (err) {
      lastPackRequest = null
      return { started: false, reason: err instanceof Error ? err.message : 'Could not start a sitting.' }
    }
  })
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
  lastError = null
  server = createLinkServer({
    pairing: pairing!,
    outbox: outbox!,
    packs: packs!,
    // Every read the phone gets, assembled in one place and shared with the
    // dev harness so the two cannot serve different route tables — see
    // linkDeps.ts for the three times that promise was made by comment and
    // broken anyway.
    ...linkReadDeps({ outbox: outbox!, packs: packs! }),
    onEvidenceBanked: () => scheduleAutoSettle(SETTLE_QUIET_MS),
    onPhoneSeen: nudgePackTopUp,
    requestPacks: requestPacksFor,
    // Read-modify-write, so filing from the phone cannot clobber a display
    // title or any other setting the learner set at the desk.
    setFolder: async (topic, folder) => {
      const current = await getTopicSettings(topic)
      await setTopicSettings(topic, { ...current, folder })
    },
    host,
    // A fixed port so a paired phone keeps working across restarts. An
    // ephemeral port would force re-entry of the host every launch, which is
    // exactly the friction this service exists to remove.
    port: 8787,
  })

  // The sweep lives with the server: no link, no phone evidence, nothing to
  // settle. Cleared on stop so a rebind does not leave two running.
  if (settleSweep) clearInterval(settleSweep)
  settleSweep = setInterval(() => void autoSettle(), SETTLE_SWEEP_MS)
  // And once now, because the queue that prompted this had been waiting since
  // the last launch.
  scheduleAutoSettle(SETTLE_QUIET_MS)
  try {
    await server.start()
  } catch (err) {
    // A busy port must not be fatal. The app is a learning client first; the
    // phone link is a feature, and a feature that cannot start should say so
    // rather than take the window with it.
    server = null
    lastError = err instanceof Error ? err.message : String(err)
  }
  return linkStatus()
}

export async function stopLinkServer(): Promise<void> {
  // Both timers die with the link. A sweep outliving the server would start
  // sittings for a surface that is no longer listening.
  if (settleSweep) clearInterval(settleSweep)
  if (settleTimer) clearTimeout(settleTimer)
  settleSweep = null
  settleTimer = null
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
    error: lastError,
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
  ipcMain.handle('link:settle', () => settleQueue())
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

/** How long to wait after the last push before settling.
 *
 * A walk arrives as a burst of five or six items over a second or two, and
 * settling on the first would start a sitting while the rest were still in the
 * air. Long enough to swallow a burst, short enough that a learner who put the
 * phone down and looked at the Mac sees the grade land. */
const SETTLE_QUIET_MS = 20_000

/** The safety net. Catches evidence that arrived while a sitting was running,
 * and in-flight items the grace period has since released. */
const SETTLE_SWEEP_MS = 5 * 60_000

let settleTimer: NodeJS.Timeout | null = null
let settleSweep: NodeJS.Timeout | null = null

/**
 * Settles queued evidence on its own, once the desk is free.
 *
 * This used to be strictly learner-initiated, and the reason was good: a
 * sitting is the unit of work, and starting one because a phone finished
 * syncing would interrupt whatever the learner was doing. That reason is kept
 * — `sittingRunning` is the gate — but the rule it produced was too strong.
 *
 * What it cost is only visible now that packs retire when their node has work
 * waiting: twenty items sat in flight for a day, every pack in the topic read
 * as spent, and the phone said "Nothing packed" for a topic with three packs
 * on disk. Evidence nobody settles is not merely ungraded, it is a queue that
 * quietly closes the surface that produced it.
 *
 * So: settle when nothing is running, after the burst has landed, and sweep
 * periodically for whatever the gate turned away. Nothing here settles ON TOP
 * of a sitting; a busy desk simply defers to the next sweep.
 */
function scheduleAutoSettle(delayMs: number): void {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    void autoSettle()
  }, delayMs)
}

async function autoSettle(): Promise<void> {
  // The whole check-then-drain sequence, locked — not just the
  // `anySessionRunning()` read. This is a third automatic trigger (the
  // phone's ASK button and the pack scheduler are the other two) with the
  // identical shape: a synchronous guard, then real async work (the pending/
  // staleInFlight reads below) before anything is actually started. See
  // sessionStartLock.ts.
  return withSessionStartLock(async () => {
    // The learner is at the desk doing the real thing. Their sitting owns the
    // engine; the queue can wait for the sweep.
    if (anySessionRunning()) return
    ensureStores()
    const waiting = await outbox!.pending().catch(() => [])
    const stale = await outbox!.staleInFlight().catch(() => [])
    if (waiting.length === 0 && stale.length === 0) return
    await settleQueue().catch(() => undefined)
  })
}

/**
 * Hands queued phone evidence to real sittings.
 *
 * Runs on its own now (see `scheduleAutoSettle`) and still on request: the
 * Companion panel's button calls exactly this, so a learner who wants their
 * grade now does not have to wait out the quiet period.
 *
 * One session per topic, because a kickoff names one topic and a sitting that
 * hopped between them would be the mixed-queue problem the desktop already
 * solved once. Items are marked drained only after their session starts, and a
 * topic that fails leaves its evidence queued for the next attempt — the
 * learner produced that work and it exists in exactly one place.
 */
export async function settleQueue(): Promise<DrainResult> {
  ensureStores()
  return drainOutbox({
    outbox: outbox!,
    batchDir: join(tmpdir(), 'engram-mobile-batches'),
    startSession: async (message, kind, topic) => {
      // Headless drain sitting — same reasoning as the pack top-up's own
      // autoCloseAfterTurn: no one is at the desk to send a next turn.
      const { sessionId } = await startSession(
        message,
        kind as 'learn' | 'review' | 'coach',
        undefined,
        topic,
        true,
      )
      return sessionId
    },
    // The record decides what counts as settled — see mobileDrain's note on
    // why starting a sitting is not the same as it producing a receipt.
    receiptSince: (topic, node, since) => receiptSince(topic, node, since),
  })
}

/**
 * The pack scheduler's wiring, assembled here because this is where the pack
 * store already lives. The scheduler itself learns nothing about how a session
 * starts or where packs are kept.
 */
export function packSchedulerDeps() {
  return {
    // The scheduler asks how many packs a topic HAS so it can decide whether
    // to write more. It must be the walkable count for the same reason the
    // phone's list must be: a topic full of spent packs is a topic with
    // nothing to walk, and counting the files would leave it starved forever.
    packedFor: (topic: string) => {
      ensureStores()
      return makeWalkableFor({ outbox: outbox!, packs: packs! })(topic)
    },
    sittingRunning: anySessionRunning,
    dueNodesFor: dueNodeIds,
    // A node solidified at the desk after its pack was already on the phone
    // leaves that pack asking about work already done. `packedFor` above
    // already stops OFFERING it (walkablePacks' own exclusion), but nothing
    // ever deleted the file — it sat on disk forever, uncounted but never
    // cleared, the exact confusion that made a stale stat-mech pack read as
    // "still there" during a live debugging session. Deleting it here, ahead
    // of this same pass's `packedFor` read, is what lets the topic's deficit
    // reflect the free slot immediately — repopulating, not merely clearing.
    cleanupStaleFor: async (topic: string) => {
      ensureStores()
      const stale = await deskGradedPacks(topic, {
        entries: (t) => packs!.entriesFor(t),
        receiptSince: receiptSinceProvider,
      })
      for (const node of stale) await packs!.remove(topic, node)
      return stale
    },
    // Headless top-up sitting — same reasoning as requestPacksFor's own
    // autoCloseAfterTurn: no one is at the desk to send a next turn.
    startSession: (message: string, topic: string) => startSession(message, 'learn', undefined, topic, true),
  }
}
