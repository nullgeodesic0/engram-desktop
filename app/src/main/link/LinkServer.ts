import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { parseOutboxItem } from '../../shared/linkProtocol'
import type { CardPackStore } from './cardPackStore'
import type { OutboxStore } from './outboxStore'
import type { PairingStore } from './pairing'

/**
 * The phone-facing server.
 *
 * Deliberately NOT an extension of `bridgeServer`: that one binds 127.0.0.1
 * for the tutor's MCP worker and its callers are local by construction. This
 * one is reachable from the network and its caller is untrusted, so the two
 * keep separate ports, separate auth postures, and separate code — a shared
 * server would eventually grow one route that forgot which side it was on.
 *
 * What this server does NOT do is as load-bearing as what it does. It never
 * rates, never stamps, never runs `engram.py`, and never touches
 * `~/.claude/learning/`. It authenticates a caller and appends their evidence
 * to a queue. Turning that queue into a receipt is a live session's job, which
 * is what keeps "a window, never a second author" true on this surface too.
 *
 * Transport encryption is not implemented here yet — see the repo's mobile
 * spec. Until it is, this server must not be exposed beyond a trusted network.
 */

/** Roughly a thousand queued items with productions. Large enough for a long
 * offline stretch, small enough that an unauthenticated caller cannot use the
 * body buffer as free memory. */
const MAX_BODY_BYTES = 1_000_000

export interface LinkServerDeps {
  pairing: PairingStore
  outbox: OutboxStore
  packs: CardPackStore
  /** Called after phone evidence lands durably, with how many items arrived.
   * The server does not decide what happens next — it does not know whether a
   * sitting is running or whether the learner is mid-thought at the desk. */
  onEvidenceBanked?: (accepted: number) => void
  /** Due retrievals for one topic, as QUESTIONS — the floor that makes Review
   * always openable. Injected like every other read, so this module gains an
   * answer and never a way to ask the engine. */
  reviewQueue?: (topic: string) => Promise<unknown>
  /** Asks the Mac to author packs for a topic the phone found empty.
   *
   * An ACTION, injected exactly like every read here is, because this module
   * may hold a handle and never the ability itself — it is the thing an
   * untrusted peer sends bytes to. Whether a sitting actually starts is
   * decided on the other side of that line, by the same guards that govern
   * every other sitting. */
  requestPacks?: (topic: string) => Promise<{ started: boolean; reason: string }>
  /** A topic's packs that still have work in them — see main/session/
   * walkablePacks.ts. Optional for the same reason the other providers are:
   * without it this server answers with every pack on disk, which is what it
   * did before the distinction existed. */
  walkablePacks?: (topic: string, mode?: 'learn' | 'review') => Promise<string[]>
  /** Supplies the phone menu's counts. Injected as a plain function so this
   * module gains an ANSWER, never a way to question the engine — the inertness
   * §D6 pins depends on that distinction. Optional: without it the endpoint
   * reports an empty overview rather than failing, which is the right shape
   * for a menu whose data source is not wired yet. */
  overview?: () => Promise<unknown>
  /** One topic's drawable graph. Injected for the same reason as `overview`.
   * The projection that strips answer fields lives on the other side of the
   * inertness boundary, in main/session/mobileOverview.ts. */
  graph?: (topic: string) => Promise<unknown>
  /** One topic's graded history — what the desk decided about work the phone
   * sent up. Injected for the same reason as `overview` and `graph`.
   *
   * This is the only route that returns the ENGINE'S OWN VERDICTS rather than
   * counts, and it is safe for a reason worth naming: a receipt is written
   * after the production is graded and records no content. The projection on
   * the other side of the boundary (main/session/mobileReceipts.ts) is a
   * whitelist, so a future engine field cannot leak by being forgotten. */
  receipts?: (topic: string, mode?: string) => Promise<unknown>
  /** Every topic's letter at once, for the roster — one history read rather
   * than one per topic. */
  gradeRoster?: (mode?: string) => Promise<unknown>
  /** The explorable gallery: what exists, and one page's HTML.
   *
   * `artifact` returns null for anything the engine's ledger does not list,
   * which is what makes a topic/node pair safe to accept from a network peer
   * — there is no path to traverse, only a lookup that matches a row the
   * engine wrote or does not. */
  /** What the record says about how the learner learns. Counts and rates
   * the engine already recorded — no misconception text, which belongs at the
   * desk with the session that can work on it. */
  coach?: () => Promise<unknown>
  artifacts?: () => Promise<unknown>
  artifact?: (topic: string, node: string) => Promise<string | null>
  /** Files a topic under an app-local folder label.
   *
   * The ONLY write this server offers besides the outbox, and it is safe for a
   * specific reason: a folder is presentational grouping in the app's own
   * settings store, not engine state. Nothing moves on disk, no graph is
   * touched, and no schedule changes. If this ever grows into something that
   * writes learning state, it belongs on the other side of the boundary. */
  setFolder?: (topic: string, folder: string | null) => Promise<void>
  /** Defaults to all interfaces — the phone is not on loopback. Tests pin it
   * to 127.0.0.1 so a test run never opens a port to the network. */
  host?: string
  /** 0 picks a free port. */
  port?: number
}

