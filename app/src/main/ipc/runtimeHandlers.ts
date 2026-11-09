import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { Confidence } from '../../shared/labs'
import type { CellResult, KernelEvent, RuntimeProgress, WorkbenchCell } from '../../shared/runtime'
import { labWorkbenchId, parseLabWorkbenchId } from '../../shared/runtime'
import {
  cancelRuntimeInstall,
  getCellLimitS,
  getRuntimeStatus,
  installRuntime,
  removeRuntime,
  setCellLimitS,
  setPackLayerSource,
} from '../runtime/envManager'
import { KernelManager } from '../runtime/kernel'
import { BASE_LAYER } from '../runtime/runtimePaths'
import { createWorkbench, listWorkbenches, openWorkbench, saveWorkbench, workbenchDir } from '../runtime/workbenchStore'
import {
  addCompletion,
  cancelAllChecks,
  cancelPackChecks,
  cancelSmoke,
  labIsSealed,
  labView,
  listPacks,
  openLab,
  pickConfidence,
  revealStep,
  runSmoke,
  submissionDir,
  submissionProduction,
  submitExplainBack,
  submitMilestone,
  submitReflection,
} from '../labs/labStore'
import { addPackFolder, layerForWorkbench, packLayerDefs, removePackFolder } from '../labs/packStore'

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

const kernels = new KernelManager(workbenchDir, (ev: KernelEvent) => broadcast('kernel:event', ev), layerForWorkbench)
setPackLayerSource(packLayerDefs)

export function shutdownAllKernels(): void {
  kernels.shutdownAll()
  cancelAllChecks()
}

type DocIn = {
  title: string
  cells: WorkbenchCell[]
  results: Record<string, CellResult>
}

