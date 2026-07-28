import { marked } from 'marked'
import katex from 'katex'
import { nodeChipHtml } from './nodeChip'

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode })
  } catch {
    return displayMode ? `$$${tex}$$` : `$${tex}$`
  }
}

/** Chat Instruments Wave B — node-name chips. Runs AFTER `marked.parse()`,
 * a DOM pass over the already-rendered HTML (the task's own suggested
 * approach, judged cleanest here too: `marked`'s renderer-override API would
 * require reconfiguring the shared `marked` instance per call with the
 * caller's own node-id set, whereas walking the output HTML needs no shared-
 * instance state at all and can't leak between unrelated calls). Only a
 * `<code>` NOT inside a `<pre>` — an inline codespan, never a fenced block —
 * whose trimmed text EXACTLY matches an id in `nodeIds` gets replaced;
 * everything else (a currency figure, a CLI flag, an unrelated identifier —
 * see the corpus measurement in the Wave B report) renders as plain code,
 * byte-identical to before this wave. `nodeIds` empty or undefined is the
 * fast path: no DOMParser round-trip at all. Once per id per call (i.e. once
 * per rendered message): a real corpus scan across 34 real Learn sittings
 * found 39 exact matches out of 1268 backticked tokens, and only ONE case of
 * the same id repeating within a single message — chips are nowhere near
 * "everywhere," but the cap costs nothing and protects the one real repeat. */
function chipifyNodeCodespans(html: string, nodeIds: Set<string>, topicId: string): string {
  if (nodeIds.size === 0) return html
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return html
  const seen = new Set<string>()
  let changed = false
  root.querySelectorAll('code').forEach((codeEl) => {
    if (codeEl.closest('pre')) return
    const text = codeEl.textContent?.trim() ?? ''
    if (!nodeIds.has(text) || seen.has(text)) return
    seen.add(text)
    const template = doc.createElement('template')
    template.innerHTML = nodeChipHtml(topicId, text)
    const chip = template.content.firstElementChild
    if (!chip) return
    codeEl.replaceWith(chip)
    changed = true
  })
  return changed ? root.innerHTML : html
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
export function renderMarkdownWithMath(
  source: string,
  /** Chat Instruments Wave B — node-name chips. Both undefined (every call
   * site before this wave, and every call site that has no topic graph in
   * scope — e.g. Review's live view; see ReviewSessionView's own doctrine
   * comment on why it holds none) renders byte-identically to before this
   * wave: `chipifyNodeCodespans` fast-paths out on an empty/absent set. */
  nodeChips?: { nodeIds: Set<string>; topicId: string },
): string {
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
  if (nodeChips && nodeChips.nodeIds.size > 0) {
    bodyHtml = chipifyNodeCodespans(bodyHtml, nodeChips.nodeIds, nodeChips.topicId)
  }

  return bodyHtml.replace(/@@MATH(\d+)@@/g, (_m, i: string) => mathHtml[Number(i)] ?? '')
}
