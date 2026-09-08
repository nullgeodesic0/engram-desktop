import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BRIDGE_TOOL_NAMES, CLAUDE_TOOL_PREFIX } from './permissionConfig'

const pendingWrites = new Map<string, Promise<void>>()

export type CodexTranscriptEvent =
  | { type: 'user_text'; text: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; isError: boolean; content: unknown }
  | { type: 'usage'; usedTokens: number; contextWindow: number; model: string }

/** Builds the provider-neutral transcript rows every existing replay and
 * export parser already consumes. Codex reasoning and shell activity have no
 * representation here and therefore cannot leak into learner-facing history. */
export function codexTranscriptLine(event: CodexTranscriptEvent, timestamp = new Date().toISOString()): Record<string, unknown> {
  if (event.type === 'user_text') {
    return { type: 'user', timestamp, message: { role: 'user', content: event.text } }
  }
  if (event.type === 'assistant_text') {
    return { type: 'assistant', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: event.text }] } }
  }
  if (event.type === 'tool_use') {
    return {
      type: 'assistant',
      timestamp,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: event.id,
          name: BRIDGE_TOOL_NAMES.includes(event.name) ? `${CLAUDE_TOOL_PREFIX}${event.name}` : event.name,
          input: event.input,
        }],
      },
    }
  }
  if (event.type === 'tool_result') {
    return {
      type: 'user',
      timestamp,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: event.toolUseId, is_error: event.isError, content: event.content }],
      },
    }
  }
  return {
    type: 'result',
    timestamp,
    usage: { input_tokens: event.usedTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    modelUsage: { [event.model]: { contextWindow: event.contextWindow } },
  }
}

export class CodexTranscriptStore {
  private readonly path: string
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly root: string, sessionId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error('Invalid Codex session id')
    this.path = join(root, `${sessionId}.jsonl`)
  }

  append(line: unknown): Promise<void> {
    const prior = pendingWrites.get(this.path) ?? this.writes
    this.writes = prior.then(async () => {
      await mkdir(this.root, { recursive: true })
      await appendFile(this.path, `${JSON.stringify(line)}\n`, 'utf-8')
    })
    pendingWrites.set(this.path, this.writes)
    return this.writes
  }

  async flush(): Promise<void> {
    await (pendingWrites.get(this.path) ?? this.writes)
  }

  async read(): Promise<unknown[]> {
    await this.flush()
    let text: string
    try {
      text = await readFile(this.path, 'utf-8')
    } catch {
      return []
    }
    return text
      .split('\n')
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line)]
        } catch {
          return []
        }
      })
  }
}

export async function flushAllCodexTranscripts(): Promise<void> {
  await Promise.all([...pendingWrites.values()])
}
