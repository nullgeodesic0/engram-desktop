import { describe, expect, it } from 'vitest'
import { mapCodexNotification } from './codexEvents'

describe('mapCodexNotification', () => {
  it('maps tutor prose and Engram bridge calls without exposing reasoning or subagents', () => {
    expect(mapCodexNotification('thread-1', {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', itemId: 'message-1', delta: 'Try the boundary case.' },
    }).events).toEqual([{ type: 'text', text: 'Try the boundary case.', append: true, itemId: 'message-1' }])

    expect(mapCodexNotification('thread-1', {
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        item: { type: 'mcpToolCall', id: 'tool-1', server: 'engram-ui-bridge', tool: 'render_beat', arguments: { beat: 'predict' } },
      },
    }).events).toEqual([{ type: 'tool_use', id: 'tool-1', name: 'mcp__engram-ui-bridge__render_beat', input: { beat: 'predict' } }])

    expect(mapCodexNotification('thread-1', {
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId: 'thread-1', delta: 'private chain' },
    }).events).toEqual([])
  })

  it('maps bridge results, usage, and turn completion', () => {
    expect(mapCodexNotification('thread-1', {
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        item: { type: 'mcpToolCall', id: 'tool-1', server: 'engram-ui-bridge', tool: 'render_beat', status: 'completed', result: { content: [{ type: 'text', text: '{"ok":true}' }] } },
      },
    }).events).toEqual([{ type: 'tool_result', toolUseId: 'tool-1', isError: false, content: [{ type: 'text', text: '{"ok":true}' }] }])

    expect(mapCodexNotification('thread-1', {
      method: 'thread/tokenUsage/updated',
      params: { threadId: 'thread-1', tokenUsage: { last: { totalTokens: 180, inputTokens: 120, cachedInputTokens: 30 }, modelContextWindow: 200000 } },
    }).events).toEqual([{ type: 'usage', usedTokens: 180, contextWindow: 200000 }])

    expect(mapCodexNotification('thread-1', {
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed', error: { message: 'model unavailable' } } },
    }).events).toEqual([{ type: 'turn_ended', isError: true, resultText: 'model unavailable' }])
  })

  it('persists an authoritative completed message and maps commands as Bash-compatible tools', () => {
    expect(mapCodexNotification('thread-1', {
      method: 'item/completed',
      params: { threadId: 'thread-1', item: { type: 'agentMessage', id: 'message-1', text: 'Hello' } },
    }).transcript).toEqual([{ type: 'assistant_text', text: 'Hello' }])

    expect(mapCodexNotification('thread-1', {
      method: 'item/started',
      params: { threadId: 'thread-1', item: { type: 'commandExecution', id: 'cmd-1', command: 'python3 engram.py rate', status: 'inProgress' } },
    }).events).toEqual([{ type: 'tool_use', id: 'cmd-1', name: 'Bash', input: { command: 'python3 engram.py rate' } }])

    expect(mapCodexNotification('thread-1', {
      method: 'item/completed',
      params: { threadId: 'thread-1', item: { type: 'commandExecution', id: 'cmd-1', command: 'python3 engram.py rate', status: 'completed', aggregatedOutput: '{"node":"x","rating":"good"}', exitCode: 0 } },
    }).events).toEqual([{ type: 'tool_result', toolUseId: 'cmd-1', isError: false, content: '{"node":"x","rating":"good"}' }])
  })

  it('ignores notifications from other threads and non-Engram MCP servers', () => {
    expect(mapCodexNotification('thread-1', { method: 'item/agentMessage/delta', params: { threadId: 'thread-2', delta: 'wrong' } }).events).toEqual([])
    expect(mapCodexNotification('thread-1', {
      method: 'item/started',
      params: { threadId: 'thread-1', item: { type: 'mcpToolCall', id: 'x', server: 'untrusted', tool: 'x', arguments: {} } },
    }).events).toEqual([])
  })

  it('maps account-wide Codex subscription warnings and blocks', () => {
    expect(mapCodexNotification('thread-1', {
      method: 'account/rateLimits/updated',
      params: { rateLimits: { primary: { usedPercent: 94, resetsAt: 1234 }, secondary: null, rateLimitReachedType: null } },
    }).events).toEqual([{ type: 'rate_limit', status: 'allowed_warning', resetsAt: 1234 }])

    expect(mapCodexNotification('thread-1', {
      method: 'account/rateLimits/updated',
      params: { rateLimits: { primary: { usedPercent: 100, resetsAt: 5678 }, secondary: null, rateLimitReachedType: 'primary' } },
    }).events).toEqual([{ type: 'rate_limit', status: 'rejected', resetsAt: 5678 }])
  })
})
