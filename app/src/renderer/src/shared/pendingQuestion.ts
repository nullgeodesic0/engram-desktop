import type { ChatMessage } from '../../../shared/chatMessages'

/** The question the learner is being asked right now, for the "Answering"
 * strip above the composer.
 *
 * Read from the transcript, never from the topic graph: the tutor phrases
 * its own question, and the strip must repeat what was actually asked, not
 * the node's stored probe. Only while the LAST message is the tutor's: once
 * the learner has replied, nothing is pending.
 *
 * The question is the last paragraph of that message that contains a "?",
 * cut just after its last "?" — so "…quadratic in both x and p? One or two
 * sentences, then pick your confidence" keeps the question and drops the
 * instructions. Paragraphs inside code fences or display maths are skipped,
 * and a paragraph too long to be a one-line reminder returns nothing rather
 * than a wall of text in the strip. */
const MAX_CHARS = 320

export function pendingQuestion(messages: ChatMessage[]): { text: string; index: number } | null {
  const index = messages.length - 1
  const last = messages[index]
  if (!last || last.role !== 'assistant') return null

  const paragraphs: string[] = []
  let fenced = false
  let display = false
  for (const block of last.text.split(/\n\s*\n/)) {
    const fences = (block.match(/^```/gm) ?? []).length
    const dollars = (block.match(/\$\$/g) ?? []).length
    const skip = fenced || display || fences > 0 || dollars > 0
    if (fences % 2 === 1) fenced = !fenced
    if (dollars % 2 === 1) display = !display
    if (!skip) paragraphs.push(block.trim())
  }

  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i]
    const cut = p.lastIndexOf('?')
    if (cut < 0) continue
    const text = p
      .slice(0, cut + 1)
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/gm, '')
      .replace(/\s*\n\s*/g, ' ')
      .trim()
    if (text.length === 0 || text.length > MAX_CHARS) return null
    return { text, index }
  }
  return null
}
