import { memo, type CSSProperties } from 'react'
import { MathRenderer } from './MathRenderer'

/** A topic's title, with maths set as maths.
 *
 * A topic imported from a paper carries the paper's title, and those contain
 * LaTeX — so the shelf, Home, Grades and the drilldown were all printing raw
 * `$...$` at the learner. Node ids already go through `humanizeNodeId` and
 * probe text already goes through KaTeX; titles were the one identifier that
 * never did.
 *
 * THE FAST PATH IS THE POINT. Almost every title is plain prose, and those
 * still render as a bare span — because `MathRenderer` emits a `<div>` full of
 * KaTeX spans, and `truncate` / `line-clamp-1` do not survive that. Routing
 * every title through the renderer would fix a rare case by breaking the
 * common one: long titles across the shelf would stop ellipsizing. So the
 * plain path is byte-identical to what was there before, and only a title
 * that actually contains maths takes the other branch.
 *
 * The trade is stated rather than hidden: a title WITH maths does not
 * ellipsize. That is the right way round — a clipped equation is unreadable,
 * whereas a wrapped one is merely longer. */

/** Cheap enough to run on every title on every render, which is why it is a
 * test rather than a parse: `$…$`, or either LaTeX delimiter pair. A lone `$`
 * (a price, "$5 a month") deliberately does NOT match — it needs a closing
 * partner to count as maths. */
export function titleHasMath(title: string): boolean {
  return /\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/.test(title)
}

export const TopicTitle = memo(function TopicTitle({
  title,
  className,
  style,
}: {
  title: string
  className?: string
  /** Passed through to whichever element this ends up being. Exists for the
   * shelf→session morph, which stamps a `view-transition-name` on the one
   * title that is travelling; it has to land on the real title element, and
   * wrapping this in a span instead would put a non-truncating box between
   * the title and the flex row that sizes it. */
  style?: CSSProperties
}) {
  if (!titleHasMath(title)) return <span className={className} style={style}>{title}</span>
  // `inline` so the renderer's own div sits in the text flow rather than
  // breaking the row it was placed in.
  return <MathRenderer text={title} inlineOnly className={`inline ${className ?? ''}`} style={style} />
})
