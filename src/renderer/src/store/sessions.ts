import { create } from 'zustand'
import type { Attachment, Session, SessionListItem, ChatMessage, SessionEffort, SessionPermissionMode, SessionRunEventRecord, TranscriptPage, UsageSummary } from '../types'
import { closePanelTab, filePanelTabId, movePanelTabByDirection, nextPinOrder, parseFilePanelTabId, reorderPinnedSessions, resetPanelTabSet, resolvePanelTabTransferAvailability, transferPanelTab, upsertPanelTab } from '../types'
import type { SettingsSectionId } from '../../../types'

export type SettingsSection = SettingsSectionId
export type RightPanelTabKind = 'new-tab' | 'environment' | 'plan' | 'diff' | 'agents' | 'extensions' | 'side' | 'files' | 'browser' | 'file' | 'sidechat' | 'terminal'
export type RightPanelTabId = Exclude<RightPanelTabKind, 'file' | 'sidechat' | 'terminal'> | `file:${string}` | `sidechat:${string}` | `terminal:${number}`

export interface SourceAnnotationState {
  id: string
  line: number
  body: string
  status: 'draft' | 'saved'
  updatedAt: number
}

export interface RightPanelTabState {
  id: RightPanelTabId
  kind: RightPanelTabKind
  title: string
  closable: boolean
  isPreview?: boolean
  isPinned?: boolean
  fileHost?: string
  filePath?: string
  terminalTabId?: number
  fileViewMode?: 'rich' | 'source'
  sourceWrap?: boolean
  selectedSourceLine?: number | null
  sourceSearchQuery?: string
  sourceSearchIndex?: number
  sourceAnnotations?: SourceAnnotationState[]
  sourceBlameVisible?: boolean
  sourceRevealLine?: number | null
  sourceRevealRequest?: number
}

export interface RightPanelState {
  open: boolean
  width: number
  widthRatio?: number
  fullWidth: boolean
  activeTabId: RightPanelTabId | null
  tabs: RightPanelTabState[]
}

export type BrowserApprovalMode = 'alwaysAsk' | 'alwaysAllow'

export interface BrowserWorkbenchState {
  findVisible: boolean
  findQuery: string
  zoomFactor: number
  deviceMode: BrowserDeviceMode
  viewportWidth: number
  viewportHeight: number
  browserUseActive: boolean
  browserUseTurnId: string | null
  browserUseViewportSize: BrowserUseSurfaceSize | null
  browserUseCaptureSurfaceSize: BrowserUseSurfaceSize | null
  browserUseCaptureBounds: BrowserUseSurfaceBounds | null
  browserUseCursorState: BrowserUseCursorState | null
  webviewTransferSourceHostId: string | null
  webviewTransferTargetHostId: string | null
  webviewTransferId: string | null
  commentMode: boolean
  commentCoachmarkDismissed: boolean
  commentPreviewOriginal: boolean
  visible: boolean
  activeTabId: string
  tabs: BrowserTabState[]
  history: BrowserHistoryEntry[]
  nextTabIndex: number
  inspectorOpen: boolean
  inspectorMode: 'console' | 'dom' | 'targets' | 'assets' | 'security'
  approvalMode: BrowserApprovalMode
  historyApprovalMode: BrowserApprovalMode
  downloadApprovalMode: BrowserApprovalMode
  uploadApprovalMode: BrowserApprovalMode
  allowedOrigins: string[]
  blockedOrigins: string[]
  allowedDownloadOrigins: string[]
  blockedDownloadOrigins: string[]
  allowedUploadOrigins: string[]
  blockedUploadOrigins: string[]
  hiddenLocalTargets: string[]
  localServerRoutes: BrowserLocalServerRoute[]
  hiddenLocalServerRoutes: string[]
}

export interface BrowserUseSurfaceSize {
  width: number
  height: number
}

export interface BrowserUseSurfaceBounds extends BrowserUseSurfaceSize {
  x: number
  y: number
  scale?: number
}

export interface BrowserUseCursorState {
  visible: boolean
  x: number
  y: number
  animateMovement?: boolean
  moveSequence?: number
}

export interface BrowserLocalServerRoute {
  serverUrl: string
  url: string
  title?: string | null
  source?: 'provider' | 'history' | 'manual'
}

