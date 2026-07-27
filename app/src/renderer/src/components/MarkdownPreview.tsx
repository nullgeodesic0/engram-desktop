import { useMemo } from 'react'
import 'katex/dist/katex.min.css'
import { renderMarkdownWithMath } from '../shared/markdownWithMath'

/**
 * Live preview pane for the response textarea, toggled via the "Markdown Preview"
 * switch. Renders the user's own in-progress typed text back to them — not remote
 * or shared content — so raw HTML passthrough from `marked` is an acceptable
 * self-only tradeoff here rather than pulling in a sanitizer dependency.
 */
export function MarkdownPreview({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdownWithMath(source), [source])

  if (!source.trim()) {
    return <div className="text-xs text-[var(--color-text-faint)] italic">Preview appears here as you type…</div>
  }

  return <div className="md-preview" dangerouslySetInnerHTML={{ __html: html }} />
}
