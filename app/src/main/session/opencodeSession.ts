import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import * as http from 'node:http'
import { resolveOpencodeBinary } from './opencodeResolver'
import { prepareOpencodeSession, type OpencodeSessionSetup } from './opencodePermissions'
import { getAuthSettings } from './authSettings'
import { bridgeServer } from '../bridge/bridgeServer'
import { OpencodeEventMapper, parseOpencodeSseChunk } from './opencodeEvents'
import type { SessionEvent } from '../../shared/sessionEvents'

// Same watchdog threshold and rationale as SessionManager.ts (Claude) — a
// real turn can legitimately go quiet for a while (a slow tool call, heavy
// thinking); this only fires on TOTAL silence past that.
const STALL_THRESHOLD_MS = 90_000

// How long `opencode serve` gets to print its "listening on" line before
// start() gives up — matched against real observed startup time (~3-4s cold,
// measured live) with generous headroom for a first-run plugin self-extract.
const SERVE_BOOT_TIMEOUT_MS = 30_000

/**
 * Drives a sitting through `opencode serve` + Cursor's models (the
 * `cursor-acp` provider) instead of the Claude Code CLI — same public
 * contract as `SessionManager` (constructor, `sessionId`, `start`,
 * `sendUserMessage`, `sendUserMessageWhenReady`, `abort`, and an `'event'`
 * stream of `SessionEvent`s ending in `closed`), so `sessionHandlers.ts` and
 * everything downstream of it — the renderer, mark derivation, replay — runs
 * completely unaware of which provider actually drove a given sitting.
 *
 * ARCHITECTURE, verified against a real running `opencode serve` before any
 * of this was written (not read off documentation): one `opencode serve`
 * child process per sitting, mirroring Claude's one-child-per-sitting model,
 * chosen specifically so the MCP bridge connects ONCE at server startup and
 * stays connected for the whole sitting — the alternative (`opencode run`
 * once per turn) would cold-boot the bridge worker on every message. The
 * server exposes a real HTTP+SSE API (`POST /session`,
 * `POST /session/{id}/message`, `GET /event`) — no translating proxy sits
 * between this app and OpenCode, same "no proxy" shape as the local-model
 * provider, just over HTTP instead of a CLI's stdin/stdout.
 *
 * KNOWN LIMITATION — resume is NOT true conversation continuation. Claude's
 * `--resume <id>` reopens its own on-disk transcript by an id THIS app
 * chose; OpenCode mints its own server-side session ids and this app's
 * public `sessionId` (used for bridge routing and the sessions Map key) has
 * to be chosen synchronously in the constructor, before any HTTP call can
 * happen — so the two id spaces can never be unified the way Claude's is.
 * A "resumed" OpenCode sitting therefore starts a genuinely NEW OpenCode
 * session and sends the same kickoff message a fresh sitting would (see
 * `sessionHandlers.ts`'s `session:resume` — it always supplies a real
 * message, even on resume, which is what makes this a working degradation
 * rather than a silent dead session). What's lost is cross-restart memory of
 * the actual prior turns. A real fix likely exists — `POST /session` takes a
 * `parentID`, and `POST /session/{id}/fork` exists — but using either
 * correctly needs persisting the OpenCode-side id per Engram sitting and
 * verifying fork semantics live, which this pass didn't have room for.
 */
export class OpencodeSessionManager extends EventEmitter {
  readonly sessionId: string
  private readonly isResume: boolean
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null
  private baseUrl: string | null = null
  private opencodeSessionID: string | null = null
  private setup: OpencodeSessionSetup | null = null
  private mapper = new OpencodeEventMapper()
  private ended = false
  private turnOutstanding = false
  private stallTimer: ReturnType<typeof setTimeout> | null = null
  private sseRequest: http.ClientRequest | null = null

  private ready: Promise<void>
  private readyResolve!: () => void

  constructor(resumeSessionId?: string) {
    super()
    this.sessionId = resumeSessionId ?? randomUUID()
    this.isResume = Boolean(resumeSessionId)
    this.ready = new Promise((resolve) => {
      this.readyResolve = resolve
    })
  }

  async start(_initialMessage: string, _extraInstructions?: string): Promise<void> {
    // TEMPORARILY DISABLED (2026-08-14). Confirmed live against a real
    // sitting: the engram-ui-bridge MCP server connects successfully at the
    // OpenCode server level (GET /mcp reports "connected", the session's own
    // permission list allows every mcp__engram_ui_bridge__* tool) — but
    // those tool schemas never reach the model's actual function-calling
    // interface through the cursor-acp provider specifically. Across a real
    // 6-turn sitting the model never once called a bridge tool, only fell
    // back to its own bash/read, and — because the system prompt still names
    // tools it doesn't actually have — repeatedly (and reasonably) flagged
    // the setup as a prompt injection attempt.
    //
    // The rest of the class (session lifecycle, event mapping, MCP
    // registration) is otherwise verified working — the gap is specifically
    // MCP-tool delivery through cursor-acp, which likely needs a different
    // mechanism entirely (routing bridge interactions through Bash rather
    // than MCP) rather than a config fix. `startWhenBridgeWorks` below keeps
    // the working implementation live (compiled, type-checked) rather than
    // commented out to bit-rot, ready for whoever picks the redesign back
    // up to call instead of this guard.
    throw new Error(
      'OpenCode + Cursor mode is temporarily disabled: the bridge tools that drive tickets, questions and grading do not reach cursor-acp’s models, so a sitting cannot actually be taught. Switch to Claude Code subscription, API key, or a local model in Settings → Authentication.',
    )
  }

