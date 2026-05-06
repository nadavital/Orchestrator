import { create } from 'zustand'
import type { Session, ChatMessage, SessionEffort, SessionPermissionMode, SessionRunEventRecord } from '../types'

interface SessionUIState {
  showDiff: boolean
  showEvents: boolean
  showTerminal: boolean
  showSkills: boolean
  hasUnread: boolean
}

interface SessionState {
  sessions: Session[]
  activeSessionId: string | null
  rawBuffers: Record<string, string>
  eventBuffers: Record<string, SessionRunEventRecord[]>
  uiState: Record<string, SessionUIState>
  providerAvailability: Record<string, boolean>
  providerModels: Record<string, string[]>
  showSettings: boolean
  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  removeSession: (id: string) => void
  setActiveSession: (id: string | null) => void
  updateStatus: (id: string, status: Session['status']) => void
  updateName: (id: string, name: string) => void
  updateSession: (id: string, patch: Partial<Session>) => void
  updateSettings: (id: string, patch: { provider?: string; model?: string; effort?: SessionEffort; permissionMode?: SessionPermissionMode; useThinking?: boolean; useFast?: boolean }) => void
  setShowDiff: (id: string, v: boolean) => void
  setShowEvents: (id: string, v: boolean) => void
  setShowTerminal: (id: string, v: boolean) => void
  setShowSkills: (id: string, v: boolean) => void
  setHasUnread: (id: string, v: boolean) => void
  setProviderAvailability: (availability: Record<string, boolean>) => void
  setProviderModels: (v: Record<string, string[]>) => void
  setShowSettings: (v: boolean) => void
  appendMessages: (id: string, messages: ChatMessage[]) => void
  appendEvents: (id: string, events: SessionRunEventRecord[]) => void
  appendRaw: (id: string, data: string) => void
}

const defaultUI: SessionUIState = { showDiff: false, showEvents: false, showTerminal: false, showSkills: false, hasUnread: false }

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  rawBuffers: {},
  eventBuffers: {},
  uiState: {},
  providerAvailability: {},
  providerModels: {},
  showSettings: false,

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((s) => ({
      sessions: s.sessions.some((x) => x.id === session.id)
        ? s.sessions
        : [...s.sessions, session]
    })),

  removeSession: (id) =>
    set((s) => {
      const { [id]: _raw, ...rawBuffers } = s.rawBuffers
      const { [id]: _events, ...eventBuffers } = s.eventBuffers
      const { [id]: _ui, ...uiState } = s.uiState
      return {
        sessions: s.sessions.filter((x) => x.id !== id),
        activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
        rawBuffers,
        eventBuffers,
        uiState
      }
    }),

  setActiveSession: (id) =>
    set((s) => ({
      activeSessionId: id,
      uiState: id
        ? { ...s.uiState, [id]: { ...(s.uiState[id] ?? defaultUI), hasUnread: false } }
        : s.uiState
    })),

  updateStatus: (id, status) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, status } : x))
    })),

  updateName: (id, name) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, name } : x))
    })),

  updateSession: (id, patch) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x))
    })),

  updateSettings: (id, patch) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x))
    })),

  setShowDiff: (id, v) =>
    set((s) => ({
      uiState: { ...s.uiState, [id]: { ...(s.uiState[id] ?? defaultUI), showDiff: v } }
    })),

  setShowEvents: (id, v) =>
    set((s) => ({
      uiState: { ...s.uiState, [id]: { ...(s.uiState[id] ?? defaultUI), showEvents: v } }
    })),

  setShowTerminal: (id, v) =>
    set((s) => ({
      uiState: { ...s.uiState, [id]: { ...(s.uiState[id] ?? defaultUI), showTerminal: v } }
    })),

  setShowSkills: (id, v) =>
    set((s) => ({
      uiState: { ...s.uiState, [id]: { ...(s.uiState[id] ?? defaultUI), showSkills: v } }
    })),

  setHasUnread: (id, v) =>
    set((s) => ({
      uiState: { ...s.uiState, [id]: { ...(s.uiState[id] ?? defaultUI), hasUnread: v } }
    })),

  setProviderAvailability: (availability) => set({ providerAvailability: availability }),

  setProviderModels: (v) => set({ providerModels: v }),

  setShowSettings: (v) => set({ showSettings: v }),

  appendMessages: (id, messages) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, messages: [...x.messages, ...messages] } : x
      )
    })),

  appendEvents: (id, events) =>
    set((s) => ({
      eventBuffers: { ...s.eventBuffers, [id]: [...(s.eventBuffers[id] ?? []), ...events].slice(-500) }
    })),

  appendRaw: (id, data) =>
    set((s) => ({
      rawBuffers: { ...s.rawBuffers, [id]: (s.rawBuffers[id] ?? '') + data }
    }))
}))
