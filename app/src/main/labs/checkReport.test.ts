import { describe, expect, it } from 'vitest'
import type { CheckRun } from '../../shared/labs'
import { REPORT_MAX, reportFields, signReport, verifyReport } from './checkReport'

const key = Buffer.alloc(32, 7)
const run: CheckRun = {
  completed: true,
  error: null,
  seconds: 41.4,
  tests: [
    { name: 'a', tier: 'core', outcome: 'passed', message: '' },
    { name: 'b', tier: 'core', outcome: 'passed', message: '' },
    { name: 'c', tier: 'slip', outcome: 'failed', message: 'off by one' },
  ],
}

function make(over: Partial<Parameters<typeof reportFields>[0]> = {}) {
  return reportFields({
    lab: 'example-pack/fit-a-line',
    milestone: 'm1',
    seq: 2,
    run,
    env: 'base-4b09c790529a',
    codeHash: '9c1e04aa31f2',
    at: new Date('2026-11-09T14:52:03.123Z'),
    ...over,
  })
}

describe('check reports', () => {
  it('signs a report that verifies, and reads back its fields', () => {
    const line = signReport(make(), key)
    expect(line).toMatch(/^\[engram-check v1 lab=example-pack\/fit-a-line m=m1 sub=2 verdict=slip core=2\/2 slip=0\/1 /)
    expect(line).toContain('t=41s at=2026-11-09T14:52:03Z sig=')
    expect(line.length).toBeLessThanOrEqual(REPORT_MAX)
    expect(verifyReport(line, key)).toEqual(make())
  })

  it('rejects an edited report, a different key and a hand-typed one', () => {
    const line = signReport(make(), key)
    expect(verifyReport(line.replace('verdict=slip', 'verdict=passed'), key)).toBeNull()
    expect(verifyReport(line, Buffer.alloc(32, 8))).toBeNull()
    expect(verifyReport('[engram-check v1 lab=x m=m1 verdict=passed sig=00]', key)).toBeNull()
    expect(verifyReport('not a report', key)).toBeNull()
  })

  it('marks a run that did not complete as broken', () => {
    const f = make({
      run: {
        completed: false,
        error: 'Your cell 2 raised',
        seconds: 1,
        tests: [],
      },
    })
    expect(f.verdict).toBe('broken')
    expect(verifyReport(signReport(f, key), key)?.verdict).toBe('broken')
  })

  it('stays inside its budget with the longest ids a pack can use', () => {
    const long = 'a'.repeat(32)
    const line = signReport(
      make({
        lab: `${long}/${long}`,
        milestone: long,
        env: `${long}-0123456789ab`,
      }),
      key,
    )
    expect(line.length).toBeLessThanOrEqual(REPORT_MAX)
  })
})
