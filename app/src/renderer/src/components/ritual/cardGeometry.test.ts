import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** MarkFrame exists to stop the transcript's card geometry drifting, and it
 * had already drifted back once: the component was written, half the family
 * migrated, and the unmigrated half re-accumulated `px-4 py-3`, `px-4 py-2`
 * and `px-3.5 py-3` against its `px-3 py-2.5`. Measured on a rendered
 * transcript that produced 19 distinct card widths in one column — left edges
 * aligned, right edges ragged across 691px.
 *
 * A learner sees these cards dozens of times a sitting; the drift is small per
 * card and very legible in aggregate. This is the guard that keeps the
 * agreement, since a comment plainly did not. */
const DIR = join(__dirname)
/** The canonical card-scale padding, from MarkFrame's own root. */
const CANON = 'px-3 py-2.5'
/** Cards that are legitimately not card-scale. CitationChip is a one-line
 * chip, not a card; it should look like a chip. */
const EXEMPT = new Set(['MarkFrame.tsx', 'cardGeometry.test.ts'])
const CHIP_OK = /px-2\.5 py-1|px-1\.5 py-0\.5|px-2 py-0\.5/

describe('transcript card geometry', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx') && !EXEMPT.has(f))

  it('every card-scale surface uses MarkFrame’s padding', () => {
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(join(DIR, f), 'utf-8')
      // Only card-scale boxes: a bordered, rounded surface at transcript width.
      for (const m of src.matchAll(/max-w-\[9[27]%\][^"`]*?(px-[\d.]+ py-[\d.]+)/g)) {
        if (m[1] !== CANON && !CHIP_OK.test(m[1])) offenders.push(`${f}: ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('MarkFrame still declares the padding this test pins', () => {
    // If MarkFrame's own geometry changes, this test must be updated with it
    // rather than silently pinning a value the component no longer uses.
    expect(readFileSync(join(DIR, 'MarkFrame.tsx'), 'utf-8')).toContain(CANON)
  })
})
