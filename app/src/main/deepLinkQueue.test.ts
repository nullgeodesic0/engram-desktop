import { describe, it, expect } from 'vitest'
import { createDeepLinkQueue } from './deepLinkQueue'

describe('createDeepLinkQueue', () => {
  it('returns the URL immediately when the app is already ready', () => {
    const q = createDeepLinkQueue()
    expect(q.handle('engram://new-topic?payload=a', () => true)).toBe('engram://new-topic?payload=a')
  })

  it('queues the URL and returns null when the app is not ready', () => {
    const q = createDeepLinkQueue()
    expect(q.handle('engram://new-topic?payload=a', () => false)).toBeNull()
  })

  it('does not leave anything to drain when handled while already ready', () => {
    const q = createDeepLinkQueue()
    q.handle('engram://new-topic?payload=a', () => true)
    expect(q.drain()).toBeNull()
  })

  it('drain returns the queued URL exactly once, then null on a second call', () => {
    const q = createDeepLinkQueue()
    q.handle('engram://new-topic?payload=a', () => false)
    expect(q.drain()).toBe('engram://new-topic?payload=a')
    expect(q.drain()).toBeNull()
  })

  it('drain returns null when nothing was ever queued', () => {
    const q = createDeepLinkQueue()
    expect(q.drain()).toBeNull()
  })

  it('a second link arriving while one is pending overwrites the first deterministically (last-write-wins)', () => {
    const q = createDeepLinkQueue()
    q.handle('engram://new-topic?payload=first', () => false)
    q.handle('engram://new-topic?payload=second', () => false)
    expect(q.drain()).toBe('engram://new-topic?payload=second')
  })

  it('a link handled while ready, after an earlier one was queued, does not disturb the queued one', () => {
    // Models index.ts's real sequence: an 'open-url' arrives before ready
    // (queued), then — before whenReady ever drains it — a SECOND source
    // (e.g. a hypothetical direct call once ready) hands in a URL while
    // isReady() now reports true. That second URL should be returned
    // immediately for direct handling, and the still-queued first one must
    // still be sitting there for drain() to pick up (deterministic: nothing
    // about calling handle() while ready silently clears an unrelated
    // still-pending entry from before the app became ready).
    const q = createDeepLinkQueue()
    q.handle('engram://new-topic?payload=queued', () => false)
    const immediate = q.handle('engram://new-topic?payload=direct', () => true)
    expect(immediate).toBe('engram://new-topic?payload=direct')
    expect(q.drain()).toBe('engram://new-topic?payload=queued')
  })

  it('two independent queue instances do not share state', () => {
    const q1 = createDeepLinkQueue()
    const q2 = createDeepLinkQueue()
    q1.handle('engram://new-topic?payload=a', () => false)
    expect(q2.drain()).toBeNull()
  })
})
