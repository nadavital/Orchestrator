import { contextBridge, ipcRenderer } from 'electron'
import type { Attachment, CapabilityCreateRequest, CapabilityCreateResult, CapabilityDeleteRequest, CapabilityMutationResult, CapabilitySyncPlan, CapabilitySyncRequest, CapabilityUpdateRequest, CodexProjectImportResult, Project, Session, SessionListItem, ChatMessage, FileChange, PerformanceMetric, PerformanceSnapshot, ProviderCommandSurfaceResult, ProviderDiagnosticInfo, ProviderManifest, ProviderResourceSnapshot, ProviderRuntimeInfo, ProviderSlashCommand, SessionRunEventRecord, TranscriptPage, TranscriptPageRequest, TranscriptSearchResult, UsageSummary } from '../types'
import type { AppMenuCommand } from '../types/appCommands'

interface AppSettings {
  defaultProvider: string
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  defaultPermissionModes: Record<string, string>
  providerModels: Record<string, string[]>
  preferredEditor: 'system' | 'vscode' | 'vscode-insiders' | 'cursor' | 'zed'
  appearance: 'system' | 'mist' | 'graphite' | 'ocean' | 'palenight' | 'high-contrast' | 'dark' | 'light'
  accent: 'blue' | 'teal' | 'purple' | 'green' | 'rose' | 'system' | 'custom'
  customAccent: string
  density: 'comfortable' | 'compact'
  sidebarTint: boolean
  transcriptStyle: 'relaxed' | 'dense'
  interfaceScale: number
  uiFont: string
  monoFont: string
  appearanceTheme: 'light' | 'dark' | 'system'
  appearanceLightChromeTheme: ChromeTheme
  appearanceDarkChromeTheme: ChromeTheme
  appearanceLightCodeThemeId: string
  appearanceDarkCodeThemeId: string
  sansFontSize: number
  codeFontSize: number
  useFontSmoothing: boolean
  usePointerCursors: boolean
  reduceMotion: boolean
}

interface ChromeTheme {
  accent: string
  surface: string
  ink: string
  contrast: number
  opaqueWindows: boolean
  fonts?: {
    ui?: string
    code?: string
  }
  semanticColors?: {
    diffAdded?: string
    diffRemoved?: string
    skill?: string
  }
}

interface FilePreviewResult {
  kind: 'text' | 'markdown' | 'json' | 'csv' | 'notebook' | 'document' | 'image' | 'pdf' | 'html' | 'audio' | 'video' | 'binary' | 'missing' | 'unreadable'
  size?: number
  text?: string
  truncated: boolean
}

interface AppProfile {
  name: string
  displayName: string
  userDataDir: string
  isIsolated: boolean
  disablePetOverlay: boolean
  forceReducedMotion: boolean
}

interface SavedPastedAttachment {
  path: string
  name: string
  size: number
  mimeType?: string
}

export type SessionEvent =
  | { type: 'created'; session: Session }
  | { type: 'status'; id: string; status: Session['status'] }
  | { type: 'messages'; id: string; messages: ChatMessage[] }
  | { type: 'messageUpdated'; id: string; message: ChatMessage }
  | { type: 'events'; id: string; events: SessionRunEventRecord[] }
  | { type: 'raw'; id: string; data: string }
  | { type: 'renamed'; id: string; name: string }
  | { type: 'pinned'; id: string; pinned: boolean; pinOrder?: number }
  | { type: 'updated'; id: string; workDir: string; useWorktree: boolean }
  | { type: 'settingsUpdated'; id: string; provider?: string; model?: string; effort?: string; permissionMode?: string; runtime?: Session['runtime']; useThinking?: boolean; useFast?: boolean; allowedTools?: string[]; disallowedTools?: string[]; availableTools?: string[]; additionalDirs?: string[]; usageSummary?: UsageSummary }
  | { type: 'needsInput'; id: string }

