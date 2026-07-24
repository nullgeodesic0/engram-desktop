import { useMemo } from 'react'
import { marked } from 'marked'
import katex from 'katex'
import 'katex/dist/katex.min.css'

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode })
  } catch {
    return displayMode ? `$$${tex}$$` : `$${tex}$`
  }
}

/**
 * Extended-markdown + LaTeX -> HTML. Math segments are pulled out and rendered via
 * KaTeX *before* handing the rest to `marked`, then spliced back in — otherwise
 * markdown's own escaping/emphasis rules (`_`, `*`, `#`) would mangle raw TeX.
 * The placeholder tokens (`@@MATH0@@`, ...) contain no markdown-special characters,
 * so they always survive the parse untouched.
 */
function renderMarkdownWithMath(source: string): string {
  const mathHtml: string[] = []

  const withoutMath = source
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => {
      mathHtml.push(renderMath(tex, true))
      return `@@MATH${mathHtml.length - 1}@@`
    })
    .replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => {
      mathHtml.push(renderMath(tex, false))
      return `@@MATH${mathHtml.length - 1}@@`
    })

  // Synchronous parse (no async extensions configured) — `marked.parse` with default
  // options returns a string, not a Promise, in that case.
  const bodyHtml = marked.parse(withoutMath, { async: false }) as string

  return bodyHtml.replace(/@@MATH(\d+)@@/g, (_m, i: string) => mathHtml[Number(i)] ?? '')
}

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