  /** The real implementation, preserved but unreachable from `start()` above
   * — see its doctrine comment. Everything from here down (port resolution,
   * SSE subscription, the httpJson helper, event dispatch) is verified
   * working and unrelated to the disabled gate; only the entry point moved.
   * Not `private`: an unused private method is dead code by definition and
   * the compiler says so (TS6133) — this one is deliberately unused FOR NOW,
   * kept type-checked and callable rather than commented out to bit-rot. */
  async startWhenBridgeWorks(initialMessage: string, extraInstructions?: string): Promise<void> {
    const port = await bridgeServer.start()
    const { opencodeModel } = await getAuthSettings()
    if (opencodeModel.trim() === '') {
      throw new Error(
        'OpenCode + Cursor mode is selected but no model is chosen — pick one in Settings → Authentication, or switch back to subscription mode.',
      )
    }
    this.setup = await prepareOpencodeSession(port, this.sessionId, opencodeModel, extraInstructions)

    const bin = await resolveOpencodeBinary()
    this.child = spawn(bin, ['serve', '--port', '0'], {
      cwd: this.setup.workspaceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OPENCODE_CONFIG: this.setup.opencodeConfigPath },
    })
    this.child.on('close', (code) => this.handleClose(code))
    this.child.on('error', (err) => this.emitEvent({ type: 'error', message: err.message }))
    this.child.stderr.on('data', (chunk: Buffer) => {
      console.error(`[opencode session ${this.sessionId}] stderr:`, chunk.toString('utf-8'))
    })

    const port2 = await this.waitForListeningPort()
    this.baseUrl = `http://127.0.0.1:${port2}`

    // No further use for stdout once the port is known — `opencode serve`
    // otherwise just logs INFO lines this app has no use for (confirmed live:
    // the real signal, "opencode server listening on ...", is the only line
    // worth parsing; everything else is config-search noise).
    this.child.stdout.removeAllListeners('data')

    // The title is purely a debugging aid (OpenCode's own session list, e.g.
    // `opencode session` on the command line) — it is NOT what makes resume
    // work, since it doesn't; see this class's own doctrine comment on why
    // resume always creates a genuinely new server-side session.
    const title = this.isResume ? 'Engram sitting (resumed — no prior context)' : 'Engram sitting'
    const created = await this.httpJson<{ id: string }>('POST', '/session', { title })
    this.opencodeSessionID = created.id
    this.readyResolve()

    this.subscribeToEvents()

