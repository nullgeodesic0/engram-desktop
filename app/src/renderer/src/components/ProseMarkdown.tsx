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
}: {
  text: string
  className?: string
}) {
  const html = useMemo(() => renderMarkdownWithMath(text), [text])
  return <div className={`md-prose ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />
})
