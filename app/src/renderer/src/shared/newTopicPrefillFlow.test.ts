import { describe, it, expect } from 'vitest'
import { decideModalPrefillOnOpenSignal } from './newTopicPrefillFlow'

describe('decideModalPrefillOnOpenSignal', () => {
  it('seeds when the modal was closed and a real prefill arrived', () => {
    expect(decideModalPrefillOnOpenSignal(false, { goal: 'Learn X' })).toEqual({
      action: 'seed',
      prefill: { goal: 'Learn X' },
    })
  })

  // Regression test for the coordinator's NEW-1 finding: the modal was
  // closed (e.g. the learner clicked Start on an earlier deep-link's
  // prefill, which closes the modal WITHOUT clearing modalPrefill) and a
  // later signal carries no new prefill (a plain ⌘N). The stale prefill
  // must be explicitly cleared, not left for the caller to reuse.
  it('clears when the modal was closed and no new prefill arrived (guards against a stale prefill resurfacing)', () => {
    expect(decideModalPrefillOnOpenSignal(false, null)).toEqual({ action: 'clear' })
    expect(decideModalPrefillOnOpenSignal(false, undefined)).toEqual({ action: 'clear' })
  })

  it('keeps and flags a dropped link when the modal was already open and a new prefill arrived', () => {
    expect(decideModalPrefillOnOpenSignal(true, { goal: 'Learn Y' })).toEqual({ action: 'keepAndNoteDropped' })
  })

  it('is a pure no-op when the modal was already open and no new prefill arrived', () => {
    expect(decideModalPrefillOnOpenSignal(true, null)).toEqual({ action: 'keep' })
    expect(decideModalPrefillOnOpenSignal(true, undefined)).toEqual({ action: 'keep' })
  })
})
