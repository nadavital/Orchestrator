import { contextBridge, ipcRenderer } from 'electron'
import type { Session, ChatMessage, SessionRunEventRecord } from '../types'

export type PetSessionEvent =
  | { type: 'created'; session: Session }
  | { type: 'status'; id: string; status: Session['status'] }
  | { type: 'messages'; id: string; messages: ChatMessage[] }
  | { type: 'events'; id: string; events: SessionRunEventRecord[] }
  | { type: 'renamed'; id: string; name: string }
  | { type: 'needsInput'; id: string }

const petApi = {
  onSessionEvent: (cb: (event: PetSessionEvent) => void): (() => void) => {
    const onCreated = (_: Electron.IpcRendererEvent, session: Session): void =>
      cb({ type: 'created', session })
    const onStatus = (_: Electron.IpcRendererEvent, p: { id: string; status: Session['status'] }): void =>
      cb({ type: 'status', ...p })
    const onMessages = (_: Electron.IpcRendererEvent, p: { id: string; messages: ChatMessage[] }): void =>
      cb({ type: 'messages', ...p })
    const onEvents = (_: Electron.IpcRendererEvent, p: { id: string; events: SessionRunEventRecord[] }): void =>
      cb({ type: 'events', ...p })
    const onRenamed = (_: Electron.IpcRendererEvent, p: { id: string; name: string }): void =>
      cb({ type: 'renamed', ...p })
    const onNeedsInput = (_: Electron.IpcRendererEvent, p: { id: string }): void =>
      cb({ type: 'needsInput', ...p })

    ipcRenderer.on('session:created', onCreated)
    ipcRenderer.on('session:status', onStatus)
    ipcRenderer.on('session:messages', onMessages)
    ipcRenderer.on('session:events', onEvents)
    ipcRenderer.on('session:renamed', onRenamed)
    ipcRenderer.on('session:needsInput', onNeedsInput)

    return () => {
      ipcRenderer.off('session:created', onCreated)
      ipcRenderer.off('session:status', onStatus)
      ipcRenderer.off('session:messages', onMessages)
      ipcRenderer.off('session:events', onEvents)
      ipcRenderer.off('session:renamed', onRenamed)
      ipcRenderer.off('session:needsInput', onNeedsInput)
    }
  },

  sessions: {
    sendMessage: (sessionId: string, prompt: string): Promise<void> =>
      ipcRenderer.invoke('sessions:sendMessage', sessionId, prompt),
    grantAndResume: (sessionId: string, toolNames: string[]): Promise<void> =>
      ipcRenderer.invoke('sessions:grantAndResume', sessionId, toolNames),
    answerUserInput: (sessionId: string, answer: string): Promise<void> =>
      ipcRenderer.invoke('sessions:answerUserInput', sessionId, answer),
    denyPermission: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke('sessions:denyPermission', sessionId),
  },

  pet: {
    getConfig: (): Promise<unknown> => ipcRenderer.invoke('pet:getConfig'),
    selectPet: (id: string): Promise<void> => ipcRenderer.invoke('pet:selectPet', id),
    importPet: (): Promise<unknown> => ipcRenderer.invoke('pet:import'),
    close: (): Promise<void> => ipcRenderer.invoke('pet:close'),
    focusMain: (sessionId?: string): Promise<void> => ipcRenderer.invoke('pet:focusMain', sessionId),
    dragStart: (clientX: number, clientY: number): void =>
      ipcRenderer.send('pet:drag:start', clientX, clientY),
    dragMove: (screenX: number, screenY: number): void => ipcRenderer.send('pet:drag:move', screenX, screenY),
    dragEnd: (): void => ipcRenderer.send('pet:drag:end'),
    dragRelease: (vx: number, vy: number): void =>
      ipcRenderer.send('pet:drag:release', vx, vy),
    setPointerInteractive: (v: boolean): void => ipcRenderer.send('pet:pointer', v),
    setTrayCount: (count: number): void => ipcRenderer.send('pet:trayCount', count),
    setTrayHeight: (h: number): void => ipcRenderer.send('pet:trayHeight', h),
    setTraySize: (size: { width: number; height: number }): void => ipcRenderer.send('pet:traySize', size),
    setMascotSize: (size: { width: number; height: number }): void => ipcRenderer.send('pet:mascotSize', size),
    onConfigUpdated: (cb: (update: { selectedPetId?: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, update: { selectedPetId?: string }): void => cb(update)
      ipcRenderer.on('pet:configUpdated', handler)
      return () => ipcRenderer.off('pet:configUpdated', handler)
    },
    onLayout: (cb: (layout: { mascotTop: number; trayTop: number }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, layout: { mascotTop: number; trayTop: number }): void => cb(layout)
      ipcRenderer.on('pet:layout', handler)
      return () => ipcRenderer.off('pet:layout', handler)
    },
  }
}

contextBridge.exposeInMainWorld('petApi', petApi)
export type PetApi = typeof petApi
