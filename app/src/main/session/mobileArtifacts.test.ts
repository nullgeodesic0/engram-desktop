import { describe, expect, it } from 'vitest'
import { projectArtifacts, MAX_ARTIFACT_BYTES } from './mobileArtifacts'

describe('projectArtifacts', () => {
  const entries = [
    { topic: 'mechanics', node: 'noether', artifact: '/home/a/noether.html', exists: true },
    { topic: 'mechanics', node: 'runge-lenz-vector', artifact: '/home/a/rl.html', exists: true },
    { topic: 'em', node: 'gauge', artifact: '/home/a/gauge.html', exists: false },
  ]

  it('names each artifact by its node, humanised', () => {
    const out = projectArtifacts(entries)
    expect(out.find((a) => a.node === 'runge-lenz-vector')?.title).toBe('Runge Lenz Vector')
  })

  it('drops artifacts the engine says are gone', () => {
    // `exists: false` means the file was moved or deleted out from under the
    // ledger. Listing it would offer a tap that can only fail.
    const out = projectArtifacts(entries)
    expect(out.map((a) => a.node)).not.toContain('gauge')
    expect(out).toHaveLength(2)
  })

  it('never ships the filesystem path', () => {
    // The phone addresses an artifact by topic and node. A path would be a
    // host detail crossing to a device, and one the client could try to vary.
    for (const artifact of projectArtifacts(entries)) {
      expect(Object.keys(artifact).sort()).toEqual(['node', 'title', 'topic'])
    }
  })

  it('survives a malformed ledger row instead of failing the whole list', () => {
    const out = projectArtifacts([
      ...entries,
      { topic: 42, node: null, artifact: '/x', exists: true } as never,
    ])
    expect(out).toHaveLength(2)
  })

  it('caps what a single artifact may be', () => {
    // An explorable is a self-contained page, not a download channel.
    expect(MAX_ARTIFACT_BYTES).toBeLessThanOrEqual(2_000_000)
  })
})
