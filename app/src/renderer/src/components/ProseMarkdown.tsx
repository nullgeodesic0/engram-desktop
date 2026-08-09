import { memo, useMemo } from 'react'
import 'katex/dist/katex.min.css'
import { renderMarkdownWithMath } from '../shared/markdownWithMath'

/**
 * Full extended-markdown + LaTeX renderer for prose surfaces — assistant beats,
 * plain dialogue blocks, the coach stream, and the learner's own message bubble.
 * Replaces the earlier bold-and-math-only MathRenderer on these surfaces so that
 * headings, lists, code, blockquotes, links and tables in a model's reply render
 * as formatting instead of literal `#`/`-`/backtick characters.
 *
 * Memoized on `text` for the same reason MathRenderer was: KaTeX + marked is
 * non-trivial per message, and without this every message re-parses on every
 * unrelated re-render of the parent session view (e.g. each keystroke in the
 * composer below the chat log).
 *
 * `md-prose` carries the element styling (see index.css); the caller's className
 * supplies voice/size (e.g. `voice-serif` for the tutor).
 */
export const ProseMarkdown = memo(function ProseMarkdown({
  text,
  className = '',
  nodeIds,
  nodeChipTopic,
  develop = false,
}: {
  text: string
  className?: string
  /** Chat Instruments Wave B — node-name chips. The currently loaded topic
   * graph's own node ids (exact match only) plus the topic they belong to;
   * see markdownWithMath.ts's `renderMarkdownWithMath` doctrine comment for
   * the render-side mechanics. Both undefined is the common case (every
   * surface this component renders before this wave, plus every Wave-B
   * surface with no graph in scope) and renders byte-identically. */
  nodeIds?: Set<string>
  nodeChipTopic?: string
  /** Let display math play its one-shot develop animation (see the `.md-develop`
   * block in index.css).
   *
   * MUST be false while text is still streaming. Every chunk changes `text`,
   * which re-renders this `dangerouslySetInnerHTML` and destroys and recreates
   * every KaTeX node inside it — so a develop animation left on during a
   * stream would restart from full blur on each chunk and read as flicker,
   * not as developing. Callers pass the negation of whatever streaming signal
   * they already hold (`trailingCaret` in the beat components); the class then
   * arrives exactly once, with the final complete render. */
  develop?: boolean
}) {
  const html = useMemo(
    () => renderMarkdownWithMath(text, nodeIds && nodeChipTopic ? { nodeIds, topicId: nodeChipTopic } : undefined),
    [text, nodeIds, nodeChipTopic],
  )
  return (
    <div
      className={`md-prose ${develop ? 'md-develop ' : ''}${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})
