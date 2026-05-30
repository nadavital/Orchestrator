import { create } from 'zustand'
import { moveSessionToSidebarCustomSection, moveSidebarSectionKey } from '../types'

export type SidebarViewMode = 'project' | 'recent-projects' | 'chronological' | 'connections'
export type SidebarSortMode = 'updated' | 'created'
export type SidebarBuiltInSection = 'pinned' | 'projects'
export type SidebarSectionKey = SidebarBuiltInSection | `custom:${string}`
export type SidebarSelectedKey = string | null

export interface SidebarCustomSection {
  id: string
  name: string
  emoji: string
  sessionIds: string[]
  collapsed: boolean
}

const SIDEBAR_VIEW_KEY = 'orchestrator.sidebar.viewMode'
const SIDEBAR_SORT_KEY = 'orchestrator.sidebar.sortMode'
const SIDEBAR_COLLAPSED_PROJECTS_KEY = 'orchestrator.sidebar.collapsedProjects'
const SIDEBAR_COLLAPSED_PROJECTLESS_CHATS_KEY = 'orchestrator.sidebar.collapsedProjectlessChats'
const SIDEBAR_COLLAPSED_CONNECTION_GROUPS_KEY = 'orchestrator.sidebar.collapsedConnectionGroups'
const SIDEBAR_COLLAPSED_SECTIONS_KEY = 'orchestrator.sidebar.collapsedSections'
const SIDEBAR_SECTION_ORDER_KEY = 'orchestrator.sidebar.sectionOrder'
const SIDEBAR_CUSTOM_SECTIONS_KEY = 'orchestrator.sidebar.customSections'
const SIDEBAR_PROJECTLESS_CHATS_FIRST_KEY = 'orchestrator.sidebar.projectlessChatsFirst'
const SIDEBAR_SELECTED_KEY = 'orchestrator.sidebar.selectedKey'
const DEFAULT_SECTION_ORDER: SidebarSectionKey[] = ['pinned', 'projects']

interface SidebarState {
  viewMode: SidebarViewMode
  sortMode: SidebarSortMode
  collapsedProjectIds: Record<string, true>
  projectlessChatsCollapsed: boolean
  projectlessChatsFirst: boolean
  collapsedConnectionGroupIds: Record<string, true>
  collapsedSections: Record<SidebarBuiltInSection, boolean>
  customSections: SidebarCustomSection[]
  sectionOrder: SidebarSectionKey[]
  selectedKey: SidebarSelectedKey
  setViewMode: (mode: SidebarViewMode) => void
  setSortMode: (mode: SidebarSortMode) => void
  setSelectedKey: (key: SidebarSelectedKey) => void
  setSectionCollapsed: (section: SidebarBuiltInSection, collapsed: boolean) => void
  toggleSectionCollapsed: (section: SidebarBuiltInSection) => void
  setSectionOrder: (order: SidebarSectionKey[]) => void
  moveSection: (sectionKey: SidebarSectionKey, beforeSectionKey?: SidebarSectionKey | null) => void
  createCustomSection: (name: string, sessionIds?: string[]) => SidebarCustomSection
  removeCustomSection: (sectionId: string) => void
  addSessionToCustomSection: (sectionId: string, sessionId: string) => void
  moveSessionToCustomSection: (sectionId: string, sessionId: string, beforeSessionId?: string | null) => void
  removeSessionFromCustomSection: (sectionId: string, sessionId: string) => void
  setCustomSectionCollapsed: (sectionId: string, collapsed: boolean) => void
  toggleCustomSectionCollapsed: (sectionId: string) => void
  setProjectCollapsed: (projectId: string, collapsed: boolean) => void
  toggleProjectCollapsed: (projectId: string) => void
  setProjectlessChatsCollapsed: (collapsed: boolean) => void
  toggleProjectlessChatsCollapsed: () => void
  setProjectlessChatsFirst: (enabled: boolean) => void
  toggleProjectlessChatsFirst: () => void
  setConnectionGroupCollapsed: (groupId: string, collapsed: boolean) => void
  toggleConnectionGroupCollapsed: (groupId: string) => void
}

const initialCustomSections = readCustomSections()

