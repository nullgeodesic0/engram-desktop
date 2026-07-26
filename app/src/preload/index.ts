import { contextBridge, ipcRenderer } from 'electron'
import type {
  TopicSummary,
  EngramStats,
  DueItem,
  ArtifactEntry,
  Misconception,
  LearnerModel,
  TopicSettings,
  EnvironmentCheckResult,
  NotifierSettings,
  UpdateCheckResult,
  ReceiptsHistory,
  SessionIndexEntry,
  UnlockedAchievement,
  DecayResult,
  NextNodeResult,
  MapAnnotations,
  NodeProvenance,
  ExportSittingRequest,
  ExportSittingResult,
  BackupNowResult,
  DescribeArchiveResult,
  RestoreArchiveResult,
  BackupInfo,
} from '../shared/types'
import type { SessionEvent } from '../shared/sessionEvents'
import type { BridgeAskRequest, BridgeAskResponse, BridgeBeatRequest, BridgeUiRequest } from '../shared/bridgeProtocol'

const engramApi = {
  topics: (): Promise<TopicSummary[]> => ipcRenderer.invoke('engram:topics'),
  stats: (): Promise<EngramStats> => ipcRenderer.invoke('engram:stats'),
  due: (limit?: number, topic?: string): Promise<DueItem[]> => ipcRenderer.invoke('engram:due', limit, topic),
  decay: (topic?: string, horizon?: number): Promise<DecayResult> => ipcRenderer.invoke('engram:decay', topic, horizon),
  doctor: (): Promise<unknown> => ipcRenderer.invoke('engram:doctor'),
  model: (): Promise<LearnerModel> => ipcRenderer.invoke('engram:model'),
  topicStatusText: (topic: string): Promise<string> => ipcRenderer.invoke('engram:topicStatusText', topic),
  topicGraph: (topic: string): Promise<unknown> => ipcRenderer.invoke('engram:topicGraph', topic),
  nextNode: (topic: string): Promise<NextNodeResult> => ipcRenderer.invoke('engram:next', topic),
  artifactList: (): Promise<ArtifactEntry[]> => ipcRenderer.invoke('engram:artifactList'),
  receiptsHistory: (): Promise<ReceiptsHistory> => ipcRenderer.invoke('engram:receiptsHistory'),
  misconceptions: (): Promise<Misconception[]> => ipcRenderer.invoke('engram:misconceptions'),
  mapAnnotations: (topicId: string): Promise<MapAnnotations> => ipcRenderer.invoke('mapAnnotations:get', topicId),
  nodeProvenance: (topic: string): Promise<Record<string, NodeProvenance>> =>
    ipcRenderer.invoke('engram:nodeProvenance', topic),
  openArtifact: (absolutePath: string): Promise<void> => ipcRenderer.invoke('engram:openArtifact', absolutePath),
  openExplorable: (rawPath: string): Promise<{ url: string; absolutePath: string } | { error: string }> =>
    ipcRenderer.invoke('engram:openExplorable', rawPath),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles'),
  exportLearningData: (): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke('engram:exportData'),
  environmentCheck: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('engram:environmentCheck'),

  getNotifierSettings: (): Promise<NotifierSettings> => ipcRenderer.invoke('notifier:getSettings'),
  setNotifierSettings: (patch: Partial<NotifierSettings>): Promise<NotifierSettings> =>
    ipcRenderer.invoke('notifier:setSettings', patch),
  checkReviewsNow: (): Promise<{ dueCount: number }> => ipcRenderer.invoke('notifier:checkNow'),
  getLoginItemSettings: (): Promise<{ openAtLogin: boolean }> => ipcRenderer.invoke('app:getLoginItemSettings'),
  setLoginItemSettings: (openAtLogin: boolean): Promise<{ openAtLogin: boolean }> =>
    ipcRenderer.invoke('app:setLoginItemSettings', openAtLogin),
  checkForUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('app:checkForUpdate'),
  getCachedUpdateCheck: (): Promise<UpdateCheckResult | null> => ipcRenderer.invoke('app:getCachedUpdateCheck'),
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  getUnlockedAchievements: (): Promise<UnlockedAchievement[]> => ipcRenderer.invoke('achievements:getUnlocked'),
  recordUnlockedAchievements: (ids: string[]): Promise<UnlockedAchievement[]> =>
    ipcRenderer.invoke('achievements:recordUnlocked', ids),

  visuals: (mode: 'eager' | 'threshold' | 'off' | 'status'): Promise<unknown> =>
    ipcRenderer.invoke('engram:visuals', mode),
  focus: (mode: 'on' | 'off' | 'status'): Promise<unknown> => ipcRenderer.invoke('engram:focus', mode),
  modelSet: (path: string, value: string): Promise<unknown> => ipcRenderer.invoke('engram:modelSet', path, value),
  modelAddInterest: (interest: string): Promise<unknown> => ipcRenderer.invoke('engram:modelAddInterest', interest),
  commit: (cue: string, action: string): Promise<unknown> => ipcRenderer.invoke('engram:commit', cue, action),

  startSession: (
    initialMessage: string,
    kind: 'learn' | 'review' | 'coach',
    topicId?: string,
  ): Promise<{ sessionId: string }> => ipcRenderer.invoke('session:start', initialMessage, kind, topicId),
  resumeSession: (
    initialMessage: string,
    kind: 'learn' | 'review' | 'coach',
    topicId?: string,
  ): Promise<{ sessionId: string }> => ipcRenderer.invoke('session:resume', initialMessage, kind, topicId),
  lastSessionFor: (kind: 'learn' | 'review' | 'coach', topicId?: string): Promise<string | null> =>
    ipcRenderer.invoke('session:lastFor', kind, topicId),
  sessionHistoryFor: (kind: 'learn' | 'review' | 'coach', topicId?: string): Promise<SessionIndexEntry[]> =>
    ipcRenderer.invoke('session:historyFor', kind, topicId),
  getTranscript: (sessionId: string): Promise<unknown[]> => ipcRenderer.invoke('session:transcript', sessionId),
  exportSitting: (req: ExportSittingRequest): Promise<ExportSittingResult> => ipcRenderer.invoke('session:export', req),

  backupNow: (destDir?: string): Promise<BackupNowResult> => ipcRenderer.invoke('backup:now', destDir),
  describeArchive: (archivePath: string): Promise<DescribeArchiveResult> =>
    ipcRenderer.invoke('backup:describe', archivePath),
  restoreFromArchive: (archivePath: string, confirmation: string): Promise<RestoreArchiveResult> =>
    ipcRenderer.invoke('backup:restore', archivePath, confirmation),
  pickBackupArchive: (): Promise<string | null> => ipcRenderer.invoke('backup:pickArchive'),
  getBackupInfo: (): Promise<BackupInfo> => ipcRenderer.invoke('backup:info'),

  getTopicSettings: (topicId: string): Promise<TopicSettings> => ipcRenderer.invoke('topicSettings:get', topicId),
  setTopicSettings: (topicId: string, settings: TopicSettings): Promise<void> =>
    ipcRenderer.invoke('topicSettings:set', topicId, settings),
  sendMessage: (sessionId: string, text: string): Promise<void> => ipcRenderer.invoke('session:send', sessionId, text),
  abortSession: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:abort', sessionId),
  anySessionActive: (): Promise<boolean> => ipcRenderer.invoke('session:anyActive'),
  answerBridgeQuestion: (requestId: string, response: BridgeAskResponse): Promise<void> =>
    ipcRenderer.invoke('bridge:answer', requestId, response),

  onSessionEvent: (cb: (sessionId: string, event: SessionEvent) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: { sessionId: string; event: SessionEvent }) =>
      cb(payload.sessionId, payload.event)
    ipcRenderer.on('session:event', handler)
    return () => ipcRenderer.removeListener('session:event', handler)
  },
  onBridgeAsk: (cb: (req: BridgeAskRequest) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, req: BridgeAskRequest) => cb(req)
    ipcRenderer.on('bridge:ask', handler)
    return () => ipcRenderer.removeListener('bridge:ask', handler)
  },
  onBridgeBeat: (cb: (req: BridgeBeatRequest) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, req: BridgeBeatRequest) => cb(req)
    ipcRenderer.on('bridge:beat', handler)
    return () => ipcRenderer.removeListener('bridge:beat', handler)
  },
  onBridgeUi: (cb: (req: BridgeUiRequest) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, req: BridgeUiRequest) => cb(req)
    ipcRenderer.on('bridge:ui', handler)
    return () => ipcRenderer.removeListener('bridge:ui', handler)
  },
  // Fired by main when a tray click or notification click should deep-link the
  // (possibly just-recreated) window to a specific view — see main/index.ts's
  // focusOrCreateWindow/sendNav.
  onNavigate: (cb: (view: string) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, view: string) => cb(view)
    ipcRenderer.on('app:navigate', handler)
    return () => ipcRenderer.removeListener('app:navigate', handler)
  },

  windowClose: (): Promise<void> => ipcRenderer.invoke('window:close'),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  windowZoom: (): Promise<void> => ipcRenderer.invoke('window:zoom'),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  onFullScreenChange: (cb: (fs: boolean) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, fs: boolean) => cb(fs)
    ipcRenderer.on('window:fullscreen', handler)
    return () => ipcRenderer.removeListener('window:fullscreen', handler)
  },
}

export type EngramApi = typeof engramApi

contextBridge.exposeInMainWorld('engram', engramApi)