    // Unlike Claude's `--resume` (which already has full prior context and
    // would treat a re-sent kickoff as a spurious extra turn), an OpenCode
    // "resume" is always a fresh server-side session — see this class's own
    // doctrine comment. It needs the kickoff exactly like a new sitting does,
    // so this is NOT gated on `!this.isResume` the way Claude's is.
    this.sendUserMessage(initialMessage)
  }

  sendUserMessage(text: string): void {
    if (!this.baseUrl || !this.opencodeSessionID || this.ended || !this.setup) return
    this.turnOutstanding = true
    this.armStallTimer()
    // Fire-and-forget, matching sendUserMessage's own `void` contract — the
    // turn's actual content arrives over the SSE subscription, not this
    // response. Confirmed live: `POST /session/{id}/message` blocks for the
    // full turn duration and returns the complete final message, so this
    // promise is left deliberately unawaited rather than making a `void`
    // method secretly synchronous-for-a-turn's-length.
    void this.httpJson('POST', `/session/${this.opencodeSessionID}/message`, {
      parts: [{ type: 'text', text }],
      model: this.setup.model,
      system: this.setup.systemPrompt,
      tools: this.setup.tools,
    }).catch((err: unknown) => {
      if (this.ended) return
      this.emitEvent({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    })
  }

  /** Same readiness contract as SessionManager's — resolves once the server
   * is up and a session exists, so a send arriving before that doesn't race
   * ahead of the HTTP calls it depends on. OpenCode's boot doesn't have
   * Claude's --resume-repair race this was originally built for, but the
   * 10s-cap-then-send-anyway shape is identical and callers (`sessionHandlers
   * .ts`'s `session:send`) already route every send through this uniformly
   * regardless of provider. */
  async sendUserMessageWhenReady(text: string): Promise<void> {
    await Promise.race([this.ready, new Promise((r) => setTimeout(r, 10_000))])
    this.sendUserMessage(text)
  }

  abort(): void {
    this.clearStallTimer()
    this.sseRequest?.destroy()
    this.child?.kill()
  }

  private waitForListeningPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = this.child!
      const timer = setTimeout(() => {
        reject(new Error('opencode serve did not report a listening port within 30s'))
      }, SERVE_BOOT_TIMEOUT_MS)
      const onData = (chunk: Buffer) => {
        const match = chunk.toString('utf-8').match(/listening on http:\/\/[^:]+:(\d+)/)
        if (match) {
          clearTimeout(timer)
          child.stdout.off('data', onData)
          resolve(Number(match[1]))
        }
      }
      child.stdout.on('data', onData)
      child.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        reject(new Error(`opencode serve exited before starting (code ${code})`))
      })
    })
  }

  /** node:http, deliberately not fetch/undici — same reasoning
   * mcpBridgeWorker.mjs documents for its own postJson: undici's default
   * headersTimeout has been observed in this codebase to kill long-pending
   * requests, and `/session/{id}/message` is exactly that (confirmed live:
   * a real turn held the connection open for the full generation). */
  private httpJson<T>(method: string, path: string, body: unknown): Promise<T> {
    const directory = this.setup!.workspaceDir
    const url = new URL(`${this.baseUrl}${path}`)
    url.searchParams.set('directory', directory)
    const payload = JSON.stringify(body)
    return new Promise((resolve, reject) => {
      const req = http.request(
        url,
        {
          method,
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8')
            if ((res.statusCode ?? 500) >= 400) {
              reject(new Error(`opencode ${method} ${path} -> ${res.statusCode}: ${text.slice(0, 300)}`))
              return
            }
            try {
              resolve(text ? JSON.parse(text) : ({} as T))
            } catch (err) {
              reject(err)
            }
          })
        },
      )
      req.on('error', reject)
      req.write(payload)
      req.end()
    })
  }

  private subscribeToEvents(): void {
    const directory = this.setup!.workspaceDir
    const url = new URL(`${this.baseUrl}/event`)
    url.searchParams.set('directory', directory)
    let buffered = ''
    const req = http.request(url, { method: 'GET' }, (res) => {
      res.setEncoding('utf-8')
      res.on('data', (chunk: string) => {
        buffered += chunk
        const { events, rest } = parseOpencodeSseChunk(buffered)
        buffered = rest
        for (const raw of events) {
          const properties = raw.properties as { sessionID?: string } | undefined
          // The bus is GLOBAL (every session `opencode serve` knows about),
          // not scoped to this one — confirmed live (`server.connected`,
          // `catalog.updated` etc. carry no sessionID at all). Only events
          // that DO name a sessionID are filtered; the rest are dropped by
          // OpencodeEventMapper's own default case regardless, so letting
          // sessionID-less events through to it is harmless, but filtering
          // first avoids doing that work for a bus this manager will only
          // ever have one real session on.
          if (properties?.sessionID && properties.sessionID !== this.opencodeSessionID) continue
          this.handleActivity()
          for (const event of this.mapper.map(raw)) this.dispatch(event)
        }
      })
      res.on('error', (err) => {
        if (this.ended) return
        this.emitEvent({ type: 'error', message: err.message })
      })
    })
    req.on('error', (err) => {
      if (this.ended) return
      this.emitEvent({ type: 'error', message: err.message })
    })
    req.end()
    this.sseRequest = req
  }

  /** turn_ended from the mapper needs the same bookkeeping SessionManager's
   * own 'result' branch does (clear turnOutstanding, stop the watchdog)
   * before it goes out — kept in one place rather than duplicated at every
   * mapper call site. */
  private dispatch(event: SessionEvent): void {
    if (event.type === 'turn_ended') {
      this.turnOutstanding = false
      this.clearStallTimer()
    }
    this.emitEvent(event)
  }

  private handleActivity(): void {
    this.armStallTimer()
  }

  private armStallTimer(): void {
    this.clearStallTimer()
    if (!this.turnOutstanding) return
    this.stallTimer = setTimeout(() => {
      this.emitEvent({ type: 'stall', seconds: STALL_THRESHOLD_MS / 1000 })
    }, STALL_THRESHOLD_MS)
  }

  private clearStallTimer(): void {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer)
      this.stallTimer = null
    }
  }

  private handleClose(code: number | null): void {
    this.ended = true
    this.turnOutstanding = false
    this.clearStallTimer()
    this.sseRequest?.destroy()
    bridgeServer.dropSession(this.sessionId)
    this.emitEvent({ type: 'closed', exitCode: code })
    void this.setup?.cleanup()
  }

  private emitEvent(event: SessionEvent): void {
    this.emit('event', event)
  }
}
