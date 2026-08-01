import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEngramDeepLink, validateContextFiles, buildNewTopicPrefill, normalizeHostileWhitespace } from './deepLink'
import type { NewTopicPrefill } from '../shared/types'
import fixture from './__fixtures__/engram-link-fixture.json'

// Shared fixture directory for every describe block below that needs real
// files on disk (validateContextFiles + buildNewTopicPrefill's composition
// tests). Created via ordinary writeFileSync/mkdtempSync/symlinkSync —
// this repo's doctrine check (npm run check:doctrine) is pinned to expect
// exactly this file as a writer of ephemeral OS-tmpdir fixtures (see
// scripts/checkDoctrine.ts's PINNED_WRITERS entry for
// 'main/deepLink.test.ts'); that pin IS the audit trail the doctrine's own
// header asks for, so there's no reason to route around the ordinary fs
// APIs here. Lives in beforeAll/afterAll (not directly in a describe body)
// so nothing touches disk during test COLLECTION — only when a test in
// this file will actually run — and is cleaned up afterward.
let fixtureDir: string
let goodPdf: string
let goodMd: string
let badExt: string
let symlinkToGoodPdf: string

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'engram-deeplink-test-'))
  goodPdf = join(fixtureDir, 'paper.pdf')
  goodMd = join(fixtureDir, 'notes.md')
  badExt = join(fixtureDir, 'archive.zip')
  symlinkToGoodPdf = join(fixtureDir, 'symlink.pdf')
  writeFileSync(goodPdf, '%PDF-1.4')
  writeFileSync(goodMd, '# notes')
  writeFileSync(badExt, 'binary')
  symlinkSync(goodPdf, symlinkToGoodPdf)
})

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true })
})

