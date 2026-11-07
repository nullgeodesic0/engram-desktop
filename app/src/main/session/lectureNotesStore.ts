import { app, dialog, shell, type BrowserWindow } from 'electron'
import { join, dirname } from 'node:path'
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { getTopicsCached } from '../engramCli/topicsCache'
import { renderPrintHtmlToPdf, sanitizeFilename } from './exportSitting'
import {
  countPdfPages,
  isValidNotesId,
  lectureNotesPrintHtml,
  type LectureNotesPayload,
  type LectureNotesRecord,
  type LectureNotesSummary,
} from '../../shared/lectureNotes'

/**
 * Lecture notes on disk — `<userData>/lecture-notes/<topic>/<node>.json` and
 * the rendered `<node>.pdf` beside it. App userData only, the same
 * not-part-of-the-plugin's-schema home as map-annotations.json: notes are
 * the tutor's teaching text, never learning state, and nothing here reads a
 * node's claim, rubric or probe.
 *
 * One set of notes per node. A later sitting that writes notes for the same
 * node again (a re-walk after a reset) replaces them: the map shows the
 * notes that taught the concept most recently.
 */

function rootDir(): string {
  return join(app.getPath('userData'), 'lecture-notes')
}

/** Ids are re-validated on every path build, so a renderer-supplied id can
 * never walk out of the notes directory. */
function paths(topic: string, node: string): { json: string; pdf: string } | null {
  if (!isValidNotesId(topic) || !isValidNotesId(node)) return null
  const dir = join(rootDir(), topic)
  return { json: join(dir, `${node}.json`), pdf: join(dir, `${node}.pdf`) }
}

let katexCssCache: string | null = null

/** KaTeX's stylesheet with its woff2 fonts inlined. The print document is
 * loaded from a temp file, so the stylesheet's relative `fonts/…` URLs would
 * resolve to nothing and every formula would print in a fallback face. */
async function katexCssWithInlineFonts(): Promise<string> {
  if (katexCssCache) return katexCssCache
  const require = createRequire(import.meta.url)
  const cssPath = require.resolve('katex/dist/katex.min.css')
  const fontDir = join(dirname(cssPath), 'fonts')
  let css = await readFile(cssPath, 'utf-8')
  const fontNames = new Set<string>()
  css.replace(/url\(fonts\/([A-Za-z0-9_-]+)\.woff2\)/g, (_m, name: string) => {
    fontNames.add(name)
    return ''
  })
  const dataUris = new Map<string, string>()
  for (const name of fontNames) {
    try {
      const bytes = await readFile(join(fontDir, `${name}.woff2`))
      dataUris.set(name, `data:font/woff2;base64,${bytes.toString('base64')}`)
    } catch {
      // A missing font degrades one glyph family, never the whole PDF.
    }
  }
  // Keep only the woff2 source of each @font-face, inlined.
  css = css.replace(
    /src:url\(fonts\/([A-Za-z0-9_-]+)\.woff2\) format\("woff2"\)(,url\([^)]*\) format\("[a-z]+"\))*/g,
    (m, name: string) => (dataUris.has(name) ? `src:url(${dataUris.get(name)}) format("woff2")` : m),
  )
  katexCssCache = css
  return css
}

async function topicTitle(topic: string): Promise<string> {
  try {
    const topics = await getTopicsCached()
    const hit = topics.find((t) => t.topic === topic)
    if (hit?.title) return hit.title
  } catch {
    // Fall through to the id — a title lookup never blocks the notes.
  }
  return topic.replace(/-/g, ' ')
}

async function renderPdf(record: LectureNotesRecord, pdfPath: string): Promise<number | null> {
  const html = lectureNotesPrintHtml(record, await topicTitle(record.topic), await katexCssWithInlineFonts())
  const pdf = await renderPrintHtmlToPdf(html, {
    margins: { top: 0.8, bottom: 0.8, left: 0.9, right: 0.9 },
  })
  await writeFile(pdfPath, pdf)
  return countPdfPages(Buffer.from(pdf).toString('latin1'))
}

/** Stores the notes and renders their PDF. The JSON lands first, so a PDF
 * failure (no GPU, a renderer crash) still leaves readable notes in the app;
 * the PDF is re-rendered on the next open. */
export async function saveLectureNotes(notes: LectureNotesPayload, sessionId: string | null): Promise<LectureNotesRecord> {
  const p = paths(notes.topic, notes.node)
  if (!p) throw new Error('invalid topic or node id')
  await mkdir(dirname(p.json), { recursive: true })
  const record: LectureNotesRecord = { ...notes, writtenAt: new Date().toISOString(), sessionId, pages: null }
  await writeFile(p.json, JSON.stringify(record, null, 2), 'utf-8')
  try {
    record.pages = await renderPdf(record, p.pdf)
    await writeFile(p.json, JSON.stringify(record, null, 2), 'utf-8')
  } catch {
    // Leave pages null; ensurePdf retries on open.
  }
  return record
}

export async function getLectureNotes(topic: string, node: string): Promise<LectureNotesRecord | null> {
  const p = paths(topic, node)
  if (!p) return null
  try {
    return JSON.parse(await readFile(p.json, 'utf-8')) as LectureNotesRecord
  } catch {
    return null
  }
}

export async function listLectureNotes(topic: string): Promise<LectureNotesSummary[]> {
  if (!isValidNotesId(topic)) return []
  let files: string[]
  try {
    files = await readdir(join(rootDir(), topic))
  } catch {
    return []
  }
  const out: LectureNotesSummary[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const rec = await getLectureNotes(topic, f.slice(0, -5))
    if (rec) {
      const { markdown: _markdown, ...summary } = rec
      out.push(summary)
    }
  }
  return out.sort((a, b) => a.writtenAt.localeCompare(b.writtenAt))
}

/** The PDF path, rendering it first if it is missing (an earlier render
 * failed, or the file was deleted by hand). */
async function ensurePdf(topic: string, node: string): Promise<string | null> {
  const p = paths(topic, node)
  const rec = await getLectureNotes(topic, node)
  if (!p || !rec) return null
  try {
    await readFile(p.pdf)
    return p.pdf
  } catch {
    try {
      rec.pages = await renderPdf(rec, p.pdf)
      await writeFile(p.json, JSON.stringify(rec, null, 2), 'utf-8')
      return p.pdf
    } catch {
      return null
    }
  }
}

/** Opens the PDF in the system viewer. */
export async function openLectureNotesPdf(topic: string, node: string): Promise<{ ok: boolean; reason?: string }> {
  const pdf = await ensurePdf(topic, node)
  if (!pdf) return { ok: false, reason: 'These notes could not be found or printed.' }
  const err = await shell.openPath(pdf)
  return err ? { ok: false, reason: err } : { ok: true }
}

/** Copies the PDF to a place the learner picks. */
export async function saveLectureNotesPdfCopy(
  win: BrowserWindow | null,
  topic: string,
  node: string,
): Promise<{ ok: boolean; path?: string; reason?: string }> {
  if (!win) return { ok: false, reason: 'No window available to show the save dialog from.' }
  const rec = await getLectureNotes(topic, node)
  const pdf = await ensurePdf(topic, node)
  if (!rec || !pdf) return { ok: false, reason: 'These notes could not be found or printed.' }
  const result = await dialog.showSaveDialog(win, {
    title: 'Save lecture notes',
    defaultPath: `${sanitizeFilename(rec.title)} — lecture notes.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (result.canceled || !result.filePath) return { ok: false, reason: 'canceled' }
  await copyFile(pdf, result.filePath)
  return { ok: true, path: result.filePath }
}
