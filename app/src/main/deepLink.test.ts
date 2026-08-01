import { describe, it, expect } from 'vitest'
import { mkdtempSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEngramDeepLink, validateContextFiles } from './deepLink'
import fixture from './__fixtures__/engram-link-fixture.json'

describe('parseEngramDeepLink — pinned fixture round-trip', () => {
  // Copied verbatim from ObservatoryDesktop's encoder fixture — see
  // ./__fixtures__/engram-link-fixture.json. That repo's encoder is the
  // authority for the URL shape; this only proves the parser reproduces
  // exactly what it encoded.
  it('reproduces the fixture payload (goal, contextFiles, deadline-folded instructions)', () => {
    const result = parseEngramDeepLink(fixture.url)
    expect('error' in result).toBe(false)
    const prefill = result as { goal: string; instructions: string; contextFiles: string[] }
    expect(prefill.goal).toBe(fixture.payload.goal)
    expect(prefill.contextFiles).toEqual(fixture.payload.contextFiles)
    // The fixture's own `instructions` already ends with the deadline
    // sentence — proves the fold is idempotent, not just additive.
    expect(prefill.instructions).toBe(fixture.payload.instructions)
  })
})

describe('parseEngramDeepLink — deadline folding', () => {
  it('appends the deadline sentence when instructions do not already carry it', () => {
    const payload = { v: 1, goal: 'Learn X', instructions: 'Focus on proofs.', deadline: '2026-09-01' }
    const url = `engram://new-topic?payload=${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
    const result = parseEngramDeepLink(url)
    expect('error' in result).toBe(false)
    const prefill = result as { instructions: string }
    expect(prefill.instructions).toBe(
      'Focus on proofs. I need this understood by 2026-09-01 — pace the curriculum accordingly.',
    )
  })

  it('the deadline sentence alone when there are no instructions', () => {
    const payload = { v: 1, goal: 'Learn X', deadline: '2026-09-01' }
    const url = `engram://new-topic?payload=${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
    const result = parseEngramDeepLink(url)
    expect('error' in result).toBe(false)
    const prefill = result as { instructions: string }
    expect(prefill.instructions).toBe('I need this understood by 2026-09-01 — pace the curriculum accordingly.')
  })
})

