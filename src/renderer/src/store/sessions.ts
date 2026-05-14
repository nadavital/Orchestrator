import { create } from 'zustand'
import type { Session, ChatMessage, SessionEffort, SessionPermissionMode, SessionRunEventRecord, UsageSummary } from '../types'

export type SettingsSection = 'general' | 'providers' | 'pets'

export interface SideQuestionMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  status?: 'pending' | 'complete' | 'error'
  usage?: UsageSummary
}

interface SessionUIState {
  showPlan: boolean
  showDiff: boolean
  showEvents: boolean
  showTerminal: boolean
  showExtensions: boolean
  showSideQuestions: boolean
  hasUnread: boolean
  activeAgentId?: string | null
  agentTabIds?: string[]
  sideQuestions?: SideQuestionMessage[]
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
  showCapabilities: boolean
  settingsSection: SettingsSection
  setSessions: (sessions: Session[]) => void
  addSession: (session: Session) => void
  removeSession: (id: string) => void
  setActiveSession: (id: string | null) => void
  updateStatus: (id: string, status: Session['status']) => void
  updateName: (id: string, name: string) => void
  updatePinned: (id: string, pinned: boolean) => void
  updateSession: (id: string, patch: Partial<Session>) => void
  updateSettings: (id: string, patch: {
    provider?: string
    model?: string
    effort?: SessionEffort
    agentName?: string | null
    permissionMode?: SessionPermissionMode
    runtime?: Session['runtime']
    useThinking?: boolean
    useFast?: boolean
    allowedTools?: string[]
    disallowedTools?: string[]
    availableTools?: string[]
    additionalDirs?: string[]
    usageSummary?: UsageSummary
  }) => void
  setShowDiff: (id: string, v: boolean) => void
  setShowPlan: (id: string, v: boolean) => void
  setShowEvents: (id: string, v: boolean) => void
  setShowTerminal: (id: string, v: boolean) => void
  setShowExtensions: (id: string, v: boolean) => void
  setActiveAgent: (id: string, agentId: string | null) => void
  closeAgentTab: (id: string, agentId: string) => void
  appendSideQuestion: (id: string, message: SideQuestionMessage) => void
  updateSideQuestion: (id: string, messageId: string, patch: Partial<SideQuestionMessage>) => void
  setShowSideQuestions: (id: string, v: boolean) => void
  setHasUnread: (id: string, v: boolean) => void
  setProviderAvailability: (availability: Record<string, boolean>) => void
  setProviderModels: (v: Record<string, string[]>) => void
  setShowSettings: (v: boolean) => void
  setShowCapabilities: (v: boolean) => void
  setSettingsSection: (section: SettingsSection) => void
  appendMessages: (id: string, messages: ChatMessage[]) => void
  upsertMessage: (id: string, message: ChatMessage) => void
  appendEvents: (id: string, events: SessionRunEventRecord[]) => void
  appendRaw: (id: string, data: string) => void
}

