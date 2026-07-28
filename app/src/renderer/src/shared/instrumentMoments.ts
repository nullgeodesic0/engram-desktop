import type { GradeResult } from '../../../shared/gradeResult'
import type { ProbeHeader } from '../../../shared/probeHeader'
import type { DerivedRitualMark } from '../../../shared/ritualFromTranscript'
import { humanizeNodeId } from '../../../shared/humanizeId'
import type { RitualMark } from '../components/ritual/Marks'
import { BEAT_STYLE } from '../components/BeatCard'
import { GRADE_STYLE } from '../components/GradeResultCard'

/** The transcript minimap's own small glyph vocabulary — Chat Instruments
 * Wave B. Deliberately NOT a new visual language: every glyph/tone pair here
 * is read straight off the card that same moment already renders inline —
 * `BEAT_STYLE`'s icon+accent per beat (BeatCard.tsx), `GRADE_STYLE`'s color
 * per grade (GradeResultCard.tsx), ProbeCard's own cool/violet(-threshold)
 * accent and `†` marker, NodeCrossingDivider's warm ink. Where a source card
 * has no glyph of its own (crossing, misconception, milestone, ask), the
 * closest plain character to what that card already says is used once, never
 * a second competing symbol per kind. */
export type InstrumentMomentKind = 'probe' | 'grade' | 'crossing' | 'beat' | 'misconception' | 'milestone' | 'ask'

export interface InstrumentMoment {
  id: string
  /** Message-array index this moment is pinned to/near. May equal
   * `messages.length` (never negative, never beyond it) for a moment
   * resolved to "after everything rendered so far" — the same tail
   * convention every ritual mark and grade-batch anchor in this codebase
   * already uses (see reviewCrossing.ts's `nextProbeHeaderAt`). Callers
   * position/clamp against their own `messages.length`, never baked in here. */
  atIndex: number
  kind: InstrumentMomentKind
  glyph: string
  tone: string
  tooltip: string
}

const GRADE_LABEL: Record<GradeResult['grade'], string> = { recalled: 'recalled', partial: 'partial', lapsed: 'lapsed' }

function gradeTooltip(r: GradeResult): string {
  if (r.sBefore !== null && r.sAfter !== null) {
    return `${GRADE_LABEL[r.grade]} · ${r.sBefore.toFixed(1)}d → ${r.sAfter.toFixed(1)}d`
  }
  return `${GRADE_LABEL[r.grade]} · ${humanizeNodeId(r.node)}`
}

function probeMoment(index: number, header: ProbeHeader): InstrumentMoment {
  return {
    id: `probe-${index}`,
    atIndex: index,
    kind: 'probe',
    glyph: header.threshold ? '†' : '○',
    tone: header.threshold ? 'var(--color-ink-violet)' : 'var(--color-ink-cool)',
    tooltip: `probe · ${humanizeNodeId(header.node)}`,
  }
}

/** Structural subset of the two real mark unions (`RitualMark` — live session
 * views; `DerivedRitualMark` — replayed transcripts, shared/ritualFromTranscript.ts)
 * this function actually reads from. Both are assignable here as-is — same
 * "never a renderer import into shared/, just a structural superset" pattern
 * shared/verdictSegments.ts's own doctrine comment documents, applied in the
 * other direction (this file lives in renderer/src/shared, so it imports both
 * real unions directly rather than redeclaring a third copy of their fields). */
type AnyMark = RitualMark | DerivedRitualMark

