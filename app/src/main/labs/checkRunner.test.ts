import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../runtime/envManager', () => ({
  checkRunnerPath: () => '',
  mplConfigDir: () => '',
  readyInterpreter: async () => null,
}))

const { parseOut, sameTests } = await import('./checkRunner')

const out = (nonce: string, tests: unknown[]) => ({ nonce, completed: true, error: null, tests, seconds: 1 })
const test = (id: string, tier: string, outcome = 'passed') => ({ id, name: id, about: '', tier, outcome, message: '' })

describe('check runner output', () => {
  it('accepts only the nonce it handed out', () => {
    expect(parseOut(out('n1', [test('a', 'core')]), 'hidden', 'n1')?.tests).toHaveLength(1)
    expect(parseOut(out('forged', [test('a', 'core')]), 'hidden', 'n1')).toBeNull()
    expect(parseOut({ completed: true, tests: [] }, 'hidden', 'n1')).toBeNull()
  })

  it('reads every smoke test as smoke, and anything unknown as an error', () => {
    const run = parseOut(out('n', [test('a', 'slip', 'weird')]), 'smoke', 'n')!
    expect(run.tests[0]).toMatchObject({ tier: 'smoke', outcome: 'error' })
  })

  it('wants the run to report exactly the listed tests and tiers', () => {
    const listed = parseOut(out('n', [test('a', 'core'), test('b', 'slip')]), 'collect', 'n')!.tests
    const ran = (ts: unknown[]) => parseOut(out('n', ts), 'hidden', 'n')!.tests
    expect(sameTests(listed, ran([test('b', 'slip'), test('a', 'core')]))).toBe(true)
    expect(sameTests(listed, ran([test('a', 'core')]))).toBe(false)
    expect(sameTests(listed, ran([test('a', 'core'), test('b', 'core')]))).toBe(false)
    expect(sameTests(listed, ran([test('a', 'core'), test('a', 'core')]))).toBe(false)
  })
})
