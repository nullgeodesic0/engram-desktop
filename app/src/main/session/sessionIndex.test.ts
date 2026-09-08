import { describe, expect, it } from 'vitest'
import { findLastSessionEntry, normalizeSessionIndex } from './sessionIndex'

describe('session index provider metadata', () => {
  it('migrates legacy rows to Claude without changing their public id or date', () => {
    expect(
      normalizeSessionIndex({
        calculus: { sessionId: 'old-id', key: 'calculus', startedAt: '2026-01-02T03:04:05.000Z' },
      }),
    ).toEqual({
      calculus: [
        {
          sessionId: 'old-id',
          providerSessionId: 'old-id',
          provider: 'claude',
          model: 'Claude default',
          key: 'calculus',
          startedAt: '2026-01-02T03:04:05.000Z',
        },
      ],
    })
  })

  it('finds only the newest session owned by the selected provider', () => {
    const index = normalizeSessionIndex({
      review: [
        { sessionId: 'claude-1', provider: 'claude', providerSessionId: 'claude-1', model: 'Sonnet', key: 'review', startedAt: '2026-01-01T00:00:00Z' },
        { sessionId: 'codex-1', provider: 'codex', providerSessionId: 'thread-1', model: 'GPT Fast', key: 'review', startedAt: '2026-01-02T00:00:00Z' },
        { sessionId: 'claude-2', provider: 'claude', providerSessionId: 'claude-2', model: 'Haiku', key: 'review', startedAt: '2026-01-03T00:00:00Z' },
      ],
    })

    expect(findLastSessionEntry(index, 'review', 'codex')?.providerSessionId).toBe('thread-1')
    expect(findLastSessionEntry(index, 'review', 'claude')?.sessionId).toBe('claude-2')
  })

  it('drops malformed rows instead of making them resumable', () => {
    expect(normalizeSessionIndex({ review: [{ provider: 'codex' }, null, 4] })).toEqual({ review: [] })
  })
})
