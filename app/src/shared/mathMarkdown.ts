import { marked } from 'marked'
import katex from 'katex'

/**
 * The DOM-free core of the app's markdown + LaTeX pipeline, shared by the
 * renderer (`renderer/src/shared/markdownWithMath.ts`, which adds the
 * node-chip pass on top) and the main process (lecture-notes PDFs, which are
 * rendered with no window in hand). One implementation, so a lecture-notes
 * PDF and the in-app reader can never disagree about what a `$…$` means.
 *
 * Math segments are pulled out and rendered via KaTeX *before* handing the
 * rest to `marked`, then spliced back in — otherwise markdown's own
 * escaping/emphasis rules (`_`, `*`, `#`) would mangle raw TeX. The
 * placeholder tokens (`@@MATH0@@`, ...) contain no markdown-special
 * characters, so they always survive the parse untouched.
 */
export function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode })
  } catch {
    return displayMode ? `$$${tex}$$` : `$${tex}$`
  }
}

export function renderMarkdownWithMathCore(source: string, postProcess?: (bodyHtml: string) => string): string {
  const mathHtml: string[] = []
  const stash = (html: string): string => {
    mathHtml.push(html)
    return `@@MATH${mathHtml.length - 1}@@`
  }

  const withoutMath = source
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => stash(renderMath(tex, true)))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex: string) => stash(renderMath(tex, true)))
    // Pandoc's inline-math delimiter rules, not "any two dollars on a line": the
    // opening `$` must be followed by a non-space, the closing `$` must be preceded
    // by a non-space and not followed by a digit. This keeps `$x$`, `$f(x)=x^2$`,
    // and digit-leading math like `$2n$`/`$5$` working while leaving currency like
    // "$5 … $2" as prose — an unpaired-currency "pair" always fails the closing-side
    // guards (the closer is preceded by a space, or followed by a digit as in
    // "$5-$10"), which is what actually prevents math mode swallowing the spaces.
    // NOTE: Pandoc forbids a digit only AFTER THE CLOSER — a digit after the opener
    // is legitimate math, and banning it there was exactly what broke `$2n$`.
    .replace(/\$(?!\s)((?:[^$\n]|\\\$)*?)(?<!\s)\$(?!\d)/g, (_m, tex: string) => stash(renderMath(tex, false)))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex: string) => stash(renderMath(tex, false)))

  // Synchronous parse (no async extensions configured) — `marked.parse` with default
  // options returns a string, not a Promise, in that case.
  let bodyHtml = marked.parse(withoutMath, { async: false }) as string
  if (postProcess) bodyHtml = postProcess(bodyHtml)

  return bodyHtml.replace(/@@MATH(\d+)@@/g, (_m, i: string) => mathHtml[Number(i)] ?? '')
}
