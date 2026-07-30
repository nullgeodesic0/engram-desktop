import { describe, it, expect } from 'vitest'
import { parseTicket, splitAroundTicket } from './ticketParser'

const REAL_REVIEW_TICKET = `\`\`\`
engram · review · quick ────────────────
topic     grad-quantum-mechanics   retained 7/33
due today 1                        pending 0
\`\`\``

describe('parseTicket', () => {
  it('parses a real fenced review ticket, including the mode segment', () => {
    const ticket = parseTicket(REAL_REVIEW_TICKET)
    expect(ticket).not.toBeNull()
    expect(ticket!.kind).toBe('review')
    expect(ticket!.mode).toBe('quick')
    expect(ticket!.fields).toEqual([
      { key: 'topic', value: 'grad-quantum-mechanics' },
      { key: 'retained', value: '7/33' },
      { key: 'due today', value: '1' },
      { key: 'pending', value: '0' },
    ])
  })

  it('treats mode as optional — Review tickets sometimes omit it entirely', () => {
    const noMode = '```\nengram · review ────────────────\ndue today 2\n```'
    const ticket = parseTicket(noMode)
    expect(ticket).not.toBeNull()
    expect(ticket!.kind).toBe('review')
    expect(ticket!.mode).toBeNull()
  })

  it('returns null for text with no fenced ticket block', () => {
    expect(parseTicket('just some ordinary prose, no fence at all')).toBeNull()
  })
})

describe('splitAroundTicket', () => {
  it('splits prose before and after the fence around the parsed ticket', () => {
    const text = `Getting started.\n\n${REAL_REVIEW_TICKET}\n\nOne item, right on schedule.`
    const result = splitAroundTicket(text)
    expect(result).not.toBeNull()
    expect(result!.before).toBe('Getting started.')
    expect(result!.after).toBe('One item, right on schedule.')
    expect(result!.ticket.kind).toBe('review')
  })
})
