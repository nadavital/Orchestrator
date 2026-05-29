import { contextBridge, ipcRenderer } from 'electron'
import type { Attachment, Automation, AutomationRun, AutomationUpsertRequest, CapabilityCreateRequest, CapabilityCreateResult, CapabilityDeleteRequest, CapabilityMutationResult, CapabilitySyncPlan, CapabilitySyncRequest, CapabilityUpdateRequest, CodexProjectImportResult, CodexReviewStartRequest, Project, Session, SessionForkMode, SessionForkOptions, SessionListItem, ChatMessage, FileChange, GitBranchActionResult, GitCommitResult, GitLineBlameResult, GitPathActionResult, GitPullRequestCreateUrlResult, GitRefOption, OpenPathOptions, OpenPathResult, OpenTargetAvailability, OrchestratorDeepLinkNavigation, PerformanceMetric, PerformanceSnapshot, ProviderCommandSurfaceResult, ProviderDiagnosticInfo, ProviderManifest, ProviderPermissionRuntimeContext, ProviderResourceSnapshot, ProviderRuntimeConnectionState, ProviderRuntimeDebugEvent, ProviderRuntimeInfo, ProviderSidebarSyncResult, ProviderSlashCommand, ReviewDiffSource, ReviewMetadata, SessionRunEventRecord, SideQuestionMessage, TerminalServiceSnapshot, TranscriptPage, TranscriptPageRequest, TranscriptSearchResult, UsageSummary, UserInputAnswerPayload, WorktreeInventoryItem, WorkspaceSearchRequest, WorkspaceSearchResult } from '../types'
import type { BrowserUsePolicy } from '../types/browserUsePolicy'
import type { AppCommandAvailability, AppMenuCommand, AppMenuCommandState, StableAppCommand } from '../types/appCommands'
import type { ShortcutOverrides } from '../types/appCommands'

