import { marked } from 'marked'
import katex from 'katex'

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode })
  } catch {
    return displayMode ? `$$${tex}$$` : `$${tex}$`
  }
}

/**
 * Extended-markdown + LaTeX -> HTML — the single rendering pipeline shared by the
 * composer's live preview (MarkdownPreview) and the assistant/coach/beat prose
 * (ProseMarkdown). Math segments are pulled out and rendered via KaTeX *before*
 * handing the rest to `marked`, then spliced back in — otherwise markdown's own
 * escaping/emphasis rules (`_`, `*`, `#`) would mangle raw TeX. The placeholder
 * tokens (`@@MATH0@@`, ...) contain no markdown-special characters, so they always
 * survive the parse untouched.
 *
 * Both delimiter families are honored, because a model writes whichever its
 * training leaned on: TeX's `$…$`/`$$…$$` and LaTeX's `\(…\)`/`\[…\]`. Display
 * forms are extracted first so a `\[` inside a `$$` block can't split it — this
 * mirrors MathRenderer's tokenizer so the two renderers stay in agreement.
 *
 * `marked`'s HTML passthrough is left unsanitized: every caller renders only
 * first-party text — the user's own typed draft, or the assistant's reply from
 * the user's own Claude session — never remote or third-party content. Introducing
 * a sanitizer would be the right move if that trust boundary ever widens.
 */
export function renderMarkdownWithMath(source: string): string {
  const mathHtml: string[] = []
  const stash = (html: string): string => {
    mathHtml.push(html)
    return `@@MATH${mathHtml.length - 1}@@`
  }

  const withoutMath = source
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => stash(renderMath(tex, true)))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex: string) => stash(renderMath(tex, true)))
    .replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => stash(renderMath(tex, false)))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex: string) => stash(renderMath(tex, false)))

  // Synchronous parse (no async extensions configured) — `marked.parse` with default
  // options returns a string, not a Promise, in that case.
  const bodyHtml = marked.parse(withoutMath, { async: false }) as string

  return bodyHtml.replace(/@@MATH(\d+)@@/g, (_m, i: string) => mathHtml[Number(i)] ?? '')
}
