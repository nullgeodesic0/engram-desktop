import { describe, it, expect } from 'vitest'
import { isLoopbackUrl } from './localModel'
import { describeProbe } from '../../shared/localModelVerdict'
import type { LocalModelProbe } from '../../shared/types'

const base: LocalModelProbe = {
  reachable: true,
  text: false,
  toolUse: false,
  toolUseImitation: false,
  models: [],
  error: null,
}

describe('describeProbe', () => {
  it('clears a model that emits real tool calls', () => {
    const v = describeProbe({ ...base, text: true, toolUse: true })
    expect(v.ok).toBe(true)
    expect(v.headline).toMatch(/ready/i)
  })

  it('rejects a model that describes the call instead of making it', () => {
    // The observed Ollama 0.32.9 + nemotron-nano behaviour: a ```json fence
    // in a text block with stop_reason end_turn. This is the dangerous case —
    // it looks like success in the transcript and writes no receipts.
    const v = describeProbe({ ...base, text: true, toolUseImitation: true })
    expect(v.ok).toBe(false)
    expect(v.detail).toMatch(/writing nothing to your record/i)
  })

  it('rejects a model that ignores tools entirely, and says so differently', () => {
    const ignored = describeProbe({ ...base, text: true })
    const imitated = describeProbe({ ...base, text: true, toolUseImitation: true })
    expect(ignored.ok).toBe(false)
    // Different failures need different fixes — swap the model vs. adjust the
    // prompt — so the two must not collapse into one message.
    expect(ignored.detail).not.toBe(imitated.detail)
  })

  it('separates "server unreachable" from "server refused"', () => {
    const down = describeProbe({ ...base, reachable: false, error: 'ECONNREFUSED' })
    const refused = describeProbe({ ...base, error: '404 Not Found' })
    expect(down.headline).toMatch(/cannot reach/i)
    expect(refused.headline).toMatch(/refused the request/i)
  })

  it('does not claim readiness when the server answers with nothing', () => {
    expect(describeProbe(base).ok).toBe(false)
  })

  it('never reports ok when toolUse is false, whatever else is set', () => {
    // The one invariant that matters: prose quality must never be mistaken
    // for the ability to drive a sitting.
    for (const text of [true, false]) {
      for (const imitation of [true, false]) {
        expect(describeProbe({ ...base, text, toolUseImitation: imitation }).ok).toBe(false)
      }
    }
  })
})

describe('isLoopbackUrl', () => {
  it('accepts the loopback forms a local runtime actually uses', () => {
    for (const u of ['http://localhost:11434', 'http://127.0.0.1:11434', 'http://[::1]:11434', 'https://localhost:1234/']) {
      expect(isLoopbackUrl(u)).toBe(true)
    }
  })

  it('rejects hosts that merely START with a loopback name', () => {
    // The reason this is parsed rather than prefix-matched: both of these
    // resolve wherever their owner wants, and this setting decides where a
    // learner's productions are sent.
    expect(isLoopbackUrl('http://localhost.evil.com/v1')).toBe(false)
    expect(isLoopbackUrl('http://127.0.0.1.evil.com')).toBe(false)
    expect(isLoopbackUrl('http://notlocalhost')).toBe(false)
  })

  it('rejects remote hosts and non-http schemes', () => {
    expect(isLoopbackUrl('http://192.168.1.50:11434')).toBe(false)
    expect(isLoopbackUrl('https://api.anthropic.com')).toBe(false)
    expect(isLoopbackUrl('file:///etc/passwd')).toBe(false)
    expect(isLoopbackUrl('not a url')).toBe(false)
    expect(isLoopbackUrl('')).toBe(false)
  })
})
