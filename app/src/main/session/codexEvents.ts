import type { SessionEvent } from '../../shared/sessionEvents'
import type { CodexTranscriptEvent } from './codexTranscript'
import { BRIDGE_SERVER_NAME, CLAUDE_TOOL_PREFIX } from './permissionConfig'
import type { CodexWireMessage } from './codexAppServerClient'

export interface MappedCodexNotification {
  events: SessionEvent[]
  transcript: CodexTranscriptEvent[]
  turnId?: string
}

function paramsOf(message: CodexWireMessage): Record<string, unknown> {
  return message.params && typeof message.params === 'object' ? message.params as Record<string, unknown> : {}
}

/** Converts app-server's evolving protocol into Engram's narrow, stable
 * learner-facing event contract. Reasoning, command execution, and collab
 * agent traffic are omitted deliberately. */
export function mapCodexNotification(activeThreadId: string, message: CodexWireMessage): MappedCodexNotification {
  const events: SessionEvent[] = []
  const transcript: CodexTranscriptEvent[] = []
  const params = paramsOf(message)

  if (message.method === 'account/rateLimits/updated') {
    const rateLimits = params.rateLimits && typeof params.rateLimits === 'object' ? params.rateLimits as Record<string, unknown> : {}
    const primary = rateLimits.primary && typeof rateLimits.primary === 'object' ? rateLimits.primary as Record<string, unknown> : null
    const secondary = rateLimits.secondary && typeof rateLimits.secondary === 'object' ? rateLimits.secondary as Record<string, unknown> : null
    const reached = rateLimits.rateLimitReachedType != null
    const mostUrgent = [primary, secondary]
      .filter((window): window is Record<string, unknown> => window !== null)
      .sort((a, b) => (Number(b.usedPercent) || 0) - (Number(a.usedPercent) || 0))[0]
    const usedPercent = mostUrgent ? Number(mostUrgent.usedPercent) || 0 : 0
    if (reached || usedPercent >= 90) {
      events.push({
        type: 'rate_limit',
        status: reached ? 'rejected' : 'allowed_warning',
        resetsAt: typeof mostUrgent?.resetsAt === 'number' ? mostUrgent.resetsAt : null,
      })
    }
    return { events, transcript }
  }

  if (params.threadId !== activeThreadId) return { events, transcript }

  if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
    events.push({
      type: 'text',
      text: params.delta,
      append: true,
      itemId: typeof params.itemId === 'string' ? params.itemId : undefined,
    })
    return { events, transcript }
  }

  const item = params.item && typeof params.item === 'object' ? params.item as Record<string, unknown> : null
  if (message.method === 'item/completed' && item?.type === 'agentMessage' && typeof item.text === 'string') {
    transcript.push({ type: 'assistant_text', text: item.text })
    return { events, transcript }
  }

  if ((message.method === 'item/started' || message.method === 'item/completed') && item?.type === 'commandExecution') {
    if (typeof item.id !== 'string' || typeof item.command !== 'string') return { events, transcript }
    if (message.method === 'item/started') {
      const input = { command: item.command }
      events.push({ type: 'tool_use', id: item.id, name: 'Bash', input })
      transcript.push({ type: 'tool_use', id: item.id, name: 'Bash', input })
    } else {
      const isError = item.status === 'failed' || item.status === 'declined' || (typeof item.exitCode === 'number' && item.exitCode !== 0)
      const content = typeof item.aggregatedOutput === 'string' ? item.aggregatedOutput : ''
      events.push({ type: 'tool_result', toolUseId: item.id, isError, content })
      transcript.push({ type: 'tool_result', toolUseId: item.id, isError, content })
    }
    return { events, transcript }
  }

  if ((message.method === 'item/started' || message.method === 'item/completed') && item?.type === 'mcpToolCall') {
    if (item.server !== BRIDGE_SERVER_NAME || typeof item.id !== 'string' || typeof item.tool !== 'string') {
      return { events, transcript }
    }
    if (message.method === 'item/started') {
      const input = item.arguments && typeof item.arguments === 'object' ? item.arguments as Record<string, unknown> : {}
      events.push({ type: 'tool_use', id: item.id, name: `${CLAUDE_TOOL_PREFIX}${item.tool}`, input })
      transcript.push({ type: 'tool_use', id: item.id, name: item.tool, input })
    } else {
      const isError = item.status === 'failed' || Boolean(item.error)
      const content = item.result && typeof item.result === 'object'
        ? (item.result as Record<string, unknown>).content ?? item.result
        : item.error ?? item.result ?? null
      events.push({ type: 'tool_result', toolUseId: item.id, isError, content })
      transcript.push({ type: 'tool_result', toolUseId: item.id, isError, content })
    }
    return { events, transcript }
  }

  if (message.method === 'thread/tokenUsage/updated') {
    const tokenUsage = params.tokenUsage && typeof params.tokenUsage === 'object' ? params.tokenUsage as Record<string, unknown> : {}
    const last = tokenUsage.last && typeof tokenUsage.last === 'object' ? tokenUsage.last as Record<string, unknown> : {}
    const usedTokens = typeof last.totalTokens === 'number' ? last.totalTokens : 0
    const contextWindow = typeof tokenUsage.modelContextWindow === 'number' ? tokenUsage.modelContextWindow : 0
    if (contextWindow > 0) events.push({ type: 'usage', usedTokens, contextWindow })
    return { events, transcript }
  }

  if (message.method === 'turn/completed') {
    const turn = params.turn && typeof params.turn === 'object' ? params.turn as Record<string, unknown> : {}
    const error = turn.error && typeof turn.error === 'object' ? turn.error as Record<string, unknown> : {}
    const isError = turn.status === 'failed'
    events.push({
      type: 'turn_ended',
      isError,
      resultText: typeof error.message === 'string' ? error.message : null,
    })
    return { events, transcript, turnId: typeof turn.id === 'string' ? turn.id : undefined }
  }

  return { events, transcript }
}
