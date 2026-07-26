import { memo } from 'react'
import { humanizeNodeId } from '../../../../shared/humanizeId'
import { MarkdownPreview } from '../MarkdownPreview'
import { MathRenderer } from '../MathRenderer'
import { AtlasBirth } from './AtlasBirth'
import { Frontispiece } from './Frontispiece'
import { DiagnosticPlate, type DiagnosticPlateItem } from './DiagnosticPlate'
import { MisconceptionPin } from './MisconceptionPin'
import { ExplorableForged } from './ExplorableForged'
import { ReviewDocket, type ReviewDocketItem } from './ReviewDocket'
import { LapseRite } from './LapseRite'
import { AuditCard, type AuditVerdict } from './AuditCard'

/** Abbreviate to ~cap chars on a word boundary WITHOUT cutting inside a $…$ /
 * $$…$$ span — a dangling delimiter would make KaTeX render the tail as
 * garbled math. Walks segments (outside/inside math) and stops cleanly. */
function abbreviateOutsideMath(text: string, cap: number): string {
  if (text.length <= cap) return text
  // Split into alternating outside/inside-math segments, keeping delimiters.
  const parts = text.split(/(\$\$[^$]*\$\$|\$[^$]*\$)/g).filter((p) => p.length > 0)
  let out = ''
  for (const part of parts) {
    if (out.length >= cap) break
    const isMath = part.startsWith('$')
    if (isMath) {
      // Math spans are atomic: include whole or stop before it.
      if (out.length + part.length > cap + 24) break
      out += part
    } else {
      const room = cap - out.length
      if (part.length <= room) {
        out += part
      } else {
        const cut = part.slice(0, room)
        const lastSpace = cut.lastIndexOf(' ')
        out += lastSpace > 0 ? cut.slice(0, lastSpace) : cut
        break
      }
    }
  }
  out = out.trimEnd()
  return out.length < text.length ? `${out}…` : out
}

/** Ephemeral transcript overlays for the loop's recurring moments — pinned to
 * a message index at creation time (atIndex = messages.length when the signal
 * arrived), rendered interleaved by LearnSessionView.
 *
 * Most are derivable from the transcript's own record of tool calls and
 * replay on resume/history — `beat`/`crossing` (render_beat),
 * `phase`/`diagnostic` (session_phase + pretest rate calls), `misconception`
 * (`misconception add` Bash calls), `explorable` (an artifact-smith spawn
 * and/or `artifact set` Bash call), `verify-seal` (a `beat_outcome`
 * bridge:ui call naming beat `verify` with outcome `confirmed`), `lapse`
 * (Review's own rite: a `rate --rating again` call whose result grades
 * 'lapsed'), and `audit` (Review's own honesty check: an engram-assessor
 * spawn auditing the tutor's self-grading, `pending` until a matching
 * `<task-notification>` resolves it — replay-only, see the AUDIT doctrine
 * comment in shared/ritualFromTranscript.ts for why a live sitting never
 * sees a resolved verdict) — see
 * `shared/ritualFromTranscript.ts`'s
 * `deriveRitualMarks`, which walks a reopened session's transcript to rebuild
 * them instead of leaving a resumed sitting's history bare. The rest are
 * genuinely one-time signals with no durable record to replay from —
 * `stamp` (a stash confirmation), `figure` (a `show_figure` aside), `atlas`
 * (a topic's birth), and `docket` (Review's opening `due()` snapshot — the
 * read itself never lands in the transcript, only its downstream `rate`
 * calls do) — those stay live-session-only, same pattern as grade cards and
 * JobsRail. */
export type RitualMark = { id: string; atIndex: number } & (
  | { kind: 'beat'; beat: string; content: string }
  | { kind: 'crossing'; nodeId: string; verb?: string }
  | { kind: 'stamp' }
  | { kind: 'figure'; title: string | null; body: string }
  | { kind: 'atlas'; topic: string | null }
  | { kind: 'phase'; phase: string }
  | { kind: 'diagnostic'; items: DiagnosticPlateItem[] }
  | { kind: 'misconception'; text: string; node?: string }
  | { kind: 'explorable'; title: string; path?: string; node?: string }
  | { kind: 'verify-seal' }
  | { kind: 'lapse'; node: string; returnDate: string | null }
  | { kind: 'docket'; items: ReviewDocketItem[] }
  | { kind: 'audit'; itemCount: number | null; verdict: AuditVerdict; disputedNodes: string[] }
)

/** Small hand-drawn glyphs, one per dialogue-grammar beat. 16x16 viewBox,
 * stroke-only, currentColor — the ink language at icon scale. */
const BEAT_GLYPHS: Record<string, { path: string; label: string }> = {
  open_gap: { path: 'M8 2.5 A5.5 5.5 0 1 0 13.5 8', label: 'OPEN A GAP' },
  predict: { path: 'M2.5 8 H12 M9 4.5 12 8 9 11.5', label: 'PREDICT' },
  struggle: { path: 'M2.5 8 C5 3.5 7 12 9.5 6.5 S13 10 13.5 5.5', label: 'STRUGGLE' },
  resolve: { path: 'M3 11 C5 11 5.5 5 8 5 S11 11 13 5', label: 'RESOLVE' },
  self_explain: { path: 'M8 2.5 V13.5 M3.5 5 C5.5 7 5.5 9 3.5 11 M12.5 5 C10.5 7 10.5 9 12.5 11', label: 'SELF-EXPLAIN' },
  connect: { path: 'M2.5 10 C5 5 11 5 13.5 10 M4.5 10 A1.4 1.4 0 1 0 4.5 10.01 M11.5 10 A1.4 1.4 0 1 0 11.5 10.01', label: 'CONNECT' },
  verify: { path: 'M8 2.5 12.5 5 V9 C12.5 12 8 13.5 8 13.5 S3.5 12 3.5 9 V5 Z M6 8 7.5 9.5 10.5 6.5', label: 'VERIFY' },
}

