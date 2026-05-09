import type { IpcMain } from 'electron'
import { dialog, app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { dirname } from 'path'
import { projectStore } from './projects'
import { sessionManager } from './sessions'
import { gitManager } from './git'
import { settingsStore } from './settings'
import { terminalManager } from './terminal'
import { petOverlayManager } from './petOverlay'
import { getProviderDiagnostics, getProviderRuntimeInfo, runProviderCommandSurface } from './providers'
import type { ProviderRuntimeKind } from '../types'

export function registerIpcHandlers(ipcMain: IpcMain): void {
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
  ipcMain.handle('sessions:get', (_, id: string) => sessionManager.get(id))
  ipcMain.handle('sessions:create', (_, opts) => sessionManager.create(opts))
  ipcMain.handle('sessions:sendMessage', (_, sessionId: string, prompt: string, useWorktree?: boolean) =>
    sessionManager.sendMessage(sessionId, prompt, useWorktree)
  )
  ipcMain.handle('sessions:updateName', (_, id: string, name: string) =>
    sessionManager.updateName(id, name)
  )
  ipcMain.handle('sessions:updateSettings', (_, id: string, patch: {
    provider?: string
    model?: string
    effort?: string
    permissionMode?: string
    runtime?: ProviderRuntimeKind
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
  ipcMain.handle('providers:getDiagnostics', () => getProviderDiagnostics())
  ipcMain.handle('providers:runCommandSurface', (_, providerId: string, surfaceId: string) =>
    runProviderCommandSurface(providerId, surfaceId)
  )

  // Git
  ipcMain.handle('git:isGitRepo', (_, dir: string) => gitManager.isGitRepo(dir))

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

  // User shell terminal (separate from provider PTYs)
  ipcMain.handle('terminal:spawn', (_, sessionId: string, workDir: string) =>
    terminalManager.spawn(sessionId, workDir)
  )
  ipcMain.handle('terminal:write', (_, sessionId: string, data: string) =>
    terminalManager.write(sessionId, data)
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
  ipcMain.on('pet:trayCount', (_, count: number) => petOverlayManager.setTrayCount(count))
  ipcMain.on('pet:trayHeight', (_, h: number) => petOverlayManager.setTrayHeight(h))
  ipcMain.on('pet:traySize', (_, size: { width: number; height: number }) => petOverlayManager.setTraySize(size))
  ipcMain.on('pet:mascotSize', (_, size: { width: number; height: number }) => petOverlayManager.setMascotSize(size))
}
