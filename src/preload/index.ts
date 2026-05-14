import { contextBridge, ipcRenderer } from 'electron'
import type { Attachment, Project, Session, ChatMessage, FileChange, ProviderCommandSurfaceResult, ProviderDiagnosticInfo, ProviderResourceSnapshot, ProviderRuntimeInfo, ProviderSlashCommand, SessionRunEventRecord, UsageSummary } from '../types'

interface AppSettings {
  defaultProvider: string
  defaultModels: Record<string, string>
  defaultEfforts: Record<string, string>
  defaultPermissionModes: Record<string, string>
  providerModels: Record<string, string[]>
  appearance: 'system' | 'mist' | 'graphite' | 'high-contrast' | 'dark' | 'light'
  accent: 'blue' | 'teal' | 'purple' | 'green' | 'rose' | 'system'
  density: 'comfortable' | 'compact'
  sidebarTint: boolean
  transcriptStyle: 'relaxed' | 'dense'
}

interface AppProfile {
  name: string
  displayName: string
  userDataDir: string
  isIsolated: boolean
  disablePetOverlay: boolean
}

export type SessionEvent =
  | { type: 'created'; session: Session }
  | { type: 'status'; id: string; status: Session['status'] }
  | { type: 'messages'; id: string; messages: ChatMessage[] }
  | { type: 'messageUpdated'; id: string; message: ChatMessage }
  | { type: 'events'; id: string; events: SessionRunEventRecord[] }
  | { type: 'raw'; id: string; data: string }
  | { type: 'renamed'; id: string; name: string }
  | { type: 'updated'; id: string; workDir: string; useWorktree: boolean }
  | { type: 'settingsUpdated'; id: string; provider?: string; model?: string; effort?: string; permissionMode?: string; runtime?: Session['runtime']; useThinking?: boolean; useFast?: boolean; allowedTools?: string[]; disallowedTools?: string[]; availableTools?: string[]; additionalDirs?: string[]; usageSummary?: UsageSummary }
  | { type: 'needsInput'; id: string }

type SettingsUpdatedPayload = Omit<Extract<SessionEvent, { type: 'settingsUpdated' }>, 'type'>

const api = {
  app: {
    getProfile: (): Promise<AppProfile> => ipcRenderer.invoke('app:getProfile')
  },

  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke('projects:list'),
    add: (name: string, rootPath: string): Promise<Project> =>
      ipcRenderer.invoke('projects:add', name, rootPath),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('projects:remove', id),
    addSession: (projectId: string, sessionId: string): Promise<void> =>
      ipcRenderer.invoke('projects:addSession', projectId, sessionId),
    removeSession: (projectId: string, sessionId: string): Promise<void> =>
      ipcRenderer.invoke('projects:removeSession', projectId, sessionId)
  },

  sessions: {
    list: (): Promise<Session[]> => ipcRenderer.invoke('sessions:list'),
    get: (id: string): Promise<Session | undefined> => ipcRenderer.invoke('sessions:get', id),
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
    isGitRepo: (dir: string): Promise<boolean> => ipcRenderer.invoke('git:isGitRepo', dir)
  },

  providers: {
    getRuntimeInfo: (): Promise<Record<string, ProviderRuntimeInfo>> =>
      ipcRenderer.invoke('providers:getRuntimeInfo'),
    getDiagnostics: (providerId?: string): Promise<Record<string, ProviderDiagnosticInfo>> =>
      ipcRenderer.invoke('providers:getDiagnostics', providerId),
    runCommandSurface: (providerId: string, surfaceId: string): Promise<ProviderCommandSurfaceResult> =>
      ipcRenderer.invoke('providers:runCommandSurface', providerId, surfaceId),
    listResources: (providerId?: string): Promise<Record<string, ProviderResourceSnapshot>> =>
      ipcRenderer.invoke('providers:listResources', providerId),
    discoverClaudeExtensions: (workDir: string): Promise<{ commands: ProviderSlashCommand[]; skills: ProviderSlashCommand[] }> =>
      ipcRenderer.invoke('providers:discoverClaudeExtensions', workDir)
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
      ipcRenderer.off('session:updated', onUpdated)
      ipcRenderer.off('session:settingsUpdated', onSettingsUpdated)
      ipcRenderer.off('session:needsInput', onNeedsInput)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