export const useSidebarStore = create<SidebarState>((set, get) => ({
  viewMode: readSidebarViewMode(),
  sortMode: readSidebarSortMode(),
  collapsedProjectIds: readCollapsedProjects(),
  projectlessChatsCollapsed: readProjectlessChatsCollapsed(),
  projectlessChatsFirst: readProjectlessChatsFirst(),
  collapsedConnectionGroupIds: readCollapsedConnectionGroups(),
  collapsedSections: readCollapsedSections(),
  customSections: initialCustomSections,
  sectionOrder: readSectionOrder(initialCustomSections),
  selectedKey: readSidebarSelectedKey(),
  setViewMode: (mode) => {
    writeString(SIDEBAR_VIEW_KEY, mode)
    set({ viewMode: mode })
  },
  setSortMode: (mode) => {
    writeString(SIDEBAR_SORT_KEY, mode)
    set({ sortMode: mode })
  },
  setSelectedKey: (key) => {
    const normalized = normalizeSidebarSelectedKey(key)
    if (normalized) {
      writeString(SIDEBAR_SELECTED_KEY, normalized)
    } else {
      removeString(SIDEBAR_SELECTED_KEY)
    }
    set({ selectedKey: normalized })
  },
  setSectionCollapsed: (section, collapsed) => {
    set((state) => {
      const next = { ...state.collapsedSections, [section]: collapsed }
      writeJson(SIDEBAR_COLLAPSED_SECTIONS_KEY, next)
      return { collapsedSections: next }
    })
  },
  toggleSectionCollapsed: (section) => {
    const nextCollapsed = get().collapsedSections[section] !== true
    get().setSectionCollapsed(section, nextCollapsed)
  },
  setSectionOrder: (order) => {
    const next = normalizeSectionOrder(order, get().customSections)
    writeJson(SIDEBAR_SECTION_ORDER_KEY, next)
    set({ sectionOrder: next })
  },
  moveSection: (sectionKey, beforeSectionKey) => {
    set((state) => {
      const next = normalizeSectionOrder(
        moveSidebarSectionKey(state.sectionOrder, sectionKey, beforeSectionKey),
        state.customSections
      )
      writeJson(SIDEBAR_SECTION_ORDER_KEY, next)
      return { sectionOrder: next }
    })
  },
  createCustomSection: (name, sessionIds = []) => {
    const section: SidebarCustomSection = {
      id: createSectionId(),
      name: name.trim(),
      emoji: '#',
      sessionIds: uniqueStrings(sessionIds),
      collapsed: false
    }
    set((state) => {
      const customSections = [...state.customSections, section]
      const sectionKey = customSectionKey(section.id)
      const sectionOrder = insertSectionBeforeProjects(state.sectionOrder, sectionKey)
      writeJson(SIDEBAR_CUSTOM_SECTIONS_KEY, customSections)
      writeJson(SIDEBAR_SECTION_ORDER_KEY, sectionOrder)
      return { customSections, sectionOrder }
    })
    return section
  },
  removeCustomSection: (sectionId) => {
    set((state) => {
      const customSections = state.customSections.filter((section) => section.id !== sectionId)
      const sectionOrder = normalizeSectionOrder(
        state.sectionOrder.filter((section) => section !== customSectionKey(sectionId)),
        customSections
      )
      writeJson(SIDEBAR_CUSTOM_SECTIONS_KEY, customSections)
      writeJson(SIDEBAR_SECTION_ORDER_KEY, sectionOrder)
      return { customSections, sectionOrder }
    })
  },
  addSessionToCustomSection: (sectionId, sessionId) => {
    set((state) => {
      const customSections = moveSessionToSidebarCustomSection(state.customSections, sectionId, sessionId)
      writeJson(SIDEBAR_CUSTOM_SECTIONS_KEY, customSections)
      return { customSections }
    })
  },
  moveSessionToCustomSection: (sectionId, sessionId, beforeSessionId) => {
    set((state) => {
      const customSections = moveSessionToSidebarCustomSection(state.customSections, sectionId, sessionId, beforeSessionId)
      writeJson(SIDEBAR_CUSTOM_SECTIONS_KEY, customSections)
      return { customSections }
    })
  },
  removeSessionFromCustomSection: (sectionId, sessionId) => {
    set((state) => {
      const customSections = state.customSections.map((section) => (
        section.id === sectionId
          ? { ...section, sessionIds: section.sessionIds.filter((id) => id !== sessionId) }
          : section
      ))
      writeJson(SIDEBAR_CUSTOM_SECTIONS_KEY, customSections)
      return { customSections }
    })
  },
  setCustomSectionCollapsed: (sectionId, collapsed) => {
    set((state) => {
      const customSections = state.customSections.map((section) => (
        section.id === sectionId ? { ...section, collapsed } : section
      ))
      writeJson(SIDEBAR_CUSTOM_SECTIONS_KEY, customSections)
      return { customSections }
    })
  },
  toggleCustomSectionCollapsed: (sectionId) => {
    const section = get().customSections.find((candidate) => candidate.id === sectionId)
    if (!section) return
    get().setCustomSectionCollapsed(sectionId, !section.collapsed)
  },
  setProjectCollapsed: (projectId, collapsed) => {
    set((state) => {
      const next = { ...state.collapsedProjectIds }
      if (collapsed) {
        next[projectId] = true
      } else {
        delete next[projectId]
      }
      writeJson(SIDEBAR_COLLAPSED_PROJECTS_KEY, next)
      return { collapsedProjectIds: next }
    })
  },
  toggleProjectCollapsed: (projectId) => {
    const nextCollapsed = get().collapsedProjectIds[projectId] !== true
    get().setProjectCollapsed(projectId, nextCollapsed)
  },
  setProjectlessChatsCollapsed: (collapsed) => {
    writeString(SIDEBAR_COLLAPSED_PROJECTLESS_CHATS_KEY, collapsed ? 'true' : 'false')
    set({ projectlessChatsCollapsed: collapsed })
  },
  toggleProjectlessChatsCollapsed: () => {
    get().setProjectlessChatsCollapsed(!get().projectlessChatsCollapsed)
  },
  setProjectlessChatsFirst: (enabled) => {
    writeString(SIDEBAR_PROJECTLESS_CHATS_FIRST_KEY, enabled ? 'true' : 'false')
    set({ projectlessChatsFirst: enabled })
  },
  toggleProjectlessChatsFirst: () => {
    get().setProjectlessChatsFirst(!get().projectlessChatsFirst)
  },
  setConnectionGroupCollapsed: (groupId, collapsed) => {
    set((state) => {
      const next = { ...state.collapsedConnectionGroupIds }
      if (collapsed) {
        next[groupId] = true
      } else {
        delete next[groupId]
      }
      writeJson(SIDEBAR_COLLAPSED_CONNECTION_GROUPS_KEY, next)
      return { collapsedConnectionGroupIds: next }
    })
  },
  toggleConnectionGroupCollapsed: (groupId) => {
    const nextCollapsed = get().collapsedConnectionGroupIds[groupId] !== true
    get().setConnectionGroupCollapsed(groupId, nextCollapsed)
  }
}))

