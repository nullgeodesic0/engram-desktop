import { ipcMain } from 'electron'
import {
  engramRead,
  engramTopicStatusText,
  engramArtifactList,
  engramDirectMutate,
  readTopicGraph,
} from '../engramCli/readOnly'
import { getTopicsCached } from '../engramCli/topicsCache'
import { readReceiptsHistory } from '../engramCli/receiptsHistory'
import { getMapAnnotations } from '../session/mapAnnotations'

export function registerReadHandlers(): void {
  ipcMain.handle('engram:topics', () => getTopicsCached())
  ipcMain.handle('engram:stats', () => engramRead('stats'))
  ipcMain.handle('engram:due', (_e, limit?: number, topic?: string) => {
    const args: string[] = []
    if (limit != null) args.push('--limit', String(limit))
    if (topic) args.push('--topic', topic)
    return engramRead('due', args)
  })
  ipcMain.handle('engram:decay', (_e, topic?: string, horizon?: number) => {
    const args: string[] = []
    if (topic) args.push('--topic', topic)
    if (horizon != null) args.push('--horizon', String(horizon))
    return engramRead('decay', args)
  })
  ipcMain.handle('engram:next', (_e, topic: string) => engramRead('next', ['--topic', topic]))
  ipcMain.handle('engram:doctor', () => engramRead('doctor'))
  ipcMain.handle('engram:model', () => engramRead('model'))
  ipcMain.handle('engram:topicStatusText', (_e, topic: string) => engramTopicStatusText(topic))
  ipcMain.handle('engram:topicGraph', (_e, topic: string) => readTopicGraph(topic))
  ipcMain.handle('engram:artifactList', () => engramArtifactList())
  ipcMain.handle('engram:receiptsHistory', () => readReceiptsHistory())
  ipcMain.handle('mapAnnotations:get', (_e, topicId: string) => getMapAnnotations(topicId))

  // The narrow direct-mutation exception (settings only): visuals/focus/model --set/commit.
  ipcMain.handle('engram:visuals', (_e, mode: 'eager' | 'threshold' | 'off' | 'status') =>
    engramDirectMutate('visuals', [mode]),
  )
  ipcMain.handle('engram:focus', (_e, mode: 'on' | 'off' | 'status') =>
    engramDirectMutate('focus', [mode]),
  )
  ipcMain.handle('engram:modelSet', (_e, path: string, value: string) =>
    engramDirectMutate('model', ['--set', `${path}=${value}`]),
  )
  ipcMain.handle('engram:modelAddInterest', (_e, interest: string) =>
    engramDirectMutate('model', ['--add-interest', interest]),
  )
  ipcMain.handle('engram:commit', (_e, cue: string, action: string) =>
    engramDirectMutate('commit', ['--cue', cue, '--action', action]),
  )
}
