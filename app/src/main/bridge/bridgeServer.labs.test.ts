import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LAB_HANDOFF_OPENING, labHandoffMessage } from '../../shared/labHandoff'

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' } }))
vi.mock('../labs/labStore', () => ({
  lookupReport: async (line: string) =>
    line === '[engram-check v1 good]' ? { verified: true, lab: 'fit-a-line' } : { verified: false, reason: 'no' },
  readLabCells: async (pack: string, lab: string, at?: { milestone: string; submission: number }) => {
    if (lab === 'sealed') throw new Error('A submission of this lab is sealed')
    return { title: `${pack}/${lab}`, source: at ? 'submitted' : 'live', cells: [], truncated: false }
  },
}))

const { BridgeServer } = await import('./bridgeServer')
const server = new BridgeServer()
let port = 0

beforeAll(async () => {
  port = await server.start()
})
afterAll(() => server.stop())

const post = async (path: string, body: unknown) =>
  (await fetch(`http://127.0.0.1:${port}/bridge/s1/${path}`, { method: 'POST', body: JSON.stringify(body) })).json()

describe('the lab reads on the session bridge', () => {
  it('answers check_report with the verification, refusals included', async () => {
    expect(await post('check-report', { report: '[engram-check v1 good]' })).toEqual({
      verified: true,
      lab: 'fit-a-line',
    })
    expect(await post('check-report', { report: 'forged' })).toMatchObject({ verified: false })
    expect(await post('check-report', 'not json at all')).toMatchObject({ verified: false })
  })

  it('answers read_workbench, and says why when the lab is sealed', async () => {
    expect(await post('lab-cells', { pack: 'p', lab: 'l' })).toMatchObject({ ok: true, source: 'live' })
    expect(await post('lab-cells', { pack: 'p', lab: 'l', milestone: 'm1', submission: 2 })).toMatchObject({
      ok: true,
      source: 'submitted',
    })
    expect(await post('lab-cells', { pack: 'p', lab: 'sealed' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/sealed/),
    })
  })
})

describe('the lab hand-in message', () => {
  it('opens with the sentence the checked-production overlay keys on', () => {
    const overlay = readFileSync(
      resolve(__dirname, '../../../../plugin-overlays/engram/learn-skill.checked-production-protocol.md'),
      'utf-8',
    )
    expect(overlay).toContain(`("${LAB_HANDOFF_OPENING.replace(/\.$/, '')}")`)
    const msg = labHandoffMessage('[engram-check v1 x]\n\nWhy?\nBecause.\n')
    expect(msg.startsWith(LAB_HANDOFF_OPENING)).toBe(true)
    expect(msg).toContain('"Checked lab productions"')
    expect(msg.endsWith('[engram-check v1 x]\n\nWhy?\nBecause.')).toBe(true)
  })
})
