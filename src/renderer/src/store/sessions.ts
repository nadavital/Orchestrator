import { create } from 'zustand'
import type { Session, SessionListItem, ChatMessage, SessionEffort, SessionPermissionMode, SessionRunEventRecord, TranscriptPage, UsageSummary } from '../types'
import { nextPinOrder } from '../types'

export type SettingsSection = 'general' | 'appearance' | 'providers' | 'shortcuts' | 'pets'
export type RightPanelTabKind = 'plan' | 'diff' | 'agents' | 'extensions' | 'side' | 'files' | 'browser' | 'sidechat'
export type RightPanelTabId = Exclude<RightPanelTabKind, 'sidechat'> | `sidechat:${string}`

export interface RightPanelTabState {
  id: RightPanelTabId
  kind: RightPanelTabKind
  title: string
  closable: boolean
}

export interface RightPanelState {
  open: boolean
  width: number
  fullWidth: boolean
  activeTabId: RightPanelTabId | null
  tabs: RightPanelTabState[]
}

export interface SideQuestionMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  status?: 'pending' | 'complete' | 'error'
  usage?: UsageSummary
}

export interface SideChatThread {
  id: string
  title: string
  messages: SideQuestionMessage[]
  createdAt: number
  updatedAt: number
  unread?: boolean
}

export interface TerminalPanelState {
  height: number
  tabs: number[]
  activeTabId: number
  nextTabId: number
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
  sideChats?: SideChatThread[]
  activeSideChatId?: string | null
  browserUrl?: string
  terminalPanel?: TerminalPanelState
  rightPanel?: RightPanelState
}