export type BrowserDeviceMode =
  | 'desktop'
  | 'mobile'
  | 'iphoneSe'
  | 'iphone15ProMax'
  | 'pixel'
  | 'galaxyS24Ultra'
  | 'ipadMini'
  | 'ipad'
  | 'surfaceDuo'
  | 'surfacePro7'
  | 'laptop'
  | 'laptopLarge'
  | 'desktop4k'
  | 'custom'

export interface BrowserHistoryEntry {
  url: string
  title: string
  visitedAt: number
}

export interface BrowserTabState {
  id: string
  title: string
  url: string
  lastOpened: number
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
  draft?: string
  unread?: boolean
}

export interface TerminalPanelState {
  height: number
  tabs: number[]
  activeTabId: number
  nextTabId: number
}

export type SessionPanelTabTransferIntent =
  | {
    sourcePanel: 'bottom'
    targetPanel: 'right'
    tabKind: 'terminal'
    tabId: number
  }
  | {
    sourcePanel: 'right'
    targetPanel: 'bottom'
    tabKind: RightPanelTabKind
    tabId: RightPanelTabId
  }

export interface SessionUIState {
  showPlan: boolean
  showDiff: boolean
  showEvents: boolean
  showTerminal: boolean
  showExtensions: boolean
  showSideQuestions: boolean
  hasUnread: boolean
  composerDraft?: string
  composerAttachments?: Attachment[]
  activeAgentId?: string | null
  agentTabIds?: string[]
  sideQuestions?: SideQuestionMessage[]
  sideChats?: SideChatThread[]
  activeSideChatId?: string | null
  browserUrl?: string
  browserWorkbench?: BrowserWorkbenchState
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
  settingsHostId: string
  setSessions: (sessions: SessionListItem[]) => void
  addSession: (session: Session) => void
  hydrateSession: (session: Session) => void
  mergeTranscriptPage: (sessionId: string, page: TranscriptPage, mode?: 'replace' | 'prepend' | 'append') => void
  removeSession: (id: string) => void
  setActiveSession: (id: string | null) => void
  updateStatus: (id: string, status: Session['status']) => void
  updateName: (id: string, name: string) => void
  updatePinned: (id: string, pinned: boolean, pinOrder?: number) => void
  reorderPinned: (orderedPinnedSessionIds: string[]) => void
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
  setSideChatDraft: (id: string, chatId: string, draft: string) => void
  appendSideChatMessage: (id: string, chatId: string, message: SideQuestionMessage) => void
  updateSideChatMessage: (id: string, chatId: string, messageId: string, patch: Partial<SideQuestionMessage>) => void
  setShowSideQuestions: (id: string, v: boolean) => void
  setRightPanelWidth: (id: string, width: number, widthRatio?: number | null) => void
  setRightPanelOpen: (id: string, open: boolean) => void
  setRightPanelFullWidth: (id: string, fullWidth: boolean) => void
  openRightPanelTab: (id: string, tabId: RightPanelTabId) => void
  openRightPanelFileTab: (id: string, filePath: string, options?: { preview?: boolean; line?: number }) => void
  updateRightPanelFileTabState: (id: string, tabId: RightPanelTabId, patch: Pick<Partial<RightPanelTabState>, 'fileViewMode' | 'sourceWrap' | 'selectedSourceLine' | 'sourceSearchQuery' | 'sourceSearchIndex' | 'sourceAnnotations' | 'sourceBlameVisible' | 'sourceRevealLine' | 'sourceRevealRequest'>) => void
  pinRightPanelTab: (id: string, tabId: RightPanelTabId) => void
  closeRightPanelTab: (id: string, tabId: RightPanelTabId) => void
  moveRightPanelTab: (id: string, tabId: RightPanelTabId, direction: 'left' | 'right') => void
  resetRightPanelTabState: (id: string, tabId: RightPanelTabId) => void
  setRightPanelBrowserUrl: (id: string, url: string) => void
  openRightPanelBrowserUrl: (id: string, url: string) => void
  setRightPanelBrowserWorkbench: (id: string, patch: Partial<BrowserWorkbenchState>) => void
  transferBrowserWorkbench: (sourceId: string, targetId: string) => void
  closeRightPanel: (id: string) => void
  setTerminalHeight: (id: string, height: number) => void
  addTerminalTab: (id: string) => number
  setActiveTerminalTab: (id: string, tabId: number) => void
  moveTerminalTab: (id: string, tabId: number, direction: 'left' | 'right') => void
  transferSessionPanelTab: (id: string, intent: SessionPanelTabTransferIntent) => boolean
  moveTerminalTabToRight: (id: string, tabId: number) => void
  moveRightPanelTerminalTabToBottom: (id: string, tabId: RightPanelTabId) => void
  closeTerminalTab: (id: string, tabId: number) => void
  setHasUnread: (id: string, v: boolean) => void
  setComposerDraft: (id: string, draft: string) => void
  setComposerAttachments: (id: string, attachments: Attachment[] | ((current: Attachment[]) => Attachment[])) => void
  setProviderAvailability: (availability: Record<string, boolean>) => void
  setProviderModels: (v: Record<string, string[]>) => void
  setShowSettings: (v: boolean) => void
  setShowCapabilities: (v: boolean) => void
  setSettingsSection: (section: SettingsSection) => void
  setSettingsHostId: (hostId: string) => void
  appendMessages: (id: string, messages: ChatMessage[]) => void
  upsertMessage: (id: string, message: ChatMessage) => void
  appendEvents: (id: string, events: SessionRunEventRecord[]) => void
  appendRaw: (id: string, data: string) => void
}

