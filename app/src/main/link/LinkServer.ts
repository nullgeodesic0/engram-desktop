import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { parseOutboxItem } from '../../shared/linkProtocol'
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
  const { pairing, outbox } = deps
  let server: Server | null = null
  let port = 0

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
  }

  return {
    async start() {
      if (server) return { port }
      server = createServer((req, res) => {
        const url = (req.url ?? '').split('?')[0]
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
        send(res, 404, { error: 'no such route' })
      })
      await new Promise<void>((resolve) => server!.listen(deps.port ?? 0, deps.host ?? '0.0.0.0', resolve))
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
