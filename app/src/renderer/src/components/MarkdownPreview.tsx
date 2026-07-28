import { useMemo } from 'react'
import 'katex/dist/katex.min.css'
import { renderMarkdownWithMath } from '../shared/markdownWithMath'
import { useEquationCopy } from './useEquationCopy'

/**
 * Live preview pane for the response textarea, toggled via the "Markdown Preview"
 * switch. Renders the user's own in-progress typed text back to them — not remote
 * or shared content — so raw HTML passthrough from `marked` is an acceptable
 * self-only tradeoff here rather than pulling in a sanitizer dependency.
 */
export function MarkdownPreview({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdownWithMath(source), [source])
  // Chat Instruments Wave A — own draft equations are copyable while
  // composing, same as anything already sent. Wired here explicitly (not
  // just inherited from an enclosing chat container) so a composer preview
  // stays copyable even if it's ever mounted somewhere this component can't
  // predict. A callback ref (see useEquationCopy's own doctrine comment) —
  // safe to put directly on whichever branch's own root below, since it
  // re-wires itself on every mount, including the empty <-> rendered swap.
  const equationCopyRef = useEquationCopy()

  if (!source.trim()) {
    return (
      <div ref={equationCopyRef} className="text-xs text-[var(--color-text-faint)] italic">
        Preview appears here as you type…
      </div>
    )
  }

  return <div ref={equationCopyRef} className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />
}