export const BeatMarkCard = memo(function BeatMarkCard({ beat, content }: { beat: string; content: string }) {
  const glyph = BEAT_GLYPHS[beat]
  if (!glyph) return null
  // One-line caption: collapse newlines, abbreviate on a word boundary, and
  // render through the KaTeX pipeline so $…$ / $$…$$ set as real math. An
  // unclosed delimiter after the cut would derail KaTeX, so keep the cut
  // outside math: never split between a $ and its closer.
  const flat = content.replace(/\s+/g, ' ').trim()
  const excerpt = abbreviateOutsideMath(flat, 90)
  return (
    <div className="flex items-center gap-3 my-1.5 pl-1">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-[var(--color-ink-warm)]">
        <path d={glyph.path} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-warm)] shrink-0">{glyph.label}</span>
      {excerpt && (
        <MathRenderer
          text={excerpt}
          className="font-[var(--font-serif)] italic text-xs text-[var(--color-text-dim)] flex-1 min-w-0 overflow-hidden whitespace-nowrap text-ellipsis"
        />
      )}
      <span className="h-px w-6 shrink-0 bg-[var(--color-hairline)]" />
    </div>
  )
})

/** The border-crossing between nodes — a dendrite line that grows across the
 * transcript with the new territory's name. Learn crosses INTO new ground
 * ("entering"); Review sweeps across ground already held ("moving to"), so
 * the verb is the caller's to set. */
export const NodeCrossingDivider = memo(function NodeCrossingDivider({
  nodeId,
  verb = 'entering',
}: {
  nodeId: string
  verb?: string
}) {
  return (
    <div className="flex items-center gap-3 my-3 ritual-crossing">
      <span className="h-px flex-1 bg-[var(--color-ink-warm-dim)] origin-left ritual-crossing-line" />
      <span className="fig-caption shrink-0 text-[var(--color-ink-warm)]">
        {verb} {humanizeNodeId(nodeId)}
      </span>
      <span className="h-px flex-1 bg-[var(--color-ink-warm-dim)] origin-right ritual-crossing-line" />
    </div>
  )
})

/** Ink seal confirming a production was stashed for later batch grading. */
export const StashStamp = memo(function StashStamp() {
  return (
    <div className="flex justify-end pr-2">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-ink-warm-dim)] px-2.5 py-0.5 text-[10px] label-data text-[var(--color-ink-warm)] ritual-stamp">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1" />
          <path d="M3.2 5 4.5 6.3 7 3.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        production filed
      </span>
    </div>
  )
})

/** A tutor-authored figure — a diagram, table, or worked aside dropped into the
 * transcript via the show_figure bridge:ui tool. Rendered as markdown, not raw HTML. */
export const FigureCard = memo(function FigureCard({ title, body }: { title: string | null; body: string }) {
  return (
    <div className="panel px-4 py-3 max-w-[92%] flex flex-col gap-2">
      {title && <div className="font-[var(--font-serif)] text-sm text-[var(--color-text-primary)]">{title}</div>}
      <MarkdownPreview source={body} />
    </div>
  )
})

/** A small filled warm roundel holding the verify beat's own glyph — the
 * receipt for an honestly-confirmed verify beat. Deliberately absent for
 * partial/missed outcomes: the seal means confirmed, and stamping it for
 * anything less would counterfeit the receipt (dialogue-grammar's honesty
 * oath, same spirit as InkBurst never firing for a lapse). */
export const VerifySeal = memo(function VerifySeal() {
  const glyph = BEAT_GLYPHS.verify
  return (
    <div className="flex justify-end pr-2 my-1.5 ritual-verify-seal-in">
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0"
        style={{ background: 'var(--color-ink-warm)' }}
        aria-label="verify confirmed"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-[var(--color-void)]">
          <path d={glyph.path} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  )
})

export function MarkView({ mark }: { mark: RitualMark }) {
  if (mark.kind === 'beat') return <BeatMarkCard beat={mark.beat} content={mark.content} />
  if (mark.kind === 'crossing') return <NodeCrossingDivider nodeId={mark.nodeId} verb={mark.verb} />
  if (mark.kind === 'figure') return <FigureCard title={mark.title} body={mark.body} />
  if (mark.kind === 'atlas') return <AtlasBirth topic={mark.topic} />
  if (mark.kind === 'phase') return <Frontispiece phase={mark.phase} />
  if (mark.kind === 'diagnostic') return <DiagnosticPlate items={mark.items} />
  if (mark.kind === 'misconception') return <MisconceptionPin text={mark.text} node={mark.node} />
  if (mark.kind === 'explorable') return <ExplorableForged title={mark.title} path={mark.path} node={mark.node} />
  if (mark.kind === 'verify-seal') return <VerifySeal />
  if (mark.kind === 'lapse') return <LapseRite node={mark.node} returnDate={mark.returnDate} />
  if (mark.kind === 'docket') return <ReviewDocket items={mark.items} />
  if (mark.kind === 'audit') return <AuditCard itemCount={mark.itemCount} verdict={mark.verdict} disputedNodes={mark.disputedNodes} />
  return <StashStamp />
}

/** Shown at the transcript foot while the assessor examines the stash. */
export function GradingShimmer() {
  return (
    <div className="panel px-4 py-3 max-w-[70%] flex items-center gap-3">
      <div className="skeleton h-2 w-2 rounded-full shrink-0" />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="fig-caption">specimen under examination</span>
        <div className="skeleton h-1.5 w-40 rounded" />
      </div>
    </div>
  )
}
