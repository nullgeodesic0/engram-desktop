import { describe, it, expect } from 'vitest'
import { OpencodeEventMapper, parseOpencodeSseChunk } from './opencodeEvents'

// Every fixture below is a byte-for-byte capture from a real `opencode serve`
// (0.32.9 CLI / 1.18.18 server) driving one real turn through `cursor-acp/auto`
// with the message "Reply with exactly one word: pong" — not hand-written.
// Session/message/part ids are real ids from that run.
const REAL = {
  serverConnected: '{"id":"evt_0006208ca001GTcKiqb7KEFAiA","type":"server.connected","properties":{}}',
  userTextPart:
    '{"id":"evt_0006ff9470010xWkhPPJJVOwHw","type":"message.part.updated","properties":{"sessionID":"ses_fff900bddffevPXhgcQV36OkNi","part":{"type":"text","text":"Reply with exactly one word: pong","messageID":"msg_0006ff840001kYs7Pa3nOFl3VL","sessionID":"ses_fff900bddffevPXhgcQV36OkNi","id":"prt_0006ff847001kREF93TIdPDm6X"},"time":1786713733447}}',
  reasoningStart:
    '{"id":"evt_000702b00001xm24vmCb2c0sla","type":"message.part.updated","properties":{"sessionID":"ses_fff900bddffevPXhgcQV36OkNi","part":{"id":"prt_000702b00001nNNecTbfElELm5","messageID":"msg_0006ff954001Lznbid42V2hf4E","sessionID":"ses_fff900bddffevPXhgcQV36OkNi","type":"reasoning","text":"","time":{"start":1786713746176}},"time":1786713746176}}',
  textPartStart:
    '{"id":"evt_000702b0800115S6okPVkS1p19","type":"message.part.updated","properties":{"sessionID":"ses_fff900bddffevPXhgcQV36OkNi","part":{"id":"prt_000702b08001rh1WhaPZLtH2IV","messageID":"msg_0006ff954001Lznbid42V2hf4E","sessionID":"ses_fff900bddffevPXhgcQV36OkNi","type":"text","text":"","time":{"start":1786713746184}},"time":1786713746184}}',
  textDelta:
    '{"id":"evt_000702b0b001Twa2TILRWCeRXM","type":"message.part.delta","properties":{"sessionID":"ses_fff900bddffevPXhgcQV36OkNi","messageID":"msg_0006ff954001Lznbid42V2hf4E","partID":"prt_000702b08001rh1WhaPZLtH2IV","field":"text","delta":"pong"}}',
  textPartFinal:
    '{"id":"evt_000702cee001jdr7oSLu1TCqIi","type":"message.part.updated","properties":{"sessionID":"ses_fff900bddffevPXhgcQV36OkNi","part":{"id":"prt_000702b08001rh1WhaPZLtH2IV","messageID":"msg_0006ff954001Lznbid42V2hf4E","sessionID":"ses_fff900bddffevPXhgcQV36OkNi","type":"text","text":"pong","time":{"start":1786713746184,"end":1786713746670}},"time":1786713746670}}',
  sessionStatusBusy:
    '{"id":"evt_0006ff951001hGFuTc300Wb6w6","type":"session.status","properties":{"sessionID":"ses_fff900bddffevPXhgcQV36OkNi","status":{"type":"busy"}}}',
  sessionIdle:
    '{"id":"evt_000702cfc002P8lIDteGs58Oep","type":"session.idle","properties":{"sessionID":"ses_fff900bddffevPXhgcQV36OkNi"}}',
}

function sse(...lines: string[]): string {
  return lines.map((l) => `data: ${l}\n\n`).join('')
}

describe('parseOpencodeSseChunk', () => {
  it('parses one or more complete data: blocks from a real capture', () => {
    const { events, rest } = parseOpencodeSseChunk(sse(REAL.serverConnected, REAL.sessionIdle))
    expect(events).toHaveLength(2)
    expect(events[0].type).toBe('server.connected')
    expect(events[1].type).toBe('session.idle')
    expect(rest).toBe('')
  })

  it('holds back an incomplete trailing block for the next chunk', () => {
    const full = sse(REAL.serverConnected)
    const partial = full + 'data: {"id":"evt_x","type":"session.i'
    const { events, rest } = parseOpencodeSseChunk(partial)
    expect(events).toHaveLength(1)
    expect(rest).toBe('data: {"id":"evt_x","type":"session.i')
  })

  it('drops a malformed block without losing the well-formed ones around it', () => {
    const { events } = parseOpencodeSseChunk(sse(REAL.serverConnected, 'data: not json at all', REAL.sessionIdle))
    expect(events.map((e) => e.type)).toEqual(['server.connected', 'session.idle'])
  })

  it('ignores lines that are not a data: field', () => {
    const { events } = parseOpencodeSseChunk(`: heartbeat comment\n\n${sse(REAL.sessionIdle)}`)
    expect(events).toHaveLength(1)
  })
})

