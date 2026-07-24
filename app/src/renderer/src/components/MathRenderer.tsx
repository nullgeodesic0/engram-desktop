import { Fragment, memo, useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

interface Token {
  type: 'text' | 'inline-math' | 'display-math'
  content: string
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const displayRe = /\$\$([\s\S]+?)\$\$/g
  let lastIndex = 0
  let m: RegExpExecArray | null

  while ((m = displayRe.exec(source))) {
    if (m.index > lastIndex) tokens.push({ type: 'text', content: source.slice(lastIndex, m.index) })
    tokens.push({ type: 'display-math', content: m[1] })
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < source.length) tokens.push({ type: 'text', content: source.slice(lastIndex) })

  // Second pass: split remaining text tokens on inline math.
  const out: Token[] = []
  const inlineRe = /\$([^$\n]+?)\$/g
  for (const tok of tokens) {
    if (tok.type !== 'text') {
      out.push(tok)
      continue
    }
    let idx = 0
    let im: RegExpExecArray | null
    inlineRe.lastIndex = 0
    while ((im = inlineRe.exec(tok.content))) {
      if (im.index > idx) out.push({ type: 'text', content: tok.content.slice(idx, im.index) })
      out.push({ type: 'inline-math', content: im[1] })
      idx = im.index + im[0].length
    }
    if (idx < tok.content.length) out.push({ type: 'text', content: tok.content.slice(idx) })
  }
  return out
}

/** Minimal **bold** support for the plain-text spans between math tokens. */
function renderPlainText(text: string, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span key={key} style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </span>
  )
}

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode })
  } catch {
    return displayMode ? `$$${tex}$$` : `$${tex}$`
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Pure-string counterpart to the component below — same tokenize/KaTeX pipeline
 * (genuinely re-running `katex.renderToString`, not a stringified DOM snapshot),
 * but returns raw HTML instead of JSX. Used by the lab-notebook PDF export
 * (renderer/src/shared/sittingToMarkdown.ts's `sittingToPrintHtml`), which builds
 * a standalone print document outside React's render tree — reusing this instead
 * of duplicating the tokenizer keeps the two renderers from drifting apart. */
export function renderMathHtml(text: string): string {
  return tokenize(text)
    .map((tok) => {
      if (tok.type !== 'text') return renderMath(tok.content, tok.type === 'display-math')
      return tok.content
        .split(/(\*\*[^*]+\*\*)/g)
        .map((part) =>
          part.startsWith('**') && part.endsWith('**')
            ? `<strong>${escapeHtml(part.slice(2, -2))}</strong>`
            : escapeHtml(part),
        )
        .join('')
    })
    .join('')
}

/** Renders assistant prose with $...$/$$...$$ math via KaTeX and minimal **bold**.
 * `katex.renderToString` is synchronous and non-trivial per equation, so the
 * rendered nodes (not just the tokenize pass) are memoized on `text` — without
 * this, every message in a session re-runs KaTeX on every unrelated re-render
 * (e.g. every keystroke in a sibling composer textarea), which is what made
 * typing feel laggy/dropped in longer sessions. */
export const MathRenderer = memo(function MathRenderer({ text, className = '' }: { text: string; className?: string }) {
  const tokens = useMemo(() => tokenize(text), [text])

  const rendered = useMemo(
    () =>
      tokens.map((tok, i) => {
        if (tok.type === 'text') return renderPlainText(tok.content, String(i))
        if (tok.type === 'inline-math') {
          return <span key={i} dangerouslySetInnerHTML={{ __html: renderMath(tok.content, false) }} />
        }
        return <div key={i} className="my-1" dangerouslySetInnerHTML={{ __html: renderMath(tok.content, true) }} />
      }),
    [tokens],
  )

  return <div className={className}>{rendered}</div>
})
