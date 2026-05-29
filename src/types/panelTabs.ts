export type PanelTabId = string | number
export type PanelCloseFocusArea = 'main' | 'right-panel' | 'bottom-panel'
export type PanelCloseTarget = Exclude<PanelCloseFocusArea, 'main'>
export type PanelFindTarget = 'transcript' | 'review-files' | 'workspace-files' | 'source-file' | 'browser-page'
export type PanelBrowserCommandTarget = 'browser'
export type PanelNewTabTarget = 'browser' | 'right-terminal' | 'bottom-terminal'
export type PanelTabTransferPanelId = 'right' | 'bottom'
export type PanelTabTransferSupportReason = 'available' | 'same-panel' | 'unsupported-tab-kind' | 'unsupported-target'

export interface PanelTabTransferAvailability {
  model: 'shared'
  sourcePanel: PanelTabTransferPanelId
  targetPanel: PanelTabTransferPanelId
  tabKind: string
  supported: boolean
  reason: PanelTabTransferSupportReason
}

export interface PanelTabRecord<TId extends PanelTabId = PanelTabId> {
  id: TId
  isPreview?: boolean
  isPinned?: boolean
}

export interface PanelTabSet<TTab extends PanelTabRecord> {
  tabs: TTab[]
  activeTabId: TTab['id'] | null
}

export interface PanelTabTransferResult<
  TSourceTab extends PanelTabRecord,
  TTargetTab extends PanelTabRecord
> {
  source: PanelTabSet<TSourceTab>
  target: PanelTabSet<TTargetTab>
  moved: boolean
}

export interface PanelCloseAvailability {
  rightPanelActiveTabId?: string | null
  bottomPanelActiveTabId?: PanelTabId | null
  bottomPanelOpen?: boolean
  bottomPanelTabCount?: number
}

export interface PanelFindAvailability {
  rightPanelActiveTabId?: string | null
  rightPanelOpen?: boolean
}

export interface PanelBrowserCommandAvailability {
  rightPanelActiveTabId?: string | null
  rightPanelOpen?: boolean
}

export interface PanelNewTabAvailability {
  rightPanelActiveTabId?: string | null
  rightPanelOpen?: boolean
  bottomPanelActiveTabId?: number | null
  bottomPanelOpen?: boolean
  bottomPanelTabCount?: number
}

export interface FilePanelTabIdentity {
  host: string
  filePath: string
}

export function resolvePanelCloseTarget(
  focusArea: PanelCloseFocusArea,
  availability: PanelCloseAvailability
): PanelCloseTarget | null {
  const rightAvailable = Boolean(availability.rightPanelActiveTabId)
  const bottomAvailable = Boolean(
    availability.bottomPanelOpen &&
    availability.bottomPanelActiveTabId !== null &&
    availability.bottomPanelActiveTabId !== undefined &&
    (availability.bottomPanelTabCount ?? 0) > 0
  )

  if (focusArea === 'right-panel' && rightAvailable) return 'right-panel'
  if (focusArea === 'bottom-panel' && bottomAvailable) return 'bottom-panel'
  if (rightAvailable) return 'right-panel'
  if (bottomAvailable) return 'bottom-panel'
  return null
}

export function resolvePanelFindTarget(
  focusArea: PanelCloseFocusArea,
  availability: PanelFindAvailability
): PanelFindTarget | null {
  if (focusArea === 'bottom-panel') return null
  if (focusArea !== 'right-panel' || !availability.rightPanelOpen) return 'transcript'

  const activeTabId = availability.rightPanelActiveTabId ?? null
  if (activeTabId === 'diff') return 'review-files'
  if (activeTabId === 'files') return 'workspace-files'
  if (activeTabId === 'browser') return 'browser-page'
  if (activeTabId?.startsWith('file:')) return 'source-file'

  return null
}

export function resolvePanelBrowserCommandTarget(
  focusArea: PanelCloseFocusArea,
  availability: PanelBrowserCommandAvailability
): PanelBrowserCommandTarget | null {
  if (focusArea !== 'right-panel' || !availability.rightPanelOpen) return null
  return availability.rightPanelActiveTabId === 'browser' ? 'browser' : null
}

export function resolvePanelNewTabTarget(
  focusArea: PanelCloseFocusArea,
  availability: PanelNewTabAvailability
): PanelNewTabTarget | null {
  if (focusArea === 'right-panel' && availability.rightPanelOpen) {
    const activeTabId = availability.rightPanelActiveTabId ?? null
    if (activeTabId === 'browser') return 'browser'
    if (activeTabId?.startsWith('terminal:')) return 'right-terminal'
  }

  const bottomAvailable = Boolean(
    availability.bottomPanelOpen &&
    availability.bottomPanelActiveTabId !== null &&
    availability.bottomPanelActiveTabId !== undefined &&
    (availability.bottomPanelTabCount ?? 0) > 0
  )
  if (focusArea === 'bottom-panel' && bottomAvailable) return 'bottom-terminal'

  return null
}

export function resolvePanelTabTransferAvailability(
  sourcePanel: PanelTabTransferPanelId,
  targetPanel: PanelTabTransferPanelId,
  tabKind: string
): PanelTabTransferAvailability {
  if (sourcePanel === targetPanel) {
    return {
      model: 'shared',
      sourcePanel,
      targetPanel,
      tabKind,
      supported: false,
      reason: 'same-panel'
    }
  }

  if (tabKind !== 'terminal' && tabKind !== 'plan') {
    return {
      model: 'shared',
      sourcePanel,
      targetPanel,
      tabKind,
      supported: false,
      reason: 'unsupported-tab-kind'
    }
  }

  const supported =
    (sourcePanel === 'bottom' && targetPanel === 'right') ||
    (sourcePanel === 'right' && targetPanel === 'bottom')

  return {
    model: 'shared',
    sourcePanel,
    targetPanel,
    tabKind,
    supported,
    reason: supported ? 'available' : 'unsupported-target'
  }
}

