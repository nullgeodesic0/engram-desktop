/**
 * Lecture Notes — the learner-elected pre-reading for a concept that is new
 * to them (Settings → Lecture notes). The tutor writes the notes inside the
 * live sitting and hands them over through the `publish_lecture_notes`
 * bridge tool; the main process shape-guards them here, stores them in the
 * app's own userData (never the learning home), and renders the PDF.
 *
 * Pure and DOM-free on purpose: the bridge server, the IPC handlers, the
 * renderer and the tests all share this one definition of what a valid set
 * of notes is.
 */
import { renderMarkdownWithMathCore } from './mathMarkdown'

/** engram's own kebab-case id charset — identical to mapAnnotations.ts's. */
const ID_RE = /^[a-z0-9-]+$/
const MAX_ID_LEN = 128
const MAX_TITLE_LEN = 200
/** About four printed pages. The protocol asks for 400–900 words; the cap
 * is generous so a math-heavy page (LaTeX is verbose) is never refused. */
export const MAX_NOTES_CHARS = 24_000
const MIN_NOTES_CHARS = 200

export interface LectureNotesPayload {
  topic: string
  node: string
  title: string
  markdown: string
}

export interface LectureNotesRecord extends LectureNotesPayload {
  /** ISO time the app received the notes — minted by the host, never the model. */
  writtenAt: string
  /** The sitting that wrote them, so the map can say where they came from. */
  sessionId: string | null
  /** Printed page count of the stored PDF, or null if rendering failed. */
  pages: number | null
}

/** What lists and cards need — everything but the body. */
export type LectureNotesSummary = Omit<LectureNotesRecord, 'markdown'>

export function isValidNotesId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LEN && ID_RE.test(id)
}

/**
 * Validates a `publish_lecture_notes` payload. Unlike the advisory bridge
 * tools, the reasons go BACK to the tutor (the same contract emit_card_pack
 * has), so a refused set of notes is one it can fix on the same turn rather
 * than a silent gap in the learner's sitting.
 */
export function validateLectureNotes(
  raw: unknown,
): { ok: true; notes: LectureNotesPayload } | { ok: false; reasons: string[] } {
  if (!raw || typeof raw !== 'object') return { ok: false, reasons: ['the payload is not an object'] }
  const r = raw as Record<string, unknown>
  const reasons: string[] = []
  if (!isValidNotesId(r.topic)) reasons.push('topic must be the topic id (lowercase letters, digits and hyphens)')
  if (!isValidNotesId(r.node)) reasons.push('node must be the node id (lowercase letters, digits and hyphens)')
  const title = typeof r.title === 'string' ? r.title.trim() : ''
  if (!title) reasons.push('title is required')
  else if (title.length > MAX_TITLE_LEN) reasons.push(`title is longer than ${MAX_TITLE_LEN} characters`)
  const markdown = typeof r.markdown === 'string' ? r.markdown.trim() : ''
  if (markdown.length < MIN_NOTES_CHARS) reasons.push('markdown is missing or too short to be lecture notes')
  else if (markdown.length > MAX_NOTES_CHARS)
    reasons.push(`markdown is ${markdown.length} characters; keep the notes under ${MAX_NOTES_CHARS} (aim for 400–900 words)`)
  if (reasons.length > 0) return { ok: false, reasons }
  return { ok: true, notes: { topic: r.topic as string, node: r.node as string, title, markdown } }
}

/** Counts pages in a PDF Chromium printed, given its bytes as a latin1
 * string. Page objects are `/Type /Page`; the tree root is `/Type /Pages`,
 * which the lookahead excludes. */
export function countPdfPages(pdfLatin1: string): number | null {
  const n = (pdfLatin1.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length
  return n > 0 ? n : null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The notes body as HTML — the in-app reader and the PDF render the same thing. */
export function lectureNotesBodyHtml(markdown: string): string {
  return renderMarkdownWithMathCore(markdown)
}

/**
 * A self-contained print document for `renderPrintHtmlToPdf`. Light paper
 * palette (the same family mapToPrintHtml.ts uses for the printed plate), a
 * running header naming the topic, and a footer saying who wrote it.
 * `katexCss` must already carry its fonts inline — the document is loaded
 * from a temp file, so relative font URLs would not resolve.
 */
export function lectureNotesPrintHtml(
  notes: Pick<LectureNotesRecord, 'title' | 'markdown' | 'writtenAt'>,
  topicTitle: string,
  katexCss: string,
): string {
  const date = new Date(notes.writtenAt)
  const dateLabel = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(notes.title)} — lecture notes</title>
<style>${katexCss}</style>
<style>
@page { size: Letter; margin: 0.8in 0.9in; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; }
body { font-family: 'Fraunces', Georgia, 'Times New Roman', serif; color: #2a2116; font-size: 11.5pt; line-height: 1.55; }
.running { display: flex; justify-content: space-between; gap: 16px; font: 8.5pt ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: #8a7a5c; border-bottom: 1px solid #c9bc9e; padding-bottom: 6px; margin-bottom: 18px; }
h1 { font-size: 22pt; font-weight: 500; line-height: 1.2; margin: 0 0 4px; }
h1 + p em { font: 9pt ui-monospace, 'SF Mono', Menlo, monospace; font-style: normal; letter-spacing: 0.08em; text-transform: uppercase; color: #a8691a; }
h2 { font: 600 9.5pt ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: 0.1em; text-transform: uppercase; color: #6b5d47; border-top: 1px solid #c9bc9e; padding-top: 10px; margin: 18px 0 6px; break-after: avoid; }
h2 .katex, h3 .katex { text-transform: none; letter-spacing: 0; }
h3 { font-size: 12pt; font-weight: 600; margin: 12px 0 4px; break-after: avoid; }
p { margin: 0 0 9px; }
ul, ol { margin: 0 0 9px; padding-left: 22px; }
li { margin: 3px 0; }
strong { color: #8f5416; font-weight: 600; }
code { font: 10pt ui-monospace, 'SF Mono', Menlo, monospace; background: #f2ead9; padding: 0 3px; }
pre { background: #f2ead9; padding: 8px 10px; overflow-x: hidden; white-space: pre-wrap; }
blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid #b9791f; color: #4a3d2a; }
table { border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #c9bc9e; padding: 4px 8px; text-align: left; vertical-align: top; }
.katex-display { margin: 10px 0; break-inside: avoid; }
.footer { margin-top: 22px; font: 8.5pt ui-monospace, 'SF Mono', Menlo, monospace; color: #8a7a5c; border-top: 1px solid #c9bc9e; padding-top: 6px; }
</style>
</head>
<body>
<div class="running"><span>Lecture notes · ${escapeHtml(topicTitle)}</span><span>${escapeHtml(dateLabel)}</span></div>
${lectureNotesBodyHtml(notes.markdown)}
<div class="footer">Written by your tutor in the sitting that introduced this concept · Engram Desktop</div>
</body>
</html>`
}
