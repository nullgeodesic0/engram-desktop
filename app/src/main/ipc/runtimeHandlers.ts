import { BrowserWindow, ipcMain, shell } from 'electron'
import type { CellResult, KernelEvent, RuntimeProgress, WorkbenchCell } from '../../shared/runtime'
import { getCellLimitS, getRuntimeStatus, installRuntime, removeRuntime, setCellLimitS } from '../runtime/envManager'
import { KernelManager } from '../runtime/kernel'
import { createWorkbench, listWorkbenches, openWorkbench, saveWorkbench, workbenchDir } from '../runtime/workbenchStore'

/**
 * IPC for the code runtime and the Workbench (see docs/code-runtime.md).
 * Progress and kernel events are pushed to every window, so a Workbench
 * reopened after the window was recreated keeps hearing its kernel.
 */

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

const kernels = new KernelManager(workbenchDir, (ev: KernelEvent) => broadcast('kernel:event', ev))

export function shutdownAllKernels(): void {
  kernels.shutdownAll()
}

export function registerRuntimeHandlers(): void {
  ipcMain.handle('runtime:status', () => getRuntimeStatus())
  ipcMain.handle('runtime:install', async () => {
    await installRuntime((p: RuntimeProgress) => broadcast('runtime:progress', p))
    return getRuntimeStatus()
  })
  ipcMain.handle('runtime:remove', async () => {
    kernels.shutdownAll()
    await removeRuntime()
    return getRuntimeStatus()
  })
  ipcMain.handle('runtime:getCellLimit', () => getCellLimitS())
  ipcMain.handle('runtime:setCellLimit', (_e, seconds: number) => setCellLimitS(seconds))

  ipcMain.handle('workbench:list', () => listWorkbenches())
  ipcMain.handle('workbench:open', (_e, id: string) => openWorkbench(id))
  ipcMain.handle('workbench:create', (_e, title: string) => createWorkbench(String(title ?? '')))
  ipcMain.handle(
    'workbench:save',
    (_e, id: string, doc: { title: string; cells: WorkbenchCell[]; results: Record<string, CellResult> }) => saveWorkbench(id, doc),
  )
  ipcMain.handle('workbench:reveal', (_e, id: string) => shell.openPath(workbenchDir(id)))

  ipcMain.handle('kernel:run', (_e, workbenchId: string, cellId: string, code: string) => {
    workbenchDir(workbenchId) // validates the id before anything is spawned
    kernels.run(workbenchId, String(cellId), String(code))
  })
  ipcMain.handle('kernel:interrupt', (_e, workbenchId: string) => kernels.interrupt(workbenchId))
  ipcMain.handle('kernel:restart', (_e, workbenchId: string) => {
    workbenchDir(workbenchId)
    kernels.restart(workbenchId)
  })
  ipcMain.handle('kernel:shutdown', (_e, workbenchId: string) => kernels.shutdown(workbenchId))
  ipcMain.handle('kernel:state', (_e, workbenchId: string) => kernels.state(workbenchId))
  ipcMain.handle('kernel:vars', (_e, workbenchId: string) => kernels.vars(workbenchId))
}