export function upsertPanelTab<TTab extends PanelTabRecord>(
  set: PanelTabSet<TTab>,
  tab: TTab,
  options: { activate?: boolean; replacePreview?: boolean } = {}
): PanelTabSet<TTab> {
  const activate = options.activate ?? true
  const existingIndex = set.tabs.findIndex((candidate) => candidate.id === tab.id)
  if (existingIndex !== -1) {
    const tabs = [...set.tabs]
    const existing = tabs[existingIndex]
    if (!existing) return set
    tabs[existingIndex] = {
      ...existing,
      ...tab,
      isPreview: tab.isPreview && !existing.isPreview ? false : tab.isPreview ?? existing.isPreview
    } as TTab
    return {
      tabs,
      activeTabId: activate ? tab.id : set.activeTabId
    }
  }

  const tabs = options.replacePreview
    ? set.tabs.filter((candidate) => !candidate.isPreview)
    : set.tabs

  return {
    tabs: [...tabs, tab],
    activeTabId: activate ? tab.id : set.activeTabId
  }
}

export function closePanelTab<TTab extends PanelTabRecord>(
  set: PanelTabSet<TTab>,
  id: TTab['id']
): PanelTabSet<TTab> {
  const index = set.tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return set
  const tabs = set.tabs.filter((tab) => tab.id !== id)
  const activeTabId = set.activeTabId === id
    ? tabs[Math.max(0, index - 1)]?.id ?? tabs[0]?.id ?? null
    : set.activeTabId
  return { tabs, activeTabId }
}

export function transferPanelTab<
  TSourceTab extends PanelTabRecord,
  TTargetTab extends PanelTabRecord
>(
  source: PanelTabSet<TSourceTab>,
  target: PanelTabSet<TTargetTab>,
  id: TSourceTab['id'],
  mapTab: (tab: TSourceTab) => TTargetTab | null,
  options: { activate?: boolean; replacePreview?: boolean } = {}
): PanelTabTransferResult<TSourceTab, TTargetTab> {
  const tab = source.tabs.find((candidate) => candidate.id === id)
  if (!tab) {
    return { source, target, moved: false }
  }

  const targetTab = mapTab(tab)
  if (!targetTab) {
    return { source, target, moved: false }
  }

  return {
    source: closePanelTab(source, id),
    target: resetPanelTabSet(upsertPanelTab(target, targetTab, {
      activate: options.activate ?? true,
      replacePreview: options.replacePreview
    })),
    moved: true
  }
}

export function movePanelTabByDirection<TTab extends PanelTabRecord>(
  set: PanelTabSet<TTab>,
  id: TTab['id'],
  direction: 'left' | 'right'
): PanelTabSet<TTab> {
  const index = set.tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return set
  const nextIndex = direction === 'left'
    ? Math.max(0, index - 1)
    : Math.min(set.tabs.length - 1, index + 1)
  return reorderPanelTab(set, id, nextIndex)
}

export function reorderPanelTab<TTab extends PanelTabRecord>(
  set: PanelTabSet<TTab>,
  id: TTab['id'],
  nextIndex: number
): PanelTabSet<TTab> {
  const index = set.tabs.findIndex((tab) => tab.id === id)
  if (index === -1 || index === nextIndex) return set
  const clampedNextIndex = Math.max(0, Math.min(set.tabs.length - 1, nextIndex))
  if (index === clampedNextIndex) return set
  const tabs = [...set.tabs]
  const [tab] = tabs.splice(index, 1)
  if (!tab) return set
  tabs.splice(clampedNextIndex, 0, tab)
  return { ...set, tabs }
}

export function pinPanelTab<TTab extends PanelTabRecord>(
  set: PanelTabSet<TTab>,
  id: TTab['id'],
  pinned = true
): PanelTabSet<TTab> {
  return {
    ...set,
    tabs: set.tabs.map((tab) => tab.id === id ? { ...tab, isPinned: pinned, isPreview: pinned ? false : tab.isPreview } as TTab : tab)
  }
}

export function resetPanelTabSet<TTab extends PanelTabRecord>(
  set: PanelTabSet<TTab>,
  fallbackActiveId: TTab['id'] | null = null
): PanelTabSet<TTab> {
  const activeTabId = set.tabs.some((tab) => tab.id === set.activeTabId)
    ? set.activeTabId
    : fallbackActiveId ?? set.tabs[0]?.id ?? null
  return { ...set, activeTabId }
}

export function filePanelTabId(host: string, filePath: string): `file:${string}` {
  return `file:${encodeURIComponent(host || 'workspace')}:${encodeURIComponent(filePath)}`
}

export function parseFilePanelTabId(tabId: string): FilePanelTabIdentity | null {
  if (!tabId.startsWith('file:')) return null
  const payload = tabId.slice('file:'.length)
  const separatorIndex = payload.indexOf(':')
  if (separatorIndex === -1) {
    return {
      host: 'workspace',
      filePath: decodeTabSegment(payload)
    }
  }
  return {
    host: decodeTabSegment(payload.slice(0, separatorIndex)) || 'workspace',
    filePath: decodeTabSegment(payload.slice(separatorIndex + 1))
  }
}

function decodeTabSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
