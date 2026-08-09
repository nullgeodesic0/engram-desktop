import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TopicTitle, titleHasMath } from './TopicTitle'

const html = (title: string, className?: string) =>
  renderToStaticMarkup(<TopicTitle title={title} className={className} />)

describe('titleHasMath', () => {
  it('detects real maths', () => {
    expect(titleHasMath('Bounds on $T_c$ in layered superconductors')).toBe(true)
    expect(titleHasMath('The \\(SU(2)\\) case')).toBe(true)
    expect(titleHasMath('Result \\[E=mc^2\\] restated')).toBe(true)
  })

  it('does NOT treat a lone dollar as maths', () => {
    // A price is not an equation, and wrapping it in KaTeX would mangle it.
    expect(titleHasMath('Pricing at $5 a month')).toBe(false)
    expect(titleHasMath('Grad classical mechanics')).toBe(false)
  })
})

describe('TopicTitle', () => {
  it('renders an ordinary title as a bare span, so truncation still works', () => {
    const out = html('Grad classical mechanics', 'truncate')
    expect(out).toBe('<span class="truncate">Grad classical mechanics</span>')
    expect(out).not.toContain('katex')
  })

  it('renders a mathematical title through KaTeX', () => {
    const out = html('Bounds on $T_c$ in cuprates')
    expect(out).toContain('katex')
    expect(out).not.toContain('$T_c$')
  })

  it('keeps the caller class in both branches', () => {
    expect(html('plain', 'text-sm')).toContain('text-sm')
    expect(html('with $x$', 'text-sm')).toContain('text-sm')
  })
})
