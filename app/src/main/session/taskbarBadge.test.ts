import { describe, expect, it } from 'vitest'
import { overlayFileForCount, overlayDescriptionForCount } from './taskbarBadge'

describe('overlayFileForCount', () => {
  it('clears at zero — a badge claiming work already done is the worst failure', () => {
    expect(overlayFileForCount(0)).toBeNull()
  })

  it('maps each single digit to its own overlay', () => {
    expect(overlayFileForCount(1)).toBe('1.png')
    expect(overlayFileForCount(9)).toBe('9.png')
  })

  it('collapses to 9+ past nine, where a second digit stops being readable at 16px', () => {
    expect(overlayFileForCount(10)).toBe('9plus.png')
    expect(overlayFileForCount(147)).toBe('9plus.png')
  })

  it('treats a negative or non-finite count as nothing to show, never a crash', () => {
    expect(overlayFileForCount(-3)).toBeNull()
    expect(overlayFileForCount(Number.NaN)).toBeNull()
  })
})

describe('overlayDescriptionForCount', () => {
  it('reads correctly aloud — the overlay is unlabelled decoration without it', () => {
    expect(overlayDescriptionForCount(1)).toBe('1 review due')
    expect(overlayDescriptionForCount(12)).toBe('12 reviews due')
  })
})