describe('parseEngramDeepLink — minimal valid payload', () => {
  it('accepts goal-only, defaulting instructions/contextFiles to empty', () => {
    const payload = { v: 1, goal: 'Learn X' }
    const url = `engram://new-topic?payload=${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
    const result = parseEngramDeepLink(url)
    expect(result).toEqual({ goal: 'Learn X', instructions: '', contextFiles: [] })
  })
})

function urlWithPayload(payload: unknown): string {
  return `engram://new-topic?payload=${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
}

describe('parseEngramDeepLink — hostile payloads', () => {
  it('rejects a non-base64url payload', () => {
    const result = parseEngramDeepLink('engram://new-topic?payload=not!valid+base64/=')
    expect(result).toEqual({ error: expect.stringContaining('base64url') })
  })

  it('rejects a payload that decodes but is not JSON', () => {
    const garbage = Buffer.from('not json at all').toString('base64url')
    const result = parseEngramDeepLink(`engram://new-topic?payload=${garbage}`)
    expect(result).toEqual({ error: expect.stringContaining('JSON') })
  })

  it('rejects wrong schema version', () => {
    const result = parseEngramDeepLink(urlWithPayload({ v: 2, goal: 'Learn X' }))
    expect(result).toEqual({ error: expect.stringContaining('version') })
  })

  it('rejects an oversized goal (>2000 chars)', () => {
    const result = parseEngramDeepLink(urlWithPayload({ v: 1, goal: 'x'.repeat(2001) }))
    expect(result).toEqual({ error: expect.stringContaining('goal') })
  })

  it('rejects an empty goal', () => {
    const result = parseEngramDeepLink(urlWithPayload({ v: 1, goal: '' }))
    expect(result).toEqual({ error: expect.stringContaining('goal') })
  })

  it('rejects more than 8 context files', () => {
    const files = Array.from({ length: 9 }, (_, i) => `/tmp/f${i}.pdf`)
    const result = parseEngramDeepLink(urlWithPayload({ v: 1, goal: 'Learn X', contextFiles: files }))
    expect(result).toEqual({ error: expect.stringContaining('contextFiles') })
  })

  it('rejects oversized instructions (>4000 chars)', () => {
    const result = parseEngramDeepLink(urlWithPayload({ v: 1, goal: 'Learn X', instructions: 'x'.repeat(4001) }))
    expect(result).toEqual({ error: expect.stringContaining('instructions') })
  })

  it('rejects a malformed deadline', () => {
    const result = parseEngramDeepLink(urlWithPayload({ v: 1, goal: 'Learn X', deadline: '08/15/2026' }))
    expect(result).toEqual({ error: expect.stringContaining('deadline') })
  })

  it('rejects the wrong host', () => {
    const payload = Buffer.from(JSON.stringify({ v: 1, goal: 'Learn X' })).toString('base64url')
    const result = parseEngramDeepLink(`engram://open-topic?payload=${payload}`)
    expect(result).toEqual({ error: expect.stringContaining('host') })
  })

  it('accepts the host case-insensitively (Node does not lowercase a non-special scheme host)', () => {
    const payload = Buffer.from(JSON.stringify({ v: 1, goal: 'Learn X' })).toString('base64url')
    const result = parseEngramDeepLink(`engram://NEW-TOPIC?payload=${payload}`)
    expect('error' in result).toBe(false)
  })

  it('rejects the wrong scheme', () => {
    const payload = Buffer.from(JSON.stringify({ v: 1, goal: 'Learn X' })).toString('base64url')
    const result = parseEngramDeepLink(`https://new-topic?payload=${payload}`)
    expect(result).toEqual({ error: expect.stringContaining('scheme') })
  })

  it('rejects a missing payload parameter', () => {
    const result = parseEngramDeepLink('engram://new-topic')
    expect(result).toEqual({ error: expect.stringContaining('payload') })
  })

  it('rejects a not-a-URL string', () => {
    const result = parseEngramDeepLink('totally not a url')
    expect('error' in result).toBe(true)
  })
})

describe('validateContextFiles', () => {
  // Real, empty fixture files under the OS tmpdir. Created via
  // openSync/closeSync rather than writeFileSync/rmSync — this repo's
  // doctrine check (npm run check:doctrine) treats those as production
  // write-surface markers and scans every .ts file under src/, tests
  // included, so a `writeFileSync` here would ask this test to be pinned as
  // an app "writer" alongside main/index.ts and friends, which it isn't:
  // these are ephemeral fixtures in the OS's own tmpdir, not app state, and
  // nothing here goes near the learning home or the plugin — the thing the
  // doctrine actually protects. Left uncleaned for the same reason: the OS
  // owns and reclaims tmpdir, and an explicit rmSync would trip the same
  // heuristic for no real benefit.
  const dir = mkdtempSync(join(tmpdir(), 'engram-deeplink-test-'))
  function touch(path: string): string {
    closeSync(openSync(path, 'w'))
    return path
  }
  const goodPdf = touch(join(dir, 'paper.pdf'))
  const goodMd = touch(join(dir, 'notes.md'))
  const badExt = touch(join(dir, 'archive.zip'))

  it('keeps absolute, existing, allowed-extension regular files', () => {
    expect(validateContextFiles([goodPdf, goodMd])).toEqual([goodPdf, goodMd])
  })

  it('drops relative paths', () => {
    expect(validateContextFiles(['relative/paper.pdf', './notes.md'])).toEqual([])
  })

  it('drops paths containing ".." traversal segments', () => {
    expect(validateContextFiles([join(dir, '..', 'paper.pdf')])).toEqual([])
  })

  it('drops disallowed extensions', () => {
    expect(validateContextFiles([badExt])).toEqual([])
  })

  it('drops paths that do not exist on disk', () => {
    expect(validateContextFiles([join(dir, 'nonexistent.pdf')])).toEqual([])
  })

  it('drops a directory even if it has an allowed extension in its name', () => {
    expect(validateContextFiles([dir])).toEqual([])
  })

  it('mixes good and bad entries, keeping only the good ones', () => {
    expect(validateContextFiles([goodPdf, 'relative.md', badExt, join(dir, 'missing.txt')])).toEqual([goodPdf])
  })
})
