import { describe, expect, it, test } from 'vitest'
import { composeMobileDrainKickoff, composePackTopUpKickoff } from './mobileKickoff'

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

describe('composePackTopUpKickoff', () => {
  const kickoff = composePackTopUpKickoff({ topic: 'grad-statistical-mechanics', count: 3 })

  it('stays inside the collector the doctrine gate casts', () => {
    expect(kickoff.length).toBeLessThan(400)
    expect(kickoff).not.toContain('`')
  })

  it('says nothing about how to teach or how to judge', () => {
    expect(kickoff).not.toMatch(/assessor|rubric|when grading|grade (it|this|the)/i)
  })

  it('elects the skill and names what the learner wants', () => {
    expect(kickoff).toContain('/engram:learn grad-statistical-mechanics')
    expect(kickoff).toContain('3')
  })

  it('tells the tutor to skip the interactive clear-reviews-first gate', () => {
    // skills/learn/SKILL.md: "If due >= 5, offer first (arrow-key choice):
    // clear reviews first / straight to new material." That gate is meant
    // for a learner sitting at the desk. This kickoff starts a sitting
    // nobody is sitting at — the pack scheduler runs on its own clock, and
    // the phone's ASK button fires with no one watching the Mac's window.
    // Without this line, a topic with >=5 due items would leave a
    // background sitting waiting on an answer nobody is there to give, or
    // worse, defaulting into spending the whole sitting on reviews instead
    // of producing the new packs the phone actually asked for.
    expect(kickoff.toLowerCase()).toContain('clear-reviews-first')
    expect(kickoff.toLowerCase()).toMatch(/straight to new material/)
  })

  it('says so on the dueUnpacked form too — the gate risk does not depend on it', () => {
    const withDue = composePackTopUpKickoff({
      topic: 'grad-statistical-mechanics',
      count: 3,
      dueUnpacked: true,
    })
    expect(withDue.toLowerCase()).toContain('clear-reviews-first')
    expect(withDue.length).toBeLessThan(400)
  })

  it('names due nodes as already known, licensing the overlay\'s brief-beats allowance', () => {
    // The kickoff may only NAME which of the overlay's own defined behaviors
    // applies (same licence as the clear-reviews-first line above) — the
    // overlay itself (learn-skill.mobile-walk-protocol.md) is what defines
    // what "brief" means procedurally.
    const withDue = composePackTopUpKickoff({
      topic: 'grad-statistical-mechanics',
      count: 3,
      dueUnpacked: true,
    })
    expect(withDue.toLowerCase()).toContain('already known')
    expect(withDue).not.toMatch(/assessor|rubric|when grading|grade (it|this|the)/i)
  })
})