const SESSION_STORE_TAIL_MESSAGES = 64
export const DEFAULT_TERMINAL_PANEL_CONTENT_HEIGHT = 350
export const LEGACY_TERMINAL_PANEL_CONTENT_HEIGHT = 260

export const defaultUI: SessionUIState = {
  showPlan: false,
  showDiff: false,
  showEvents: false,
  showTerminal: false,
  showExtensions: false,
  showSideQuestions: false,
  hasUnread: false,
  composerDraft: '',
  composerAttachments: [],
  activeAgentId: null,
  agentTabIds: [],
  sideQuestions: [],
  sideChats: [],
  activeSideChatId: null,
  browserUrl: '',
  browserWorkbench: defaultBrowserWorkbench(),
  terminalPanel: {
    height: DEFAULT_TERMINAL_PANEL_CONTENT_HEIGHT,
    tabs: [0],
    activeTabId: 0,
    nextTabId: 1
  },
  rightPanel: {
    open: false,
    width: 600,
    widthRatio: undefined,
    fullWidth: false,
    activeTabId: null,
    tabs: []
  }
}

function defaultBrowserWorkbench(): BrowserWorkbenchState {
  return {
    findVisible: false,
    findQuery: '',
    zoomFactor: 1,
    deviceMode: 'desktop',
    viewportWidth: 1280,
    viewportHeight: 720,
    browserUseActive: false,
    browserUseTurnId: null,
    browserUseViewportSize: null,
    browserUseCaptureSurfaceSize: null,
    browserUseCaptureBounds: null,
    browserUseCursorState: null,
    webviewTransferSourceHostId: null,
    webviewTransferTargetHostId: null,
    webviewTransferId: null,
    commentMode: false,
    commentCoachmarkDismissed: false,
    commentPreviewOriginal: false,
    visible: true,
    activeTabId: 'tab-1',
    tabs: [{
      id: 'tab-1',
      title: 'New tab',
      url: '',
      lastOpened: 0
    }],
    history: [],
    nextTabIndex: 2,
    inspectorOpen: false,
    inspectorMode: 'console',
    approvalMode: 'alwaysAsk',
    historyApprovalMode: 'alwaysAsk',
    downloadApprovalMode: 'alwaysAsk',
    uploadApprovalMode: 'alwaysAsk',
    allowedOrigins: ['localhost', '127.0.0.1'],
    blockedOrigins: [],
    allowedDownloadOrigins: [],
    blockedDownloadOrigins: [],
    allowedUploadOrigins: [],
    blockedUploadOrigins: [],
    hiddenLocalTargets: [],
    localServerRoutes: [],
    hiddenLocalServerRoutes: []
  }
}

export function hasComposerDraft(ui?: Pick<SessionUIState, 'composerDraft' | 'composerAttachments'>): boolean {
  return Boolean(ui?.composerDraft?.trim() || (ui?.composerAttachments?.length ?? 0) > 0)
}

