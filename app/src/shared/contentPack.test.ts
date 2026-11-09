import { describe, expect, it } from 'vitest'
import { isSafeRelPath, parseLabManifest, parsePackManifest } from './contentPack'

const pack = { format: 1, id: 'demo', title: 'Demo', version: '1.0.0', labs: ['labs/one'] }
const milestone = { id: 'm1', title: 'First', brief: 'Do it.', hidden: 'checks/h.py', explainBack: 'Why?' }

describe('content pack manifests', () => {
  it('reads a minimal pack and lab', () => {
    const p = parsePackManifest(pack)
    expect(p.ok && p.value.runtime).toBeNull()
    const l = parseLabManifest({ id: 'one', title: 'One', milestones: [milestone] })
    expect(l.ok && l.value.milestones[0]).toMatchObject({
      id: 'm1',
      smoke: null,
      hidden: 'checks/h.py',
      timeLimitS: 600,
    })
  })

  it('reads a runtime layer, and refuses one named base', () => {
    const runtime = {
      layer: 'sci',
      label: 'Science',
      lock: 'runtime/sci.lock',
      imports: ['numpy'],
      packages: ['numpy'],
    }
    const p = parsePackManifest({ ...pack, runtime })
    expect(p.ok && p.value.runtime?.lock).toBe('runtime/sci.lock')
    expect(parsePackManifest({ ...pack, runtime: { ...runtime, layer: 'base' } }).ok).toBe(false)
    expect(parsePackManifest({ ...pack, runtime: { ...runtime, imports: ['os; rm'] } }).ok).toBe(false)
  })

  it('refuses paths that leave the pack', () => {
    for (const bad of ['../x', '/etc/passwd', 'a/../../b', 'C:/x', 'a\\b', '', './a', 'a//b'])
      expect(isSafeRelPath(bad)).toBe(false)
    expect(isSafeRelPath('labs/one/checks/h.py')).toBe(true)
    expect(parsePackManifest({ ...pack, labs: ['../elsewhere'] }).ok).toBe(false)
    expect(parseLabManifest({ id: 'one', title: 'One', milestones: [{ ...milestone, hidden: '/tmp/h.py' }] }).ok).toBe(
      false,
    )
  })

  it('refuses bad ids, repeated milestones, and hidden tests with no explain-back question', () => {
    expect(parsePackManifest({ ...pack, id: 'Has Spaces' }).ok).toBe(false)
    expect(parsePackManifest({ ...pack, id: 'x'.repeat(33) }).ok).toBe(false)
    expect(parsePackManifest({ ...pack, format: 2 }).ok).toBe(false)
    expect(parseLabManifest({ id: 'one', title: 'One', milestones: [milestone, milestone] }).ok).toBe(false)
    expect(parseLabManifest({ id: 'one', title: 'One', milestones: [{ ...milestone, explainBack: ' ' }] }).ok).toBe(
      false,
    )
    expect(parseLabManifest({ id: 'one', title: 'One', milestones: [] }).ok).toBe(false)
    expect(parseLabManifest({ id: 'one', title: 'One', milestones: [{ ...milestone, timeLimitS: 99999 }] }).ok).toBe(
      false,
    )
  })

  it('takes a brief-only milestone without tests or a question', () => {
    const l = parseLabManifest({
      id: 'one',
      title: 'One',
      milestones: [{ id: 'm1', title: 'Read', brief: 'Read this.' }],
    })
    expect(l.ok && l.value.milestones[0].hidden).toBeNull()
  })

  it('reads a brief from a file through the reader it is given', () => {
    const l = parseLabManifest(
      { id: 'one', title: 'One', milestones: [{ ...milestone, brief: undefined, briefFile: 'm1.md' }] },
      (p) => `from ${p}`,
    )
    expect(l.ok && l.value.milestones[0].brief).toBe('from m1.md')
  })
})
