/// <reference types="vite/client" />

import type { Project, Session, ChatMessage, FileChange, ProviderRuntimeInfo } from '../../types'

export interface AppSettings {
  defaultProvider: string
  defaultModels: Record<string, string>
}

export type SessionEvent =
  | { type: 'created'; session: Session }
  | { type: 'status'; id: string; status: Session['status'] }
  | { type: 'messages'; id: string; messages: ChatMessage[] }
  | { type: 'raw'; id: string; data: string }
  | { type: 'renamed'; id: string; name: string }
  | { type: 'updated'; id: string; workDir: string; useWorktree: boolean }
  | { type: 'settingsUpdated'; id: string; provider?: string; model?: string; effort?: string; permissionMode?: string }
  | { type: 'needsInput'; id: string }

declare global {
  interface Window {
    api: {
      projects: {
        list: () => Promise<Project[]>
        add: (name: string, rootPath: string) => Promise<Project>
        remove: (id: string) => Promise<void>
        addSession: (projectId: string, sessionId: string) => Promise<void>
        removeSession: (projectId: string, sessionId: string) => Promise<void>
      }
      sessions: {
        list: () => Promise<Session[]>
        get: (id: string) => Promise<Session | undefined>
        create: (opts: {
          projectId: string
          workDir: string
          useWorktree: boolean
          repoRoot?: string
        }) => Promise<Session>
        sendMessage: (sessionId: string, prompt: string, useWorktree?: boolean) => Promise<void>
        updateName: (id: string, name: string) => Promise<void>
        updateSettings: (id: string, patch: { provider?: string; model?: string; effort?: string; permissionMode?: string; useThinking?: boolean; useFast?: boolean }) => Promise<void>
        checkProviders: () => Promise<Record<string, boolean>>
        stop: (sessionId: string) => Promise<void>
        remove: (sessionId: string) => Promise<void>
        getDiff: (sessionId: string) => Promise<string>
        getChangedFiles: (sessionId: string) => Promise<FileChange[]>
        getDiffForFile: (sessionId: string, filePath: string) => Promise<string>
        writeToPty: (sessionId: string, data: string) => Promise<void>
        grantAndResume: (sessionId: string, toolNames: string[]) => Promise<void>
      }
      git: {
        isGitRepo: (dir: string) => Promise<boolean>
      }
      providers: {
        getRuntimeInfo: () => Promise<Record<string, ProviderRuntimeInfo>>
      }
      settings: {
        get: () => Promise<AppSettings>
        set: (key: string, value: unknown) => Promise<void>
      }
      fs: {
        resolveHome: () => Promise<string>
        readFile: (filePath: string) => Promise<string | null>
        writeFile: (filePath: string, content: string) => Promise<void>
        listDir: (dirPath: string) => Promise<string[] | null>
      }
      terminal: {
        spawn: (terminalId: string, workDir: string) => Promise<void>
        getBuffer: (terminalId: string) => Promise<string>
        write: (terminalId: string, data: string) => Promise<void>
        resize: (terminalId: string, cols: number, rows: number) => Promise<void>
        clear: (terminalId: string) => Promise<void>
        kill: (terminalId: string) => Promise<void>
        onData: (cb: (terminalId: string, data: string) => void) => () => void
      }
      dialog: {
        openDirectory: () => Promise<string | null>
      }
      pet: {
        getConfig: () => Promise<unknown>
        selectPet: (id: string) => Promise<void>
        importPet: () => Promise<unknown>
        setOpen: (v: boolean) => Promise<void>
        onNavigate: (cb: (sessionId: string) => void) => () => void
      }
      onSessionEvent: (cb: (event: SessionEvent) => void) => () => void
    }
  }
}
