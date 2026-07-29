import type { ChatMessage } from '../../../shared/chatMessages'

/** The dialogue grammar's session ticket — a fenced block opening every
 * session (dialogue-grammar.md "Session display formats"):
 *
 *     engram · learn · deep ─────────────────
 *     topic     transformers   frontier 8/13
 *     due today 0              pending 0
 *
 * Deterministic enough to exact-parse: header line `engram · <kind>` with an
 * optional ` · <mode>` segment (mode is absent on `review` tickets, and on
 * `learn` tickets with no mode selected — confirmed against real transcripts,
 * not just the documented `deep`/`sprint` example) followed by rows of
 * two-column key/value pairs (keys may contain a space, e.g. "due today";
 * columns are separated by runs of 2+ spaces). */

export interface ParsedTicket {
  kind: string
  mode: string | null
  fields: { key: string; value: string }[]
}

const HEADER_RE = /^engram\s*·\s*(\S+)(?:\s*·\s*(\S+))?/

function parseRows(lines: string[]): { key: string; value: string }[] {
  const fields: { key: string; value: string }[] = []
  for (const line of lines) {
    // Columns split on 2+ spaces. Two shapes occur: a self-contained cell
    // ("frontier 8/13", "due today 0" — key + single-space + value) and a
    // key whose value landed in the NEXT cell because the column gap sits
    // between them ("topic" ␣␣␣ "transformers"). A buffered orphan key pairs
    // with whatever cell follows it.
    //
    // Within a self-contained cell, the value may itself be multiple words
    // ("frontier 18 new", "progress 19 retained · 2 learning · 18 untouched"
    // once paired) — the key/value boundary is anchored on the first token
    // that starts with a digit, since every observed value leads with a
    // count. A naive "last token is the value" split (the old approach)
    // mis-parses "frontier 18 new" as key "frontier 18" / value "new".
    //
    // A cell that OPENS with "(" (e.g. "due  13  (showing 12)") is a
    // parenthetical qualifier of the value just parsed on this same line,
    // not a new key/value pair — without this, it mis-splits into a bogus
    // {key: "(showing", value: "12)"} field, since the digit-anchor regex
    // below happily matches "(showing 12)" as key "(showing" / value "12)".
    // Fold it onto the immediately-preceding field on this line instead.
    const cells = line.trim().split(/\s{2,}/)
    let pendingKey: string | null = null
    let lastField: { key: string; value: string } | null = null
    for (const cell of cells) {
      if (cell.startsWith('(') && lastField) {
        lastField.value = `${lastField.value} ${cell}`
        continue
      }
      if (pendingKey !== null) {
        lastField = { key: pendingKey, value: cell }
        fields.push(lastField)
        pendingKey = null
        continue
      }
      const m = cell.match(/^(.+?)\s+(\d\S*(?:\s\S+)*)$/)
      if (m) {
        lastField = { key: m[1].trim(), value: m[2] }
        fields.push(lastField)
      } else pendingKey = cell
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
  return { kind: header[1], mode: header[2] ?? null, fields }
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
