/// <reference types="vite/client" />

import type { Attachment, CapabilityCreateRequest, CapabilityCreateResult, CapabilityDeleteRequest, CapabilityMutationResult, CapabilitySyncPlan, CapabilitySyncRequest, CapabilityUpdateRequest, Project, Session, SessionListItem, ChatMessage, FileChange, PerformanceMetric, PerformanceSnapshot, ProviderCommandSurfaceResult, ProviderDiagnosticInfo, ProviderManifest, ProviderResourceSnapshot, ProviderRuntimeInfo, ProviderSlashCommand, SessionRunEventRecord, TranscriptPage, TranscriptPageRequest, TranscriptSearchResult, UsageSummary } from '../../types'
import type { AppMenuCommand } from '../../types/appCommands'

export interface AppSettings {
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

export interface ChromeTheme {
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

export interface AppProfile {
  name: string
  displayName: string
  userDataDir: string
  isIsolated: boolean
  disablePetOverlay: boolean
  forceReducedMotion: boolean
}

export interface SavedPastedAttachment {
  path: string
  name: string
  size: number
  mimeType?: string
}

export interface FilePreviewResult {
  kind: 'text' | 'markdown' | 'image' | 'pdf' | 'html' | 'audio' | 'video' | 'binary' | 'missing' | 'unreadable'
  size?: number
  text?: string
  truncated: boolean
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
  | {
      type: 'settingsUpdated'
      id: string
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
      usageSummary?: UsageSummary
    }
  | { type: 'needsInput'; id: string }

declare global {
  interface Window {
    api: {
      app: {
        getProfile: () => Promise<AppProfile>
        onMenuCommand: (cb: (command: AppMenuCommand) => void) => () => void
      }
      projects: {
        list: () => Promise<Project[]>
        add: (name: string, rootPath: string) => Promise<Project>
        remove: (id: string) => Promise<void>
        updateName: (id: string, name: string) => Promise<void>
        updatePinned: (id: string, pinned: boolean) => Promise<void>
        addSession: (projectId: string, sessionId: string) => Promise<void>
        removeSession: (projectId: string, sessionId: string) => Promise<void>
      }
      sessions: {
        list: () => Promise<Session[]>
        listSummaries: () => Promise<SessionListItem[]>
        get: (id: string) => Promise<Session | undefined>
        getTranscriptPage: (id: string, request?: TranscriptPageRequest) => Promise<TranscriptPage | undefined>
        searchTranscript: (id: string, query: string, limit?: number) => Promise<TranscriptSearchResult[]>
        create: (opts: {
          projectId: string
          workDir: string
          useWorktree: boolean
          repoRoot?: string
        }) => Promise<Session>
        sendMessage: (sessionId: string, prompt: string, useWorktree?: boolean, attachments?: Attachment[]) => Promise<void>
        answerSideQuestion: (sessionId: string, question: string) => Promise<{ ok: boolean; answer: string; error?: string; usage?: UsageSummary }>
        updateName: (id: string, name: string) => Promise<void>
        updatePinned: (id: string, pinned: boolean) => Promise<void>
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
        }) => Promise<void>
        checkProviders: () => Promise<Record<string, boolean>>
        stop: (sessionId: string) => Promise<void>
        steerQueuedMessage: (sessionId: string, messageId: string) => Promise<void>
        remove: (sessionId: string) => Promise<void>
        getDiff: (sessionId: string) => Promise<string>
        getChangedFiles: (sessionId: string) => Promise<FileChange[]>
        getDiffForFile: (sessionId: string, filePath: string) => Promise<string>
        writeToPty: (sessionId: string, data: string) => Promise<void>
        grantAndResume: (sessionId: string, toolNames: string[]) => Promise<void>
        allowOnceAndResume: (sessionId: string, toolNames: string[]) => Promise<void>
        answerUserInput: (sessionId: string, answer: string) => Promise<void>
        denyPermission: (sessionId: string) => Promise<void>
      }
      git: {
        isGitRepo: (dir: string) => Promise<boolean>
        getCurrentBranch: (dir: string) => Promise<string | null>
      }
      browser: {
        openExternal: (url: string) => Promise<void>
        saveDataUrlArtifact: (dataUrl: string, suggestedName?: string) => Promise<{ path: string; size: number }>
        bundleAssets: (request: {
          inventoryId: string
          pageUrl?: string | null
          assets: Array<{ id: string; kind: string; name: string; url: string }>
        }) => Promise<{
          directoryPath: string
          manifestPath: string
          assets: Array<{ id: string; kind: string; name: string; url: string; path: string; contentType: string | null }>
          failures: Array<{ id: string; kind: string; name: string; url: string; reason: string }>
          summary: { requestedCount: number; downloadedCount: number; failedCount: number }
        }>
      }
      attachments: {
        savePastedFile: (request: { name?: string; mimeType?: string; bytes: ArrayBuffer }) => Promise<SavedPastedAttachment>
      }
      providers: {
        getRuntimeInfo: () => Promise<Record<string, ProviderRuntimeInfo>>
        getManifest: () => Promise<Record<string, ProviderManifest>>
        getDiagnostics: (providerId?: string) => Promise<Record<string, ProviderDiagnosticInfo>>
        runCommandSurface: (providerId: string, surfaceId: string) => Promise<ProviderCommandSurfaceResult>
        listResources: (providerId?: string, cwd?: string) => Promise<Record<string, ProviderResourceSnapshot>>
        createCapability: (request: CapabilityCreateRequest) => Promise<CapabilityCreateResult>
        updateCapability: (request: CapabilityUpdateRequest) => Promise<CapabilityMutationResult>
        deleteCapability: (request: CapabilityDeleteRequest) => Promise<CapabilityMutationResult>
        previewCapabilitySync: (request: CapabilitySyncRequest) => Promise<CapabilitySyncPlan>
        syncCapability: (request: CapabilitySyncRequest) => Promise<CapabilityMutationResult>
        discoverClaudeExtensions: (workDir: string) => Promise<{ commands: ProviderSlashCommand[]; skills: ProviderSlashCommand[] }>
      }
      performance: {
        record: (metric: Omit<PerformanceMetric, 'id'>) => Promise<PerformanceMetric>
        snapshot: () => Promise<PerformanceSnapshot>
        reset: () => Promise<void>
      }
      settings: {
        get: () => Promise<AppSettings>
        set: (key: string, value: unknown) => Promise<void>
      }
      fs: {
        resolveHome: () => Promise<string>
        readFile: (filePath: string) => Promise<string | null>
        previewFile: (filePath: string) => Promise<FilePreviewResult>
        writeFile: (filePath: string, content: string) => Promise<void>
        listDir: (dirPath: string) => Promise<string[] | null>
        statPath: (filePath: string) => Promise<{ exists: boolean; isFile?: boolean; isDirectory?: boolean; size?: number }>
        resolveWorkspaceFileReference: (cwd: string, filePath: string) => Promise<string | null>
        openPath: (filePath: string) => Promise<string>
        showInFolder: (filePath: string) => Promise<void>
      }
      terminal: {
        spawn: (terminalId: string, workDir: string) => Promise<void>
        getBuffer: (terminalId: string) => Promise<string>
        write: (terminalId: string, data: string) => Promise<void>
        runCommand: (terminalId: string, command: string) => Promise<void>
        resize: (terminalId: string, cols: number, rows: number) => Promise<void>
        clear: (terminalId: string) => Promise<void>
        kill: (terminalId: string) => Promise<void>
        onData: (cb: (terminalId: string, data: string) => void) => () => void
      }
      dialog: {
        openDirectory: () => Promise<string | null>
        openFiles: () => Promise<Array<{ path: string; name: string; size?: number }> | null>
      }
      pet: {
        getConfig: () => Promise<unknown>
        selectPet: (id: string) => Promise<void>
        importPet: () => Promise<unknown>
        importCodexPets: () => Promise<unknown>
        setOpen: (v: boolean) => Promise<void>
        onNavigate: (cb: (sessionId: string) => void) => () => void
      }
      onSessionEvent: (cb: (event: SessionEvent) => void) => () => void
    }
  }
}
