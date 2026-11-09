import { describe, expect, it } from 'vitest'
import { renderMarkdownWithMathCore } from './mathMarkdown'

const untrusted = (s: string) => renderMarkdownWithMathCore(s, undefined, { untrusted: true })

describe('untrusted markdown (content pack briefs)', () => {
  it('shows raw HTML as text', () => {
    const html = untrusted('Hi <img src=x onerror="alert(1)"> and <script>x()</script>')
    expect(html).not.toMatch(/<img|<script/)
    expect(html).toContain('&lt;img')
  })

  it('keeps web links and drops script links and images', () => {
    expect(untrusted('[ok](https://example.org)')).toContain('<a href="https://example.org">ok</a>')
    const bad = untrusted('[x](javascript:alert(1)) ![pic](https://tracker.example/p.png)')
    expect(bad).not.toMatch(/href="javascript|<img/)
    expect(bad).toContain('pic')
  })

  it('still renders math and ordinary markdown', () => {
    const html = untrusted('**Bold** and $a<b$')
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('katex')
  })
})
