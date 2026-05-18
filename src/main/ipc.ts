import type { IpcMain } from 'electron'
import { dialog, app, shell } from 'electron'
import { execFile } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'fs'
import { basename, dirname } from 'path'
import type { Attachment, CapabilityCreateRequest, CapabilityDeleteRequest, CapabilitySyncRequest, CapabilityUpdateRequest, PerformanceMetric, TranscriptPageRequest } from '../types'
import { projectStore } from './projects'
import { sessionManager } from './sessions'
import { gitManager } from './git'
import { settingsStore } from './settings'
import { terminalManager } from './terminal'
import { petOverlayManager } from './petOverlay'
import { getAppProfile } from './appProfile'
import { getProviderDiagnosticsAsync, getProviderRuntimeInfo, runProviderCommandSurfaceAsync } from './providers'
import { resolveWorkspaceFileReference } from './workspaceResolver'
import { discoverClaudeExtensions } from './claudeExtensions'
import { listProviderResources } from './providerResources'
import { createCapability } from './capabilityCreator'
import { deleteCapability, updateCapability } from './capabilityManager'
import { applyCapabilitySync, previewCapabilitySync } from './capabilitySync'
import { performanceSnapshot, recordPerformanceMetric, resetPerformanceMetrics } from './performanceTelemetry'
import { providerManifests } from './providerManifest'

type PreferredEditor = 'system' | 'vscode' | 'vscode-insiders' | 'cursor' | 'zed'

const EDITOR_APPS: Record<Exclude<PreferredEditor, 'system'>, { label: string; macAppName: string }> = {
  vscode: { label: 'VS Code', macAppName: 'Visual Studio Code' },
  'vscode-insiders': { label: 'VS Code Insiders', macAppName: 'Visual Studio Code - Insiders' },
  cursor: { label: 'Cursor', macAppName: 'Cursor' },
  zed: { label: 'Zed', macAppName: 'Zed' }
}

function normalizePreferredEditor(value: unknown): PreferredEditor {
  return value === 'vscode' || value === 'vscode-insiders' || value === 'cursor' || value === 'zed'
    ? value
    : 'system'
}

async function openPathWithPreferredEditor(filePath: string): Promise<string> {
  const editor = normalizePreferredEditor(settingsStore.get('preferredEditor', 'system'))
  if (editor === 'system') return shell.openPath(filePath)

  const appInfo = EDITOR_APPS[editor]
  if (process.platform !== 'darwin') return shell.openPath(filePath)

  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-a', appInfo.macAppName, filePath], (error, _stdout, stderr) => {
      if (!error) {
        resolve('')
        return
      }
      const details = stderr.trim() || error.message
      resolve(`Unable to open in ${appInfo.label}${details ? `: ${details}` : '.'}`)
    })
  })
}

