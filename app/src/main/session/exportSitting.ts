import { dialog, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { ExportSittingRequest, ExportSittingResult } from '../../shared/types'

/** Mirrors the filename-sanitizing a save dialog itself would reject —
 * strips path separators and other characters that would either break on
 * disk or get silently swapped by the OS, so the suggested filename doesn't
 * surprise the user by differing from what they typed as the sitting title. */
function sanitizeFilename(title: string): string {
  const cleaned = title.replace(/[/\\:*?"<>|]/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : 'sitting'
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Exports one sitting's transcript to a user-chosen path — the main-process
 * half of IPC `exportSitting` (see ipc/sessionHandlers.ts). Never writes
 * without a path the user picked via `dialog.showSaveDialog`; a cancel is a
 * clean no-op, not an error. The PDF path loads the renderer's self-contained
 * print HTML into a hidden, offscreen `BrowserWindow` purely to drive
 * `webContents.printToPDF` — that window is always destroyed before this
 * returns, success or failure (try/finally), so a printToPDF failure can
 * never leak a stray window into the app. */
export async function exportSitting(
  win: BrowserWindow | null,
  req: ExportSittingRequest,
): Promise<ExportSittingResult> {
  if (!win) return { ok: false, reason: 'No window available to show the save dialog from.' }

  const ext = req.format === 'md' ? 'md' : 'pdf'
  const dialogResult = await dialog.showSaveDialog(win, {
    title: 'Export sitting',
    defaultPath: `${sanitizeFilename(req.title)} — ${todayStamp()}.${ext}`,
    filters: [{ name: req.format === 'md' ? 'Markdown' : 'PDF', extensions: [ext] }],
  })
  if (dialogResult.canceled || !dialogResult.filePath) return { ok: false, reason: 'canceled' }
  const filePath = dialogResult.filePath

  if (req.format === 'md') {
    if (req.markdown == null) return { ok: false, reason: 'No markdown content was provided.' }
    await writeFile(filePath, req.markdown, 'utf-8')
    return { ok: true, path: filePath }
  }

  if (req.printHtml == null) return { ok: false, reason: 'No print document was provided.' }

  // Offscreen + never shown: this window exists only to run Chromium's print
  // pipeline against a document that never needs to paint on screen. Loaded
  // via a data: URL rather than a temp file — the document is already fully
  // self-contained (inline CSS, pre-rendered KaTeX), so there's nothing a
  // temp file would buy here except another thing to clean up.
  let printWindow: BrowserWindow | null = null
  try {
    printWindow = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(req.printHtml)}`)
    const pdfBuffer = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    await writeFile(filePath, pdfBuffer)
    return { ok: true, path: filePath }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy()
  }
}
