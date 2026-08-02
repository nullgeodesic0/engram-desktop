import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { resolveEngramPlugin } from './pluginResolver'
import { resolveClaudeBinary } from './claudeResolver'
import { prepareSessionPermissions, type SessionPermissionSetup } from './permissionConfig'
import { NdjsonLineSplitter } from './streamParser'
import { bridgeServer } from '../bridge/bridgeServer'
import type { SessionEvent } from '../../shared/sessionEvents'
import { isTaskNotificationContent } from '../../shared/taskNotification'
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

// Watchdog (Phase 3) — how long the child process can go without ANY stdout
// activity while a turn is outstanding before the UI is told it's stalled.
// Deliberately generous: a real turn can spend a long time thinking or
// running a slow Bash call with no partial-message output in between; this
// is a "something's wrong" signal for a session that's gone truly silent,
// not a normal-latency warning.
const STALL_THRESHOLD_MS = 90_000

export class SessionManager extends EventEmitter {
  readonly sessionId: string
  private readonly isResume: boolean
  private child: ChildProcessWithoutNullStreams | null = null
  private splitter = new NdjsonLineSplitter()
  private permissions: SessionPermissionSetup | null = null
  private ended = false
  private turnOutstanding = false
  private stallTimer: ReturnType<typeof setTimeout> | null = null

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
    const { root: engramRoot } = resolveEngramPlugin() // fail fast if the plugin isn't resolvable
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
      // ENGRAM_ROOT: the skills' own engine-locator bootstrap probes
      // $OPENCODE_PLUGIN_ROOT → $CLAUDE_PLUGIN_ROOT → $CODEX_PLUGIN_ROOT →
      // $ENGRAM_ROOT → … for a dir containing scripts/engram.py. None of the
      // plugin-root vars exist in this headless spawn, so without this the
      // locator exits 2 on the FIRST engram call of nearly every sitting
      // (real-transcript evidence: "engram: engine not found — set
      // ENGRAM_ROOT to your engram checkout"), the tool-failure card fires,
      // and the tutor burns a turn re-finding the engine by hand. The
      // resolver's root is guaranteed to contain scripts/engram.py (that
      // filter is how it picks a version), which is exactly the locator's
      // own test — the sanctioned dev-clone hook, not a plugin modification.
      env: { ...process.env, ENGRAM_ROOT: engramRoot },
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
    this.turnOutstanding = true
    this.armStallTimer()
  }

  abort(): void {
    this.clearStallTimer()
    this.child?.kill()
  }

  /** (Re)starts the stall watchdog — called on every genuine stdout activity
   * while a turn is outstanding, so it only ever fires after a real gap of
   * total silence, never merely because a turn is taking a while. */
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

  private handleStdout(chunk: string): void {
    this.armStallTimer()
    for (const raw of this.splitter.push(chunk)) {
      this.handleRawEvent(raw as Record<string, unknown>)
    }
  }

  private handleRawEvent(d: Record<string, unknown>): void {
    const type = d.type as string

    // Sidechain traffic: a spawned subagent's OWN records (its prose, tool
    // calls, and tool results) are forwarded onto the parent session's stdout
    // as ordinary 'assistant'/'user' records, distinguished ONLY by a
    // non-null parent_tool_use_id (the spawning Agent call's id; the tutor's
    // own records carry null — verified on a live wire capture, 2026-08).
    // Without this gate the curriculum architect's final message — the entire
    // add-topic JSON — streams into the transcript as tutor prose, fused to
    // whatever bubble was open. Nothing a subagent says is ever the tutor's
    // voice: drop it all here, at the single entry point, so no downstream
    // branch has to remember to check.
    if (d.parent_tool_use_id != null) return

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
      const message = d.message as { content?: unknown } | undefined
      const content = message?.content

      // A background-agent completion (e.g. the assessor audit — see
      // ritualFromTranscript.ts's AUDIT doctrine comment) arrives as a bare
      // STRING here, not the tool_result ARRAY shape below — the two never
      // overlap, so they're handled as fully separate branches rather than
      // one loop assuming an array. A genuine learner turn is also a bare
      // string but never starts with the notification envelope's tag, so it
      // correctly falls through to "no event" (chatMessages.ts renders it as
      // a real chat bubble; this handler has nothing live to add for it).
      if (typeof content === 'string') {
        if (isTaskNotificationContent(content)) {
          this.emitEvent({ type: 'task_notification', content })
        }
        return
      }

      if (Array.isArray(content)) {
        for (const block of content) {
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
      this.turnOutstanding = false
      this.clearStallTimer()
      this.emitEvent({
        type: 'turn_ended',
        isError: Boolean(d.is_error),
        resultText: typeof d.result === 'string' ? d.result : null,
      })
    }
  }

  private handleClose(code: number | null): void {
    this.ended = true
    this.turnOutstanding = false
    this.clearStallTimer()
    // The process behind any still-open bridge:ask for this session just
    // died (abort, crash, or natural exit — this IS that one path); its
    // pendingAsks entry now holds a resolver for an HTTP response nothing
    // will ever answer. See bridgeServer.dropSession's own doctrine comment.
    bridgeServer.dropSession(this.sessionId)
    this.emitEvent({ type: 'closed', exitCode: code })
    void this.permissions?.cleanup()
  }

  private emitEvent(event: SessionEvent): void {
    this.emit('event', event)
  }
}