interface SessionState {
  sessions: SessionListItem[]
  activeSessionId: string | null
  rawBuffers: Record<string, string>
  eventBuffers: Record<string, SessionRunEventRecord[]>
  uiState: Record<string, SessionUIState>
  providerAvailability: Record<string, boolean>
  providerModels: Record<string, string[]>
  showSettings: boolean
  showCapabilities: boolean
  settingsSection: SettingsSection
  setSessions: (sessions: SessionListItem[]) => void
  addSession: (session: Session) => void
  hydrateSession: (session: Session) => void
  mergeTranscriptPage: (sessionId: string, page: TranscriptPage, mode?: 'replace' | 'prepend' | 'append') => void
  removeSession: (id: string) => void
  setActiveSession: (id: string | null) => void
  updateStatus: (id: string, status: Session['status']) => void
  updateName: (id: string, name: string) => void
  updatePinned: (id: string, pinned: boolean, pinOrder?: number) => void
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
  openSideChat: (id: string, chatId: string, title?: string) => void
  closeSideChat: (id: string, chatId: string) => void
  appendSideChatMessage: (id: string, chatId: string, message: SideQuestionMessage) => void
  updateSideChatMessage: (id: string, chatId: string, messageId: string, patch: Partial<SideQuestionMessage>) => void
  setShowSideQuestions: (id: string, v: boolean) => void
  setRightPanelWidth: (id: string, width: number) => void
  setRightPanelFullWidth: (id: string, fullWidth: boolean) => void
  openRightPanelTab: (id: string, tabId: RightPanelTabId) => void
  closeRightPanelTab: (id: string, tabId: RightPanelTabId) => void
  setRightPanelBrowserUrl: (id: string, url: string) => void
  closeRightPanel: (id: string) => void
  setTerminalHeight: (id: string, height: number) => void
  addTerminalTab: (id: string) => number
  setActiveTerminalTab: (id: string, tabId: number) => void
  closeTerminalTab: (id: string, tabId: number) => void
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

const SESSION_STORE_TAIL_MESSAGES = 64

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
  sideQuestions: [],
  sideChats: [],
  activeSideChatId: null,
  browserUrl: '',
  terminalPanel: {
    height: 260,
    tabs: [0],
    activeTabId: 0,
    nextTabId: 1
  },
  rightPanel: {
    open: false,
    width: 468,
    fullWidth: false,
    activeTabId: null,
    tabs: []
  }
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
        : [...s.sessions, fullSessionItem(session)]
    })),

  hydrateSession: (session) =>
    set((s) => ({
      sessions: s.sessions.map((x) => x.id === session.id ? fullSessionItem(session) : x)
    })),

  mergeTranscriptPage: (sessionId, page, mode = 'prepend') =>
    set((s) => ({
      sessions: s.sessions.map((session) => {
        if (session.id !== sessionId) return session
        const messages = mode === 'replace'
          ? page.messages
          : mode === 'append'
            ? mergeMessages(session.messages, page.messages)
            : mergeMessages(page.messages, session.messages)
        return {
          ...session,
          messages,
          messageCount: page.messageCount,
          messagesLoaded: !page.hasMoreBefore && !page.hasMoreAfter && messages.length >= page.messageCount,
          previewText: sessionPreviewText(messages, session.name),
          latestMessageAt: messages.at(-1)?.timestamp ?? session.latestMessageAt
        }
      })
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
    set((s) => {
      if (id && id !== s.activeSessionId) {
        const session = s.sessions.find((candidate) => candidate.id === id)
        markSessionSwitchStart(id, session?.messageCount ?? session?.messages.length ?? 0)
      }
      return {
        activeSessionId: id,
        uiState: id
          ? { ...s.uiState, [id]: { ...(s.uiState[id] ?? defaultUI), hasUnread: false } }
          : s.uiState
      }
    }),

  updateStatus: (id, status) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, status } : x))
    })),

  updateName: (id, name) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, name } : x))
    })),

  updatePinned: (id, pinned, pinOrder) =>
    set((s) => {
      const order = pinOrder ?? (pinned ? nextPinOrder(s.sessions) : undefined)
      return {
        sessions: s.sessions.map((x) => (x.id === id ? { ...x, pinned, pinOrder: order } : x))
      }
    }),

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
          rightPanel: syncRightPanelTab(s.uiState[id]?.rightPanel, 'diff', v),
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
          rightPanel: syncRightPanelTab(s.uiState[id]?.rightPanel, 'plan', v),
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
          rightPanel: syncRightPanelTab(s.uiState[id]?.rightPanel, 'agents', v),
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
      uiState: {
        ...s.uiState,
        [id]: {
          ...(s.uiState[id] ?? defaultUI),
          showTerminal: v,
          terminalPanel: ensureTerminalPanel(s.uiState[id]?.terminalPanel)
        }
      }
    })),

  setShowExtensions: (id, v) =>
    set((s) => ({
      uiState: {
        ...s.uiState,
        [id]: {
          ...(s.uiState[id] ?? defaultUI),
          rightPanel: syncRightPanelTab(s.uiState[id]?.rightPanel, 'extensions', v),
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
            rightPanel: syncRightPanelTab(current.rightPanel, 'side', v),
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
            rightPanel: syncRightPanelTab(current.rightPanel, 'agents', true),
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
            rightPanel: syncRightPanelTab(current.rightPanel, 'agents', agentTabIds.length > 0 ? current.showEvents : false),
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
            rightPanel: syncRightPanelTab(current.rightPanel, 'side', true),
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

  openSideChat: (id, chatId, title = 'Side chat') =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const now = Date.now()
      const sideChats = current.sideChats?.some((chat) => chat.id === chatId)
        ? current.sideChats.map((chat) => chat.id === chatId ? { ...chat, title, updatedAt: now } : chat)
        : [...(current.sideChats ?? []), { id: chatId, title, messages: [], createdAt: now, updatedAt: now }]
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            sideChats,
            activeSideChatId: chatId,
            rightPanel: syncRightPanelTab(current.rightPanel, sideChatTabId(chatId), true)
          }
        }
      }
    }),

  closeSideChat: (id, chatId) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const sideChats = (current.sideChats ?? []).filter((chat) => chat.id !== chatId)
      const activeSideChatId = current.activeSideChatId === chatId ? sideChats.at(-1)?.id ?? null : current.activeSideChatId ?? null
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            sideChats,
            activeSideChatId,
            rightPanel: syncRightPanelTab(current.rightPanel, sideChatTabId(chatId), false)
          }
        }
      }
    }),

  appendSideChatMessage: (id, chatId, message) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const now = Date.now()
      const sideChats = ensureSideChatThread(current.sideChats, chatId).map((chat) =>
        chat.id === chatId
          ? { ...chat, messages: [...chat.messages, message], updatedAt: now, title: sideChatTitle(chat.title, message) }
          : chat
      )
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            sideChats,
            activeSideChatId: chatId,
            rightPanel: syncRightPanelTab(current.rightPanel, sideChatTabId(chatId), true)
          }
        }
      }
    }),

  updateSideChatMessage: (id, chatId, messageId, patch) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            sideChats: (current.sideChats ?? []).map((chat) =>
              chat.id === chatId
                ? {
                    ...chat,
                    updatedAt: Date.now(),
                    messages: chat.messages.map((message) =>
                      message.id === messageId ? { ...message, ...patch } : message
                    )
                  }
                : chat
            )
          }
        }
      }
    }),

  setRightPanelWidth: (id, width) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            rightPanel: { ...ensureRightPanel(current.rightPanel), width }
          }
        }
      }
    }),

  setRightPanelFullWidth: (id, fullWidth) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            rightPanel: { ...ensureRightPanel(current.rightPanel), fullWidth }
          }
        }
      }
    }),

  openRightPanelTab: (id, tabId) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            rightPanel: syncRightPanelTab(current.rightPanel, tabId, true)
          }
        }
      }
    }),

  closeRightPanelTab: (id, tabId) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            showPlan: tabId === 'plan' ? false : current.showPlan,
            showDiff: tabId === 'diff' ? false : current.showDiff,
            showEvents: tabId === 'agents' ? false : current.showEvents,
            showExtensions: tabId === 'extensions' ? false : current.showExtensions,
            showSideQuestions: tabId === 'side' ? false : current.showSideQuestions,
            rightPanel: syncRightPanelTab(current.rightPanel, tabId, false)
          }
        }
      }
    }),

  setRightPanelBrowserUrl: (id, url) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            browserUrl: url
          }
        }
      }
    }),

  closeRightPanel: (id) =>
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
            showSideQuestions: false,
            rightPanel: { ...ensureRightPanel(current.rightPanel), open: false, activeTabId: null, tabs: [] }
          }
        }
      }
    }),

  setTerminalHeight: (id, height) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            terminalPanel: { ...ensureTerminalPanel(current.terminalPanel), height }
          }
        }
      }
    }),

  addTerminalTab: (id) => {
    let newTabId = 0
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const terminalPanel = ensureTerminalPanel(current.terminalPanel)
      newTabId = terminalPanel.nextTabId
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            showTerminal: true,
            terminalPanel: {
              ...terminalPanel,
              tabs: [...terminalPanel.tabs, newTabId],
              activeTabId: newTabId,
              nextTabId: newTabId + 1
            }
          }
        }
      }
    })
    return newTabId
  },

  setActiveTerminalTab: (id, tabId) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            terminalPanel: { ...ensureTerminalPanel(current.terminalPanel), activeTabId: tabId }
          }
        }
      }
    }),

  closeTerminalTab: (id, tabId) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const terminalPanel = ensureTerminalPanel(current.terminalPanel)
      const remaining = terminalPanel.tabs.filter((candidate) => candidate !== tabId)
      const tabs = remaining.length > 0 ? remaining : [0]
      const activeTabId = terminalPanel.activeTabId === tabId ? tabs.at(-1) ?? 0 : terminalPanel.activeTabId
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            showTerminal: remaining.length > 0 ? current.showTerminal : false,
            terminalPanel: {
              ...terminalPanel,
              tabs,
              activeTabId,
              nextTabId: remaining.length > 0 ? terminalPanel.nextTabId : 1
            }
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
        x.id === id
          ? {
              ...x,
              messages: x.messagesLoaded
                ? [...x.messages, ...messages]
                : [...x.messages, ...messages].slice(-SESSION_STORE_TAIL_MESSAGES),
              messageCount: (x.messageCount ?? x.messages.length) + messages.length,
              previewText: sessionPreviewText([...x.messages, ...messages], x.name),
              latestMessageAt: messages.at(-1)?.timestamp ?? x.latestMessageAt
            }
          : x
      )
    })),

  upsertMessage: (id, message) =>
    set((s) => ({
      sessions: s.sessions.map((x) => {
        if (x.id !== id) return x
        const index = x.messages.findIndex((existing) => existing.id === message.id)
        const messages = index >= 0
          ? x.messages.map((existing, i) => i === index ? message : existing)
          : x.messagesLoaded
            ? [...x.messages, message]
            : [...x.messages, message].slice(-SESSION_STORE_TAIL_MESSAGES)
        return {
          ...x,
          messages,
          messageCount: index >= 0 ? (x.messageCount ?? x.messages.length) : (x.messageCount ?? x.messages.length) + 1,
          previewText: sessionPreviewText(messages, x.name),
          latestMessageAt: message.timestamp ?? x.latestMessageAt
        }
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

const RIGHT_PANEL_TAB_TITLES: Record<RightPanelTabKind, string> = {
  plan: 'Plan',
  diff: 'Changes',
  agents: 'Agents',
  extensions: 'Extensions',
  side: 'Side',
  files: 'Files',
  browser: 'Browser',
  sidechat: 'Side chat'
}

function ensureRightPanel(panel?: RightPanelState): RightPanelState {
  return {
    open: panel?.open ?? false,
    width: panel?.width ?? 468,
    fullWidth: panel?.fullWidth ?? false,
    activeTabId: panel?.activeTabId ?? null,
    tabs: panel?.tabs ?? []
  }
}

function ensureTerminalPanel(panel?: TerminalPanelState): TerminalPanelState {
  const tabs = panel?.tabs?.length ? panel.tabs : [0]
  const activeTabId = tabs.includes(panel?.activeTabId ?? 0) ? panel?.activeTabId ?? 0 : tabs[0]
  return {
    height: panel?.height ?? 260,
    tabs,
    activeTabId,
    nextTabId: Math.max(panel?.nextTabId ?? 1, Math.max(...tabs) + 1)
  }
}

function rightPanelTab(id: RightPanelTabId): RightPanelTabState {
  const kind = rightPanelTabKind(id)
  return {
    id,
    kind,
    title: RIGHT_PANEL_TAB_TITLES[kind],
    closable: true
  }
}

export function sideChatTabId(chatId: string): `sidechat:${string}` {
  return `sidechat:${chatId}`
}

export function sideChatIdFromTabId(tabId: RightPanelTabId): string | null {
  return tabId.startsWith('sidechat:') ? tabId.slice('sidechat:'.length) : null
}

function rightPanelTabKind(id: RightPanelTabId): RightPanelTabKind {
  return id.startsWith('sidechat:') ? 'sidechat' : id as Exclude<RightPanelTabId, `sidechat:${string}`>
}

function ensureSideChatThread(sideChats: SideChatThread[] | undefined, chatId: string): SideChatThread[] {
  if (sideChats?.some((chat) => chat.id === chatId)) return sideChats
  const now = Date.now()
  return [...(sideChats ?? []), { id: chatId, title: 'Side chat', messages: [], createdAt: now, updatedAt: now }]
}

function sideChatTitle(currentTitle: string, message: SideQuestionMessage): string {
  if (currentTitle !== 'Side chat' || message.role !== 'user') return currentTitle
  const compact = message.content.replace(/\s+/g, ' ').trim()
  return compact.length > 28 ? `${compact.slice(0, 25)}...` : compact || currentTitle
}

function syncRightPanelTab(panel: RightPanelState | undefined, id: RightPanelTabId, open: boolean): RightPanelState {
  const current = ensureRightPanel(panel)
  if (!open) {
    const tabs = current.tabs.filter((tab) => tab.id !== id)
    const activeTabId = current.activeTabId === id ? tabs.at(-1)?.id ?? null : current.activeTabId
    return {
      ...current,
      open: tabs.length > 0,
      activeTabId,
      tabs
    }
  }
  const tabs = current.tabs.some((tab) => tab.id === id)
    ? current.tabs
    : [...current.tabs, rightPanelTab(id)]
  return {
    ...current,
    open: true,
    activeTabId: id,
    tabs
  }
}

function fullSessionItem(session: Session): SessionListItem {
  return {
    ...session,
    messageCount: session.messages.length,
    messagesLoaded: true,
    previewText: sessionPreviewText(session.messages, session.name),
    latestMessageAt: session.messages.at(-1)?.timestamp ?? session.createdAt
  }
}

function mergeMessages(first: ChatMessage[], second: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  for (const message of [...first, ...second]) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp)
}

function sessionPreviewText(messages: ChatMessage[], fallback: string): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type !== 'text' || message.role === 'system') continue
    const compact = message.content.replace(/\s+/g, ' ').trim()
    if (!compact || compact === fallback) continue
    return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact
  }
  return ''
}

function markSessionSwitchStart(sessionId: string, messageCount: number): void {
  if (typeof window === 'undefined') return
  const perfWindow = window as typeof window & {
    __orchestratorSessionSwitchPerf?: {
      sessionId: string
      startedAt: number
      messageCount: number
      renderedMessages?: number
      transcriptReadyAt?: number
      transcriptReadyMs?: number
    }
  }
  const existing = perfWindow.__orchestratorSessionSwitchPerf
  if (existing?.sessionId === sessionId && !existing.transcriptReadyAt) return
  perfWindow.__orchestratorSessionSwitchPerf = {
    sessionId,
    startedAt: performance.now(),
    messageCount
  }
}
