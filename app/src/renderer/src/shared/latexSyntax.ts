/** A delimiter scanner for LaTeX-in-prose, for the composer's editing aids.
 *
 * Editing LaTeX is not editing text. A paragraph reads left to right and a
 * mistake is visible; an expression is a TREE, and its most common mistakes —
 * an unclosed brace, a stray `$`, a `\left(` with no `\right)` — are invisible
 * until the render fails, at which point KaTeX reports a parse error at a
 * position that is usually nowhere near the actual mistake. IDEs solved this
 * for code decades ago with depth-coloured brackets and match highlighting.
 * This is that, for the four delimiter families a learner actually types.
 *
 * DELIBERATELY MATH-SCOPED. `(`, `[`, `{` are tokenised only INSIDE a math
 * span. Prose in this composer is full of ordinary parentheses (like this
 * one), and depth-colouring them would turn every message into confetti while
 * saying nothing — the whole value of the colour is that it means "you are
 * inside an expression, this deep." `$`/`$$` are always tokenised, since they
 * are what open the span in the first place.
 *
 * PURE. No React, no DOM, no KaTeX. The overlay renders what this returns and
 * the status line counts what this found, so both can be tested as data. */

export type DelimFamily = 'math' | 'paren' | 'bracket' | 'brace'

export interface DelimToken {
  /** Index of the token's first character in the source. */
  start: number
  /** Index one past its last character. */
  end: number
  /** The literal text — `$`, `$$`, `(`, `\{`, `\left(`, `\right]`, … */
  text: string
  open: boolean
  family: DelimFamily
  /** Nesting depth, 0-based, for colour cycling. A math span is depth 0 and
   * the first group inside it is depth 1. */
  depth: number
  /** Index into the returned `tokens` array, or null when nothing closed it. */
  partner: number | null
  /** True when this token came from `\left…`/`\right…` — the word is part of
   * `text` and gets coloured with the delimiter, which is what makes a
   * mismatched pair of sized delimiters findable at a glance. */
  sized: boolean
}

export interface ScanProblem {
  /** Source index the problem points at. */
  at: number
  /** Learner-facing, lowercase, no trailing period — the status line's voice. */
  message: string
}

export interface ScanResult {
  tokens: DelimToken[]
  problems: ScanProblem[]
  /** Count of COMPLETE math spans — an unterminated `$` is a problem, not a span. */
  mathSpans: number
}

const OPENERS: Record<string, DelimFamily> = { '(': 'paren', '[': 'bracket', '{': 'brace' }
const CLOSERS: Record<string, DelimFamily> = { ')': 'paren', ']': 'bracket', '}': 'brace' }

/** What `\left`/`\right` may be applied to. `.` is TeX's null delimiter — a
 * legitimate `\left. … \right)` construction. */
const SIZED_TARGETS = new Set(['(', ')', '[', ']', '{', '}', '.', '|', '/'])

/** Read a `\left`/`\right` at `i`, returning the full token text or null.
 *
 * The guard that matters: `\leftarrow` must NOT read as `\left` + `arrow`.
 * TeX control words are maximal runs of letters, so the word is only `\left`
 * if the letter run ENDS there. */
function readSized(src: string, i: number): { text: string; open: boolean } | null {
  let j = i + 1
  while (j < src.length && /[a-zA-Z]/.test(src[j])) j++
  const word = src.slice(i + 1, j)
  if (word !== 'left' && word !== 'right') return null
  // Optional whitespace between the word and its target.
  let k = j
  while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++
  if (k >= src.length) return null
  // `\left\{` / `\right\}` — the target is itself escaped.
  if (src[k] === '\\' && k + 1 < src.length && SIZED_TARGETS.has(src[k + 1])) {
    return { text: src.slice(i, k + 2), open: word === 'left' }
  }
  if (!SIZED_TARGETS.has(src[k])) return null
  return { text: src.slice(i, k + 1), open: word === 'left' }
}

/** Which family a sized token belongs to, read off its last character. */
function sizedFamily(text: string): DelimFamily {
  const last = text[text.length - 1]
  if (last === '(' || last === ')') return 'paren'
  if (last === '[' || last === ']') return 'bracket'
  return 'brace'
}