function readSidebarViewMode(): SidebarViewMode {
  const value = readString(SIDEBAR_VIEW_KEY)
  return value === 'project' || value === 'recent-projects' || value === 'chronological' || value === 'connections' ? value : 'project'
}

function readSidebarSortMode(): SidebarSortMode {
  const value = readString(SIDEBAR_SORT_KEY)
  return value === 'updated' || value === 'created' ? value : 'updated'
}

function readSidebarSelectedKey(): SidebarSelectedKey {
  return normalizeSidebarSelectedKey(readString(SIDEBAR_SELECTED_KEY))
}

function normalizeSidebarSelectedKey(value: unknown): SidebarSelectedKey {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (
    trimmed === 'capabilities' ||
    trimmed === 'automations' ||
    trimmed === 'projectless' ||
    trimmed.startsWith('session:') ||
    trimmed.startsWith('settings:') ||
    trimmed.startsWith('project:') ||
    trimmed.startsWith('connection:') ||
    trimmed.startsWith('section:') ||
    trimmed.startsWith('custom:')
  ) {
    return trimmed
  }
  return null
}

export function sidebarSessionSelectedKey(sessionId: string): string {
  return `session:${sessionId}`
}

export function sidebarSettingsSelectedKey(section: string): string {
  return `settings:${section}`
}

function readCollapsedProjects(): Record<string, true> {
  const value = readJson(SIDEBAR_COLLAPSED_PROJECTS_KEY)
  return readCollapsedIdRecord(value)
}