const defaultUI: SessionUIState = {
  showPlan: false,
  showDiff: false,
  showEvents: false,
  showTerminal: false,
  showExtensions: false,
  showSideQuestions: false,
  hasUnread: false,
  activeAgentId: null,
  agentTabIds: [],
  sideQuestions: []
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  rawBuffers: {},
  eventBuffers: {},
  uiState: {},
  providerAvailability: {},
  providerModels: {},
  showSettings: false,
  showCapabilities: false,
  settingsSection: 'general',

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

  updatePinned: (id, pinned) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, pinned } : x))
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
      uiState: {
        ...s.uiState,
        [id]: {
          ...(s.uiState[id] ?? defaultUI),
          showDiff: v,
          showPlan: v ? false : (s.uiState[id]?.showPlan ?? false),
          showEvents: v ? false : (s.uiState[id]?.showEvents ?? false),
          showExtensions: v ? false : (s.uiState[id]?.showExtensions ?? false),
          showSideQuestions: v ? false : (s.uiState[id]?.showSideQuestions ?? false)
        }
      }
    })),

  setShowPlan: (id, v) =>
    set((s) => ({
      uiState: {
        ...s.uiState,
        [id]: {
          ...(s.uiState[id] ?? defaultUI),
          showPlan: v,
          showDiff: v ? false : (s.uiState[id]?.showDiff ?? false),
          showEvents: v ? false : (s.uiState[id]?.showEvents ?? false),
          showExtensions: v ? false : (s.uiState[id]?.showExtensions ?? false),
          showSideQuestions: v ? false : (s.uiState[id]?.showSideQuestions ?? false)
        }
      }
    })),

  setShowEvents: (id, v) =>
    set((s) => ({
      uiState: {
        ...s.uiState,
        [id]: {
          ...(s.uiState[id] ?? defaultUI),
          showEvents: v,
          showPlan: v ? false : (s.uiState[id]?.showPlan ?? false),
          showDiff: v ? false : (s.uiState[id]?.showDiff ?? false),
          showExtensions: v ? false : (s.uiState[id]?.showExtensions ?? false),
          showSideQuestions: v ? false : (s.uiState[id]?.showSideQuestions ?? false)
        }
      }
    })),

  setShowTerminal: (id, v) =>
    set((s) => ({
      uiState: { ...s.uiState, [id]: { ...(s.uiState[id] ?? defaultUI), showTerminal: v } }
    })),

  setShowExtensions: (id, v) =>
    set((s) => ({
      uiState: {
        ...s.uiState,
        [id]: {
          ...(s.uiState[id] ?? defaultUI),
          showExtensions: v,
          showPlan: v ? false : (s.uiState[id]?.showPlan ?? false),
          showDiff: v ? false : (s.uiState[id]?.showDiff ?? false),
          showEvents: v ? false : (s.uiState[id]?.showEvents ?? false),
          showSideQuestions: v ? false : (s.uiState[id]?.showSideQuestions ?? false)
        }
      }
    })),

  setShowSideQuestions: (id, v) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            showExtensions: v ? false : current.showExtensions,
            showPlan: v ? false : current.showPlan,
            showDiff: v ? false : current.showDiff,
            showEvents: v ? false : current.showEvents,
            sideQuestions: current.sideQuestions ?? [],
            showSideQuestions: v
          }
        }
      }
    }),

  setActiveAgent: (id, agentId) =>
    set((s) => ({
      uiState: {
        ...s.uiState,
        [id]: (() => {
          const current = s.uiState[id] ?? defaultUI
          const agentTabIds = agentId
            ? current.agentTabIds?.includes(agentId)
              ? current.agentTabIds
              : [...(current.agentTabIds ?? []), agentId]
            : current.agentTabIds ?? []
          return {
            ...current,
            activeAgentId: agentId,
            showEvents: true,
            showPlan: false,
            showDiff: false,
            showExtensions: false,
            showSideQuestions: false,
            agentTabIds
          }
        })()
      }
    })),

  closeAgentTab: (id, agentId) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const agentTabIds = (current.agentTabIds ?? []).filter((tabId) => tabId !== agentId)
      const activeAgentId = current.activeAgentId === agentId
        ? agentTabIds.at(-1) ?? null
        : current.activeAgentId ?? null
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            agentTabIds,
            activeAgentId,
            showEvents: agentTabIds.length > 0 ? current.showEvents : false
          }
        }
      }
    }),

  appendSideQuestion: (id, message) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            showPlan: false,
            showDiff: false,
            showEvents: false,
            showExtensions: false,
            showSideQuestions: true,
            sideQuestions: [...(current.sideQuestions ?? []), message]
          }
        }
      }
    }),

  updateSideQuestion: (id, messageId, patch) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            sideQuestions: (current.sideQuestions ?? []).map((message) =>
              message.id === messageId ? { ...message, ...patch } : message
            )
          }
        }
      }
    }),

  setHasUnread: (id, v) =>
    set((s) => ({
      uiState: { ...s.uiState, [id]: { ...(s.uiState[id] ?? defaultUI), hasUnread: v } }
    })),

  setProviderAvailability: (availability) => set({ providerAvailability: availability }),

  setProviderModels: (v) => set({ providerModels: v }),

  setShowSettings: (v) => set((s) => ({ showSettings: v, showCapabilities: v ? false : s.showCapabilities })),
  setShowCapabilities: (v) => set((s) => ({ showCapabilities: v, showSettings: v ? false : s.showSettings })),

  setSettingsSection: (section) => set({ settingsSection: section }),

  appendMessages: (id, messages) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, messages: [...x.messages, ...messages] } : x
      )
    })),

  upsertMessage: (id, message) =>
    set((s) => ({
      sessions: s.sessions.map((x) => {
        if (x.id !== id) return x
        const index = x.messages.findIndex((existing) => existing.id === message.id)
        const messages = index >= 0
          ? x.messages.map((existing, i) => i === index ? message : existing)
          : [...x.messages, message]
        return { ...x, messages }
      })
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
