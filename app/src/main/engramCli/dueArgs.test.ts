import { describe, it, expect } from 'vitest'
import { buildDueArgs, buildDueCappedArgs } from './dueArgs'

describe('buildDueArgs', () => {
  it('empty options → empty argv (uncapped full due read)', () => {
    expect(buildDueArgs({})).toEqual([])
  })
  it('limit only', () => {
    expect(buildDueArgs({ limit: 12 })).toEqual(['--limit', '12'])
  })
  it('topic only', () => {
    expect(buildDueArgs({ topic: 'grad-electrodynamics' })).toEqual(['--topic', 'grad-electrodynamics'])
  })
  it('limit + topic, limit first (engine accepts either order; pinned for stability)', () => {
    expect(buildDueArgs({ limit: 5, topic: 't' })).toEqual(['--limit', '5', '--topic', 't'])
  })
  it('limit 0 is a real limit, not an omission', () => {
    expect(buildDueArgs({ limit: 0 })).toEqual(['--limit', '0'])
  })
})

describe('buildDueCappedArgs', () => {
  it('cap only', () => {
    expect(buildDueCappedArgs(24)).toEqual(['--cap', '24'])
  })
  it('cap + topic', () => {
    expect(buildDueCappedArgs(5, 'grad-classical-mechanics')).toEqual(['--cap', '5', '--topic', 'grad-classical-mechanics'])
  })
})