function readProjectlessChatsCollapsed(): boolean {
  return readString(SIDEBAR_COLLAPSED_PROJECTLESS_CHATS_KEY) === 'true'
}

function readProjectlessChatsFirst(): boolean {
  return readString(SIDEBAR_PROJECTLESS_CHATS_FIRST_KEY) === 'true'
}

function readCollapsedConnectionGroups(): Record<string, true> {
  const value = readJson(SIDEBAR_COLLAPSED_CONNECTION_GROUPS_KEY)
  return readCollapsedIdRecord(value)
}

function readCollapsedIdRecord(value: unknown): Record<string, true> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(([, collapsed]) => collapsed === true)
  ) as Record<string, true>
}

function readCollapsedSections(): Record<SidebarBuiltInSection, boolean> {
  const value = readJson(SIDEBAR_COLLAPSED_SECTIONS_KEY)
  const defaults: Record<SidebarBuiltInSection, boolean> = { pinned: false, projects: false }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const record = value as Partial<Record<SidebarBuiltInSection, unknown>>
  return {
    pinned: record.pinned === true,
    projects: record.projects === true
  }
}

function readSectionOrder(customSections: SidebarCustomSection[]): SidebarSectionKey[] {
  return normalizeSectionOrder(readJson(SIDEBAR_SECTION_ORDER_KEY), customSections)
}

function normalizeSectionOrder(value: unknown, customSections: SidebarCustomSection[] = []): SidebarSectionKey[] {
  const customKeys = customSections.map((section) => customSectionKey(section.id))
  if (!Array.isArray(value)) {
    return addMissingCustomSections([...DEFAULT_SECTION_ORDER], customKeys)
  }
  const allowedCustomKeys = new Set(customKeys)
  const next: SidebarSectionKey[] = []
  for (const section of value) {
    const valid =
      section === 'pinned' ||
      section === 'projects' ||
      (typeof section === 'string' && allowedCustomKeys.has(section as `custom:${string}`))
    if (valid && !next.includes(section as SidebarSectionKey)) next.push(section as SidebarSectionKey)
  }
  for (const section of DEFAULT_SECTION_ORDER) {
    if (!next.includes(section)) next.push(section)
  }
  return addMissingCustomSections(next, customKeys)
}

function addMissingCustomSections(order: SidebarSectionKey[], customKeys: SidebarSectionKey[]): SidebarSectionKey[] {
  let next = [...order]
  for (const key of customKeys) {
    if (!next.includes(key)) next = insertSectionBeforeProjects(next, key)
  }
  return next
}

function insertSectionBeforeProjects(order: SidebarSectionKey[], sectionKey: SidebarSectionKey): SidebarSectionKey[] {
  const next = order.filter((section) => section !== sectionKey)
  const projectsIndex = next.indexOf('projects')
  if (projectsIndex === -1) return [...next, sectionKey]
  next.splice(projectsIndex, 0, sectionKey)
  return next
}

function readCustomSections(): SidebarCustomSection[] {
  const value = readJson(SIDEBAR_CUSTOM_SECTIONS_KEY)
  if (!Array.isArray(value)) return []
  return value.flatMap((section): SidebarCustomSection[] => {
    if (!section || typeof section !== 'object' || Array.isArray(section)) return []
    const record = section as Partial<Record<keyof SidebarCustomSection, unknown>>
    if (typeof record.id !== 'string' || typeof record.name !== 'string') return []
    const sessionIds = Array.isArray(record.sessionIds)
      ? record.sessionIds.filter((id): id is string => typeof id === 'string')
      : []
    return [{
      id: record.id,
      name: record.name,
      emoji: typeof record.emoji === 'string' && record.emoji.trim() ? record.emoji : '#',
      sessionIds: uniqueStrings(sessionIds),
      collapsed: record.collapsed === true
    }]
  })
}

function customSectionKey(sectionId: string): `custom:${string}` {
  return `custom:${sectionId}`
}

function createSectionId(): string {
  return `section-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function readString(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeString(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore storage failures; in-memory state still updates.
  }
}

function removeString(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore storage failures; in-memory state still updates.
  }
}

function readJson(key: string): unknown {
  const value = readString(key)
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage failures; in-memory state still updates.
  }
}