/** Every notable moment in a sitting, positioned by message index (never
 * pixel-measured — `.transcript-measure`'s `content-visibility: auto`
 * virtualization of scrolled-past blocks, see index.css, makes a pixel
 * measurement lie the moment a block hasn't been laid out yet; index
 * proportion stays honest regardless of what's currently painted).
 *
 * Every input here is data the caller ALREADY derived for its own rendering —
 * this function performs no IPC, no re-parsing of raw transcript lines, and
 * no re-derivation of anything reviewCrossing.ts/verdictSegments.ts/
 * ritualFromTranscript.ts already computed:
 *   - `probes` — `allProbeHeaders(messages)` (shared/reviewCrossing.ts),
 *     called once by the caller and reused here AND for the grade↔probe
 *     hover linkage (see ProbeCard's/GradeResultCard's `highlighted` prop).
 *   - `gradeBatches` — Review's `resolvedGradeBatches`/SessionHistoryDrawer's
 *     `resolvedGrades`, already resolved to a render-index; Learn passes none
 *     (LearnSessionView never renders GradeResultCard inline — see its own
 *     `sessionGrades`/SessionCeremony doctrine comment — so it has none to
 *     pass, not an oversight here).
 *   - `crossings` — Review's own `deriveReviewCrossings` output; Learn's
 *     node-crossings instead arrive via `marks` (`kind: 'crossing'`, pushed by
 *     `crossToNode`) and are read from there instead, so passing both would
 *     double-count for Learn — callers pass at most one of the two sources.
 *   - `marks` — the live/derived RitualMark[] itself, for the four kinds with
 *     no separate resolved-position concept of their own: beat, misconception,
 *     milestone, ask.
 */
export function deriveInstrumentMoments(input: {
  marks: AnyMark[]
  probes: Array<{ index: number; header: ProbeHeader }>
  gradeBatches?: Array<{ id: string; atIndex: number; results: GradeResult[] }>
  crossings?: Array<{ atIndex: number; node: string }>
}): InstrumentMoment[] {
  const out: InstrumentMoment[] = []

  for (const { index, header } of input.probes) out.push(probeMoment(index, header))

  for (const batch of input.gradeBatches ?? []) {
    for (let i = 0; i < batch.results.length; i++) {
      const r = batch.results[i]
      out.push({
        id: `grade-${batch.id}-${i}`,
        atIndex: batch.atIndex,
        kind: 'grade',
        glyph: '●',
        tone: GRADE_STYLE[r.grade].color,
        tooltip: gradeTooltip(r),
      })
    }
  }

  for (const c of input.crossings ?? []) {
    out.push({
      id: `crossing-${c.atIndex}-${c.node}`,
      atIndex: c.atIndex,
      kind: 'crossing',
      glyph: '–',
      tone: 'var(--color-ink-warm)',
      tooltip: `moving to · ${humanizeNodeId(c.node)}`,
    })
  }

  for (const m of input.marks) {
    if (m.kind === 'crossing') {
      out.push({
        id: m.id,
        atIndex: m.atIndex,
        kind: 'crossing',
        glyph: '–',
        tone: 'var(--color-ink-warm)',
        tooltip: `entering · ${humanizeNodeId(m.nodeId)}`,
      })
    } else if (m.kind === 'beat') {
      const style = BEAT_STYLE[m.beat as keyof typeof BEAT_STYLE]
      out.push({
        id: m.id,
        atIndex: m.atIndex,
        kind: 'beat',
        glyph: style?.icon ?? '•',
        tone: style?.accent ?? 'var(--color-ink-warm)',
        tooltip: `beat · ${(style?.label ?? m.beat).toLowerCase()}`,
      })
    } else if (m.kind === 'misconception') {
      out.push({
        id: m.id,
        atIndex: m.atIndex,
        kind: 'misconception',
        glyph: '!',
        tone: 'var(--color-ink-danger)',
        tooltip: m.node ? `misconception · ${humanizeNodeId(m.node)}` : 'misconception',
      })
    } else if (m.kind === 'milestone') {
      out.push({
        id: m.id,
        atIndex: m.atIndex,
        kind: 'milestone',
        glyph: '◆',
        tone: 'var(--color-ink-warm)',
        tooltip: `${humanizeNodeId(m.node)} · ${m.sBefore.toFixed(1)}d → ${m.sAfter.toFixed(1)}d`,
      })
    } else if (m.kind === 'ask') {
      const answered = m.answer !== null
      out.push({
        id: m.id,
        atIndex: m.atIndex,
        kind: 'ask',
        glyph: '?',
        tone: 'var(--color-ink-cool)',
        tooltip: answered ? `asked · ${m.header}` : 'asked · awaiting answer',
      })
    }
  }

  return out.sort((a, b) => a.atIndex - b.atIndex)
}