export const useSessionStore = create<SessionState>((set, get) => ({
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
  settingsHostId: 'local',

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
        sessions: s.sessions.map((x) => (
          x.id === id
            ? {
                ...x,
                pinned,
                pinOrder: order,
                ...(pinned ? {} : { providerPinned: false, providerPinOrder: undefined, providerPinnedThreadKey: undefined })
              }
            : x
        ))
      }
    }),

  reorderPinned: (orderedPinnedSessionIds) =>
    set((s) => ({
      sessions: reorderPinnedSessions(s.sessions, orderedPinnedSessionIds)
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
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const rightPanel = v
        ? syncRightPanelTab(syncRightPanelTab(current.rightPanel, 'environment', true), 'diff', true)
        : syncRightPanelTab(current.rightPanel, 'diff', false)
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            rightPanel,
            showDiff: v,
            showPlan: v ? false : (current.showPlan ?? false),
            showEvents: v ? false : (current.showEvents ?? false),
            showExtensions: v ? false : (current.showExtensions ?? false),
            showSideQuestions: v ? false : (current.showSideQuestions ?? false)
          }
        }
      }
    }),

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
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const terminalPanel = ensureTerminalPanel(current.terminalPanel)
      const restoredPanel = v && terminalPanel.tabs.length === 0
        ? {
            ...terminalPanel,
            tabs: [terminalPanel.nextTabId],
            activeTabId: terminalPanel.nextTabId,
            nextTabId: terminalPanel.nextTabId + 1
          }
        : terminalPanel
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            showTerminal: v,
            terminalPanel: restoredPanel
          }
        }
      }
    }),

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
        ? current.sideChats.map((chat) => chat.id === chatId ? { ...chat, title: chat.title || title, updatedAt: now, unread: false } : chat)
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

  setSideChatDraft: (id, chatId, draft) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            sideChats: ensureSideChatThread(current.sideChats, chatId).map((chat) =>
              chat.id === chatId ? { ...chat, draft, updatedAt: Date.now() } : chat
            )
          }
        }
      }
    }),

  appendSideChatMessage: (id, chatId, message) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const now = Date.now()
      const isActive = current.activeSideChatId === chatId && current.rightPanel?.activeTabId === sideChatTabId(chatId)
      const sideChats = ensureSideChatThread(current.sideChats, chatId).map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              messages: [...chat.messages, message],
              updatedAt: now,
              title: sideChatTitle(chat.title, message),
              unread: message.role === 'assistant' && message.status !== 'pending' && !isActive ? true : chat.unread
            }
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
      const isActive = current.activeSideChatId === chatId && current.rightPanel?.activeTabId === sideChatTabId(chatId)
      const becomesUnread = !isActive && (patch.status === 'complete' || patch.status === 'error')
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
                    unread: becomesUnread ? true : chat.unread,
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

  setRightPanelWidth: (id, width, widthRatio) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const rightPanel = ensureRightPanel(current.rightPanel)
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            rightPanel: {
              ...rightPanel,
              width,
              widthRatio: widthRatio === undefined ? rightPanel.widthRatio : widthRatio ?? undefined
            }
          }
        }
      }
    }),

  setRightPanelOpen: (id, open) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            rightPanel: { ...ensureRightPanel(current.rightPanel), open }
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

  openRightPanelFileTab: (id, filePath, options) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const currentPanel = ensureRightPanel(current.rightPanel)
      const session = s.sessions.find((candidate) => candidate.id === id)
      const preview = options?.preview ?? true
      const line = typeof options?.line === 'number' && Number.isFinite(options.line) && options.line > 0
        ? Math.floor(options.line)
        : null
      const tab = {
        ...rightPanelTab(fileTabId(filePath, session?.workDir)),
        isPreview: preview,
        isPinned: !preview,
        ...(line !== null
          ? {
              fileViewMode: 'source' as const,
              selectedSourceLine: line,
              sourceRevealLine: line,
              sourceRevealRequest: Date.now()
            }
          : {})
      }
      const next = resetPanelTabSet(upsertPanelTab(currentPanel, tab, { activate: true, replacePreview: preview }))
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            rightPanel: {
              ...currentPanel,
              open: true,
              activeTabId: next.activeTabId,
              tabs: next.tabs
            }
          }
        }
      }
    }),

  pinRightPanelTab: (id, tabId) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const currentPanel = ensureRightPanel(current.rightPanel)
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            rightPanel: {
              ...currentPanel,
              tabs: currentPanel.tabs.map((tab) =>
                tab.id === tabId ? { ...tab, isPreview: false, isPinned: true } : tab
              )
            }
          }
        }
      }
    }),

  updateRightPanelFileTabState: (id, tabId, patch) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const currentPanel = ensureRightPanel(current.rightPanel)
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            rightPanel: {
              ...currentPanel,
              tabs: currentPanel.tabs.map((tab) =>
                tab.id === tabId && tab.kind === 'file'
                  ? { ...tab, ...patch }
                  : tab
              )
            }
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

  moveRightPanelTab: (id, tabId, direction) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            rightPanel: moveRightPanelTab(current.rightPanel, tabId, direction)
          }
        }
      }
    }),

  resetRightPanelTabState: (id, tabId) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      if (tabId !== 'browser') return s
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            browserUrl: '',
            browserWorkbench: defaultBrowserWorkbench()
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

  openRightPanelBrowserUrl: (id, url) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const workbench = current.browserWorkbench ?? defaultBrowserWorkbench()
      const tabs = workbench.tabs.length ? workbench.tabs : defaultBrowserWorkbench().tabs
      const activeTabId = tabs.some((tab) => tab.id === workbench.activeTabId) ? workbench.activeTabId : tabs[0].id
      const openedAt = Date.now()
      const title = browserTitleForUrl(url)
      const nextWorkbench: BrowserWorkbenchState = {
        ...workbench,
        visible: true,
        activeTabId,
        tabs: tabs.map((tab) => tab.id === activeTabId ? { ...tab, url, title, lastOpened: openedAt } : tab),
        history: [
          { url, title, visitedAt: openedAt },
          ...workbench.history.filter((item) => item.url !== url)
        ].slice(0, 12)
      }
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            browserUrl: url,
            browserWorkbench: nextWorkbench,
            rightPanel: syncRightPanelTab(current.rightPanel, 'browser', true)
          }
        }
      }
    }),

  setRightPanelBrowserWorkbench: (id, patch) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            browserWorkbench: {
              ...(current.browserWorkbench ?? defaultUI.browserWorkbench!),
              ...patch
            }
          }
        }
      }
    }),

  transferBrowserWorkbench: (sourceId, targetId) =>
    set((s) => {
      if (sourceId === targetId) return s
      const source = s.uiState[sourceId]
      if (!source?.browserWorkbench) return s
      const target = s.uiState[targetId] ?? defaultUI
      const sourceRightPanel = ensureRightPanel(source.rightPanel)
      const targetRightPanel = ensureRightPanel(target.rightPanel)
      const sourceHasBrowserTab = sourceRightPanel.tabs.some((tab) => tab.id === 'browser')
      const nextTargetRightPanel = sourceHasBrowserTab
        ? {
            ...syncRightPanelTab(targetRightPanel, 'browser', true),
            width: sourceRightPanel.width,
            widthRatio: sourceRightPanel.widthRatio,
            fullWidth: sourceRightPanel.fullWidth,
            open: sourceRightPanel.open
          }
        : targetRightPanel
      const sourceHostId = `right:${sourceId}:browser`
      const targetHostId = `right:${targetId}:browser`
      const transferredWorkbench = cloneBrowserWorkbenchForTransfer(source.browserWorkbench, sourceHostId, targetHostId)
      return {
        uiState: {
          ...s.uiState,
          [sourceId]: {
            ...source,
            browserWorkbench: clearTransferredBrowserUseState(source.browserWorkbench)
          },
          [targetId]: {
            ...target,
            browserUrl: activeBrowserWorkbenchUrl(transferredWorkbench) || source.browserUrl || target.browserUrl || '',
            browserWorkbench: transferredWorkbench,
            rightPanel: nextTargetRightPanel
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

  moveTerminalTab: (id, tabId, direction) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            terminalPanel: moveTerminalTab(ensureTerminalPanel(current.terminalPanel), tabId, direction)
          }
        }
      }
    }),

  transferSessionPanelTab: (id, intent) => {
    const availability = resolvePanelTabTransferAvailability(intent.sourcePanel, intent.targetPanel, intent.tabKind)
    if (!availability.supported) return false

    let moved = false
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const terminalPanel = ensureTerminalPanel(current.terminalPanel)
      const rightPanel = ensureRightPanel(current.rightPanel)

      if (intent.sourcePanel === 'bottom' && intent.targetPanel === 'right') {
        const tabId = intent.tabId
        const transfer = transferPanelTab(
          {
            activeTabId: terminalPanel.activeTabId,
            tabs: terminalPanel.tabs.map((candidate) => ({ id: candidate }))
          },
          rightPanel,
          tabId,
          (tab) => rightPanelTab(terminalTabId(tab.id)),
          { activate: true, replacePreview: true }
        )
        if (!transfer.moved) return s
        moved = true
        const remainingTabs = transfer.source.tabs.map((tab) => tab.id)
        const activeTabId = remainingTabs.length > 0
          ? transfer.source.activeTabId ?? remainingTabs.at(-1) ?? remainingTabs[0] ?? terminalPanel.activeTabId
          : terminalPanel.activeTabId
        return {
          uiState: {
            ...s.uiState,
            [id]: {
              ...current,
              showTerminal: remainingTabs.length > 0 ? current.showTerminal : false,
              terminalPanel: {
                ...terminalPanel,
                tabs: remainingTabs,
                activeTabId
              },
              rightPanel: {
                ...rightPanel,
                open: true,
                activeTabId: transfer.target.activeTabId,
                tabs: transfer.target.tabs
              }
            }
          }
        }
      }

      const rightPanelTabId = intent.tabId
      const terminalId = terminalTabIdFromTabId(rightPanelTabId)
      if (terminalId === null) return s
      const transfer = transferPanelTab(
        rightPanel,
        {
          activeTabId: terminalPanel.activeTabId,
          tabs: terminalPanel.tabs.map((candidate) => ({ id: candidate }))
        },
        rightPanelTabId,
        () => ({ id: terminalId }),
        { activate: true }
      )
      if (!transfer.moved) return s
      moved = true
      const tabs = transfer.target.tabs.map((tab) => tab.id)
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            showTerminal: true,
            terminalPanel: {
              ...terminalPanel,
              tabs,
              activeTabId: transfer.target.activeTabId ?? terminalId,
              nextTabId: Math.max(terminalPanel.nextTabId, terminalId + 1)
            },
            rightPanel: {
              ...rightPanel,
              open: transfer.source.tabs.length > 0,
              activeTabId: transfer.source.activeTabId,
              tabs: transfer.source.tabs
            }
          }
        }
      }
    })
    return moved
  },

  moveTerminalTabToRight: (id, tabId) => {
    get().transferSessionPanelTab(id, {
      sourcePanel: 'bottom',
      targetPanel: 'right',
      tabKind: 'terminal',
      tabId
    })
  },

  moveRightPanelTerminalTabToBottom: (id, tabId) => {
    get().transferSessionPanelTab(id, {
      sourcePanel: 'right',
      targetPanel: 'bottom',
      tabKind: 'terminal',
      tabId
    })
  },

  closeTerminalTab: (id, tabId) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const terminalPanel = ensureTerminalPanel(current.terminalPanel)
      const next = closePanelTab({
        activeTabId: terminalPanel.activeTabId,
        tabs: terminalPanel.tabs.map((candidate) => ({ id: candidate }))
      }, tabId)
      const remaining = next.tabs.map((tab) => tab.id)
      const tabs = remaining
      const activeTabId = remaining.length > 0 ? next.activeTabId ?? tabs[0] ?? 0 : 0
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
              nextTabId: terminalPanel.nextTabId
            },
            rightPanel: syncRightPanelTab(current.rightPanel, terminalTabId(tabId), false)
          }
        }
      }
    }),

  setHasUnread: (id, v) =>
    set((s) => ({
      uiState: { ...s.uiState, [id]: { ...(s.uiState[id] ?? defaultUI), hasUnread: v } }
    })),

  setComposerDraft: (id, draft) =>
    set((s) => ({
      uiState: { ...s.uiState, [id]: { ...(s.uiState[id] ?? defaultUI), composerDraft: draft } }
    })),

  setComposerAttachments: (id, attachments) =>
    set((s) => {
      const current = s.uiState[id] ?? defaultUI
      const nextAttachments = typeof attachments === 'function'
        ? attachments(current.composerAttachments ?? [])
        : attachments
      return {
        uiState: {
          ...s.uiState,
          [id]: {
            ...current,
            composerAttachments: nextAttachments
          }
        }
      }
    }),

  setProviderAvailability: (availability) => set({ providerAvailability: availability }),

  setProviderModels: (v) => set({ providerModels: v }),

  setShowSettings: (v) => set((s) => ({ showSettings: v, showCapabilities: v ? false : s.showCapabilities })),
  setShowCapabilities: (v) => set((s) => ({ showCapabilities: v, showSettings: v ? false : s.showSettings })),

  setSettingsSection: (section) => set({ settingsSection: section }),
  setSettingsHostId: (settingsHostId) => set({ settingsHostId }),

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
  'new-tab': 'New tab',
  environment: 'Environment',
  plan: 'Plan',
  diff: 'Review',
  agents: 'Agents',
  extensions: 'Extensions',
  side: 'Side',
  files: 'Files',
  browser: 'Browser',
  file: 'File',
  sidechat: 'Side chat',
  terminal: 'Terminal'
}