interface AppSettings {
  defaultProvider: string
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  defaultPermissionModes: Record<string, string>
  providerModels: Record<string, string[]>
  preferredEditor: 'system' | 'vscode' | 'vscode-insiders' | 'cursor' | 'zed'
  composerEnterBehavior: 'send' | 'newline'
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
  shortcutOverrides: ShortcutOverrides
  browserUsePolicy: BrowserUsePolicy
  personalizationEnabled: boolean
  personalizationCustomInstructions: string
  personalizationCodingPreferences: string
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
  kind: 'text' | 'markdown' | 'json' | 'csv' | 'notebook' | 'document' | 'image' | 'pdf' | 'html' | 'audio' | 'video' | 'spreadsheet' | 'slides' | 'binary' | 'missing' | 'unreadable'
  size?: number
  text?: string
  document?: {
    blocks: Array<
      | { type: 'paragraph'; text: string; paragraphStyle?: 'title' | 'heading1' | 'heading2'; textStyle?: { bold?: boolean; italic?: boolean; underline?: boolean; highlightColor?: string }; listKind?: 'bullet' | 'ordered'; listLevel?: number; listMarker?: string; reviewKind?: 'insertion' | 'deletion'; reviewAuthor?: string; reviewDate?: string; links?: Array<{ text: string; url: string }> }
      | { type: 'table'; rows: string[][] }
      | { type: 'image'; dataUrl: string; mimeType: string; alt?: string; width?: number; height?: number }
      | { type: 'shape'; text: string; geometry?: string; fillColor?: string; lineColor?: string }
    >
    tableCount: number
    imageCount?: number
    shapeCount?: number
    footnotes?: Array<{ id: string; text: string }>
    footnoteCount?: number
    comments?: Array<{ id: string; text: string; author?: string }>
    commentCount?: number
    reviewMarkCount?: number
    linkCount?: number
    styleCount?: number
    headerText?: string
    footerText?: string
    sectionCount?: number
    columnCount?: number
  }
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

interface BrowserClientToolCall {
  sessionId: string
  requestId: string
  namespace: string | null
  tool: string
  arguments: Record<string, unknown>
}

interface BrowserClientToolResponse {
  requestId: string
  success: boolean
  contentItems: Array<{ type: 'inputText'; text: string }>
}

export type SessionEvent =
  | { type: 'created'; session: Session }
  | { type: 'status'; id: string; status: Session['status'] }
  | { type: 'messages'; id: string; messages: ChatMessage[] }
  | { type: 'messageUpdated'; id: string; message: ChatMessage }
  | { type: 'messageRemoved'; id: string; messageId: string }
  | { type: 'events'; id: string; events: SessionRunEventRecord[] }
  | { type: 'raw'; id: string; data: string }
  | { type: 'renamed'; id: string; name: string }
  | { type: 'pinned'; id: string; pinned: boolean; pinOrder?: number }
  | { type: 'updated'; id: string; workDir?: string; useWorktree?: boolean; repoRoot?: string; worktreeState?: Session['worktreeState']; status?: Session['status'] }
  | { type: 'settingsUpdated'; id: string; provider?: string; model?: string; effort?: string; permissionMode?: string; runtime?: Session['runtime']; useThinking?: boolean; useFast?: boolean; allowedTools?: string[]; disallowedTools?: string[]; availableTools?: string[]; additionalDirs?: string[]; usageSummary?: UsageSummary }
  | { type: 'needsInput'; id: string }
  | { type: 'archived'; id: string }

type SettingsUpdatedPayload = Omit<Extract<SessionEvent, { type: 'settingsUpdated' }>, 'type'>

const api = {
  app: {
    getProfile: (): Promise<AppProfile> => ipcRenderer.invoke('app:getProfile'),
    consumePendingNavigation: (): Promise<OrchestratorDeepLinkNavigation | null> => ipcRenderer.invoke('app:consumePendingNavigation'),
    openSessionWindow: (sessionId: string): Promise<boolean> => ipcRenderer.invoke('app:openSessionWindow', sessionId),
    setMenuCommandAvailability: (availability: AppCommandAvailability): Promise<boolean> =>
      ipcRenderer.invoke('app:setMenuCommandAvailability', availability),
    getMenuCommandState: (command: StableAppCommand): Promise<AppMenuCommandState | null> =>
      ipcRenderer.invoke('app:getMenuCommandState', command),
    onNavigateSession: (cb: (sessionId: string) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, sessionId: string): void => cb(sessionId)
      ipcRenderer.on('app:navigate-session', handler)
      return () => ipcRenderer.off('app:navigate-session', handler)
    },
    onNavigateSettings: (cb: (navigation: Extract<OrchestratorDeepLinkNavigation, { kind: 'settings' }>) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, navigation: Extract<OrchestratorDeepLinkNavigation, { kind: 'settings' }>): void => cb(navigation)
      ipcRenderer.on('app:navigate-settings', handler)
      return () => ipcRenderer.off('app:navigate-settings', handler)
    },
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
    listArchivedSummaries: (): Promise<SessionListItem[]> => ipcRenderer.invoke('sessions:listArchivedSummaries'),
    get: (id: string): Promise<Session | undefined> => ipcRenderer.invoke('sessions:get', id),
    getTranscriptPage: (id: string, request?: TranscriptPageRequest): Promise<TranscriptPage | undefined> =>
      ipcRenderer.invoke('sessions:getTranscriptPage', id, request ?? {}),
    searchTranscript: (id: string, query: string, limit?: number): Promise<TranscriptSearchResult[]> =>
      ipcRenderer.invoke('sessions:searchTranscript', id, query, limit),
    copyDeeplink: (id: string): Promise<string> => ipcRenderer.invoke('sessions:copyDeeplink', id),
    copyMarkdown: (id: string): Promise<string> => ipcRenderer.invoke('sessions:copyMarkdown', id),
    create: (opts: {
      projectId: string
      workDir: string
      useWorktree: boolean
      repoRoot?: string
      worktreeBaseRef?: string
      worktreeBranchName?: string
    }): Promise<Session> => ipcRenderer.invoke('sessions:create', opts),
    fork: (id: string, mode: SessionForkMode, options?: SessionForkOptions): Promise<Session> =>
      ipcRenderer.invoke('sessions:fork', id, mode, options),
    retryPendingWorktree: (id: string): Promise<Session> =>
      ipcRenderer.invoke('sessions:retryPendingWorktree', id),
    sendMessage: (sessionId: string, prompt: string, useWorktree?: boolean, attachments?: Attachment[]): Promise<boolean> =>
      ipcRenderer.invoke('sessions:sendMessage', sessionId, prompt, useWorktree, attachments ?? []),
    startCodexReview: (sessionId: string, request: CodexReviewStartRequest): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sessions:startCodexReview', sessionId, request),
    retryLastUserMessage: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke('sessions:retryLastUserMessage', sessionId),
    continueLastTurn: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke('sessions:continueLastTurn', sessionId),
    answerSideQuestion: (sessionId: string, question: string, sideChatMessages?: SideQuestionMessage[]): Promise<{ ok: boolean; answer: string; error?: string; usage?: UsageSummary }> =>
      ipcRenderer.invoke('sessions:answerSideQuestion', sessionId, question, sideChatMessages ?? []),
    updateName: (id: string, name: string): Promise<void> =>
      ipcRenderer.invoke('sessions:updateName', id, name),
    updatePinned: (id: string, pinned: boolean): Promise<void> =>
      ipcRenderer.invoke('sessions:updatePinned', id, pinned),
    reorderPinned: (orderedPinnedSessionIds: string[]): Promise<void> =>
      ipcRenderer.invoke('sessions:reorderPinned', orderedPinnedSessionIds),
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
    cancelQueuedMessage: (sessionId: string, messageId: string): Promise<boolean> =>
      ipcRenderer.invoke('sessions:cancelQueuedMessage', sessionId, messageId),
    steerQueuedMessage: (sessionId: string, messageId: string): Promise<void> =>
      ipcRenderer.invoke('sessions:steerQueuedMessage', sessionId, messageId),
    archive: (sessionId: string): Promise<void> => ipcRenderer.invoke('sessions:archive', sessionId),
    restoreArchived: (sessionId: string): Promise<Session | undefined> =>
      ipcRenderer.invoke('sessions:restoreArchived', sessionId),
    remove: (sessionId: string): Promise<void> => ipcRenderer.invoke('sessions:remove', sessionId),
    getDiff: (sessionId: string): Promise<string> =>
      ipcRenderer.invoke('sessions:getDiff', sessionId),
    getReviewMetadata: (sessionId: string): Promise<ReviewMetadata | undefined> =>
      ipcRenderer.invoke('sessions:getReviewMetadata', sessionId),
    getChangedFiles: (sessionId: string, source?: ReviewDiffSource, ref?: string): Promise<FileChange[]> =>
      ipcRenderer.invoke('sessions:getChangedFiles', sessionId, source, ref),
    getDiffForFile: (sessionId: string, filePath: string, source?: ReviewDiffSource, ref?: string): Promise<string> =>
      ipcRenderer.invoke('sessions:getDiffForFile', sessionId, filePath, source, ref),
    undoChangedFiles: (sessionId: string, paths: string[]): Promise<GitPathActionResult> =>
      ipcRenderer.invoke('sessions:undoChangedFiles', sessionId, paths),
    writeToPty: (sessionId: string, data: string): Promise<void> =>
      ipcRenderer.invoke('sessions:writeToPty', sessionId, data),
    grantAndResume: (sessionId: string, toolNames: string[]): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sessions:grantAndResume', sessionId, toolNames),
    allowOnceAndResume: (sessionId: string, toolNames: string[]): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sessions:allowOnceAndResume', sessionId, toolNames),
    answerUserInput: (sessionId: string, answer: string | UserInputAnswerPayload): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sessions:answerUserInput', sessionId, answer),
    denyPermission: (sessionId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('sessions:denyPermission', sessionId)
  },

