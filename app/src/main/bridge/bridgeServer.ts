import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { BridgeAskRequest, BridgeAskResponse, BridgeBeatRequest, BridgeUiRequest } from '../../shared/bridgeProtocol'
import { sanitizeAnnotatePayload, setNodeAnnotation } from '../session/mapAnnotations'
import { parseCardPack } from '../../shared/cardPack'
import { createCardPackStore, type CardPackStore } from '../link/cardPackStore'
import { app } from 'electron'
import { join } from 'node:path'

/**
 * Hosts the loopback HTTP relay the MCP bridge worker (see mcpBridgeWorker.ts,
 * spawned by `claude` per session as an MCP server) talks to. The worker
 * speaks MCP to Claude on one side and plain HTTP to this server on the
 * other; this server forwards questions to the renderer over IPC and holds
 * the HTTP response open until the renderer answers — which is what makes
 * the MCP tool_use call from Claude's side genuinely block on a real human
 * click (confirmed viable in the M0 spike).
 */
export class BridgeServer {
  private server: Server | null = null
  private port = 0
  // Keyed by requestId; carries the owning sessionId alongside the HTTP
  // resolver so a dead session's entries can be found and dropped without
  // scanning by anything other than a Map lookup — see `dropSession` below.
  private pendingAsks = new Map<string, { sessionId: string; resolve: (res: BridgeAskResponse) => void }>()
  private window: BrowserWindow | null = null
  /** Where an authored pack lands. Lazily built so constructing the server
   * needs no Electron app paths — the tests do exactly that. */
  private packStore: CardPackStore | null = null

  private get cardPacks(): CardPackStore {
    this.packStore ??= createCardPackStore({
      rootDir: join(app.getPath('userData'), 'card-packs'),
    })
    return this.packStore
  }

  setWindow(win: BrowserWindow): void {
    this.window = win
  }

  async start(): Promise<number> {
    if (this.server) return this.port
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        void this.handleRequest(req.url ?? '', Buffer.concat(chunks).toString('utf-8'), res)
      })
    })
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    this.port = typeof address === 'object' && address ? address.port : 0
    return this.port
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  private async handleRequest(url: string, body: string, res: import('node:http').ServerResponse): Promise<void> {
    const askMatch = url.match(/^\/bridge\/([^/]+)\/ask$/)
    const beatMatch = url.match(/^\/bridge\/([^/]+)\/beat$/)
    const uiMatch = url.match(/^\/bridge\/([^/]+)\/ui$/)
    const packMatch = url.match(/^\/bridge\/([^/]+)\/card-pack$/)

    if (askMatch) {
      const sessionId = decodeURIComponent(askMatch[1])
      const payload = JSON.parse(body) as Omit<BridgeAskRequest, 'sessionId' | 'requestId'>
      const requestId = randomUUID()
      const request: BridgeAskRequest = { ...payload, sessionId, requestId }

      // If the relay hangs up before the learner answers — the worker died,
      // the session was killed, or (historically) undici's 300 s timeout
      // guillotined a question someone was still thinking about — the
      // promise below would never settle and the card would sit on screen
      // looking answerable forever, resolving into nothing. Tell the
      // renderer so it can orphan that specific card honestly, the same
      // state a replayed unanswered ask already renders.
      let settled = false
      res.on('close', () => {
        if (settled) return
        this.pendingAsks.delete(requestId)
        this.window?.webContents.send('bridge:ask-dropped', { sessionId, requestId })
      })

      const answer = await new Promise<BridgeAskResponse>((resolve) => {
        this.pendingAsks.set(requestId, { sessionId, resolve })
        this.window?.webContents.send('bridge:ask', request)
      })

      settled = true
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(answer))
      return
    }

    if (packMatch) {
      // The one bridge tool whose refusal the model must SEE. Everything else
      // here is advisory and fire-and-forget; a card pack that breaks the
      // walk protocol is a pack the tutor can fix on the same turn, and
      // swallowing the reason would leave it re-emitting the same mistake.
      let accepted = false
      let reasons: string[] = []
      try {
        const pack = parseCardPack(JSON.parse(body))
        if (!pack) {
          reasons = ['the pack does not match the card-pack schema']
        } else {
          await this.cardPacks.put(pack)
          accepted = true
        }
      } catch (error) {
        reasons = [error instanceof Error ? error.message : String(error)]
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ accepted, reasons }))
      return
    }

    if (beatMatch) {
      const sessionId = decodeURIComponent(beatMatch[1])
      const payload = JSON.parse(body) as Omit<BridgeBeatRequest, 'sessionId'>
      this.window?.webContents.send('bridge:beat', { ...payload, sessionId } as BridgeBeatRequest)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (uiMatch) {
      const sessionId = decodeURIComponent(uiMatch[1])
      const payload = JSON.parse(body) as Omit<BridgeUiRequest, 'sessionId'>
      // annotate_node is the one bridge:ui tool that persists (see mapAnnotations.ts) —
      // everything else here is purely ephemeral UI signal forwarded to the renderer.
      // Shape-guarded before it ever touches disk; a malformed/oversized/wrong-charset
      // payload is silently dropped (fire-and-forget, advisory contract: never throw).
      if (payload.tool === 'annotate_node' && payload.payload && typeof payload.payload === 'object') {
        const sanitized = sanitizeAnnotatePayload(payload.payload as Record<string, unknown>)
        if (sanitized) {
          void setNodeAnnotation(sanitized.topic, sanitized.node, sanitized.patch).catch(() => {})
        }
      }
      this.window?.webContents.send('bridge:ui', { ...payload, sessionId } as BridgeUiRequest)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    res.writeHead(404)
    res.end()
  }

  /** Called by the renderer (via IPC) when the user answers a bridge:ask prompt. */
  answer(requestId: string, response: BridgeAskResponse): void {
    const pending = this.pendingAsks.get(requestId)
    if (!pending) return
    this.pendingAsks.delete(requestId)
    pending.resolve(response)
  }

  /**
   * Called by SessionManager when a session's process dies (abort, crash, or
   * natural exit — the one `handleClose` path). Any ask still pending for
   * that session has a dead `res` behind it (the mcpBridgeWorker process that
   * opened the HTTP connection died with the session), and the renderer-side
   * ask mark is now orphaned too (see ReviewSessionView.tsx/LearnSessionView.tsx's
   * `closed` handling) — nothing will ever call `answer()` for it again.
   * Deliberately does NOT call `resolve()`: the underlying HTTP socket is
   * already gone, and writing to it from here would risk an unhandled
   * rejection out of `handleRequest`'s still-suspended `await`. Dropping the
   * map entry just releases the reference so it can't accumulate across
   * repeated session aborts; the suspended request handler is left to be
   * garbage-collected with its dead socket, exactly as it would be if this
   * method didn't exist.
   */
  dropSession(sessionId: string): void {
    for (const [requestId, pending] of this.pendingAsks) {
      if (pending.sessionId === sessionId) this.pendingAsks.delete(requestId)
    }
  }

  get portNumber(): number {
    return this.port
  }
}

export const bridgeServer = new BridgeServer()
