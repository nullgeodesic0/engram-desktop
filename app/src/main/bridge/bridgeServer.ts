import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { BridgeAskRequest, BridgeAskResponse, BridgeBeatRequest, BridgeUiRequest } from '../../shared/bridgeProtocol'
import { sanitizeAnnotatePayload, setNodeAnnotation } from '../session/mapAnnotations'

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
  private pendingAsks = new Map<string, (res: BridgeAskResponse) => void>()
  private window: BrowserWindow | null = null

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

    if (askMatch) {
      const sessionId = decodeURIComponent(askMatch[1])
      const payload = JSON.parse(body) as Omit<BridgeAskRequest, 'sessionId' | 'requestId'>
      const requestId = randomUUID()
      const request: BridgeAskRequest = { ...payload, sessionId, requestId }

      const answer = await new Promise<BridgeAskResponse>((resolve) => {
        this.pendingAsks.set(requestId, resolve)
        this.window?.webContents.send('bridge:ask', request)
      })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(answer))
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
    const resolve = this.pendingAsks.get(requestId)
    if (!resolve) return
    this.pendingAsks.delete(requestId)
    resolve(response)
  }

  get portNumber(): number {
    return this.port
  }
}

export const bridgeServer = new BridgeServer()