  worktrees: {
    list: (): Promise<WorktreeInventoryItem[]> => ipcRenderer.invoke('worktrees:list'),
    delete: (workDir: string): Promise<WorktreeInventoryItem[]> => ipcRenderer.invoke('worktrees:delete', workDir)
  },

  automations: {
    list: (): Promise<Automation[]> => ipcRenderer.invoke('automations:list'),
    listForSession: (sessionId: string): Promise<Automation[]> =>
      ipcRenderer.invoke('automations:listForSession', sessionId),
    listRuns: (automationId: string): Promise<AutomationRun[]> =>
      ipcRenderer.invoke('automations:listRuns', automationId),
    upsert: (request: AutomationUpsertRequest): Promise<Automation> =>
      ipcRenderer.invoke('automations:upsert', request),
    runNow: (id: string): Promise<AutomationRun> => ipcRenderer.invoke('automations:runNow', id),
    pause: (id: string): Promise<Automation | undefined> => ipcRenderer.invoke('automations:pause', id),
    resume: (id: string): Promise<Automation | undefined> => ipcRenderer.invoke('automations:resume', id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('automations:delete', id)
  },

  clipboard: {
    writeText: (text: string): Promise<boolean> => ipcRenderer.invoke('clipboard:writeText', text),
    readText: (): Promise<string> => ipcRenderer.invoke('clipboard:readText')
  },

  git: {
    isGitRepo: (dir: string): Promise<boolean> => ipcRenderer.invoke('git:isGitRepo', dir),
    getCurrentBranch: (dir: string): Promise<string | null> => ipcRenderer.invoke('git:getCurrentBranch', dir),
    listBranches: (dir: string): Promise<GitRefOption[]> => ipcRenderer.invoke('git:listBranches', dir),
    listRecentCommits: (dir: string): Promise<GitRefOption[]> => ipcRenderer.invoke('git:listRecentCommits', dir),
    getPullRequestCreateUrl: (dir: string, baseBranch: string, headBranch: string): Promise<GitPullRequestCreateUrlResult> =>
      ipcRenderer.invoke('git:getPullRequestCreateUrl', dir, baseBranch, headBranch),
    createBranch: (dir: string, branchName: string): Promise<GitBranchActionResult> =>
      ipcRenderer.invoke('git:createBranch', dir, branchName),
    checkoutBranch: (dir: string, branchName: string): Promise<GitBranchActionResult> =>
      ipcRenderer.invoke('git:checkoutBranch', dir, branchName),
    stagePaths: (dir: string, paths: string[]): Promise<GitPathActionResult> =>
      ipcRenderer.invoke('git:stagePaths', dir, paths),
    unstagePaths: (dir: string, paths: string[]): Promise<GitPathActionResult> =>
      ipcRenderer.invoke('git:unstagePaths', dir, paths),
    discardPaths: (dir: string, paths: string[]): Promise<GitPathActionResult> =>
      ipcRenderer.invoke('git:discardPaths', dir, paths),
    commitStaged: (dir: string, message: string): Promise<GitCommitResult> =>
      ipcRenderer.invoke('git:commitStaged', dir, message),
    blameLine: (dir: string, filePath: string, line: number): Promise<GitLineBlameResult> =>
      ipcRenderer.invoke('git:blameLine', dir, filePath, line)
  },

  browser: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('browser:openExternal', url),
    clearData: (kind: 'all' | 'cache' | 'cookies' | 'siteData' = 'all', partition?: string): Promise<void> =>
      ipcRenderer.invoke('browser:clearData', kind, partition),
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
    }> => ipcRenderer.invoke('browser:bundleAssets', request),
    setSecurityPolicy: (policy: {
      downloadApprovalMode?: 'alwaysAsk' | 'alwaysAllow'
      uploadApprovalMode?: 'alwaysAsk' | 'alwaysAllow'
      allowedDownloadOrigins?: string[]
      blockedDownloadOrigins?: string[]
      allowedUploadOrigins?: string[]
      blockedUploadOrigins?: string[]
    }) => ipcRenderer.invoke('browser:setSecurityPolicy', policy),
    onClientToolCall: (cb: (call: BrowserClientToolCall) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, call: BrowserClientToolCall): void => cb(call)
      ipcRenderer.on('browser:clientToolCall', handler)
      return () => ipcRenderer.off('browser:clientToolCall', handler)
    },
    answerClientToolCall: (response: BrowserClientToolResponse): Promise<boolean> =>
      ipcRenderer.invoke('browser:clientToolResponse', response),
    runClientToolSmoke: (call: {
      sessionId: string
      namespace?: string | null
      tool: string
      arguments?: Record<string, unknown>
    }): Promise<{ success: boolean; contentItems: Array<{ type: 'inputText'; text: string }> }> =>
      ipcRenderer.invoke('browser:runClientToolSmoke', call)
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
    listRuntimeDebugEvents: (providerId?: string, includeNoisy?: boolean): Promise<ProviderRuntimeDebugEvent[]> =>
      ipcRenderer.invoke('providers:listRuntimeDebugEvents', providerId, includeNoisy),
    listRuntimeConnections: (providerId?: string): Promise<ProviderRuntimeConnectionState[]> =>
      ipcRenderer.invoke('providers:listRuntimeConnections', providerId),
    runCommandSurface: (providerId: string, surfaceId: string): Promise<ProviderCommandSurfaceResult> =>
      ipcRenderer.invoke('providers:runCommandSurface', providerId, surfaceId),
    refreshSidebarMetadata: (providerId: string, cwd?: string): Promise<ProviderSidebarSyncResult> =>
      ipcRenderer.invoke('providers:refreshSidebarMetadata', providerId, cwd),
    getPermissionContext: (providerId: string, cwd?: string): Promise<ProviderPermissionRuntimeContext> =>
      ipcRenderer.invoke('providers:getPermissionContext', providerId, cwd),
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
    searchWorkspace: (request: WorkspaceSearchRequest): Promise<WorkspaceSearchResult> =>
      ipcRenderer.invoke('fs:searchWorkspace', request),
    listOpenTargets: (): Promise<OpenTargetAvailability[]> => ipcRenderer.invoke('fs:listOpenTargets'),
    openPath: (filePath: string, options?: OpenPathOptions): Promise<OpenPathResult> =>
      ipcRenderer.invoke('fs:openPath', filePath, options),
    showInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke('fs:showInFolder', filePath)
  },

  terminal: {
    spawn: (terminalId: string, workDir: string): Promise<void> =>
      ipcRenderer.invoke('terminal:spawn', terminalId, workDir),
    getBuffer: (terminalId: string): Promise<string> =>
      ipcRenderer.invoke('terminal:getBuffer', terminalId),
    getServiceSnapshot: (): Promise<TerminalServiceSnapshot> =>
      ipcRenderer.invoke('terminal:getServiceSnapshot'),
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
    },
    onExit: (cb: (terminalId: string, code: number, signal: number | null) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, id: string, code: number, signal: number | null): void => cb(id, code, signal)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.off('terminal:exit', handler)
    },
    onError: (cb: (terminalId: string, message: string) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, id: string, message: string): void => cb(id, message)
      ipcRenderer.on('terminal:error', handler)
      return () => ipcRenderer.off('terminal:error', handler)
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
    const onMessageRemoved = (_: Electron.IpcRendererEvent, p: { id: string; messageId: string }): void =>
      cb({ type: 'messageRemoved', ...p })
    const onEvents = (_: Electron.IpcRendererEvent, p: { id: string; events: SessionRunEventRecord[] }): void =>
      cb({ type: 'events', ...p })
    const onRaw = (_: Electron.IpcRendererEvent, p: { id: string; data: string }): void =>
      cb({ type: 'raw', ...p })
    const onRenamed = (_: Electron.IpcRendererEvent, p: { id: string; name: string }): void =>
      cb({ type: 'renamed', ...p })
    const onPinned = (_: Electron.IpcRendererEvent, p: { id: string; pinned: boolean; pinOrder?: number }): void =>
      cb({ type: 'pinned', ...p })
    const onUpdated = (_: Electron.IpcRendererEvent, p: { id: string; workDir?: string; useWorktree?: boolean; repoRoot?: string; worktreeState?: Session['worktreeState']; status?: Session['status'] }): void =>
      cb({ type: 'updated', ...p })
    const onSettingsUpdated = (_: Electron.IpcRendererEvent, p: SettingsUpdatedPayload): void =>
      cb({ type: 'settingsUpdated', ...p })
    const onNeedsInput = (_: Electron.IpcRendererEvent, p: { id: string }): void =>
      cb({ type: 'needsInput', ...p })
    const onArchived = (_: Electron.IpcRendererEvent, p: { id: string }): void =>
      cb({ type: 'archived', ...p })

    ipcRenderer.on('session:created', onCreated)
    ipcRenderer.on('session:status', onStatus)
    ipcRenderer.on('session:messages', onMessages)
    ipcRenderer.on('session:messageUpdated', onMessageUpdated)
    ipcRenderer.on('session:messageRemoved', onMessageRemoved)
    ipcRenderer.on('session:events', onEvents)
    ipcRenderer.on('session:raw', onRaw)
    ipcRenderer.on('session:renamed', onRenamed)
    ipcRenderer.on('session:pinned', onPinned)
    ipcRenderer.on('session:updated', onUpdated)
    ipcRenderer.on('session:settingsUpdated', onSettingsUpdated)
    ipcRenderer.on('session:needsInput', onNeedsInput)
    ipcRenderer.on('session:archived', onArchived)

    return () => {
      ipcRenderer.off('session:created', onCreated)
      ipcRenderer.off('session:status', onStatus)
      ipcRenderer.off('session:messages', onMessages)
      ipcRenderer.off('session:messageUpdated', onMessageUpdated)
      ipcRenderer.off('session:messageRemoved', onMessageRemoved)
      ipcRenderer.off('session:events', onEvents)
      ipcRenderer.off('session:raw', onRaw)
      ipcRenderer.off('session:renamed', onRenamed)
      ipcRenderer.off('session:pinned', onPinned)
      ipcRenderer.off('session:updated', onUpdated)
      ipcRenderer.off('session:settingsUpdated', onSettingsUpdated)
      ipcRenderer.off('session:needsInput', onNeedsInput)
      ipcRenderer.off('session:archived', onArchived)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