function ensureRightPanel(panel?: RightPanelState): RightPanelState {
  const isLegacyDefaultPanel =
    panel?.width === 468 &&
    typeof panel?.widthRatio === 'number' &&
    Math.abs(panel.widthRatio - 0.34) <= 0.0001
  return {
    open: panel?.open ?? false,
    width: isLegacyDefaultPanel ? 600 : panel?.width ?? 600,
    widthRatio: isLegacyDefaultPanel ? undefined : panel?.widthRatio,
    fullWidth: panel?.fullWidth ?? false,
    activeTabId: panel?.activeTabId ?? null,
    tabs: panel?.tabs ?? []
  }
}

function ensureTerminalPanel(panel?: TerminalPanelState): TerminalPanelState {
  const tabs = panel?.tabs ?? [0]
  const activeTabId = tabs.includes(panel?.activeTabId ?? 0) ? panel?.activeTabId ?? 0 : tabs[0]
  const maxTabId = tabs.length > 0 ? Math.max(...tabs) : 0
  const storedHeight = panel?.height
  const height = storedHeight == null || storedHeight === LEGACY_TERMINAL_PANEL_CONTENT_HEIGHT
    ? DEFAULT_TERMINAL_PANEL_CONTENT_HEIGHT
    : storedHeight
  return {
    height,
    tabs,
    activeTabId: activeTabId ?? 0,
    nextTabId: Math.max(panel?.nextTabId ?? 1, maxTabId + 1)
  }
}

function browserTitleForUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname || url
  } catch {
    return url
  }
}

function activeBrowserWorkbenchUrl(workbench: BrowserWorkbenchState): string {
  return workbench.tabs.find((tab) => tab.id === workbench.activeTabId)?.url ?? workbench.tabs[0]?.url ?? ''
}

function cloneBrowserUseSurfaceSize(size: BrowserUseSurfaceSize | null): BrowserUseSurfaceSize | null {
  return size ? { ...size } : null
}

function cloneBrowserUseSurfaceBounds(bounds: BrowserUseSurfaceBounds | null): BrowserUseSurfaceBounds | null {
  return bounds ? { ...bounds } : null
}

function cloneBrowserUseCursorState(state: BrowserUseCursorState | null): BrowserUseCursorState | null {
  return state ? { ...state } : null
}

function clearTransferredBrowserUseState(workbench: BrowserWorkbenchState): BrowserWorkbenchState {
  return {
    ...workbench,
    browserUseActive: false,
    browserUseTurnId: null,
    browserUseViewportSize: null,
    browserUseCaptureSurfaceSize: null,
    browserUseCaptureBounds: null,
    browserUseCursorState: null,
    webviewTransferSourceHostId: null,
    webviewTransferTargetHostId: null,
    webviewTransferId: null
  }
}

