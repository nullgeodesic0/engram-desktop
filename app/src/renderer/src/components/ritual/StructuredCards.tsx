import { memo } from 'react'
import { MathRenderer } from '../MathRenderer'
import { MarkFrame } from './MarkFrame'
import type { ComparisonSide, LadderStep, SymbolGloss } from '../../../../shared/bridgeUiIntents'

/** The four cards behind the expanded bridge vocabulary (`render_comparison`,
 * `render_steps`, `render_formula`, `cite_source`).
 *
 * Every one of these draws content the tutor was going to write in prose
 * anyway — that is the licence they run on, and it is the same one
 * `show_figure` has always had. They do not unlock anything the loop
 * withholds: the withholding discipline (no canonical answer before the
 * confidence pick, no rubric before the production) lives in the skill files
 * and applies to the tutor's WORDS, not to which element sets them. What
 * these buy is that the moments the tutor already has — "here is the contrast
 * case", "here is the derivation as steps", "here is the formula and what
 * each symbol means", "this came from Hull chapter 13" — stop being
 * indistinguishable walls of prose and start being the same recognizable
 * object every time they occur, in every topic, in both session views.
 *
 * All prose runs through MathRenderer, not MarkdownPreview: these are
 * structured slots, not free-form markdown blocks, and every one of them
 * routinely carries LaTeX in a physics or finance sitting. */

/** Two labelled columns — the contrast case. The single most common teaching
 * move the app had no card for: the dialogue grammar reaches for a contrast
 * whenever a misconception is caught or a node's boundary needs drawing, and
 * until now it landed as two paragraphs the eye has to re-parse each time.
 * Cool ink: a comparison is an instrument reading, not a verdict — neither
 * column is the "right" one. */
export const ComparisonCard = memo(function ComparisonCard({
  title,
  left,
  right,
}: {
  title: string | null
  left: ComparisonSide
  right: ComparisonSide
}) {
  return (
    <MarkFrame
      accent="cool"
      label="CONTRAST"
      glyph={
        <>
          <path d="M7 1.5 V12.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M1.5 4.5 H4.5 M1.5 7 H4.5 M1.5 9.5 H3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <path d="M9.5 4.5 H12.5 M9.5 7 H12.5 M10.5 9.5 H12.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </>
      }
    >
      {title && <div className="font-(family-name:--font-serif) text-sm text-[var(--color-text-primary)]">{title}</div>}
      {/* Stacks on a narrow window — a two-column contrast squeezed into an
        * unreadable ladder is worse than an honest single column. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 pt-0.5">
        {[left, right].map((side, i) => (
          <div key={i} className="flex flex-col gap-1 min-w-0">
            <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-cool)]">{side.label}</span>
            <MathRenderer text={side.body} className="text-xs text-[var(--color-text-dim)] leading-relaxed" />
          </div>
        ))}
      </div>
    </MarkFrame>
  )
})

/** A numbered ladder — a derivation or procedure laid out as rungs instead of
 * a run-on paragraph. Procedure nodes dominate the technical curricula this
 * app is used for (30 of 35 in the stat-mech topic), and "walk me through the
 * steps" is the shape of nearly every one of their probes. Warm ink: this is
 * the loop working, the ordinary business of teaching a method. */
export const StepsCard = memo(function StepsCard({ title, steps }: { title: string | null; steps: LadderStep[] }) {
  return (
    <MarkFrame
      accent="warm"
      label="STEPS"
      glyph={
        <>
          <path d="M1.5 11.5 H4.5 V8.5 H7.5 V5.5 H10.5 V2.5 H12.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </>
      }
    >
      {title && <div className="font-(family-name:--font-serif) text-sm text-[var(--color-text-primary)]">{title}</div>}
      <ol className="flex flex-col gap-1.5 pt-0.5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2.5 min-w-0">
            <span
              className="label-data text-[10px] tabular-nums shrink-0 pt-0.5 text-[var(--color-ink-warm)]"
              aria-hidden="true"
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="flex flex-col gap-0.5 min-w-0">
              <MathRenderer text={step.text} className="text-xs text-[var(--color-text-primary)] leading-relaxed" />
              {step.note && <MathRenderer text={step.note} className="fig-caption" />}
            </span>
          </li>
        ))}
      </ol>
    </MarkFrame>
  )
})

/** One display equation with a caption and an optional where-clause. Distinct
 * from `show_figure`'s free markdown precisely because the glossary is
 * STRUCTURED: "what does each symbol mean" is the question that actually
 * blocks a learner mid-derivation, and a card that always answers it in the
 * same place is worth more than a paragraph that sometimes does. Warm ink,
 * same as the steps ladder — a set formula is teaching, not verdict. */
export const FormulaCard = memo(function FormulaCard({
  latex,
  caption,
  where,
}: {
  latex: string
  caption: string | null
  where: SymbolGloss[]
}) {
  return (
    <MarkFrame
      accent="warm"
      label="FORMULA"
      glyph={
        <>
          <path d="M2 3 H12 M2 7 H8 M2 11 H12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="11" cy="7" r="1.3" stroke="currentColor" strokeWidth="1.1" />
        </>
      }
    >
      {/* The tutor sends bare LaTeX (no delimiters) — wrap it as display math
        * so the card always sets it the same way, whether or not the model
        * remembered its own $$. A payload that DID arrive wrapped is left
        * alone rather than double-wrapped into a parse error. */}
      <div className="overflow-x-auto py-1">
        <MathRenderer
          text={/^\s*\$\$|^\s*\\\[/.test(latex) ? latex : `$$${latex}$$`}
          className="text-[var(--color-text-primary)]"
        />
      </div>
      {caption && <div className="fig-caption">{caption}</div>}
      {where.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1 border-t border-[var(--color-hairline)] mt-0.5">
          {where.map((w, i) => (
            <div key={i} className="contents">
              <dt className="min-w-0">
                <MathRenderer text={`$${w.symbol.replace(/^\$+|\$+$/g, '')}$`} inlineOnly className="text-xs text-[var(--color-ink-warm)]" />
              </dt>
              <dd className="min-w-0">
                <MathRenderer text={w.meaning} inlineOnly className="fig-caption" />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </MarkFrame>
  )
})

/** A provenance chip — where this came from. Engram's curricula are built out
 * of real sources (a textbook, a qualifying exam, a paper), and "which
 * chapter was that" is a question the transcript could never answer before.
 * Cool ink and deliberately the smallest card in the vocabulary: a citation
 * is an annotation on the teaching, never an event in it. */
export const CitationChip = memo(function CitationChip({
  label,
  locator,
  note,
}: {
  label: string
  locator: string | null
  note: string | null
}) {
  return (
    <div className="flex justify-start my-1 pl-1">
      <span
        className="ritual-mark-in inline-flex items-baseline gap-2 rounded-md border px-2.5 py-1 max-w-[92%]"
        style={{ borderColor: 'var(--color-ink-cool-dim)', ['--ink-accent' as string]: 'var(--color-ink-cool)' }}
      >
        <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-cool)] shrink-0">SOURCE</span>
        <span className="text-xs text-[var(--color-text-dim)] min-w-0">
          {label}
          {locator && <span className="text-[var(--color-text-faint)]"> · {locator}</span>}
          {note && <span className="fig-caption"> — {note}</span>}
        </span>
      </span>
    </div>
  )
})
