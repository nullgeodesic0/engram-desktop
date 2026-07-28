/** The /learn batch-grading receipt strip — a fenced block the tutor prints
 * after applying a receipt batch (review/SKILL.md's close format shares the
 * shape, but in practice it appears in /learn grading and at /review session
 * close):
 *
 *     receipts  3 graded → 2 partial · 1 lapsed
 *     next due  moment-of-inertia-integration, … → tomorrow (Jul 18)
 *
 * Deterministic enough to exact-parse, same discipline as ticketParser.ts:
 * key is the line's leading token(s) up to a run of 2+ spaces, value is the
 * rest. The gate is strict — a fence qualifies ONLY if at least one row's key
 * is exactly `receipts` or `next due` — so session tickets (whose first line
 * is `engram · <kind> · <mode>`) and arbitrary code fences can never be
 * claimed. Anything that fails the gate falls through to plain rendering,
 * byte-identical (Verdict Anatomy's standing rule: degrade to prose, never
 * force structure). */

export interface ParsedReceiptStrip {
  /** The optional `**Receipt**`-style heading line directly above the fence,
   * consumed so it doesn't render twice. Null when absent. */
  heading: string | null
  rows: { key: string; value: string }[]
}

/** Row keys that mark a fence as a genuine receipt strip. Closed set, from
 * the corpus (17 real strips) — extend only against real transcripts. */
const RECEIPT_KEYS = new Set(['receipts', 'next due', 'streak', 'momentum'])

function parseStripRows(body: string): { key: string; value: string }[] | null {
  const rows: { key: string; value: string }[] = []
  let sawReceiptKey = false
  for (const line of body.split('\n')) {
    if (!line.trim()) continue
    // Key = everything before the first run of 2+ spaces ("next due" keeps
    // its internal single space); value = everything after. A line with no
    // column gap disqualifies the whole fence — receipt strips are strictly
    // tabular, and half-claiming a fence would obscure information.
    const m = line.match(/^(\S+(?: \S+)*?)\s{2,}(.+)$/)
    if (!m) return null
    const key = m[1].trim()
    rows.push({ key, value: m[2].trim() })
    if (RECEIPT_KEYS.has(key)) sawReceiptKey = true
  }
  return sawReceiptKey && rows.length > 0 ? rows : null
}

/** Split prose around its receipt-strip fence so the card renders in place of
 * the raw mono block. Returns null when no qualifying fence exists — the
 * caller falls back to plain rendering. Mirrors splitAroundTicket's shape. */
export function splitAroundReceiptStrip(
  text: string,
): { before: string; strip: ParsedReceiptStrip; after: string } | null {
  const fenceMatch = text.match(/```[^\n]*\n([\s\S]*?)```/)
  if (!fenceMatch || fenceMatch.index == null) return null
  const rows = parseStripRows(fenceMatch[1])
  if (!rows) return null

  let before = text.slice(0, fenceMatch.index)
  // Consume a bare `**Receipt**` / `Receipt:`-style heading line sitting
  // directly above the fence — it labels the strip, and the card carries its
  // own label, so leaving it would render the same word twice.
  let heading: string | null = null
  const headingMatch = before.match(/(?:^|\n)(\*{0,2}Receipts?\*{0,2}:?)\s*$/)
  if (headingMatch && headingMatch.index != null) {
    heading = headingMatch[1].replace(/[*:]/g, '')
    before = before.slice(0, headingMatch.index)
  }
  return {
    before: before.trim(),
    strip: { heading, rows },
    after: text.slice(fenceMatch.index + fenceMatch[0].length).trim(),
  }
}

/** The `Next time you're back:` forward-pointer coda — the batch receipt's
 * closing organ (corpus: 2/4 sampled learn reveals end in one, sometimes
 * bleeding straight into the next sitting's first probe). Split so the coda
 * gets its quiet forward-pointer label; the prose itself is untouched. */
export function splitLearnCoda(text: string): { before: string; coda: string } | null {
  const m = text.match(/(?:^|\n)(Next time you(?:'|’)re back:?)/)
  if (!m || m.index == null) return null
  const before = text.slice(0, m.index).trim()
  const coda = text.slice(m.index).trim()
  if (!coda) return null
  return { before, coda }
}