export interface LinkServer {
  start(): Promise<{ port: number }>
  stop(): Promise<void>
  readonly port: number
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(payload)
}

/** Reads the body, refusing anything over the cap. Resolves `null` when the
 * cap is hit — the response is already sent by then and the socket destroyed,
 * so the caller must simply stop. */
function readBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    req.on('data', (chunk: Buffer) => {
      if (done) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        done = true
        send(res, 413, { error: 'body too large' })
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (done) return
      done = true
      resolve(Buffer.concat(chunks).toString('utf-8'))
    })
    req.on('error', () => {
      if (done) return
      done = true
      resolve(null)
    })
  })
}

function bearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
}

export function createLinkServer(deps: LinkServerDeps): LinkServer {
  const { pairing, outbox, packs } = deps
  let server: Server | null = null
  let port = 0

  /** Every pack route is authenticated: a pack carries its own sealed reveals,
   * so serving one to an unpaired caller would hand out answers. */
  async function handlePackRead(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!(await pairing.verifyToken(bearerToken(req)))) {
      send(res, 401, { error: 'unauthorized' })
      return
    }
    const topic = url.searchParams.get('topic') ?? ''
    if (url.pathname === '/link/packs') {
      // Walkable rather than present, when the composition root supplies the
      // distinction. Falling back to every file is deliberate: the fixture and
      // the tests wire a bare store, and a topic that lists nothing is
      // indistinguishable on the phone from a Mac that is not answering.
      // `mode` narrows it: Learn may open any pack with work left, Review
      // only a pack whose node the engine has scheduled. Unknown values read
      // as 'learn' rather than erroring — an older phone asking without the
      // parameter must keep working.
      const mode = url.searchParams.get('mode') === 'review' ? 'review' : 'learn'
      send(res, 200, {
        nodes: deps.walkablePacks
          ? await deps.walkablePacks(topic, mode)
          : await packs.listFor(topic),
      })
      return
    }
    if (url.pathname === '/link/overview') {
      send(res, 200, deps.overview ? await deps.overview() : { topics: [], dueTotal: 0, minutesPerItem: null })
      return
    }
    if (url.pathname === '/link/graph') {
      if (!deps.graph) {
        send(res, 404, { error: 'no graph provider' })
        return
      }
      send(res, 200, await deps.graph(topic))
      return
    }
    if (url.pathname === '/link/grades') {
      if (!deps.gradeRoster) {
        send(res, 404, { error: 'no grade roster provider' })
        return
      }
      send(res, 200, { topics: await deps.gradeRoster(url.searchParams.get('mode') ?? undefined) })
      return
    }
    if (url.pathname === '/link/review') {
      if (!deps.reviewQueue) {
        send(res, 404, { error: 'no review provider' })
        return
      }
      send(res, 200, { items: await deps.reviewQueue(topic) })
      return
    }
    if (url.pathname === '/link/coach') {
      if (!deps.coach) {
        send(res, 404, { error: 'no coach provider' })
        return
      }
      send(res, 200, await deps.coach())
      return
    }
    if (url.pathname === '/link/artifacts') {
      if (!deps.artifacts) {
        send(res, 404, { error: 'no artifacts provider' })
        return
      }
      send(res, 200, await deps.artifacts())
      return
    }
    if (url.pathname === '/link/artifact') {
      if (!deps.artifact) {
        send(res, 404, { error: 'no artifact provider' })
        return
      }
      const html = await deps.artifact(topic, url.searchParams.get('node') ?? '')
      if (html === null) {
        send(res, 404, { error: 'no such artifact' })
        return
      }
      // The one non-JSON response. Served as text/html with nothing else in
      // the headers: the client renders it in a web view, and a content type
      // that lied about that would be the client's problem to work around.
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    if (url.pathname === '/link/receipts') {
      if (!deps.receipts) {
        send(res, 404, { error: 'no receipts provider' })
        return
      }
      send(res, 200, await deps.receipts(topic, url.searchParams.get('mode') ?? undefined))
      return
    }
    const node = url.searchParams.get('node') ?? ''
    const pack = await packs.get(topic, node)
    if (!pack) {
      send(res, 404, { error: 'no pack for that node' })
      return
    }
    send(res, 200, pack)
  }

  async function handlePair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req, res)
    if (body === null) return
    let parsed: { code?: unknown; deviceName?: unknown }
    try {
      parsed = JSON.parse(body)
    } catch {
      send(res, 400, { error: 'malformed json' })
      return
    }
    if (typeof parsed.code !== 'string' || typeof parsed.deviceName !== 'string') {
      send(res, 400, { error: 'code and deviceName are required' })
      return
    }
    const paired = await pairing.completePairing(parsed.code, parsed.deviceName)
    if (!paired) {
      // One shape for every failure — expired, wrong, already burned. A
      // caller guessing codes learns nothing from the difference.
      send(res, 401, { error: 'pairing refused' })
      return
    }
    send(res, 200, paired)
  }

  async function handleOutbox(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const device = await pairing.verifyToken(bearerToken(req))
    if (!device) {
      // Read and discard nothing: the body is not touched before auth, so an
      // unauthenticated caller cannot make this process buffer anything.
      send(res, 401, { error: 'unauthorized' })
      return
    }
    const body = await readBody(req, res)
    if (body === null) return
    let parsed: { items?: unknown }
    try {
      parsed = JSON.parse(body)
    } catch {
      send(res, 400, { error: 'malformed json' })
      return
    }
    if (!Array.isArray(parsed.items)) {
      send(res, 400, { error: 'items must be an array' })
      return
    }
    // Per-item validation, per-item outcome: one bad record must not cost the
    // learner a whole offline stretch of real work.
    const valid = []
    let rejected = 0
    for (const raw of parsed.items) {
      const item = parseOutboxItem(raw)
      if (item) valid.push(item)
      else rejected += 1
    }
    const { accepted, duplicates } = await outbox.append(valid)
    send(res, 200, { accepted, duplicates, rejected })
    // Told AFTER the reply, so a slow settle never holds the phone's push
    // open. The phone's job ends when its work is durable here.
    if (accepted > 0) deps.onEvidenceBanked?.(accepted)
  }

  /** "There is nothing here to learn" is a fact about supply, and supply is
   * something the Mac can do something about. Without this the phone's only
   * honest move was to say no. */
  async function handlePackRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!(await pairing.verifyToken(bearerToken(req)))) {
      send(res, 401, { error: 'unauthorized' })
      return
    }
    if (!deps.requestPacks) {
      send(res, 404, { error: 'packing not available' })
      return
    }
    const body = await readBody(req, res)
    if (body === null) return
    // Hand-checked rather than schema-parsed: one field, and the topic is
    // used only to name a sitting and read the due queue. It never becomes a
    // path — cardPackStore is the module that treats a topic as a path
    // segment, and it does its own refusal.
    const topic = (body as { topic?: unknown }).topic
    if (typeof topic !== 'string' || topic.length === 0 || topic.length > 120) {
      send(res, 400, { error: 'bad request' })
      return
    }
    send(res, 200, await deps.requestPacks(topic))
  }

  async function handleSetFolder(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!(await pairing.verifyToken(bearerToken(req)))) {
      send(res, 401, { error: 'unauthorized' })
      return
    }
    if (!deps.setFolder) {
      send(res, 404, { error: 'filing not available' })
      return
    }
    const body = await readBody(req, res)
    if (body === null) return
    let parsed: { topic?: unknown; folder?: unknown }
    try {
      parsed = JSON.parse(body)
    } catch {
      send(res, 400, { error: 'malformed json' })
      return
    }
    if (typeof parsed.topic !== 'string' || !parsed.topic) {
      send(res, 400, { error: 'topic is required' })
      return
    }
    // A folder is a label the learner typed; anything else is a client bug.
    const folder =
      parsed.folder === null || parsed.folder === undefined
        ? null
        : typeof parsed.folder === 'string'
          ? parsed.folder.trim().slice(0, 60) || null
          : undefined
    if (folder === undefined) {
      send(res, 400, { error: 'folder must be a string or null' })
      return
    }
    await deps.setFolder(parsed.topic, folder)
    send(res, 200, { ok: true })
  }

  return {
    async start() {
      if (server) return { port }
      server = createServer((req, res) => {
        const parsedUrl = new URL(req.url ?? '/', 'http://localhost')
        const url = parsedUrl.pathname
        if (
          req.method === 'GET' &&
          (url === '/link/pack' ||
            url === '/link/packs' ||
            url === '/link/overview' ||
            url === '/link/graph' ||
            url === '/link/receipts' ||
            url === '/link/artifacts' ||
            url === '/link/coach' ||
            url === '/link/review' ||
            url === '/link/grades' ||
            url === '/link/artifact')
        ) {
          void handlePackRead(req, res, parsedUrl)
          return
        }
        if (req.method === 'GET' && url === '/link/health') {
          // Unauthenticated on purpose, and bare on purpose: enough for a
          // client to confirm it found the right service, and nothing that
          // describes the learner, the corpus, or the host.
          send(res, 200, { app: 'engram-desktop', protocol: 1 })
          return
        }
        if (req.method === 'POST' && url === '/link/pair') {
          void handlePair(req, res)
          return
        }
        if (req.method === 'POST' && url === '/link/outbox') {
          void handleOutbox(req, res)
          return
        }
        if (req.method === 'POST' && url === '/link/request-packs') {
          void handlePackRequest(req, res)
          return
        }
        if (req.method === 'POST' && url === '/link/topic-folder') {
          void handleSetFolder(req, res)
          return
        }
        send(res, 404, { error: 'no such route' })
      })
      // `listen` reports failure by EMITTING 'error', not by rejecting.
      // Unhandled, that event is an uncaught exception — in the Electron main
      // process it took the whole app down at launch when anything else held
      // the port, which is a spectacular way for an optional feature to fail.
      // Bind errors now reject, and the half-built server is discarded so a
      // later retry starts clean.
      const listening = new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          server?.removeListener('listening', onListening)
          reject(err)
        }
        const onListening = () => {
          server?.removeListener('error', onError)
          resolve()
        }
        server!.once('error', onError)
        server!.once('listening', onListening)
        server!.listen(deps.port ?? 0, deps.host ?? '0.0.0.0')
      })
      try {
        await listening
      } catch (err) {
        server?.close()
        server = null
        throw err
      }
      const address = server.address()
      port = typeof address === 'object' && address ? address.port : 0
      return { port }
    },

    async stop() {
      const current = server
      server = null
      if (!current) return
      await new Promise<void>((resolve) => current.close(() => resolve()))
    },

    get port() {
      return port
    },
  }
}
