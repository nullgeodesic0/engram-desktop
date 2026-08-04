import { describe, it, expect } from 'vitest'
import { resolveAnchorBeforeNextProbe, nextProbeHeaderAt } from './reviewCrossing'
import type { ChatMessage } from './chatMessages'

function msg(role: 'assistant' | 'user', text: string): ChatMessage {
  return { id: `${role}-${text.slice(0, 8)}`, role, text }
}

const OWN = new Set(['canonical-transformations-poisson-brackets'])

describe('resolveAnchorBeforeNextProbe', () => {
  it('forward scan wins when a later message carries a header', () => {
    const messages = [
      msg('assistant', 'reveal prose'),
      msg('assistant', 'verdict prose\n\n**[4/5] · `postulates-hilbert-space`** — qm.'),
    ]
    expect(resolveAnchorBeforeNextProbe(messages, 1, OWN)).toBe(1)
    expect(nextProbeHeaderAt(messages, 1)).toBe(1)
  })

  it('absorption case: next-item header merged into the bubble BELOW atIndex resolves backward', () => {
    const messages = [
      msg('assistant', '**[3/5] · `canonical-transformations-poisson-brackets`** — cm.'),
      msg('assistant', 'reveal prose\n\nverdict prose — Back Aug 16.\n\n**[4/5] · `postulates-hilbert-space`** — qm.'),
    ]
    // atIndex stamped past the end (messages.length at rate time, before any
    // later message arrived) — forward scan finds nothing.
    expect(nextProbeHeaderAt(messages, 2)).toBeNull()
    expect(resolveAnchorBeforeNextProbe(messages, 2, OWN)).toBe(1)
  })

  it('standard sitting can never resolve backward onto its own header', () => {
    const messages = [
      msg('assistant', 'verdict prose'),
      msg('assistant', '**[3/5] · `canonical-transformations-poisson-brackets`** — cm.\nprobe text'),
    ]
    // The preceding bubble's only header is the graded item's own — stays null (tail).
    expect(resolveAnchorBeforeNextProbe(messages, 2, OWN)).toBeNull()
  })

  it('only the immediately preceding assistant bubble is considered', () => {
    const messages = [
      msg('assistant', 'old prose\n\n**[4/5] · `postulates-hilbert-space`** — qm.'),
      msg('assistant', 'a later bubble with no header'),
    ]
    // The foreign header is two bubbles back — the loop breaks at the first
    // assistant bubble it inspects, so this stays a tail resolve.
    expect(resolveAnchorBeforeNextProbe(messages, 2, OWN)).toBeNull()
  })

  it('user messages between are skipped when finding the preceding assistant bubble', () => {
    const messages = [
      msg('assistant', 'verdict\n\n**[4/5] · `postulates-hilbert-space`** — qm.'),
      msg('user', 'my answer'),
    ]
    expect(resolveAnchorBeforeNextProbe(messages, 2, OWN)).toBe(0)
  })
})
