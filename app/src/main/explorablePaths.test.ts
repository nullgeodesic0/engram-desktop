import { describe, expect, it } from 'vitest'
import { explorablePathToUrl, explorableUrlToPath } from './explorablePaths'

describe('explorable path <-> URL', () => {
  it('round-trips a POSIX path', () => {
    const p = '/Users/x/.claude/learning/artifacts/noether.html'
    expect(explorableUrlToPath(explorablePathToUrl(p, false), false)).toBe(p)
  })

  it('round-trips a Windows path, drive letter and separators intact', () => {
    const p = 'C:\\Users\\x\\.claude\\learning\\artifacts\\noether.html'
    expect(explorableUrlToPath(explorablePathToUrl(p, true), true)).toBe(p)
  })

  it('produces a parseable URL for a Windows path — the bug that made every explorable 404', () => {
    const url = explorablePathToUrl('C:\\Users\\x\\a.html', true)
    // Plain concatenation used to yield `explorable://localC:\Users\x\a.html`,
    // whose pathname is empty, so the handler's allow-list check could never
    // match and every artifact opened as a blank frame.
    expect(url).toBe('explorable://local/C:/Users/x/a.html')
    expect(new URL(url).pathname).toBe('/C:/Users/x/a.html')
  })

  it('survives the spaces and non-ASCII that artifact filenames actually contain', () => {
    // Real shape: the artifact-smith names files after node titles, and a
    // topic settings path can put them under a directory with spaces.
    const posix = '/Users/x/Physics Qualifying Exam/nöther’s theorem.html'
    expect(explorablePathToUrl(posix, false)).toContain('%20')
    expect(explorableUrlToPath(explorablePathToUrl(posix, false), false)).toBe(posix)

    const win = 'C:\\Users\\x\\Physics Qualifying Exam\\nöther’s theorem.html'
    expect(explorableUrlToPath(explorablePathToUrl(win, true), true)).toBe(win)
  })

  it('keeps one stable origin, so the renderer CSP has one host to allow', () => {
    expect(new URL(explorablePathToUrl('/a/b.html', false)).host).toBe('local')
    expect(new URL(explorablePathToUrl('C:\\a\\b.html', true)).host).toBe('local')
  })
})
