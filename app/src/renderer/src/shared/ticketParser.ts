import type { ChatMessage } from '../../../shared/chatMessages'

/** The dialogue grammar's session ticket — a fenced block opening every
 * session (dialogue-grammar.md "Session display formats"):
 *
 *     engram · learn · deep ─────────────────
 *     topic     transformers   frontier 8/13
 *     due today 0              pending 0
 *
 * Deterministic enough to exact-parse: header line `engram · <kind> · <mode>`
 * followed by rows of two-column key/value pairs (keys may contain a space,
 * e.g. "due today"; columns are separated by runs of 2+ spaces). */

export interface ParsedTicket {
  kind: string
  mode: string
  fields: { key: string; value: string }[]
}

const HEADER_RE = /^engram\s*·\s*(\S+)\s*·\s*(\S+)/

function parseRows(lines: string[]): { key: string; value: string }[] {
  const fields: { key: string; value: string }[] = []
  for (const line of lines) {
    // Columns split on 2+ spaces. Two shapes occur: a self-contained cell
    // ("frontier 8/13", "due today 0" — key + single-space + value) and a
    // key whose value landed in the NEXT cell because the column gap sits
    // between them ("topic" ␣␣␣ "transformers"). A buffered orphan key pairs
    // with whatever cell follows it.
    const cells = line.trim().split(/\s{2,}/)
    let pendingKey: string | null = null
    for (const cell of cells) {
      if (pendingKey !== null) {
        fields.push({ key: pendingKey, value: cell })
        pendingKey = null
        continue
      }
      const m = cell.match(/^(.+?)\s+(\S+)$/)
      if (m) fields.push({ key: m[1].trim(), value: m[2] })
      else pendingKey = cell
    }
  }
  return fields
}

/** Parse the FIRST ticket block found in a chunk of assistant prose (there is
 * at most one per session opening). Returns null when no well-formed ticket
 * is present — callers fall back to plain rendering. */
export function parseTicket(text: string): ParsedTicket | null {
  const fenceMatch = text.match(/```[^\n]*\n([\s\S]*?)```/)
  if (!fenceMatch) return null
  const body = fenceMatch[1]
  const lines = body.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return null
  const header = lines[0].match(HEADER_RE)
  if (!header) return null
  const fields = parseRows(lines.slice(1))
  if (fields.length === 0) return null
  return { kind: header[1], mode: header[2], fields }
}

/** Split prose around its ticket fence so the card can render in place of the
 * raw block. Returns null when the text has no parseable ticket. */
export function splitAroundTicket(text: string): { before: string; ticket: ParsedTicket; after: string } | null {
  const fenceMatch = text.match(/```[^\n]*\n([\s\S]*?)```/)
  if (!fenceMatch || fenceMatch.index == null) return null
  const ticket = parseTicket(text)
  if (!ticket) return null
  return {
    before: text.slice(0, fenceMatch.index).trim(),
    ticket,
    after: text.slice(fenceMatch.index + fenceMatch[0].length).trim(),
  }
}

/** Latest ticket across a session's assistant messages — the rail pins this
 * so the sitting's plan stays anchored while the transcript scrolls. */
export function extractTicketFromMessages(messages: ChatMessage[]): ParsedTicket | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const ticket = parseTicket(m.text)
    if (ticket) return ticket
  }
  return null
}
