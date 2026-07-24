import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { resolveEngramPlugin } from './pluginResolver'
import { resolveClaudeBinary } from './claudeResolver'
import { prepareSessionPermissions, type SessionPermissionSetup } from './permissionConfig'
import { NdjsonLineSplitter } from './streamParser'
import { bridgeServer } from '../bridge/bridgeServer'
import type { SessionEvent } from '../../shared/sessionEvents'
import { homedir } from 'node:os'

interface RawToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
interface RawTextBlock {
  type: 'text'
  text: string
}
type RawContentBlock = RawToolUseBlock | RawTextBlock | { type: string; [k: string]: unknown }

export class SessionManager extends EventEmitter {
  readonly sessionId: string
  private readonly isResume: boolean
  private child: ChildProcessWithoutNullStreams | null = null
  private splitter = new NdjsonLineSplitter()
  private permissions: SessionPermissionSetup | null = null
  private ended = false

  /**
   * `resumeSessionId`, when given, continues a previous Claude Code conversation
   * (`--resume`) instead of starting a fresh one (`--session-id`) — the UI-convenience
   * pointer lives in sessionIndex.ts, not here; this class just does what it's told.
   * `this.sessionId` is always the id actually in effect either way, since it's what
   * bridgeServer routes bridge:ask/bridge:beat requests by.
   */
  constructor(resumeSessionId?: string) {
    super()
    this.sessionId = resumeSessionId ?? randomUUID()
    this.isResume = Boolean(resumeSessionId)
  }

  /** `extraInstructions` — per-topic system-prompt addition, see topicSettings.ts. Ignored on resume (the prior turn's system prompt already governs the conversation; --resume doesn't accept a new one). */
  async start(initialMessage: string, extraInstructions?: string): Promise<void> {
    const { scriptPath } = resolveEngramPlugin() // fail fast if the plugin isn't resolvable
    void scriptPath
    const port = await bridgeServer.start()
    this.permissions = await prepareSessionPermissions(port, this.sessionId, extraInstructions)

    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--tools', this.permissions.tools,
      '--disallowedTools', this.permissions.disallowedTools,
      '--allowedTools', this.permissions.allowedTools,
      // Required for --input-format stream-json to run ANY tool at all — without it every
      // Bash call is denied with a generic "requires approval" gate (confirmed by direct
      // repro; --output-format-only `-p "text"` mode does not have this requirement).
      // --disallowedTools patterns are still enforced under bypass (also confirmed by
      // direct repro: `rm -rf` was denied even with bypassPermissions active), which is
      // what keeps the "scoped allowlist" intent alive despite the blunter flag name.
      '--permission-mode', 'bypassPermissions',
      '--mcp-config', this.permissions.mcpConfigPath,
      '--strict-mcp-config',
      '--append-system-prompt', this.permissions.appendSystemPrompt,
      ...(this.isResume ? ['--resume', this.sessionId] : ['--session-id', this.sessionId]),
    ]

    const claudeBin = await resolveClaudeBinary()
    this.child = spawn(claudeBin, args, {
      cwd: homedir(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk.toString('utf-8')))
    this.child.stderr.on('data', (chunk: Buffer) => {
      // Not surfaced as UI events by default — noisy on a clean run — but kept
      // for diagnostics; a real "unexpected crash" shows up via the 'close' handler instead.
      console.error(`[session ${this.sessionId}] stderr:`, chunk.toString('utf-8'))
    })
    this.child.on('close', (code) => this.handleClose(code))
    this.child.on('error', (err) => this.emitEvent({ type: 'error', message: err.message }))

    // A resumed session already has full prior context — the whole point of --resume —
    // so re-sending the kickoff message here would land as a fresh, spurious turn on top
    // of a conversation that's already exactly where it left off. Only a genuinely new
    // session needs to be told what to do.
    if (!this.isResume) {
      this.sendUserMessage(initialMessage)
    }
  }

  sendUserMessage(text: string): void {
    if (!this.child || this.ended) return
    const message = { type: 'user', message: { role: 'user', content: text } }
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  abort(): void {
    this.child?.kill()
  }

  private handleStdout(chunk: string): void {
    for (const raw of this.splitter.push(chunk)) {
      this.handleRawEvent(raw as Record<string, unknown>)
    }
  }

  private handleRawEvent(d: Record<string, unknown>): void {
    const type = d.type as string

    if (type === 'assistant') {
      const message = d.message as { content?: RawContentBlock[] } | undefined
      for (const block of message?.content ?? []) {
        if (block.type === 'text') {
          this.emitEvent({ type: 'text', text: (block as RawTextBlock).text })
        } else if (block.type === 'tool_use') {
          const b = block as RawToolUseBlock
          this.emitEvent({ type: 'tool_use', id: b.id, name: b.name, input: b.input })
        }
      }
      return
    }

    if (type === 'user') {
      const message = d.message as { content?: unknown[] } | undefined
      for (const block of message?.content ?? []) {
        const b = block as { type?: string; tool_use_id?: string; is_error?: boolean; content?: unknown }
        if (b?.type === 'tool_result') {
          this.emitEvent({
            type: 'tool_result',
            toolUseId: b.tool_use_id ?? '',
            isError: Boolean(b.is_error),
            content: b.content,
          })
        }
      }
      return
    }

    if (type === 'rate_limit_event') {
      const info = d.rate_limit_info as { status?: string; resetsAt?: number } | undefined
      this.emitEvent({ type: 'rate_limit', status: info?.status ?? 'unknown', resetsAt: info?.resetsAt ?? null })
      return
    }

    if (type === 'result') {
      const usage = d.usage as
        | { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
        | undefined
      const modelUsage = d.modelUsage as Record<string, { contextWindow?: number }> | undefined
      const contextWindow = modelUsage ? Object.values(modelUsage)[0]?.contextWindow : undefined
      if (usage && contextWindow) {
        // Total prompt size for the latest turn — input + cache-creation + cache-read
        // tokens together are what's actually "in context" right now, per the engine's
        // own accounting (never estimated client-side).
        const usedTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
        this.emitEvent({ type: 'usage', usedTokens, contextWindow })
      }
      this.emitEvent({
        type: 'turn_ended',
        isError: Boolean(d.is_error),
        resultText: typeof d.result === 'string' ? d.result : null,
      })
    }
  }

  private handleClose(code: number | null): void {
    this.ended = true
    this.emitEvent({ type: 'closed', exitCode: code })
    void this.permissions?.cleanup()
  }

  private emitEvent(event: SessionEvent): void {
    this.emit('event', event)
  }
}