export function scanLatex(src: string): ScanResult {
  const tokens: DelimToken[] = []
  const problems: ScanProblem[] = []
  // Open groups awaiting a closer, innermost last. Math is tracked separately
  // because `$` toggles rather than nests.
  const groupStack: number[] = []
  let mathOpenToken: number | null = null
  let mathSpans = 0
  let i = 0

  const inMath = () => mathOpenToken !== null

  const push = (t: Omit<DelimToken, 'partner'>) => {
    tokens.push({ ...t, partner: null })
    return tokens.length - 1
  }

  while (i < src.length) {
    const c = src[i]

    if (c === '\\') {
      const next = src[i + 1]

      // `\$` and friends — an escaped literal is never a delimiter.
      if (next === '$' || next === '%' || next === '&' || next === '#' || next === '_') {
        i += 2
        continue
      }

      // `\{` / `\}` — a literal brace in the OUTPUT, but still a paired
      // construction the learner has to balance, so it's tokenised as one.
      if (inMath() && (next === '{' || next === '}')) {
        const open = next === '{'
        if (open) {
          groupStack.push(push({ start: i, end: i + 2, text: '\\{', open: true, family: 'brace', depth: groupStack.length + 1, sized: false }))
        } else {
          const openIdx = groupStack.pop()
          const idx = push({ start: i, end: i + 2, text: '\\}', open: false, family: 'brace', depth: openIdx !== undefined ? tokens[openIdx].depth : groupStack.length + 1, sized: false })
          if (openIdx === undefined) problems.push({ at: i, message: 'a `\\}` with nothing open' })
          else {
            tokens[openIdx].partner = idx
            tokens[idx].partner = openIdx
          }
        }
        i += 2
        continue
      }

      const sized = inMath() ? readSized(src, i) : null
      if (sized) {
        const family = sizedFamily(sized.text)
        if (sized.open) {
          groupStack.push(
            push({ start: i, end: i + sized.text.length, text: sized.text, open: true, family, depth: groupStack.length + 1, sized: true }),
          )
        } else {
          const openIdx = groupStack.pop()
          const idx = push({
            start: i,
            end: i + sized.text.length,
            text: sized.text,
            open: false,
            family,
            depth: openIdx !== undefined ? tokens[openIdx].depth : groupStack.length + 1,
            sized: true,
          })
          if (openIdx === undefined) problems.push({ at: i, message: 'a `\\right` with no `\\left`' })
          else {
            tokens[openIdx].partner = idx
            tokens[idx].partner = openIdx
            if (!tokens[openIdx].sized) {
              problems.push({ at: i, message: '`\\right` closing a plain opener' })
            }
          }
        }
        i += sized.text.length
        continue
      }

      // Any other control sequence: consume the whole word (or the single
      // escaped character), so nothing inside it is ever scanned.
      let j = i + 1
      if (j < src.length && /[a-zA-Z]/.test(src[j])) {
        while (j < src.length && /[a-zA-Z]/.test(src[j])) j++
      } else {
        j = i + 2
      }
      i = j
      continue
    }

    if (c === '$') {
      const display = src[i + 1] === '$'
      const text = display ? '$$' : '$'
      if (!inMath()) {
        mathOpenToken = push({ start: i, end: i + text.length, text, open: true, family: 'math', depth: 0, sized: false })
      } else {
        const openIdx = mathOpenToken as number
        // `$$` must close `$$` and `$` must close `$` — a mismatch here is the
        // single most confusing LaTeX bug there is, because it silently
        // re-opens a span and swallows the rest of the message as math.
        if (tokens[openIdx].text !== text) {
          problems.push({ at: i, message: `\`${text}\` closing a \`${tokens[openIdx].text}\` span` })
        }
        const idx = push({ start: i, end: i + text.length, text, open: false, family: 'math', depth: 0, sized: false })
        tokens[openIdx].partner = idx
        tokens[idx].partner = openIdx
        mathSpans++
        mathOpenToken = null
        // A math span ends any groups left open inside it.
        while (groupStack.length) {
          const stray = groupStack.pop() as number
          problems.push({ at: tokens[stray].start, message: `\`${tokens[stray].text}\` never closed` })
        }
      }
      i += text.length
      continue
    }

    if (inMath() && OPENERS[c]) {
      groupStack.push(push({ start: i, end: i + 1, text: c, open: true, family: OPENERS[c], depth: groupStack.length + 1, sized: false }))
      i++
      continue
    }

    if (inMath() && CLOSERS[c]) {
      const openIdx = groupStack.pop()
      const idx = push({
        start: i,
        end: i + 1,
        text: c,
        open: false,
        family: CLOSERS[c],
        depth: openIdx !== undefined ? tokens[openIdx].depth : groupStack.length + 1,
        sized: false,
      })
      if (openIdx === undefined) {
        problems.push({ at: i, message: `a \`${c}\` with nothing open` })
      } else {
        tokens[openIdx].partner = idx
        tokens[idx].partner = openIdx
        if (tokens[openIdx].family !== CLOSERS[c]) {
          problems.push({ at: i, message: `\`${c}\` closing a \`${tokens[openIdx].text}\`` })
        }
      }
      i++
      continue
    }

    i++
  }

  if (mathOpenToken !== null) {
    problems.push({ at: tokens[mathOpenToken].start, message: `\`${tokens[mathOpenToken].text}\` never closed` })
  }
  for (const stray of groupStack) {
    problems.push({ at: tokens[stray].start, message: `\`${tokens[stray].text}\` never closed` })
  }
  problems.sort((a, b) => a.at - b.at)

  return { tokens, problems, mathSpans }
}

/** The token the caret sits against, if any — checked on BOTH sides, the way
 * an editor does it, so a caret at `…{|` matches the brace behind it and a
 * caret at `|}` matches the one ahead. Returns the token index and its
 * partner's, so the overlay can emphasize the pair. */
export function pairAtCaret(tokens: DelimToken[], caret: number): { a: number; b: number } | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (caret === t.end || caret === t.start) {
      if (t.partner === null) return { a: i, b: i }
      return { a: i, b: t.partner }
    }
  }
  return null
}

/** One-line transparency for the composer's status row. Names the FIRST real
 * problem rather than a count of them: the first unbalanced delimiter is
 * usually the cause of every later one, so listing all of them would be
 * mostly noise about consequences. */
export function describeScan(result: ScanResult): string | null {
  if (result.problems.length > 0) {
    const first = result.problems[0]
    const more = result.problems.length - 1
    return more > 0 ? `${first.message} · ${more} more` : first.message
  }
  if (result.mathSpans === 0) return null
  return `${result.mathSpans} math span${result.mathSpans === 1 ? '' : 's'} · balanced`
}