describe('OpencodeEventMapper', () => {
  it('maps a real text delta to a SessionTextEvent carrying just the increment', () => {
    const mapper = new OpencodeEventMapper()
    const [out] = mapper.map(JSON.parse(REAL.textDelta))
    expect(out).toEqual({ type: 'text', text: 'pong' })
  })

  it('does not re-emit text from message.part.updated — only message.part.delta carries it', () => {
    // The cumulative full-text-so-far shape of `part.updated` would double
    // the output if both were treated as text sources (e.g. "" then "pong"
    // then "pong" again) — updated events for a text part must map to
    // nothing, deltas are the only text channel.
    const mapper = new OpencodeEventMapper()
    expect(mapper.map(JSON.parse(REAL.textPartStart))).toEqual([])
    expect(mapper.map(JSON.parse(REAL.textPartFinal))).toEqual([])
  })

  it('maps a real session.idle to exactly one turn_ended, clean', () => {
    const mapper = new OpencodeEventMapper()
    expect(mapper.map(JSON.parse(REAL.sessionIdle))).toEqual([{ type: 'turn_ended', isError: false, resultText: null }])
  })

  it('drops bookkeeping event types this app has no use for', () => {
    const mapper = new OpencodeEventMapper()
    for (const raw of [REAL.serverConnected, REAL.sessionStatusBusy, REAL.reasoningStart]) {
      expect(mapper.map(JSON.parse(raw))).toEqual([])
    }
  })

  it('replays the real captured turn in order and produces the right event sequence', () => {
    const mapper = new OpencodeEventMapper()
    const sequence = [
      REAL.userTextPart,
      REAL.sessionStatusBusy,
      REAL.reasoningStart,
      REAL.textPartStart,
      REAL.textDelta,
      REAL.textPartFinal,
      REAL.sessionIdle,
    ]
    const out = sequence.flatMap((raw) => mapper.map(JSON.parse(raw)))
    expect(out).toEqual([
      { type: 'text', text: 'pong' },
      { type: 'turn_ended', isError: false, resultText: null },
    ])
  })

  describe('tool parts', () => {
    const running = {
      id: 'evt_1',
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_x',
        part: {
          id: 'prt_tool1',
          type: 'tool',
          callID: 'call_1',
          tool: 'mcp__engram_ui_bridge__render_ticket',
          state: { status: 'running', input: { node: 'kepler-orbits', index: 1 } },
        },
      },
    }
    const completed = {
      id: 'evt_2',
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_x',
        part: {
          id: 'prt_tool1',
          type: 'tool',
          callID: 'call_1',
          tool: 'mcp__engram_ui_bridge__render_ticket',
          state: { status: 'completed', input: { node: 'kepler-orbits', index: 1 }, output: 'ok' },
        },
      },
    }
    const errored = {
      id: 'evt_3',
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses_x',
        part: {
          id: 'prt_tool2',
          type: 'tool',
          callID: 'call_2',
          tool: 'mcp__engram_ui_bridge__ask_user_question',
          state: { status: 'error', input: {}, error: 'boom' },
        },
      },
    }

    it('maps a running tool part to tool_use with its parsed input', () => {
      const mapper = new OpencodeEventMapper()
      expect(mapper.map(running as never)).toEqual([
        { type: 'tool_use', id: 'call_1', name: 'mcp__engram_ui_bridge__render_ticket', input: { node: 'kepler-orbits', index: 1 } },
      ])
    })

    it('maps a completed tool part to tool_result, not another tool_use', () => {
      const mapper = new OpencodeEventMapper()
      mapper.map(running as never)
      expect(mapper.map(completed as never)).toEqual([
        { type: 'tool_result', toolUseId: 'call_1', isError: false, content: 'ok' },
      ])
    })

    it('maps an errored tool part to an isError tool_result carrying the error', () => {
      const mapper = new OpencodeEventMapper()
      expect(mapper.map(errored as never)).toEqual([{ type: 'tool_result', toolUseId: 'call_2', isError: true, content: 'boom' }])
    })

    it('does not repeat an identical (callID, status) pair', () => {
      const mapper = new OpencodeEventMapper()
      mapper.map(running as never)
      expect(mapper.map(running as never)).toEqual([]) // same status re-sent — no duplicate tool_use
    })
  })

  it('maps session.error to both an error event and an errored turn_ended', () => {
    const mapper = new OpencodeEventMapper()
    const raw = { id: 'evt_e', type: 'session.error', properties: { sessionID: 'ses_x', error: { message: 'boom' } } }
    expect(mapper.map(raw as never)).toEqual([
      { type: 'error', message: 'boom' },
      { type: 'turn_ended', isError: true, resultText: 'boom' },
    ])
  })
})
