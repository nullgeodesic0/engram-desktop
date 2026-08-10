import { describe, expect, test } from 'vitest'
import { composeMobileDrainKickoff } from './mobileKickoff'

/**
 * A kickoff is a user turn with the app's words in the learner's mouth, so it
 * lives under the same constraints every other kickoff does — and these tests
 * are what keep it there. The 400-char/no-backtick limits are not style: they
 * are the net checkDoctrine's D3 collector casts, and a literal that outgrows
 * them silently escapes the pin.
 */

const sample = composeMobileDrainKickoff({
  topic: 'grad-statistical-mechanics',
  evidencePath: '/tmp/engram-mobile/batch-1.json',
  itemCount: 4,
})

describe('composeMobileDrainKickoff', () => {
  test('names the skill and the topic', () => {
    expect(sample).toContain('/engram:learn')
    expect(sample).toContain('grad-statistical-mechanics')
  })

  test('declares the mobile surface, which is what activates the protocol', () => {
    // The overlay runs "ONLY when this sitting's opening message declares the
    // mobile surface". If this wording drifts, the tutor silently walks the
    // ordinary desk beats over phone evidence.
    expect(sample.toLowerCase()).toContain('companion app')
  })

  test('points at the evidence rather than inlining it', () => {
    expect(sample).toContain('/tmp/engram-mobile/batch-1.json')
  })

  test('stays inside the D3 collector net', () => {
    const collapsed = sample.replace(/\$\{[^}]*\}/g, '${}')
    expect(collapsed.length).toBeLessThan(400)
    expect(sample).not.toContain('`')
  })

  test('says nothing about how to judge the work', () => {
    // D4 blindness: the app never speaks about assessment into a session.
    expect(sample).not.toMatch(/assessor|rubric|when grading|grade (it|this|the)/i)
  })

  test('does not tell the tutor how to teach', () => {
    // It may name a protocol the skill itself defines — same licence the
    // checkpoint kickoff has — but not method.
    expect(sample).not.toMatch(/scaffold|hint ladder|explain that|make sure to teach/i)
  })

  test('reports the item count so the learner can see the sitting is complete', () => {
    expect(sample).toContain('4')
  })

  test('is a single line', () => {
    expect(sample.split('\n')).toHaveLength(1)
  })
})