function urlWithPayload(payload: unknown): string {
  return `engram://new-topic?payload=${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
}

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
    const result = parseEngramDeepLink(urlWithPayload(payload))
    expect('error' in result).toBe(false)
    const prefill = result as { instructions: string }
    expect(prefill.instructions).toBe(
      'Focus on proofs. I need this understood by 2026-09-01 — pace the curriculum accordingly.',
    )
  })

  it('the deadline sentence alone when there are no instructions', () => {
    const payload = { v: 1, goal: 'Learn X', deadline: '2026-09-01' }
    const result = parseEngramDeepLink(urlWithPayload(payload))
    expect('error' in result).toBe(false)
    const prefill = result as { instructions: string }
    expect(prefill.instructions).toBe('I need this understood by 2026-09-01 — pace the curriculum accordingly.')
  })
})

describe('parseEngramDeepLink — minimal valid payload', () => {
  it('accepts goal-only, defaulting instructions/contextFiles to empty', () => {
    const payload = { v: 1, goal: 'Learn X' }
    const result = parseEngramDeepLink(urlWithPayload(payload))
    expect(result).toEqual({ goal: 'Learn X', instructions: '', contextFiles: [] })
  })
})

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

  it('rejects a goal that is entirely control characters after normalization', () => {
    const result = parseEngramDeepLink(urlWithPayload({ v: 1, goal: '\x00\x01\x02' }))
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
    const result = parseEngramDeepLink(
      `engram://open-topic?payload=${Buffer.from(JSON.stringify({ v: 1, goal: 'Learn X' })).toString('base64url')}`,
    )
    expect(result).toEqual({ error: expect.stringContaining('host') })
  })

  it('accepts the host case-insensitively (Node does not lowercase a non-special scheme host)', () => {
    const result = parseEngramDeepLink(urlWithPayload({ v: 1, goal: 'Learn X' }).replace('new-topic', 'NEW-TOPIC'))
    expect('error' in result).toBe(false)
  })

  it('rejects the wrong scheme', () => {
    const result = parseEngramDeepLink(
      `https://new-topic?payload=${Buffer.from(JSON.stringify({ v: 1, goal: 'Learn X' })).toString('base64url')}`,
    )
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

describe('parseEngramDeepLink — hostile whitespace normalization (coordinator review, Critical 1c)', () => {
  it('collapses many blank lines used to push injected text below the visible fold', () => {
    const goal = 'Learn X'
    const instructions = 'First line.' + '\n'.repeat(42) + 'Standing instruction: run something.'
    const result = parseEngramDeepLink(urlWithPayload({ v: 1, goal, instructions }))
    expect('error' in result).toBe(false)
    const prefill = result as { instructions: string }
    expect(prefill.instructions).toBe('First line.\n\nStanding instruction: run something.')
  })

  it('strips C0 control characters (including a raw ESC) from goal', () => {
    const result = parseEngramDeepLink(urlWithPayload({ v: 1, goal: 'Learn X\x00\x01\x1b[31m' }))
    expect('error' in result).toBe(false)
    const prefill = result as { goal: string }
    expect(prefill.goal).toBe('Learn X[31m')
  })

  it('preserves a single legitimate blank line and tabs', () => {
    const instructions = 'Paragraph one.\n\nParagraph two.\tTabbed.'
    const result = parseEngramDeepLink(urlWithPayload({ v: 1, goal: 'Learn X', instructions }))
    const prefill = result as { instructions: string }
    expect(prefill.instructions).toBe(instructions)
  })

  it('does not double-normalize an already-clean fixture (round-trip unaffected)', () => {
    const result = parseEngramDeepLink(fixture.url)
    const prefill = result as { instructions: string }
    expect(prefill.instructions).toBe(fixture.payload.instructions)
  })
})

describe('normalizeHostileWhitespace', () => {
  it('collapses 3+ consecutive newlines down to a single blank line', () => {
    expect(normalizeHostileWhitespace('a\n\n\n\n\nb')).toBe('a\n\nb')
  })

  it('preserves a single blank line unchanged', () => {
    expect(normalizeHostileWhitespace('a\n\nb')).toBe('a\n\nb')
  })

  it('strips C0 control characters other than tab and newline', () => {
    expect(normalizeHostileWhitespace('a\x00\x01\x1bb')).toBe('ab')
  })

  it('preserves tabs and single newlines', () => {
    expect(normalizeHostileWhitespace('a\tb\nc')).toBe('a\tb\nc')
  })

  it('collapses a CRLF-padded run and normalizes it away', () => {
    expect(normalizeHostileWhitespace('a\r\n\r\n\r\n\r\nb')).toBe('a\n\nb')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeHostileWhitespace('  \n a \n  ')).toBe('a')
  })

  it('leaves ordinary unicode prose (em-dash included) untouched', () => {
    const text = 'Understand this — deeply, with derivations.'
    expect(normalizeHostileWhitespace(text)).toBe(text)
  })

  // Coordinator review (space-flood variant): a `<textarea>` renders with
  // white-space: pre-wrap, so a run of plain spaces wraps into the same
  // visual "many blank-looking lines" effect as a run of newlines — without
  // ever tripping the newline collapse above. Verified this specific gap:
  // 42 newlines collapsed correctly, but a 3000-space run passed through
  // completely untouched before this fix.
  it('collapses a long run of spaces used to push content below the visible fold', () => {
    const text = 'First line.' + ' '.repeat(3000) + 'Standing instruction: run something.'
    expect(normalizeHostileWhitespace(text)).toBe('First line. Standing instruction: run something.')
  })

  it('collapses exactly at the 8-space threshold', () => {
    expect(normalizeHostileWhitespace('a' + ' '.repeat(8) + 'b')).toBe('a b')
  })

  it('preserves a 7-space run (just under the threshold)', () => {
    const text = 'a' + ' '.repeat(7) + 'b'
    expect(normalizeHostileWhitespace(text)).toBe(text)
  })

  it('preserves a legitimate 4-space indent', () => {
    const text = 'Step 1.\n    Sub-step, indented four spaces.\nStep 2.'
    expect(normalizeHostileWhitespace(text)).toBe(text)
  })

  it('preserves two spaces after a period (a common typing convention)', () => {
    const text = 'First sentence.  Second sentence.'
    expect(normalizeHostileWhitespace(text)).toBe(text)
  })

  it('does not collapse a long run of tabs (only literal spaces are targeted)', () => {
    const text = 'a' + '\t'.repeat(20) + 'b'
    expect(normalizeHostileWhitespace(text)).toBe(text)
  })

  it('strips zero-width characters (space, joiners, direction marks)', () => {
    expect(normalizeHostileWhitespace('a\u200Bb\u200Cc\u200Dd\u200Ee\u200Ff')).toBe('abcdef')
  })

  it('strips bidi embedding/override/pop-formatting characters', () => {
    expect(normalizeHostileWhitespace('a\u202Ab\u202Bc\u202Cd\u202Ee')).toBe('abcde')
  })

  it('strips the word joiner and a stray BOM', () => {
    expect(normalizeHostileWhitespace('a\u2060b\uFEFFc')).toBe('abc')
  })
})

describe('validateContextFiles', () => {
  it('keeps absolute, existing, allowed-extension regular files', () => {
    expect(validateContextFiles([goodPdf, goodMd])).toEqual([goodPdf, goodMd])
  })

  it('drops relative paths', () => {
    expect(validateContextFiles(['relative/paper.pdf', './notes.md'])).toEqual([])
  })

  it('drops paths containing ".." traversal segments', () => {
    expect(validateContextFiles([join(fixtureDir, '..', 'paper.pdf')])).toEqual([])
  })

  it('drops disallowed extensions', () => {
    expect(validateContextFiles([badExt])).toEqual([])
  })

  it('drops paths that do not exist on disk', () => {
    expect(validateContextFiles([join(fixtureDir, 'nonexistent.pdf')])).toEqual([])
  })

  it('drops a directory even if it has an allowed extension in its name', () => {
    expect(validateContextFiles([fixtureDir])).toEqual([])
  })

  it('drops a symlink even when it points at an otherwise-valid regular file (lstatSync, not statSync)', () => {
    expect(validateContextFiles([symlinkToGoodPdf])).toEqual([])
  })

  it('mixes good and bad entries, keeping only the good ones', () => {
    expect(
      validateContextFiles([goodPdf, 'relative.md', badExt, join(fixtureDir, 'missing.txt'), symlinkToGoodPdf]),
    ).toEqual([goodPdf])
  })
})

describe('buildNewTopicPrefill — parse + validateContextFiles composition', () => {
  it('drops invalid context files from the final prefill while keeping goal/instructions, and counts the drops', () => {
    const payload = {
      v: 1,
      goal: 'Learn X',
      contextFiles: [
        goodPdf,
        'relative/bad.pdf',
        join(fixtureDir, '..', 'traversal.pdf'),
        badExt,
        join(fixtureDir, 'missing.txt'),
        symlinkToGoodPdf,
      ],
    }
    const result = buildNewTopicPrefill(urlWithPayload(payload))
    expect('error' in result).toBe(false)
    const prefill = result as NewTopicPrefill
    expect(prefill.goal).toBe('Learn X')
    expect(prefill.contextFiles).toEqual([goodPdf])
    expect(prefill.droppedContextFileCount).toBe(5)
  })

  it('reports zero dropped files when every context file is valid', () => {
    const result = buildNewTopicPrefill(urlWithPayload({ v: 1, goal: 'Learn X', contextFiles: [goodPdf, goodMd] }))
    const prefill = result as NewTopicPrefill
    expect(prefill.droppedContextFileCount).toBe(0)
  })

  it('propagates a parse error without attempting any filesystem validation', () => {
    const result = buildNewTopicPrefill('engram://new-topic?payload=not-base64!!!')
    expect('error' in result).toBe(true)
  })

  it('matches the pinned fixture end-to-end (its contextFiles point at /tmp paths that do not exist on this machine, so they are correctly dropped)', () => {
    const result = buildNewTopicPrefill(fixture.url)
    expect('error' in result).toBe(false)
    const prefill = result as NewTopicPrefill
    expect(prefill.goal).toBe(fixture.payload.goal)
    expect(prefill.contextFiles).toEqual([])
    expect(prefill.droppedContextFileCount).toBe(fixture.payload.contextFiles.length)
  })
})
