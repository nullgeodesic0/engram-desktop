import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = () => join(app.getPath('userData'), 'window-state.json')
const DEFAULTS = { width: 1280, height: 840 }

/** Last-known window bounds, clamped to a currently-attached display so a
 * disconnected monitor can't strand the window off-screen. */
export function restoreWindowState(): { x?: number; y?: number; width: number; height: number } {
  try {
    const saved = JSON.parse(readFileSync(FILE(), 'utf-8')) as Rectangle
    const area = screen.getDisplayMatching(saved).workArea
    const width = Math.min(saved.width, area.width)
    const height = Math.min(saved.height, area.height)
    const x = Math.min(Math.max(saved.x, area.x), area.x + area.width - width)
    const y = Math.min(Math.max(saved.y, area.y), area.y + area.height - height)
    return { x, y, width, height }
  } catch {
    return { ...DEFAULTS }
  }
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const save = () => {
    if (win.isDestroyed() || win.isFullScreen()) return
    try {
      writeFileSync(FILE(), JSON.stringify(win.getNormalBounds()))
    } catch {
      // Best-effort — a failed save just means default bounds next launch.
    }
  }
  const debounced = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 500)
  }
  win.on('move', debounced)
  win.on('resize', debounced)
  win.on('close', save)
}
