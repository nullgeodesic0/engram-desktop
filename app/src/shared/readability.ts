/**
 * A quick, mechanical readability check on prose the tutor writes for the
 * learner to read (today: lecture notes, before `publish_lecture_notes`
 * accepts them).
 *
 * It only FLAGS sentences; it never rewrites anything. The tutor rereads the
 * flagged sentences against the dialogue grammar's "Readable sentences"
 * overlay and decides what to change, so equations, code, identifiers and
 * terms of art are only ever edited by the model under rules that forbid
 * touching them.
 *
 * Only signals a regex can catch without many false alarms are checked:
 * very long sentences (a proxy for a subject far from its verb), words the
 * notes' language rules already forbid, stock filler frames and overused
 * words, and paragraphs heavy with dashes. Missing "that", stacked nouns and
 * things doing what people do need a parser or a reader, so they are left to
 * the tutor's own reread.
 *
 * Background: Clark, Martin & Mahowald (arXiv 2610.29162) found that most
 * frontier models overuse six constructions that earlier psycholinguistic
 * studies link to slower reading. The paper measures; the checks and
 * thresholds here are this app's own choices.
 *
 * Pure and DOM-free, like lectureNotes.ts.
 */

export interface ReadabilityFinding {
  kind: 'long-sentence' | 'forbidden-word' | 'filler' | 'dashes'
  /** The sentence or paragraph, math shown as [math] and code as [code]. */
  excerpt: string
  /** What to look at, in one sentence the tutor can act on. */
  advice: string
}

/** Words of prose (math and code count as one word each). Long enough that
 * a sentence past it almost always has a long subject–verb or verb–object
 * gap, or should be two sentences. */
export const LONG_SENTENCE_WORDS = 40
/** At most this many findings go back, so the reply stays a short list. */
export const MAX_FINDINGS = 8
const MAX_EXCERPT = 140

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bsimply\b/i, 'simply'],
  [/\bobviously\b/i, 'obviously'],
  [/\bclearly\b/i, 'clearly'],
  [/\btrivially\b/i, 'trivially'],
  [/\bit(?:'s|’s| is) easy to see\b/i, "it's easy to see"],
]

const FILLER: Array<[RegExp, string]> = [
  [/\bit(?:'s|’s| is) (?:important|worth|crucial) (?:to note|noting|mentioning|pointing out|remembering)\b/i, 'a frame before the claim'],
  [/\bgreat question\b/i, '"great question"'],
  [/\bdelv(?:e|es|ed|ing)\b/i, '"delve"'],
  [/\btapestry\b/i, '"tapestry"'],
  [/\bseamless(?:ly)?\b/i, '"seamless"'],
  [/\bleverag(?:e|es|ed|ing)\b/i, '"leverage"'],
  [/\bnavigat(?:e|es|ing) the (?:landscape|complexities)\b/i, '"navigate the landscape"'],
  [/^(?:in short|in summary|to sum up|in conclusion),/i, 'a wrap-up line'],
]

/** Replaces code and math with placeholders so they are never judged as
 * prose (and never split a sentence on a period inside an equation). */
export function proseOnly(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '\n\n')
    .replace(/~~~[\s\S]*?~~~/g, '\n\n')
    .replace(/\$\$[\s\S]*?\$\$/g, ' [math] ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' [math] ')
    .replace(/\\\([\s\S]*?\\\)/g, ' [math] ')
    .replace(/(?<![\\$])\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/g, '[math]')
    .replace(/`[^`\n]+`/g, '[code]')
}

/** Paragraphs of prose: headings, tables, rules and quotes are left out
 * (fragments are expected there); list items are kept, one per paragraph. */
function paragraphs(prose: string): string[] {
  const out: string[] = []
  let current: string[] = []
  const flush = () => {
    if (current.length) out.push(current.join(' '))
    current = []
  }
  for (const raw of prose.split('\n')) {
    const line = raw.trim()
    if (!line || /^#{1,6}\s/.test(line) || line.startsWith('|') || line.startsWith('>') || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush()
      continue
    }
    if (/^([-*+]|\d+[.)])\s+/.test(line)) {
      flush()
      current.push(line.replace(/^([-*+]|\d+[.)])\s+/, ''))
      continue
    }
    current.push(line)
  }
  flush()
  return out.map((p) => p.replace(/(\*\*|__|\*|_)(?=\S)|(?<=\S)(\*\*|__|\*|_)/g, '').trim()).filter(Boolean)
}

function sentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])["”')\]]*\s+(?=["“(\[]?[A-Z[])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter((w) => /[A-Za-z0-9[]/.test(w)).length
}

function excerpt(text: string): string {
  return text.length <= MAX_EXCERPT ? text : `${text.slice(0, MAX_EXCERPT - 1).trimEnd()}…`
}

export function readabilityFindings(markdown: string): ReadabilityFinding[] {
  const findings: ReadabilityFinding[] = []
  for (const para of paragraphs(proseOnly(markdown))) {
    const dashes = (para.match(/—|\s--\s/g) ?? []).length
    if (dashes >= 3) {
      findings.push({
        kind: 'dashes',
        excerpt: excerpt(para),
        advice: `This paragraph has ${dashes} dashes; turn most of them into commas, periods or parentheses.`,
      })
    }
    for (const s of sentences(para)) {
      const n = wordCount(s)
      if (n > LONG_SENTENCE_WORDS) {
        findings.push({
          kind: 'long-sentence',
          excerpt: excerpt(s),
          advice: `This sentence runs ${n} words. If its subject sits far from its verb, bring the verb up or split the sentence; if it reads easily, leave it.`,
        })
      }
      for (const [re, word] of FORBIDDEN) {
        if (re.test(s)) {
          findings.push({
            kind: 'forbidden-word',
            excerpt: excerpt(s),
            advice: `Remove "${word}": the notes' language rules forbid it.`,
          })
        }
      }
      for (const [re, what] of FILLER) {
        if (re.test(s)) {
          findings.push({
            kind: 'filler',
            excerpt: excerpt(s),
            advice: `Drop ${what} and keep the claim in plain words.`,
          })
        }
      }
    }
  }
  return findings.slice(0, MAX_FINDINGS)
}
