import { contextBridge, ipcRenderer } from 'electron'
import type {
  TopicListEntry,
  EngramStats,
  DueItem,
  DueCappedResult,
  ArtifactEntry,
  Misconception,
  ActiveExperiment,
  DoctorResult,
  LearnerModel,
  TopicSettings,
  EnvironmentCheckResult,
  NotifierSettings,
  AuthMode,
  AuthSettings,
  ApiKeyStatus,
  UpdateCheckResult,
  ReceiptsHistory,
  SessionIndexEntry,
  UnlockedAchievement,
  CrashLogEntry,
  DecayResult,
  NextNodeResult,
  MapAnnotations,
  NodeProvenance,
  GraderHealthResult,
  GraderAuditFile,
  ExportSittingRequest,
  ExportSittingResult,
  ExportMapRequest,
  BackupNowResult,
  DescribeArchiveResult,
  RestoreArchiveResult,
  BackupInfo,
  NewTopicPrefill,
  LinkStatus,
  PairingOffer,
  DrainSummary,
} from '../shared/types'
import type { SessionEvent } from '../shared/sessionEvents'
import type { BridgeAskRequest, BridgeAskResponse, BridgeBeatRequest, BridgeUiRequest } from '../shared/bridgeProtocol'

const engramApi = {
  topics: (): Promise<TopicListEntry[]> => ipcRenderer.invoke('engram:topics'),
  /** Mirrors the renderer's confidence picks into app data so the phone's
   * grade has the same five components the desk's does. */
  mirrorCalibration: (picks: unknown[]): Promise<void> =>
    ipcRenderer.invoke('app:mirrorCalibration', picks),
  stats: (): Promise<EngramStats> => ipcRenderer.invoke('engram:stats'),
  due: (limit?: number, topic?: string): Promise<DueItem[]> => ipcRenderer.invoke('engram:due', limit, topic),
  // Savings-ordered triage read (`due --cap`) — rejects on engines without
  // --cap; callers catch and fall back to due(limit).
  dueCapped: (cap: number, topic?: string): Promise<DueCappedResult> => ipcRenderer.invoke('engram:dueCapped', cap, topic),
  decay: (topic?: string, horizon?: number): Promise<DecayResult> => ipcRenderer.invoke('engram:decay', topic, horizon),
  doctor: (): Promise<DoctorResult> => ipcRenderer.invoke('engram:doctor'),

  // The phone link. Read-only status plus the three actions that change it:
  // open a pairing window, widen the bind, forget a device.
  linkStatus: (): Promise<LinkStatus> => ipcRenderer.invoke('link:status'),
  linkBeginPairing: (): Promise<PairingOffer> => ipcRenderer.invoke('link:beginPairing'),
  linkExpose: (exposeToLan: boolean): Promise<LinkStatus> => ipcRenderer.invoke('link:expose', exposeToLan),
  linkRevoke: (deviceId: string): Promise<LinkStatus> => ipcRenderer.invoke('link:revoke', deviceId),
  /** Starts a sitting per topic for whatever the phone has queued. */
  linkSettle: (): Promise<DrainSummary> => ipcRenderer.invoke('link:settle'),
  model: (): Promise<LearnerModel> => ipcRenderer.invoke('engram:model'),
  graderHealth: (): Promise<GraderHealthResult> => ipcRenderer.invoke('engram:graderHealth'),
  graderAuditHistory: (): Promise<GraderAuditFile[]> => ipcRenderer.invoke('engram:graderAuditHistory'),
  topicStatusText: (topic: string): Promise<string> => ipcRenderer.invoke('engram:topicStatusText', topic),
  topicGraph: (topic: string): Promise<unknown> => ipcRenderer.invoke('engram:topicGraph', topic),
  nextNode: (topic: string): Promise<NextNodeResult> => ipcRenderer.invoke('engram:next', topic),
  artifactList: (): Promise<ArtifactEntry[]> => ipcRenderer.invoke('engram:artifactList'),
  receiptsHistory: (): Promise<ReceiptsHistory> => ipcRenderer.invoke('engram:receiptsHistory'),
  misconceptions: (): Promise<Misconception[]> => ipcRenderer.invoke('engram:misconceptions'),
  misconceptionResolve: (id: string): Promise<unknown> => ipcRenderer.invoke('engram:misconceptionResolve', id),
  retireTopic: (topic: string, restore: boolean): Promise<unknown> => ipcRenderer.invoke('engram:retireTopic', topic, restore),
  deleteTopic: (topic: string): Promise<{ trashedTo: string; moved: string[] }> => ipcRenderer.invoke('engram:deleteTopic', topic),
  misconceptionManualResolves: (): Promise<Record<string, { date: string }>> =>
    ipcRenderer.invoke('engram:misconceptionManualResolves'),
  activeExperiment: (): Promise<ActiveExperiment | null> => ipcRenderer.invoke('engram:activeExperiment'),
  mapAnnotations: (topicId: string): Promise<MapAnnotations> => ipcRenderer.invoke('mapAnnotations:get', topicId),
  nodeProvenance: (topic: string): Promise<Record<string, NodeProvenance>> =>
    ipcRenderer.invoke('engram:nodeProvenance', topic),
  openArtifact: (absolutePath: string): Promise<void> => ipcRenderer.invoke('engram:openArtifact', absolutePath),
  openExplorable: (rawPath: string): Promise<{ url: string; absolutePath: string } | { error: string }> =>
    ipcRenderer.invoke('engram:openExplorable', rawPath),
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles'),
  sittingPace: (): Promise<import('../shared/sittingPace').PaceModel> => ipcRenderer.invoke('engram:sittingPace'),
  pendingProductions: (): Promise<{ pending: number } | { error: string }> =>
    ipcRenderer.invoke('engram:pendingProductions'),
  pickHandwriting: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickHandwriting'),
  saveIncomingImage: (payload: { mime: string; bytes: ArrayBuffer; name?: string }): Promise<{ path: string } | { error: string }> =>
    ipcRenderer.invoke('dialog:saveIncomingImage', payload),
  exportLearningData: (): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke('engram:exportData'),
  environmentCheck: (): Promise<EnvironmentCheckResult> => ipcRenderer.invoke('engram:environmentCheck'),

  // Dual-mode auth — the API key never crosses this boundary outward.
  getAuthSettings: (): Promise<AuthSettings> => ipcRenderer.invoke('auth:getSettings'),
  setAuthMode: (mode: AuthMode): Promise<AuthSettings> => ipcRenderer.invoke('auth:setMode', mode),
  authKeyStatus: (): Promise<ApiKeyStatus> => ipcRenderer.invoke('auth:keyStatus'),
  authSetApiKey: (key: string): Promise<ApiKeyStatus> => ipcRenderer.invoke('auth:setApiKey', key),
  authClearApiKey: (): Promise<ApiKeyStatus> => ipcRenderer.invoke('auth:clearApiKey'),

  getNotifierSettings: (): Promise<NotifierSettings> => ipcRenderer.invoke('notifier:getSettings'),
  setNotifierSettings: (patch: Partial<NotifierSettings>): Promise<NotifierSettings> =>
    ipcRenderer.invoke('notifier:setSettings', patch),
  checkReviewsNow: (): Promise<{ dueCount: number }> => ipcRenderer.invoke('notifier:checkNow'),
  getLoginItemSettings: (): Promise<{ openAtLogin: boolean }> => ipcRenderer.invoke('app:getLoginItemSettings'),
  setLoginItemSettings: (openAtLogin: boolean): Promise<{ openAtLogin: boolean }> =>
    ipcRenderer.invoke('app:setLoginItemSettings', openAtLogin),
  checkForUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('app:checkForUpdate'),
  cachedUpdateCheck: (): Promise<UpdateCheckResult | null> => ipcRenderer.invoke('app:cachedUpdateCheck'),
  getCachedUpdateCheck: (): Promise<UpdateCheckResult | null> => ipcRenderer.invoke('app:getCachedUpdateCheck'),
  getCrashLog: (): Promise<CrashLogEntry[]> => ipcRenderer.invoke('app:getCrashLog'),
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
  exportMap: (req: ExportMapRequest): Promise<ExportSittingResult> => ipcRenderer.invoke('map:export', req),

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
  /** An ask whose relay connection died before it was answered — the card
   * can never resolve, so the views orphan it (see bridgeServer's ask
   * route). */
  onBridgeAskDropped: (cb: (req: { sessionId: string; requestId: string }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, req: { sessionId: string; requestId: string }) => cb(req)
    ipcRenderer.on('bridge:ask-dropped', handler)
    return () => ipcRenderer.removeListener('bridge:ask-dropped', handler)
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
  // Fired by main when an engram:// deep link (Observatory's paper→topic
  // hand-off) has been parsed, shape-guarded, and filesystem-checked — see
  // main/deepLink.ts + main/index.ts's handleDeepLink. Delivered alongside
  // (not instead of) onNavigate('learn'); App.tsx is what actually opens the
  // New Topic modal with these fields prefilled. Prefill only — never starts
  // a session on its own.
  onNewTopicPrefill: (cb: (prefill: NewTopicPrefill) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, prefill: NewTopicPrefill) => cb(prefill)
    ipcRenderer.on('app:new-topic-prefill', handler)
    return () => ipcRenderer.removeListener('app:new-topic-prefill', handler)
  },
  // Sidebar due-badge push — see main/session/reviewNotifier.ts's 5-min poll
  // (main/index.ts's `sendDueCount`). Freshness (window focus, a sitting
  // ending) is a separate pull via `refreshDueCount` below.
  onDueCount: (cb: (count: number) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, count: number) => cb(count)
    ipcRenderer.on('engram:due-count', handler)
    return () => ipcRenderer.removeListener('engram:due-count', handler)
  },
  refreshDueCount: (): Promise<{ dueCount: number }> => ipcRenderer.invoke('engram:refresh-due-count'),

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
