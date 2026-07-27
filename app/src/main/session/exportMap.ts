import { dialog, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { sanitizeFilename, todayStamp, renderPrintHtmlToPdf } from './exportSitting'
import type { ExportMapRequest, ExportSittingResult } from '../../shared/types'

/** Exports the topic-map plate to a user-chosen PDF path — the main-process
 * half of IPC `map:export` (see ipc/sessionHandlers.ts). This is a SIBLING to
 * exportSitting.ts, not a second print path: the save-dialog filename goes
 * through that file's own `sanitizeFilename`/`todayStamp`, and the actual
 * "load a self-contained HTML document into a hidden BrowserWindow and drive
 * printToPDF" mechanics are that file's own `renderPrintHtmlToPdf` — the
 * exact same offscreen-window + try/finally pipeline the sitting export
 * already established, reused rather than re-implemented.
 *
 * Landscape, unlike the sitting export's portrait default — a node map is
 * wider than it is tall, the same reason a physical atlas plate is usually
 * bound landscape rather than portrait; the sitting export's own
 * portrait-Letter default is untouched since a transcript is prose. */
export async function exportMap(win: BrowserWindow | null, req: ExportMapRequest): Promise<ExportSittingResult> {
  if (!win) return { ok: false, reason: 'No window available to show the save dialog from.' }

  const dialogResult = await dialog.showSaveDialog(win, {
    title: 'Export map',
    defaultPath: `${sanitizeFilename(req.title)} — map — ${todayStamp()}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (dialogResult.canceled || !dialogResult.filePath) return { ok: false, reason: 'canceled' }
  const filePath = dialogResult.filePath

  if (req.printHtml == null) return { ok: false, reason: 'No print document was provided.' }

  try {
    const pdfBuffer = await renderPrintHtmlToPdf(req.printHtml, { landscape: true })
    await writeFile(filePath, pdfBuffer)
    return { ok: true, path: filePath }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
