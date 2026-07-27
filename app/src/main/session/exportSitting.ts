import { app, dialog, BrowserWindow } from 'electron'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ExportSittingRequest, ExportSittingResult } from '../../shared/types'

/** Mirrors the filename-sanitizing a save dialog itself would reject —
 * strips path separators and other characters that would either break on
 * disk or get silently swapped by the OS, so the suggested filename doesn't
 * surprise the user by differing from what they typed as the sitting title.
 * Exported so exportMap.ts's save-dialog filename goes through the exact
 * same sanitizing rather than a second, possibly-drifting copy. */
export function sanitizeFilename(title: string): string {
  const cleaned = title.replace(/[/\\:*?"<>|]/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : 'sitting'
}

/** Exported for the same reason as sanitizeFilename — exportMap.ts's default
 * filename uses the identical date stamp convention. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

/** THE hidden-window print pipeline, factored out so exportMap.ts (the print
 * plate) and this file's own PDF branch (below) share exactly one
 * implementation of "load a self-contained HTML document into an offscreen
 * BrowserWindow and drive printToPDF" — not two copies that could drift.
 * Loaded via a TEMP FILE rather than a `data:` URL for the reason given in
 * this file's own header comment (the ~2M-character data: URL cap); the
 * window is always destroyed and the temp file always cleaned up in the
 * `finally`, success or failure, so a printToPDF failure can never leak a
 * stray window or temp file. Returns the PDF bytes — writing them to the
 * user-chosen path is the CALLER's job (both callers' destinations differ:
 * a sitting export vs. a map export), so this function itself never touches
 * the save path or the dialog. */
export async function renderPrintHtmlToPdf(
  printHtml: string,
  options?: Partial<Electron.PrintToPDFOptions>,
): Promise<Buffer> {
  const tempHtmlPath = join(app.getPath('temp'), `engram-print-export-${randomUUID()}.html`)
  let printWindow: BrowserWindow | null = null
  try {
    await writeFile(tempHtmlPath, printHtml, 'utf-8')
    printWindow = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    await printWindow.loadFile(tempHtmlPath)
    return await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      ...options,
    })
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.destroy()
    await unlink(tempHtmlPath).catch(() => {
      // Best-effort cleanup — a leftover temp file in the OS temp dir is
      // harmless (cleaned by the OS eventually) and must never mask the
      // real export result above.
    })
  }
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

  try {
    const pdfBuffer = await renderPrintHtmlToPdf(req.printHtml)
    await writeFile(filePath, pdfBuffer)
    return { ok: true, path: filePath }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