export function registerRuntimeHandlers(): void {
  ipcMain.handle('runtime:status', () => getRuntimeStatus())
  // Every change of install state is announced, so an open Workbench
  // enables or disables itself without being remounted.
  const announce = async () => broadcast('runtime:changed', await getRuntimeStatus())
  ipcMain.handle('runtime:install', async (_e, layerId?: string) => {
    try {
      await installRuntime(typeof layerId === 'string' && layerId ? layerId : BASE_LAYER, (p: RuntimeProgress) =>
        broadcast('runtime:progress', p),
      )
    } finally {
      await announce()
    }
    return getRuntimeStatus()
  })
  ipcMain.handle('runtime:cancel', () => cancelRuntimeInstall())
  ipcMain.handle('runtime:remove', async () => {
    kernels.shutdownAll()
    cancelAllChecks()
    await removeRuntime()
    await announce()
    return getRuntimeStatus()
  })
  ipcMain.handle('runtime:getCellLimit', () => getCellLimitS())
  ipcMain.handle('runtime:setCellLimit', (_e, seconds: number) => setCellLimitS(seconds))

  ipcMain.handle('workbench:list', () => listWorkbenches())
  // A pack lab opens through labStore, which seeds it and refreshes its given cells.
  ipcMain.handle('workbench:open', (_e, id: string) => {
    const lab = parseLabWorkbenchId(String(id))
    return lab ? openLab(lab.packId, lab.labId) : openWorkbench(id)
  })
  ipcMain.handle('workbench:create', (_e, title: string) => createWorkbench(String(title ?? '')))
  ipcMain.handle('workbench:save', (_e, id: string, doc: DocIn) => saveWorkbench(id, doc))
  ipcMain.handle('workbench:reveal', (_e, id: string) => shell.openPath(workbenchDir(id)))

  ipcMain.handle('kernel:run', async (_e, workbenchId: string, cellId: string, code: string) => {
    workbenchDir(workbenchId) // validates the id before anything is spawned
    // A lab with a sealed submission is frozen until its explain-back and
    // confidence are in; its code does not run meanwhile.
    if (await labIsSealed(String(workbenchId)))
      throw new Error('This lab is frozen until the submission under way is unsealed.')
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

  // Content packs (docs/content-packs.md). Adding or removing one changes the
  // runtime layers on offer, so the runtime is announced too.
  const packsChanged = async () => {
    broadcast('packs:changed', await listPacks())
    await announce()
  }
  ipcMain.handle('packs:list', (_e, refresh?: boolean) => listPacks(refresh === true))
  ipcMain.handle('packs:add', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = {
      title: 'Add a content pack',
      properties: ['openDirectory' as const],
      buttonLabel: 'Add pack',
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths[0]) return null
    await addPackFolder(result.filePaths[0])
    await packsChanged()
    return listPacks()
  })
  ipcMain.handle('packs:remove', async (_e, folder: string) => {
    const before = await listPacks()
    const pack = before.find((p) => p.folder === folder)
    // A removed pack's labs must not keep a kernel on its layer.
    for (const lab of pack?.labs ?? []) kernels.shutdown(labWorkbenchId(lab.packId, lab.labId))
    if (pack?.id) cancelPackChecks(pack.id)
    await removePackFolder(String(folder))
    await packsChanged()
    return listPacks()
  })
  // Only a folder the learner added: the renderer cannot open arbitrary paths.
  ipcMain.handle('packs:reveal', async (_e, folder: string) => {
    if (!(await listPacks()).some((p) => p.folder === folder)) throw new Error('That folder is not an added pack.')
    return shell.openPath(folder)
  })

  const saveFirst = async (packId: string, labId: string, doc: DocIn | null) => {
    if (doc) await saveWorkbench(labWorkbenchId(String(packId), String(labId)), doc)
  }
  ipcMain.handle('lab:view', (_e, packId: string, labId: string) => labView(String(packId), String(labId)))
  ipcMain.handle('lab:smoke', async (_e, packId: string, labId: string, milestoneId: string, doc: DocIn | null) => {
    await saveFirst(packId, labId, doc)
    return runSmoke(String(packId), String(labId), String(milestoneId))
  })
  ipcMain.handle('lab:cancelSmoke', (_e, packId: string, labId: string) => cancelSmoke(String(packId), String(labId)))
  ipcMain.handle('lab:submit', async (_e, packId: string, labId: string, milestoneId: string, doc: DocIn | null) => {
    await saveFirst(packId, labId, doc)
    return submitMilestone(String(packId), String(labId), String(milestoneId))
  })
  ipcMain.handle('lab:explainBack', (_e, packId: string, labId: string, submissionId: string, text: string) =>
    submitExplainBack(String(packId), String(labId), String(submissionId), String(text ?? '')),
  )
  ipcMain.handle('lab:confidence', (_e, packId: string, labId: string, submissionId: string, confidence: Confidence) =>
    pickConfidence(String(packId), String(labId), String(submissionId), confidence),
  )
  ipcMain.handle('lab:production', (_e, packId: string, labId: string, submissionId: string) =>
    submissionProduction(String(packId), String(labId), String(submissionId)),
  )
  ipcMain.handle('lab:revealStep', (_e, packId: string, labId: string, milestoneId: string) =>
    revealStep(String(packId), String(labId), String(milestoneId)),
  )
  ipcMain.handle(
    'lab:addCompletion',
    async (_e, packId: string, labId: string, milestoneId: string, doc: DocIn | null) => {
      await saveFirst(packId, labId, doc)
      return addCompletion(String(packId), String(labId), String(milestoneId))
    },
  )
  ipcMain.handle('lab:reflect', (_e, packId: string, labId: string, submissionId: string, text: string) =>
    submitReflection(String(packId), String(labId), String(submissionId), String(text ?? '')),
  )
  ipcMain.handle('lab:revealSubmission', async (_e, packId: string, labId: string, submissionId: string) =>
    shell.openPath(await submissionDir(String(packId), String(labId), String(submissionId))),
  )
}
