import { describe, expect, it } from 'vitest'
import { flattenCwd } from './transcriptReader'

describe('flattenCwd', () => {
  it('matches the POSIX name Claude Code writes — verified against a real recorded session', () => {
    expect(flattenCwd('/Users/learner')).toBe('-Users-learner')
  })

  it('flattens a Windows path, including the drive-letter colon', () => {
    // Neither `\` nor `:` is legal in a directory name, so both have to go.
    expect(flattenCwd('C:\\Users\\learner')).toBe('C--Users-learner')
  })

  it('leaves the rest of the name untouched — dots, dashes and spaces are all legal', () => {
    expect(flattenCwd('/Users/a.b-c d')).toBe('-Users-a.b-c d')
  })
})