function cloneBrowserWorkbenchForTransfer(
  workbench: BrowserWorkbenchState,
  sourceHostId: string,
  targetHostId: string
): BrowserWorkbenchState {
  return {
    ...workbench,
    webviewTransferSourceHostId: sourceHostId,
    webviewTransferTargetHostId: targetHostId,
    webviewTransferId: `${sourceHostId}->${targetHostId}:${Date.now()}`,
    browserUseViewportSize: cloneBrowserUseSurfaceSize(workbench.browserUseViewportSize),
    browserUseCaptureSurfaceSize: cloneBrowserUseSurfaceSize(workbench.browserUseCaptureSurfaceSize),
    browserUseCaptureBounds: cloneBrowserUseSurfaceBounds(workbench.browserUseCaptureBounds),
    browserUseCursorState: cloneBrowserUseCursorState(workbench.browserUseCursorState),
    tabs: workbench.tabs.map((tab) => ({ ...tab })),
    history: workbench.history.map((item) => ({ ...item })),
    allowedOrigins: [...workbench.allowedOrigins],
    blockedOrigins: [...workbench.blockedOrigins],
    allowedDownloadOrigins: [...workbench.allowedDownloadOrigins],
    blockedDownloadOrigins: [...workbench.blockedDownloadOrigins],
    allowedUploadOrigins: [...workbench.allowedUploadOrigins],
    blockedUploadOrigins: [...workbench.blockedUploadOrigins],
    hiddenLocalTargets: [...workbench.hiddenLocalTargets],
    localServerRoutes: workbench.localServerRoutes.map((route) => ({ ...route })),
    hiddenLocalServerRoutes: [...workbench.hiddenLocalServerRoutes]
  }
}

