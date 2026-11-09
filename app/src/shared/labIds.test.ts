import { describe, expect, it } from 'vitest'
import { isValidWorkbenchId, labWorkbenchId, parseLabWorkbenchId } from './runtime'
import { tally, verdictOf, type CheckRun } from './labs'

describe('workbench ids', () => {
  it('accepts a free-standing slug and a pack/lab pair, nothing else', () => {
    expect(isValidWorkbenchId('scratch')).toBe(true)
    expect(isValidWorkbenchId('example-pack/fit-a-line')).toBe(true)
    for (const bad of ['a/b/c', '../x', 'a/', '/a', 'A', 'a/../b', 'a\\b']) expect(isValidWorkbenchId(bad)).toBe(false)
    expect(parseLabWorkbenchId(labWorkbenchId('p', 'l'))).toEqual({ packId: 'p', labId: 'l' })
    expect(parseLabWorkbenchId('scratch')).toBeNull()
  })
})

describe('verdicts', () => {
  const t = (tier: 'core' | 'slip', outcome: 'passed' | 'failed') => ({
    id: `t::${tier}${outcome}`,
    name: `${tier}${outcome}`,
    about: '',
    tier,
    outcome,
    message: '',
  })
  const run = (tests: CheckRun['tests'], completed = true): CheckRun => ({ completed, error: null, tests, seconds: 1 })

  it('reads the grading table', () => {
    expect(verdictOf(run([t('core', 'passed'), t('slip', 'passed')]))).toBe('passed')
    expect(verdictOf(run([t('core', 'passed'), t('slip', 'failed')]))).toBe('slip')
    expect(verdictOf(run([t('core', 'failed'), t('slip', 'passed')]))).toBe('core')
    expect(verdictOf(run([], false))).toBe('broken')
    expect(tally([t('core', 'passed'), t('core', 'failed')], 'core')).toEqual({ passed: 1, total: 2 })
  })
})
