import { memo, useCallback, useRef, useState } from 'react'
import { MathRenderer, isRenderableTex } from '../MathRenderer'
import { MarkFrame } from './MarkFrame'
import { highlightLatexSymbol } from '../../shared/latexHighlight'
import type { ComparisonSide, LadderStep, SymbolGloss, SanityCheck, TimelineEvent } from '../../../../shared/bridgeUiIntents'

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
      {title && (
        <MathRenderer
          text={title}
          inlineOnly
          className="font-(family-name:--font-serif) text-sm text-[var(--color-text-primary)]"
        />
      )}
      {/* Stacks on a narrow window — a two-column contrast squeezed into an
        * unreadable ladder is worse than an honest single column. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 pt-0.5">
        {[left, right].map((side, i) => (
          <div key={i} className="flex flex-col gap-1 min-w-0">
            <MathRenderer
              text={side.label}
              inlineOnly
              className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-cool)]"
            />
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
      {title && (
        <MathRenderer
          text={title}
          inlineOnly
          className="font-(family-name:--font-serif) text-sm text-[var(--color-text-primary)]"
        />
      )}
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
  // Which gloss row the learner is pointing at, and the resolved hex for the
  // accent ink. KaTeX bakes a colour into its output at parse time, so a CSS
  // variable can't be handed to `\\textcolor` — the computed value is read off
  // the live card instead, which keeps the tint correct in both themes and
  // through a theme switch (the read happens per hover, not once at mount).
  const [active, setActive] = useState<number | null>(null)
  const rootRef = useRef<HTMLDListElement | null>(null)
  const inkRef = useRef<string>('#e8a857')

  const point = useCallback((i: number | null) => {
    if (i !== null && rootRef.current) {
      const raw = getComputedStyle(rootRef.current).getPropertyValue('--color-ink-warm').trim()
      // Only a hex literal is usable; anything else leaves the last good value
      // in place and `highlightLatexSymbol` will reject it if it isn't one.
      if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(raw)) inkRef.current = raw
    }
    setActive(i)
  }, [])

  // Highlight the BARE expression, then wrap — never the other way round. The
  // parse check has to see the same tex KaTeX will, and `$$…$$` is delimiter
  // syntax the tokenizer strips, not part of the expression.
  const bare = latex.replace(/^\s*\$\$|\$\$\s*$/g, '').replace(/^\s*\\\[|\\\]\s*$/g, '')
  const tinted =
    active !== null && where[active]
      ? highlightLatexSymbol(bare, where[active].symbol.replace(/^\$+|\$+$/g, ''), inkRef.current, isRenderableTex)
      : bare
  const shown = `$$${tinted}$$`

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
      {/* The tutor sends bare LaTeX (no delimiters) — wrapped as display math
        * so the card always sets it the same way, whether or not the model
        * remembered its own $$. A payload that DID arrive wrapped is left
        * alone rather than double-wrapped into a parse error. */}
      <div className="overflow-x-auto py-1">
        <MathRenderer text={shown} className="text-[var(--color-text-primary)]" />
      </div>
      {caption && <MathRenderer text={caption} inlineOnly className="fig-caption" />}
      {where.length > 0 && (
        <dl ref={rootRef} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1 border-t border-[var(--color-hairline)] mt-0.5">
          {where.map((w, i) => (
            // The whole row is the target, not just the symbol — a 6px glyph
            // is not a hit area. Focusable so the same pointing gesture works
            // from the keyboard, and `onFocus`/`onBlur` mirror the hover
            // exactly rather than being a lesser path.
            <div
              key={i}
              tabIndex={0}
              role="button"
              aria-label={`highlight ${w.symbol} in the equation`}
              className={`focus-ring grid grid-cols-subgrid col-span-2 gap-x-3 rounded-sm cursor-default transition-colors ${
                active === i ? 'bg-[color-mix(in_srgb,var(--color-ink-warm)_10%,transparent)]' : ''
              }`}
              onMouseEnter={() => point(i)}
              onMouseLeave={() => point(null)}
              onFocus={() => point(i)}
              onBlur={() => point(null)}
            >
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
          <MathRenderer text={label} inlineOnly className="inline" />
          {locator && (
            <span className="text-[var(--color-text-faint)]">
              {' · '}
              <MathRenderer text={locator} inlineOnly className="inline" />
            </span>
          )}
          {note && (
            <span className="fig-caption">
              {' — '}
              <MathRenderer text={note} inlineOnly className="inline" />
            </span>
          )}
        </span>
      </span>
    </div>
  )
})

/** A ledger of limiting cases — "check r→∞, check r=a, check the dimensions."
 *
 * This is how a physicist actually knows an answer is right, and it is the
 * move a struggling learner never makes on their own: they solve, they stop.
 * Written as prose it reads as an afterthought paragraph; written as a ledger
 * with each check paired to what it MUST give, it reads as a procedure — and
 * a procedure is a thing you can learn to run. The tutor's own probe in a
 * real grad-EM sitting ended "evaluate both expressions at r=a and say what
 * you find", which is exactly one row of this card.
 *
 * Cool ink: a check is an instrument reading. It is not a verdict on the
 * learner, and it must not be dressed as one — a failed check is information,
 * and the card stays neutral about who it belongs to. */
export const ChecksCard = memo(function ChecksCard({ title, checks }: { title: string | null; checks: SanityCheck[] }) {
  return (
    <MarkFrame
      accent="cool"
      label="SANITY CHECKS"
      glyph={
        <>
          <path d="M2 7.5 L5 10.5 L12 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      }
    >
      {title && (
        <MathRenderer text={title} inlineOnly className="font-(family-name:--font-serif) text-sm text-[var(--color-text-primary)]" />
      )}
      <ul className="flex flex-col gap-1.5 pt-0.5">
        {checks.map((c, i) => (
          <li key={i} className="flex flex-col gap-0.5 min-w-0">
            <span className="flex items-baseline gap-2 min-w-0 flex-wrap">
              <MathRenderer text={c.check} inlineOnly className="text-xs text-[var(--color-text-primary)]" />
              {/* An arrow, not a colon: the row asserts an implication, and
                  the glyph should say so at a glance. */}
              <span aria-hidden="true" className="fig-caption shrink-0">
                →
              </span>
              <MathRenderer text={c.expect} inlineOnly className="text-xs text-[var(--color-ink-cool)]" />
            </span>
            {c.note && <MathRenderer text={c.note} inlineOnly className="fig-caption" />}
          </li>
        ))}
      </ul>
    </MarkFrame>
  )
})

/** A dated spine — the chronology a topic turns on.
 *
 * Deliberately the least mathematical card in the vocabulary, and added for
 * that reason: everything else here grew out of physics sittings, and the
 * same app teaches history and political theory, where "what happened, in
 * what order, and what did it change" IS the material. A chronology written
 * as a paragraph is the single hardest prose form to hold in memory.
 *
 * `when` is rendered exactly as the tutor wrote it and never parsed as a
 * date — "1902", "the Second Congress", "T+30d", and "at expiry" are all
 * legitimate positions on a curriculum's timeline, and a card that insisted
 * on a calendar would quietly refuse three of them. */
export const TimelineCard = memo(function TimelineCard({ title, events }: { title: string | null; events: TimelineEvent[] }) {
  return (
    <MarkFrame
      accent="warm"
      label="SEQUENCE"
      glyph={
        <>
          <path d="M7 1.5 V12.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="7" cy="4" r="1.4" fill="currentColor" />
          <circle cx="7" cy="10" r="1.4" fill="currentColor" />
        </>
      }
    >
      {title && (
        <MathRenderer text={title} inlineOnly className="font-(family-name:--font-serif) text-sm text-[var(--color-text-primary)]" />
      )}
      <ol className="flex flex-col pt-0.5">
        {events.map((e, i) => (
          <li key={i} className="flex gap-3 min-w-0">
            {/* The spine: a hairline through the whole column with a node per
                event, drawn in the row rather than as a background so it can
                never drift out of register with the text beside it. The first
                and last rows clip their half so the line starts and stops at
                the outermost nodes instead of floating past them. */}
            <span aria-hidden="true" className="relative shrink-0 w-2 flex justify-center">
              <span
                className="absolute w-px bg-[var(--color-ink-warm-dim)]"
                style={{
                  top: i === 0 ? '0.45rem' : 0,
                  bottom: i === events.length - 1 ? 'calc(100% - 0.45rem)' : 0,
                }}
              />
              <span className="absolute top-[0.3rem] w-[5px] h-[5px] rounded-full bg-[var(--color-ink-warm)]" />
            </span>
            <span className="flex flex-col gap-0.5 min-w-0 pb-2">
              <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-warm)]">{e.when}</span>
              <MathRenderer text={e.what} inlineOnly className="text-xs text-[var(--color-text-primary)] leading-relaxed" />
              {e.note && <MathRenderer text={e.note} inlineOnly className="fig-caption" />}
            </span>
          </li>
        ))}
      </ol>
    </MarkFrame>
  )
})

/** A term, pinned with its definition — and, when it earns one, the thing it
 * is most often confused with.
 *
 * That last field is the whole reason this exists rather than being a line of
 * prose. "X, not to be confused with Y" is a boundary the learner will need
 * again at review time, and it is the same shape the misconception ledger
 * records after the fact — this is the tutor drawing the boundary BEFORE the
 * learner walks over it. Distinct from `render_comparison`, which gives two
 * ideas equal columns; here one term is the subject and the other is a
 * hazard beside it. */
export const DefinitionCard = memo(function DefinitionCard({
  term,
  definition,
  aka,
  notToBeConfusedWith,
}: {
  term: string
  definition: string
  aka: string | null
  notToBeConfusedWith: string | null
}) {
  return (
    <MarkFrame
      accent="cool"
      label="DEFINITION"
      glyph={
        <>
          <path d="M3.5 2.5 H10.5 V11.5 H3.5 Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M5.5 5.5 H8.5 M5.5 8 H8.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </>
      }
    >
      <div className="flex items-baseline gap-2 flex-wrap min-w-0">
        <MathRenderer text={term} inlineOnly className="font-(family-name:--font-serif) text-sm text-[var(--color-text-primary)]" />
        {aka && <MathRenderer text={`also: ${aka}`} inlineOnly className="fig-caption" />}
      </div>
      <MathRenderer text={definition} className="text-xs text-[var(--color-text-dim)] leading-relaxed" />
      {notToBeConfusedWith && (
        // Danger ink on this line alone, not on the card: the definition is
        // ordinary teaching; only the boundary is a hazard worth flagging.
        <div className="flex items-baseline gap-2 pt-0.5 border-t border-[var(--color-hairline)] mt-0.5 min-w-0">
          <span className="label-data text-[10px] tracking-[0.14em] text-[var(--color-ink-danger)] shrink-0">NOT</span>
          <MathRenderer text={notToBeConfusedWith} inlineOnly className="fig-caption" />
        </div>
      )}
    </MarkFrame>
  )
})