function moveTerminalTab(
  panel: TerminalPanelState,
  id: number,
  direction: 'left' | 'right'
): TerminalPanelState {
  const next = movePanelTabByDirection({
    activeTabId: panel.activeTabId,
    tabs: panel.tabs.map((tabId) => ({ id: tabId }))
  }, id, direction)
  return {
    ...panel,
    activeTabId: next.activeTabId ?? panel.activeTabId,
    tabs: next.tabs.map((tab) => tab.id)
  }
}

function rightPanelTab(id: RightPanelTabId): RightPanelTabState {
  const kind = rightPanelTabKind(id)
  const fileIdentity = parseFilePanelTabId(id)
  const filePath = fileIdentity?.filePath ?? null
  const terminalId = terminalTabIdFromTabId(id)
  return {
    id,
    kind,
    title: filePath ? basename(filePath) : terminalId !== null ? `Terminal ${terminalId + 1}` : RIGHT_PANEL_TAB_TITLES[kind],
    closable: true,
    fileHost: fileIdentity?.host,
    filePath: filePath ?? undefined,
    terminalTabId: terminalId ?? undefined,
    isPreview: kind === 'file' ? true : undefined,
    isPinned: kind === 'file' ? false : undefined
  }
}

export function sideChatTabId(chatId: string): `sidechat:${string}` {
  return `sidechat:${chatId}`
}

export function fileTabId(filePath: string, host = 'workspace'): `file:${string}` {
  return filePanelTabId(host, filePath)
}

export function terminalTabId(tabId: number): `terminal:${number}` {
  return `terminal:${tabId}`
}

export function sideChatIdFromTabId(tabId: RightPanelTabId): string | null {
  return tabId.startsWith('sidechat:') ? tabId.slice('sidechat:'.length) : null
}

export function terminalTabIdFromTabId(tabId: RightPanelTabId): number | null {
  if (!tabId.startsWith('terminal:')) return null
  const parsed = Number(tabId.slice('terminal:'.length))
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export function filePathFromTabId(tabId: RightPanelTabId): string | null {
  return parseFilePanelTabId(tabId)?.filePath ?? null
}

function rightPanelTabKind(id: RightPanelTabId): RightPanelTabKind {
  if (id.startsWith('file:')) return 'file'
  if (id.startsWith('terminal:')) return 'terminal'
  return id.startsWith('sidechat:') ? 'sidechat' : id as Exclude<RightPanelTabId, `file:${string}` | `sidechat:${string}` | `terminal:${number}`>
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
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
    const next = closePanelTab(current, id)
    return {
      ...current,
      open: next.tabs.length > 0,
      activeTabId: next.activeTabId,
      tabs: next.tabs
    }
  }
  const next = resetPanelTabSet(upsertPanelTab(current, rightPanelTab(id), { activate: true, replacePreview: true }))
  return {
    ...current,
    open: true,
    activeTabId: next.activeTabId,
    tabs: next.tabs
  }
}

function moveRightPanelTab(
  panel: RightPanelState | undefined,
  id: RightPanelTabId,
  direction: 'left' | 'right'
): RightPanelState {
  const current = ensureRightPanel(panel)
  return {
    ...current,
    ...movePanelTabByDirection(current, id, direction)
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
