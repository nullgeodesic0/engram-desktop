import { describe, it, expect } from 'vitest'
import { engramDirectMutate } from './readOnly'

// Only the SHAPE gates are under test — every rejection below fires before
// the function ever resolves the plugin or spawns python3, so these run
// green on machines with no engram install at all.
describe('engramDirectMutate retire shape gate', () => {
  it('refuses per-node retire args', async () => {
    await expect(engramDirectMutate('retire', ['--topic', 'grad-electrodynamics', '--node', 'gauss-symmetry-solve'])).rejects.toThrow(
      /--topic <slug> \[--restore\]/,
    )
  })
  it('refuses a malformed slug', async () => {
    await expect(engramDirectMutate('retire', ['--topic', '../evil'])).rejects.toThrow(/--topic <slug>/)
  })
  it('refuses missing --topic flag', async () => {
    await expect(engramDirectMutate('retire', ['grad-electrodynamics'])).rejects.toThrow(/--topic <slug>/)
  })
  it('refuses extra args beyond --restore', async () => {
    await expect(engramDirectMutate('retire', ['--topic', 't', '--restore', '--force'])).rejects.toThrow(/--topic <slug>/)
  })
  it('refuses commands not on the allowlist at all', async () => {
    await expect(engramDirectMutate('rate', ['--topic', 't'])).rejects.toThrow(/not on the direct-mutation allowlist/)
  })
})
