import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexTranscriptStore, codexTranscriptLine } from './codexTranscript'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Codex transcript normalization', () => {
  it('uses the Claude-shaped rows consumed by existing replay code', () => {
    expect(codexTranscriptLine({ type: 'assistant_text', text: 'A mechanism.' }, '2026-01-01T00:00:00Z')).toEqual({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'A mechanism.' }] },
    })
    expect(
      codexTranscriptLine(
        { type: 'tool_use', id: 'call-1', name: 'render_ticket', input: { kind: 'learn' } },
        '2026-01-01T00:00:01Z',
      ),
    ).toMatchObject({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'call-1', name: 'mcp__engram-ui-bridge__render_ticket', input: { kind: 'learn' } }],
      },
    })
    expect(
      codexTranscriptLine(
        { type: 'tool_use', id: 'cmd-1', name: 'Bash', input: { command: 'python3 engram.py rate' } },
        '2026-01-01T00:00:01Z',
      ),
    ).toMatchObject({ message: { content: [{ name: 'Bash' }] } })
    expect(
      codexTranscriptLine(
        { type: 'tool_result', toolUseId: 'call-1', isError: false, content: [{ type: 'text', text: 'ok' }] },
        '2026-01-01T00:00:02Z',
      ),
    ).toMatchObject({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', is_error: false }] },
    })
  })

  it('persists rows in append order and reads them back after a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engram-codex-transcript-test-'))
    roots.push(root)
    const writer = new CodexTranscriptStore(root, 'session-1')
    await writer.append(codexTranscriptLine({ type: 'user_text', text: 'first' }, '2026-01-01T00:00:00Z'))
    await writer.append(codexTranscriptLine({ type: 'assistant_text', text: 'second' }, '2026-01-01T00:00:01Z'))

    const reader = new CodexTranscriptStore(root, 'session-1')
    expect(await reader.read()).toMatchObject([
      { type: 'user', message: { content: 'first' } },
      { type: 'assistant', message: { content: [{ text: 'second' }] } },
    ])
  })

  it('waits for in-flight writes started by another store instance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'engram-codex-transcript-test-'))
    roots.push(root)
    const writer = new CodexTranscriptStore(root, 'session-race')
    void writer.append(codexTranscriptLine({ type: 'user_text', text: 'durable' }, '2026-01-01T00:00:00Z'))

    const reader = new CodexTranscriptStore(root, 'session-race')
    expect(await reader.read()).toMatchObject([
      { type: 'user', message: { content: 'durable' } },
    ])
  })

  it('refuses a session id that could escape the transcript directory', () => {
    expect(() => new CodexTranscriptStore('/safe', '../outside')).toThrow('Invalid Codex session id')
  })
})