type SettingsUpdatedPayload = Omit<Extract<SessionEvent, { type: 'settingsUpdated' }>, 'type'>

const api = {
  app: {
    getProfile: (): Promise<AppProfile> => ipcRenderer.invoke('app:getProfile'),
    onMenuCommand: (cb: (command: AppMenuCommand) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, command: AppMenuCommand): void => cb(command)
      ipcRenderer.on('app:menu-command', handler)
      return () => ipcRenderer.off('app:menu-command', handler)
    }
  },

  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
    add: (name: string, rootPath: string): Promise<Project> =>
      ipcRenderer.invoke('projects:add', name, rootPath),
    importCodex: (): Promise<CodexProjectImportResult> =>
      ipcRenderer.invoke('projects:importCodex'),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('projects:remove', id),
    updateName: (id: string, name: string): Promise<void> =>
      ipcRenderer.invoke('projects:updateName', id, name),
    updatePinned: (id: string, pinned: boolean): Promise<void> =>
      ipcRenderer.invoke('projects:updatePinned', id, pinned),
    addSession: (projectId: string, sessionId: string): Promise<void> =>
      ipcRenderer.invoke('projects:addSession', projectId, sessionId),
    removeSession: (projectId: string, sessionId: string): Promise<void> =>
      ipcRenderer.invoke('projects:removeSession', projectId, sessionId)
  },

  sessions: {
    list: (): Promise<Session[]> => ipcRenderer.invoke('sessions:list'),
    listSummaries: (): Promise<SessionListItem[]> => ipcRenderer.invoke('sessions:listSummaries'),
    get: (id: string): Promise<Session | undefined> => ipcRenderer.invoke('sessions:get', id),
    getTranscriptPage: (id: string, request?: TranscriptPageRequest): Promise<TranscriptPage | undefined> =>
      ipcRenderer.invoke('sessions:getTranscriptPage', id, request ?? {}),
    searchTranscript: (id: string, query: string, limit?: number): Promise<TranscriptSearchResult[]> =>
      ipcRenderer.invoke('sessions:searchTranscript', id, query, limit),
    create: (opts: {
      projectId: string
      workDir: string
      useWorktree: boolean
      repoRoot?: string
    }): Promise<Session> => ipcRenderer.invoke('sessions:create', opts),
    sendMessage: (sessionId: string, prompt: string, useWorktree?: boolean, attachments?: Attachment[]): Promise<void> =>
      ipcRenderer.invoke('sessions:sendMessage', sessionId, prompt, useWorktree, attachments ?? []),
    answerSideQuestion: (sessionId: string, question: string): Promise<{ ok: boolean; answer: string; error?: string; usage?: UsageSummary }> =>
      ipcRenderer.invoke('sessions:answerSideQuestion', sessionId, question),
    updateName: (id: string, name: string): Promise<void> =>
      ipcRenderer.invoke('sessions:updateName', id, name),
    updatePinned: (id: string, pinned: boolean): Promise<void> =>
      ipcRenderer.invoke('sessions:updatePinned', id, pinned),
    updateSettings: (id: string, patch: {
      provider?: string
      model?: string
      effort?: string
      agentName?: string | null
      permissionMode?: string
      runtime?: Session['runtime']
      useThinking?: boolean
      useFast?: boolean
      allowedTools?: string[]
      disallowedTools?: string[]
      availableTools?: string[]
      additionalDirs?: string[]
    }): Promise<void> =>
      ipcRenderer.invoke('sessions:updateSettings', id, patch),
    checkProviders: (): Promise<Record<string, boolean>> =>
      ipcRenderer.invoke('sessions:checkProviders'),
    stop: (sessionId: string): Promise<void> => ipcRenderer.invoke('sessions:stop', sessionId),
    steerQueuedMessage: (sessionId: string, messageId: string): Promise<void> =>
      ipcRenderer.invoke('sessions:steerQueuedMessage', sessionId, messageId),
    remove: (sessionId: string): Promise<void> => ipcRenderer.invoke('sessions:remove', sessionId),
    getDiff: (sessionId: string): Promise<string> =>
      ipcRenderer.invoke('sessions:getDiff', sessionId),
    getChangedFiles: (sessionId: string): Promise<FileChange[]> =>
      ipcRenderer.invoke('sessions:getChangedFiles', sessionId),
    getDiffForFile: (sessionId: string, filePath: string): Promise<string> =>
      ipcRenderer.invoke('sessions:getDiffForFile', sessionId, filePath),
    writeToPty: (sessionId: string, data: string): Promise<void> =>
      ipcRenderer.invoke('sessions:writeToPty', sessionId, data),
    grantAndResume: (sessionId: string, toolNames: string[]): Promise<void> =>
      ipcRenderer.invoke('sessions:grantAndResume', sessionId, toolNames),
    allowOnceAndResume: (sessionId: string, toolNames: string[]): Promise<void> =>
      ipcRenderer.invoke('sessions:allowOnceAndResume', sessionId, toolNames),
    answerUserInput: (sessionId: string, answer: string): Promise<void> =>
      ipcRenderer.invoke('sessions:answerUserInput', sessionId, answer),
    denyPermission: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('sessions:denyPermission', sessionId)
  },

  git: {
    isGitRepo: (dir: string): Promise<boolean> => ipcRenderer.invoke('git:isGitRepo', dir),
    getCurrentBranch: (dir: string): Promise<string | null> => ipcRenderer.invoke('git:getCurrentBranch', dir)
  },

  browser: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('browser:openExternal', url),
    clearData: (kind: 'all' | 'cache' | 'cookies' | 'siteData' = 'all'): Promise<void> =>
      ipcRenderer.invoke('browser:clearData', kind),
    saveDataUrlArtifact: (dataUrl: string, suggestedName?: string): Promise<{ path: string; size: number }> =>
      ipcRenderer.invoke('browser:saveDataUrlArtifact', dataUrl, suggestedName),
    discoverLocalTargets: (recentUrls?: string[]): Promise<Array<{ url: string; title: string | null; source: 'port-scan' | 'recent' }>> =>
      ipcRenderer.invoke('browser:discoverLocalTargets', recentUrls),
    bundleAssets: (request: {
      inventoryId: string
      pageUrl?: string | null
      assets: Array<{ id: string; kind: string; name: string; url: string }>
    }): Promise<{
      directoryPath: string
      manifestPath: string
      assets: Array<{ id: string; kind: string; name: string; url: string; path: string; contentType: string | null }>
      failures: Array<{ id: string; kind: string; name: string; url: string; reason: string }>
      summary: { requestedCount: number; downloadedCount: number; failedCount: number }
    }> => ipcRenderer.invoke('browser:bundleAssets', request)
  },

  attachments: {
    savePastedFile: (request: { name?: string; mimeType?: string; bytes: ArrayBuffer }): Promise<SavedPastedAttachment> =>
      ipcRenderer.invoke('attachments:savePastedFile', request)
  },

  providers: {
    getRuntimeInfo: (): Promise<Record<string, ProviderRuntimeInfo>> =>
      ipcRenderer.invoke('providers:getRuntimeInfo'),
    getManifest: (): Promise<Record<string, ProviderManifest>> =>
      ipcRenderer.invoke('providers:getManifest'),
    getDiagnostics: (providerId?: string): Promise<Record<string, ProviderDiagnosticInfo>> =>
      ipcRenderer.invoke('providers:getDiagnostics', providerId),
    runCommandSurface: (providerId: string, surfaceId: string): Promise<ProviderCommandSurfaceResult> =>
      ipcRenderer.invoke('providers:runCommandSurface', providerId, surfaceId),
    listResources: (providerId?: string, cwd?: string): Promise<Record<string, ProviderResourceSnapshot>> =>
      ipcRenderer.invoke('providers:listResources', providerId, cwd),
    createCapability: (request: CapabilityCreateRequest): Promise<CapabilityCreateResult> =>
      ipcRenderer.invoke('providers:createCapability', request),
    updateCapability: (request: CapabilityUpdateRequest): Promise<CapabilityMutationResult> =>
      ipcRenderer.invoke('providers:updateCapability', request),
    deleteCapability: (request: CapabilityDeleteRequest): Promise<CapabilityMutationResult> =>
      ipcRenderer.invoke('providers:deleteCapability', request),
    previewCapabilitySync: (request: CapabilitySyncRequest): Promise<CapabilitySyncPlan> =>
      ipcRenderer.invoke('providers:previewCapabilitySync', request),
    syncCapability: (request: CapabilitySyncRequest): Promise<CapabilityMutationResult> =>
      ipcRenderer.invoke('providers:syncCapability', request),
    discoverClaudeExtensions: (workDir: string): Promise<{ commands: ProviderSlashCommand[]; skills: ProviderSlashCommand[] }> =>
      ipcRenderer.invoke('providers:discoverClaudeExtensions', workDir)
  },

  performance: {
    record: (metric: Omit<PerformanceMetric, 'id'>): Promise<PerformanceMetric> =>
      ipcRenderer.invoke('performance:record', metric),
    snapshot: (): Promise<PerformanceSnapshot> =>
      ipcRenderer.invoke('performance:snapshot'),
    reset: (): Promise<void> => ipcRenderer.invoke('performance:reset')
  },

  settings: {
    get: (): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:get'),
    set: (key: string, value: unknown): Promise<void> =>
      ipcRenderer.invoke('settings:set', key, value)
  },

  fs: {
    resolveHome: (): Promise<string> => ipcRenderer.invoke('fs:resolveHome'),
    readFile: (filePath: string): Promise<string | null> => ipcRenderer.invoke('fs:readFile', filePath),
    previewFile: (filePath: string): Promise<FilePreviewResult> => ipcRenderer.invoke('fs:previewFile', filePath),
    writeFile: (filePath: string, content: string): Promise<void> => ipcRenderer.invoke('fs:writeFile', filePath, content),
    listDir: (dirPath: string): Promise<string[] | null> => ipcRenderer.invoke('fs:listDir', dirPath),
    statPath: (filePath: string): Promise<{ exists: boolean; isFile?: boolean; isDirectory?: boolean; size?: number }> =>
      ipcRenderer.invoke('fs:statPath', filePath),
    resolveWorkspaceFileReference: (cwd: string, filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('fs:resolveWorkspaceFileReference', cwd, filePath),
    openPath: (filePath: string): Promise<string> => ipcRenderer.invoke('fs:openPath', filePath),
    showInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke('fs:showInFolder', filePath)
  },

  terminal: {
    spawn: (terminalId: string, workDir: string): Promise<void> =>
      ipcRenderer.invoke('terminal:spawn', terminalId, workDir),
    getBuffer: (terminalId: string): Promise<string> =>
      ipcRenderer.invoke('terminal:getBuffer', terminalId),
    write: (terminalId: string, data: string): Promise<void> =>
      ipcRenderer.invoke('terminal:write', terminalId, data),
    runCommand: (terminalId: string, command: string): Promise<void> =>
      ipcRenderer.invoke('terminal:runCommand', terminalId, command),
    resize: (terminalId: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),
    clear: (terminalId: string): Promise<void> =>
      ipcRenderer.invoke('terminal:clear', terminalId),
    kill: (terminalId: string): Promise<void> =>
      ipcRenderer.invoke('terminal:kill', terminalId),
    onData: (cb: (terminalId: string, data: string) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, id: string, data: string): void => cb(id, data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.off('terminal:data', handler)
    }
  },

  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
    openFiles: (): Promise<Array<{ path: string; name: string; size?: number }> | null> => ipcRenderer.invoke('dialog:openFiles')
  },

  pet: {
    getConfig: (): Promise<unknown> => ipcRenderer.invoke('pet:getConfig'),
    selectPet: (id: string): Promise<void> => ipcRenderer.invoke('pet:selectPet', id),
    importPet: (): Promise<unknown> => ipcRenderer.invoke('pet:import'),
    importCodexPets: (): Promise<unknown> => ipcRenderer.invoke('pet:importCodexPets'),
    setOpen: (v: boolean): Promise<void> => ipcRenderer.invoke('pet:setOpen', v),
    onNavigate: (cb: (sessionId: string) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, id: string): void => cb(id)
      ipcRenderer.on('pet:navigate', handler)
      return () => ipcRenderer.off('pet:navigate', handler)
    }
  },

  onSessionEvent: (cb: (event: SessionEvent) => void): (() => void) => {
    const onCreated = (_: Electron.IpcRendererEvent, session: Session): void =>
      cb({ type: 'created', session })
    const onStatus = (_: Electron.IpcRendererEvent, p: { id: string; status: Session['status'] }): void =>
      cb({ type: 'status', ...p })
    const onMessages = (_: Electron.IpcRendererEvent, p: { id: string; messages: ChatMessage[] }): void =>
      cb({ type: 'messages', ...p })
    const onMessageUpdated = (_: Electron.IpcRendererEvent, p: { id: string; message: ChatMessage }): void =>
      cb({ type: 'messageUpdated', ...p })
    const onEvents = (_: Electron.IpcRendererEvent, p: { id: string; events: SessionRunEventRecord[] }): void =>
      cb({ type: 'events', ...p })
    const onRaw = (_: Electron.IpcRendererEvent, p: { id: string; data: string }): void =>
      cb({ type: 'raw', ...p })
    const onRenamed = (_: Electron.IpcRendererEvent, p: { id: string; name: string }): void =>
      cb({ type: 'renamed', ...p })
    const onPinned = (_: Electron.IpcRendererEvent, p: { id: string; pinned: boolean; pinOrder?: number }): void =>
      cb({ type: 'pinned', ...p })
    const onUpdated = (_: Electron.IpcRendererEvent, p: { id: string; workDir: string; useWorktree: boolean }): void =>
      cb({ type: 'updated', ...p })
    const onSettingsUpdated = (_: Electron.IpcRendererEvent, p: SettingsUpdatedPayload): void =>
      cb({ type: 'settingsUpdated', ...p })
    const onNeedsInput = (_: Electron.IpcRendererEvent, p: { id: string }): void =>
      cb({ type: 'needsInput', ...p })

    ipcRenderer.on('session:created', onCreated)
    ipcRenderer.on('session:status', onStatus)
    ipcRenderer.on('session:messages', onMessages)
    ipcRenderer.on('session:messageUpdated', onMessageUpdated)
    ipcRenderer.on('session:events', onEvents)
    ipcRenderer.on('session:raw', onRaw)
    ipcRenderer.on('session:renamed', onRenamed)
    ipcRenderer.on('session:pinned', onPinned)
    ipcRenderer.on('session:updated', onUpdated)
    ipcRenderer.on('session:settingsUpdated', onSettingsUpdated)
    ipcRenderer.on('session:needsInput', onNeedsInput)

    return () => {
      ipcRenderer.off('session:created', onCreated)
      ipcRenderer.off('session:status', onStatus)
      ipcRenderer.off('session:messages', onMessages)
      ipcRenderer.off('session:messageUpdated', onMessageUpdated)
      ipcRenderer.off('session:events', onEvents)
      ipcRenderer.off('session:raw', onRaw)
      ipcRenderer.off('session:renamed', onRenamed)
      ipcRenderer.off('session:pinned', onPinned)
      ipcRenderer.off('session:updated', onUpdated)
      ipcRenderer.off('session:settingsUpdated', onSettingsUpdated)
      ipcRenderer.off('session:needsInput', onNeedsInput)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
