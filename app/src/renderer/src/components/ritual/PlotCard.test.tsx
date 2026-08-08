import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlotCard } from './PlotCard'

/** Static-render assertions on the sketch card. Server rendering is enough
 * for everything asserted here — the crosshair is the only interactive part,
 * and these cover the two things that were actually wrong on screen: LaTeX in
 * a marker label printing as literal dollar signs, and the card resizing
 * under the cursor. */

const series = [{ label: '$E(r)$', points: [[0, 0], [1, 2], [2, 1]] as [number, number][], dashed: false }]

function render(props: Partial<Parameters<typeof PlotCard>[0]> = {}) {
  return renderToStaticMarkup(
    <PlotCard title={null} xLabel={null} yLabel={null} series={series} markers={[]} {...props} />,
  )
}

describe('PlotCard — marker labels are real math', () => {
  it('renders a LaTeX marker label through KaTeX, not as literal text', () => {
    const html = render({ markers: [{ x: 1, label: '$r=a$' }] })
    // KaTeX emits its own markup; a literal `$r=a$` in the output would mean
    // the label never reached the renderer (the SVG <text> regression).
    expect(html).toContain('katex')
    expect(html).not.toContain('$r=a$')
  })

  it('keeps the guide line and the label as separate elements', () => {
    const html = render({ markers: [{ x: 1, label: '$r=a$' }] })
    // The dashed guide stays inside the SVG…
    expect(html).toContain('stroke-dasharray="3 3"')
    // …and the label is positioned HTML over it, not an SVG text node.
    expect(html).not.toMatch(/<text[^>]*>\$/)
  })

  it('draws a marker with no label as a bare guide', () => {
    const html = render({ markers: [{ x: 1, label: null }] })
    expect(html).toContain('stroke-dasharray="3 3"')
  })
})

describe('PlotCard — geometry does not depend on interaction state', () => {
  it('takes a fixed width rather than shrinking to its caption', () => {
    // The resize bug: MarkFrame is shrink-to-fit by default, so the readout's
    // numbers widened the card and rescaled the SVG inside it.
    expect(render()).toContain('w-full')
  })

  it('reserves the readout slots while idle, so the legend never reflows', () => {
    const html = render({ xLabel: '$r$' })
    // One slot per series plus the x slot — all present with no cursor, all
    // transparent. If these mounted only on hover the row would reflow (and,
    // narrow, rewrap) every time the pointer entered the plot.
    expect(html).toContain('min-w-[3.5rem]')
    expect(html).toContain('min-w-[4.25rem]')
    expect((html.match(/opacity-0/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(html).not.toContain('opacity-100')
  })

  it('does not let the legend row wrap', () => {
    // `flex-wrap` on this row was the second half of the resize: numbers
    // appearing could push it to a second line and change the card's height.
    const html = render()
    const row = html.slice(html.indexOf('items-baseline justify-between'))
    expect(row.slice(0, 200)).not.toContain('flex-wrap')
  })
})

describe('PlotCard — honest about the data it was given', () => {
  it('plots exactly the points sent, in order', () => {
    const html = render()
    // Three sampled points → three path commands, no interpolation.
    const d = /<path[^>]*d="(M[^"]*L[^"]*)"/.exec(html)?.[1] ?? ''
    expect((d.match(/[ML]/g) ?? []).length).toBe(3)
  })

  it('renders a dashed series distinguishably', () => {
    const html = render({ series: [{ ...series[0], dashed: true }] })
    expect(html).toContain('stroke-dasharray="5 4"')
  })
})