export function registerIpcHandlers(ipcMain: IpcMain): void {
  // App profile
  ipcMain.handle('app:getProfile', () => getAppProfile())

  // Projects
  ipcMain.handle('projects:list', () => projectStore.list())
  ipcMain.handle('projects:add', (_, name: string, rootPath: string) =>
    projectStore.add(name, rootPath)
  )
  ipcMain.handle('projects:remove', (_, id: string) => projectStore.remove(id))
  ipcMain.handle('projects:addSession', (_, projectId: string, sessionId: string) =>
    projectStore.addSession(projectId, sessionId)
  )
  ipcMain.handle('projects:removeSession', (_, projectId: string, sessionId: string) =>
    projectStore.removeSession(projectId, sessionId)
  )

  // Sessions
  ipcMain.handle('sessions:list', () => sessionManager.list())
  ipcMain.handle('sessions:listSummaries', () => sessionManager.listSummaries())
  ipcMain.handle('sessions:get', (_, id: string) => sessionManager.get(id))
  ipcMain.handle('sessions:getTranscriptPage', (_, id: string, request?: TranscriptPageRequest) =>
    sessionManager.getTranscriptPage(id, request ?? {})
  )
  ipcMain.handle('sessions:searchTranscript', (_, id: string, query: string, limit?: number) =>
    sessionManager.searchTranscript(id, query, limit)
  )
  ipcMain.handle('sessions:create', (_, opts) => sessionManager.create(opts))
  ipcMain.handle('sessions:sendMessage', (_, sessionId: string, prompt: string, useWorktree?: boolean, attachments?: Attachment[]) =>
    sessionManager.sendMessage(sessionId, prompt, useWorktree, attachments ?? [])
  )
  ipcMain.handle('sessions:answerSideQuestion', (_, sessionId: string, question: string) =>
    sessionManager.answerSideQuestion(sessionId, question)
  )
  ipcMain.handle('sessions:updateName', (_, id: string, name: string) =>
    sessionManager.updateName(id, name)
  )
  ipcMain.handle('sessions:updatePinned', (_, id: string, pinned: boolean) =>
    sessionManager.updatePinned(id, pinned)
  )
  ipcMain.handle('sessions:updateSettings', (_, id: string, patch: {
    provider?: string
    model?: string
    effort?: string
    agentName?: string | null
    permissionMode?: string
    runtime?: 'headless' | 'interactive' | 'sdk' | 'app-server'
    useThinking?: boolean
    useFast?: boolean
    allowedTools?: string[]
    disallowedTools?: string[]
    availableTools?: string[]
    additionalDirs?: string[]
  }) =>
    sessionManager.updateSettings(id, patch)
  )
  ipcMain.handle('sessions:checkProviders', () => sessionManager.checkProviders())
  ipcMain.handle('sessions:stop', (_, sessionId: string) => sessionManager.stop(sessionId))
  ipcMain.handle('sessions:steerQueuedMessage', (_, sessionId: string, messageId: string) =>
    sessionManager.steerQueuedMessage(sessionId, messageId)
  )
  ipcMain.handle('sessions:remove', (_, sessionId: string) => sessionManager.remove(sessionId))
  ipcMain.handle('sessions:getDiff', (_, sessionId: string) => sessionManager.getDiff(sessionId))
  ipcMain.handle('sessions:getChangedFiles', (_, sessionId: string) => {
    const session = sessionManager.get(sessionId)
    if (!session) return []
    return gitManager.getChangedFiles(session.workDir)
  })
  ipcMain.handle('sessions:getDiffForFile', (_, sessionId: string, filePath: string) => {
    const session = sessionManager.get(sessionId)
    if (!session) return ''
    return gitManager.getDiffForFile(session.workDir, filePath)
  })
  ipcMain.handle('sessions:writeToPty', (_, sessionId: string, data: string) =>
    sessionManager.writeToPty(sessionId, data)
  )
  ipcMain.handle('sessions:grantAndResume', (_, sessionId: string, toolNames: string[]) =>
    sessionManager.grantAndResume(sessionId, toolNames)
  )
  ipcMain.handle('sessions:allowOnceAndResume', (_, sessionId: string, toolNames: string[]) =>
    sessionManager.allowOnceAndResume(sessionId, toolNames)
  )
  ipcMain.handle('sessions:answerUserInput', (_, sessionId: string, answer: string) =>
    sessionManager.answerUserInput(sessionId, answer)
  )
  ipcMain.handle('sessions:denyPermission', (_, sessionId: string) =>
    sessionManager.denyPermission(sessionId)
  )

  // Providers
  ipcMain.handle('providers:getRuntimeInfo', () => getProviderRuntimeInfo())
  ipcMain.handle('providers:getManifest', () => providerManifests())
  ipcMain.handle('providers:getDiagnostics', (_, providerId?: string) => getProviderDiagnosticsAsync(providerId))
  ipcMain.handle('providers:runCommandSurface', (_, providerId: string, surfaceId: string) =>
    runProviderCommandSurfaceAsync(providerId, surfaceId)
  )
  ipcMain.handle('providers:listResources', (_, providerId?: string, cwd?: string) =>
    listProviderResources(providerId, cwd)
  )
  ipcMain.handle('providers:createCapability', (_, request: CapabilityCreateRequest) =>
    createCapability(request)
  )
  ipcMain.handle('providers:updateCapability', (_, request: CapabilityUpdateRequest) =>
    updateCapability(request)
  )
  ipcMain.handle('providers:deleteCapability', (_, request: CapabilityDeleteRequest) =>
    deleteCapability(request)
  )
  ipcMain.handle('providers:previewCapabilitySync', (_, request: CapabilitySyncRequest) =>
    previewCapabilitySync(request)
  )
  ipcMain.handle('providers:syncCapability', (_, request: CapabilitySyncRequest) =>
    applyCapabilitySync(request)
  )
  ipcMain.handle('providers:discoverClaudeExtensions', (_, workDir: string) =>
    discoverClaudeExtensions(workDir)
  )

  // Performance
  ipcMain.handle('performance:record', (_, metric: Omit<PerformanceMetric, 'id'>) =>
    recordPerformanceMetric(metric)
  )
  ipcMain.handle('performance:snapshot', () => performanceSnapshot())
  ipcMain.handle('performance:reset', () => resetPerformanceMetrics())

  // Git
  ipcMain.handle('git:isGitRepo', (_, dir: string) => gitManager.isGitRepo(dir))
  ipcMain.handle('git:getCurrentBranch', (_, dir: string) => gitManager.getCurrentBranch(dir))

  // App settings
  ipcMain.handle('settings:get', () => settingsStore.store)
  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    settingsStore.set(key as keyof typeof settingsStore.store, value as never)
  })

  // File system (for provider instructions and skills)
  ipcMain.handle('fs:resolveHome', () => app.getPath('home'))
  ipcMain.handle('fs:readFile', (_, filePath: string): string | null => {
    try { return readFileSync(filePath, 'utf-8') } catch { return null }
  })
  ipcMain.handle('fs:writeFile', (_, filePath: string, content: string): void => {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, 'utf-8')
  })
  ipcMain.handle('fs:listDir', (_, dirPath: string): string[] | null => {
    try { return readdirSync(dirPath) } catch { return null }
  })
  ipcMain.handle('fs:statPath', (_, filePath: string): { exists: boolean; isFile?: boolean; isDirectory?: boolean; size?: number } => {
    try {
      if (!existsSync(filePath)) return { exists: false }
      const stat = statSync(filePath)
      return {
        exists: true,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        size: stat.size
      }
    } catch {
      return { exists: false }
    }
  })
  ipcMain.handle('fs:resolveWorkspaceFileReference', (_, cwd: string, filePath: string): string | null =>
    resolveWorkspaceFileReference(cwd, filePath)
  )
  ipcMain.handle('fs:openPath', (_, filePath: string): Promise<string> => openPathWithPreferredEditor(filePath))
  ipcMain.handle('fs:showInFolder', (_, filePath: string): void => shell.showItemInFolder(filePath))

  // User shell terminal (separate from provider subprocesses)
  ipcMain.handle('terminal:spawn', (_, sessionId: string, workDir: string) =>
    terminalManager.spawn(sessionId, workDir)
  )
  ipcMain.handle('terminal:write', (_, sessionId: string, data: string) =>
    terminalManager.write(sessionId, data)
  )
  ipcMain.handle('terminal:runCommand', (_, sessionId: string, command: string) =>
    terminalManager.runCommand(sessionId, command)
  )
  ipcMain.handle('terminal:resize', (_, sessionId: string, cols: number, rows: number) =>
    terminalManager.resize(sessionId, cols, rows)
  )
  ipcMain.handle('terminal:getBuffer', (_, terminalId: string) =>
    terminalManager.getBuffer(terminalId)
  )
  ipcMain.handle('terminal:clear', (_, terminalId: string) =>
    terminalManager.clear(terminalId)
  )
  ipcMain.handle('terminal:kill', (_, terminalId: string) =>
    terminalManager.kill(terminalId)
  )

  // File dialog
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:openFiles', async (): Promise<Array<{ path: string; name: string; size?: number }> | null> => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return null
    return result.filePaths.map((filePath) => {
      let size: number | undefined
      try { size = statSync(filePath).size } catch { /* ignore stat races */ }
      return { path: filePath, name: basename(filePath), size }
    })
  })

  // Pet overlay
  ipcMain.handle('pet:getConfig', () => petOverlayManager.getConfig())
  ipcMain.handle('pet:selectPet', (_, id: string) => petOverlayManager.selectPet(id))
  ipcMain.handle('pet:import', () => petOverlayManager.importPet())
  ipcMain.handle('pet:importCodexPets', () => petOverlayManager.importCodexPets())
  ipcMain.handle('pet:setOpen', (_, v: boolean) => petOverlayManager.setOpen(v))
  ipcMain.handle('pet:close', () => petOverlayManager.setOpen(false))
  ipcMain.handle('pet:focusMain', (_, sessionId?: string) => petOverlayManager.focusMain(sessionId))
  ipcMain.on('pet:drag:start', (_, clientX: number, clientY: number) =>
    petOverlayManager.dragStart(clientX, clientY))
  ipcMain.on('pet:drag:move', (_, screenX: number, screenY: number) =>
    petOverlayManager.dragMove(screenX, screenY))
  ipcMain.on('pet:drag:end', () => petOverlayManager.dragEnd())
  ipcMain.on('pet:drag:release', (_, vx: number, vy: number) =>
    petOverlayManager.dragRelease(vx, vy))
  ipcMain.on('pet:pointer', (_, v: boolean) => petOverlayManager.setPointerInteractive(v))
  ipcMain.on('pet:keyboard', (_, v: boolean) => petOverlayManager.setKeyboardInteractive(v))
  ipcMain.on('pet:trayCount', (_, count: number) => petOverlayManager.setTrayCount(count))
  ipcMain.on('pet:trayHeight', (_, h: number) => petOverlayManager.setTrayHeight(h))
  ipcMain.on('pet:traySize', (_, size: { width: number; height: number }) => petOverlayManager.setTraySize(size))
  ipcMain.on('pet:elementMetrics', (_, metrics: { isTrayVisible: boolean; mascot: { width: number; height: number }; tray: { width: number; height: number } | null }) =>
    petOverlayManager.setElementMetrics(metrics))
  ipcMain.on('pet:mascotSize', (_, size: { width: number; height: number }) => petOverlayManager.setMascotSize(size))
  ipcMain.on('pet:mascotResizePreview', (_, width: number) => petOverlayManager.setMascotResizePreview(width))
  ipcMain.on('pet:mascotWidth', (_, width: number) => petOverlayManager.setMascotWidth(width))
}
