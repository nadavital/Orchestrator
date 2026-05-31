import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import type { Project, WorktreeInventoryItem } from '../../types'
import { useSessionStore } from '../../store/sessions'
import { useProjectStore } from '../../store/projects'
import {
  ConfirmDialog,
  SettingsContentGroup,
  SettingsContentLayout,
  SettingsGroupContent,
  SettingsPageSection,
  SettingsRow,
  SettingsSurface
} from '../shared/designSystem'

interface WorktreesSettingsPageProps {
  onClose?: () => void
}

export default function WorktreesSettingsPage({ onClose }: WorktreesSettingsPageProps): JSX.Element {
  const [worktrees, setWorktrees] = useState<WorktreeInventoryItem[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [baseRef, setBaseRef] = useState('HEAD')
  const [branchName, setBranchName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState<string | null>(null)
  const [pendingDeleteWorktree, setPendingDeleteWorktree] = useState<WorktreeInventoryItem | null>(null)
  const statusId = useId()
  const addSession = useSessionStore((state) => state.addSession)
  const updateSessionName = useSessionStore((state) => state.updateName)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const removeSession = useSessionStore((state) => state.removeSession)
  const setShowSettings = useSessionStore((state) => state.setShowSettings)
  const addSessionToProject = useProjectStore((state) => state.addSessionToProject)

  const groupedWorktrees = useMemo(() => groupByRepo(worktrees), [worktrees])
  const activeCount = worktrees.filter((worktree) => worktree.state === 'ready').length
  const pendingCount = worktrees.filter((worktree) => worktree.state !== 'ready').length

  const refreshWorktrees = useCallback(async (options: { announce?: boolean } = {}): Promise<void> => {
    if (options.announce) {
      setRefreshBusy(true)
      setStatus('Refreshing worktrees')
    }
    try {
      const next = await window.api.worktrees.list()
      setWorktrees(next)
      if (options.announce) {
        setStatus(`Worktrees refreshed: ${next.length} workspace${next.length === 1 ? '' : 's'}`)
      }
    } catch (error) {
      if (options.announce) {
        setStatus(`Refresh failed: ${error instanceof Error ? error.message : String(error)}`)
      } else {
        throw error
      }
    } finally {
      if (options.announce) setRefreshBusy(false)
    }
  }, [])

  useEffect(() => {
    void refreshWorktrees()
    window.api.projects.list()
      .then((nextProjects) => {
        setProjects(nextProjects)
        setSelectedProjectId((current) => current || nextProjects[0]?.id || '')
      })
      .catch(() => setProjects([]))
    const refresh = (): void => { void refreshWorktrees() }
    window.addEventListener('orchestrator:worktrees-updated', refresh)
    return () => window.removeEventListener('orchestrator:worktrees-updated', refresh)
  }, [refreshWorktrees])

  const deleteWorktree = async (worktree: WorktreeInventoryItem): Promise<void> => {
    if (!worktree.managed) return
    setBusyIds((current) => ({ ...current, [worktree.id]: true }))
    try {
      const next = await window.api.worktrees.delete(worktree.workDir)
      setWorktrees(next)
      for (const conversation of worktree.conversations) removeSession(conversation.id)
      setStatus(`Deleted worktree for ${worktree.conversationCount} chat${worktree.conversationCount === 1 ? '' : 's'}`)
      window.dispatchEvent(new CustomEvent('orchestrator:worktrees-updated'))
    } finally {
      setBusyIds((current) => ({ ...current, [worktree.id]: false }))
      setPendingDeleteWorktree((current) => current?.id === worktree.id ? null : current)
    }
  }

  const createWorktree = async (): Promise<void> => {
    const project = projects.find((candidate) => candidate.id === selectedProjectId) ?? projects[0]
    if (!project || createBusy) return
    const requestedBranch = branchName.trim()
    setCreateBusy(true)
    try {
      const session = await window.api.sessions.create({
        projectId: project.id,
        workDir: project.rootPath,
        useWorktree: true,
        repoRoot: project.rootPath,
        worktreeBaseRef: baseRef.trim() || undefined,
        worktreeBranchName: requestedBranch || undefined
      })
      const name = requestedBranch ? `Worktree: ${requestedBranch}` : 'Worktree chat'
      await window.api.projects.addSession(project.id, session.id)
      addSessionToProject(project.id, session.id)
      addSession({ ...session, name })
      setActiveSession(session.id)
      await window.api.sessions.updateName(session.id, name)
      updateSessionName(session.id, name)
      setBranchName('')
      setStatus(`Created ${name}`)
      await refreshWorktrees()
      window.dispatchEvent(new CustomEvent('orchestrator:worktrees-updated'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setCreateBusy(false)
    }
  }

  const openConversation = async (conversationId: string): Promise<void> => {
    const testWindow = window as typeof window & { __orchestratorLastOpenedWorktreeConversationId?: string }
    testWindow.__orchestratorLastOpenedWorktreeConversationId = conversationId
    try {
      const currentSessions = useSessionStore.getState().sessions
      if (!currentSessions.some((session) => session.id === conversationId)) {
        const stored = await window.api.sessions.get(conversationId)
        if (!stored || stored.archivedAt) throw new Error('Linked chat is not available locally')
        addSession(stored)
        addSessionToProject(stored.projectId, stored.id)
      }
      setActiveSession(conversationId)
      setStatus('Opened linked chat')
      setShowSettings(false)
      onClose?.()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not open linked chat')
    }
  }

  return (
    <div data-settings-page-module="worktrees">
      <SettingsPageSection dataTestId="worktrees-settings-section" className="worktrees-settings-page">
        <SettingsContentLayout
          title="Worktrees"
          subtitle="Inspect app-managed worktrees, linked chats, and cleanup state before deleting a workspace."
          dataTestId="settings-content-layout-worktrees"
        >
          <SettingsContentGroup
            className="worktrees-settings-content-group"
            rootAttrs={{
              tabIndex: -1,
              'data-settings-search-anchor': 'worktrees-create'
            }}
          >
            <div className="settings-content-heading">
              <div className="settings-content-title">Create</div>
              <div className="settings-content-description">Create an app-managed worktree chat from a project, base ref, and optional branch name.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="worktrees-settings-surface" dataTestId="worktrees-create-surface">
                <div className="worktrees-create-form">
                  <div className="worktrees-create-fields">
                    <label className="settings-field-stack">
                      <span>Project</span>
                      <select
                        className="settings-select settings-control-fill"
                        value={selectedProjectId}
                        onChange={(event) => setSelectedProjectId(event.target.value)}
                        data-testid="worktrees-create-project"
                      >
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>{project.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-field-stack">
                      <span>Base</span>
                      <input
                        className="settings-input"
                        value={baseRef}
                        onChange={(event) => setBaseRef(event.target.value)}
                        placeholder="HEAD"
                        data-testid="worktrees-create-base"
                      />
                    </label>
                    <label className="settings-field-stack">
                      <span>Branch</span>
                      <input
                        className="settings-input"
                        value={branchName}
                        onChange={(event) => setBranchName(event.target.value)}
                        placeholder="orchestrator/my-work"
                        data-testid="worktrees-create-branch"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="settings-action-button"
                    disabled={!selectedProjectId || createBusy}
                    onClick={() => { void createWorktree() }}
                    data-testid="worktrees-create-submit"
                  >
                    {createBusy ? 'Creating...' : 'Create worktree'}
                  </button>
                </div>
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="worktrees-settings-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Inventory</div>
              <div className="settings-content-description">Worktrees created or tracked by Orchestrator across local providers.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="worktrees-settings-surface" dataTestId="worktrees-inventory-surface">
                <SettingsRow
                  label="Worktrees"
                  description={`${activeCount} ready, ${pendingCount} pending or failed`}
                  control={(
                    <button
                      type="button"
                      className="settings-action-button"
                      data-testid="worktrees-refresh"
                      disabled={refreshBusy}
                      aria-describedby={status ? statusId : undefined}
                      onClick={() => { void refreshWorktrees({ announce: true }) }}
                    >
                      {refreshBusy ? 'Refreshing...' : 'Refresh'}
                    </button>
                  )}
                />
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>

          {groupedWorktrees.length === 0 ? (
            <SettingsContentGroup className="worktrees-settings-content-group">
              <div className="settings-content-heading">
                <div className="settings-content-title">No worktrees yet</div>
                <div className="settings-content-description">Worktrees created from chat actions will appear here.</div>
              </div>
              <SettingsGroupContent>
                <SettingsSurface className="worktrees-settings-surface" dataTestId="worktrees-empty-surface">
                  <div className="worktrees-empty">No app-managed worktrees</div>
                </SettingsSurface>
              </SettingsGroupContent>
            </SettingsContentGroup>
          ) : groupedWorktrees.map((group) => (
            <SettingsContentGroup key={group.repoRoot} className="worktrees-settings-content-group" data-testid="worktrees-repo-group">
              <div className="settings-content-heading">
                <div className="settings-content-title">{group.repoRoot}</div>
                <div className="settings-content-description">{group.items.length} worktree{group.items.length === 1 ? '' : 's'} in this repository.</div>
              </div>
              <SettingsGroupContent>
                <SettingsSurface className="worktrees-settings-surface" dataTestId="worktrees-repo-surface">
                  <div className="worktrees-list">
                    {group.items.map((worktree) => (
                      <WorktreeRow
                        key={worktree.id}
                        worktree={worktree}
                        busy={busyIds[worktree.id] === true}
                        onDeleteRequest={setPendingDeleteWorktree}
                        onOpenConversation={openConversation}
                        onStatus={setStatus}
                      />
                    ))}
                  </div>
                </SettingsSurface>
              </SettingsGroupContent>
            </SettingsContentGroup>
          ))}

          {status && (
            <div
              className="worktrees-status"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              id={statusId}
              data-testid="worktrees-status"
            >
              {status}
            </div>
          )}
        </SettingsContentLayout>
        {pendingDeleteWorktree && (
          <ConfirmDialog
            dataTestId="worktrees-delete-confirm-dialog"
            title="Delete worktree?"
            description={`Linked chats will be archived before removing "${pendingDeleteWorktree.workDir}".`}
            confirmLabel={busyIds[pendingDeleteWorktree.id] ? 'Deleting...' : 'Delete'}
            onCancel={() => setPendingDeleteWorktree(null)}
            onConfirm={() => { void deleteWorktree(pendingDeleteWorktree) }}
          />
        )}
      </SettingsPageSection>
    </div>
  )
}

function WorktreeRow({
  worktree,
  busy,
  onDeleteRequest,
  onOpenConversation,
  onStatus
}: {
  worktree: WorktreeInventoryItem
  busy: boolean
  onDeleteRequest: (worktree: WorktreeInventoryItem) => void
  onOpenConversation: (conversationId: string) => void | Promise<void>
  onStatus: (status: string) => void
}): JSX.Element {
  const conversationsLabelId = useId()
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const setShowTerminal = useSessionStore((state) => state.setShowTerminal)
  const addTerminalTab = useSessionStore((state) => state.addTerminalTab)
  const setActiveTerminalTab = useSessionStore((state) => state.setActiveTerminalTab)
  const terminalSessionId = worktree.conversations[0]?.id ?? activeSessionId

  const copyWorktreePath = async (): Promise<void> => {
    onStatus('Copying worktree path')
    try {
      if (typeof window.api.clipboard?.writeText === 'function') {
        const didWrite = await window.api.clipboard.writeText(worktree.workDir)
        if (!didWrite) throw new Error('Clipboard write failed')
      } else {
        await navigator.clipboard.writeText(worktree.workDir)
      }
      const globals = window as typeof window & { __orchestratorLastWorktreeCopiedPathForSmoke?: string }
      globals.__orchestratorLastWorktreeCopiedPathForSmoke = worktree.workDir
      onStatus('Worktree path copied')
    } catch {
      onStatus('Copy worktree path failed')
    }
  }

  const insertWorktreePathInTerminal = async (): Promise<void> => {
    if (!terminalSessionId) {
      onStatus('No chat available for terminal handoff')
      return
    }
    onStatus('Opening terminal for worktree path')
    try {
      const state = useSessionStore.getState()
      const currentPanel = state.uiState[terminalSessionId]?.terminalPanel
      const existingTab = typeof currentPanel?.activeTabId === 'number'
        ? currentPanel.activeTabId
        : currentPanel?.tabs.find((tab): tab is number => typeof tab === 'number')
      const tabId = existingTab ?? addTerminalTab(terminalSessionId)
      setActiveSession(terminalSessionId)
      setShowTerminal(terminalSessionId, true)
      setActiveTerminalTab(terminalSessionId, tabId)
      const terminalId = `${terminalSessionId}-${tabId}`
      const globals = window as typeof window & {
        __orchestratorLastWorktreeTerminalPathForSmoke?: string
        __orchestratorLastWorktreeTerminalIdForSmoke?: string
      }
      globals.__orchestratorLastWorktreeTerminalPathForSmoke = worktree.workDir
      globals.__orchestratorLastWorktreeTerminalIdForSmoke = terminalId
      await window.api.terminal.spawn(terminalId, worktree.workDir)
      await window.api.terminal.write(terminalId, shellQuote(worktree.workDir))
      onStatus('Worktree path inserted in terminal')
    } catch {
      onStatus('Insert worktree path in terminal failed')
    }
  }

  return (
    <div
      className="worktrees-row"
      role="group"
      aria-label={`${worktreeStateLabel(worktree.state)} worktree at ${worktree.workDir}`}
      data-testid="worktree-settings-row"
      data-worktree-state={worktree.state}
      data-worktree-managed={String(worktree.managed)}
    >
      <div className="worktrees-row-header">
        <div className="worktrees-row-copy">
          <div className="worktrees-row-title">
            <span className="worktrees-state-pill" data-state={worktree.state}>{worktreeStateLabel(worktree.state)}</span>
            <span>Worktree</span>
          </div>
          <code className="worktrees-path">{worktree.workDir}</code>
        </div>
        <div className="worktrees-row-actions">
          <button
            type="button"
            className="settings-action-button"
            aria-label={`Copy worktree path ${worktree.workDir}`}
            onClick={() => { void copyWorktreePath() }}
            data-testid="worktree-copy-path"
          >
            Copy path
          </button>
          <button
            type="button"
            className="settings-action-button"
            disabled={!terminalSessionId}
            aria-label={`Insert worktree path in terminal ${worktree.workDir}`}
            onClick={() => { void insertWorktreePathInTerminal() }}
            data-testid="worktree-insert-terminal"
          >
            Terminal
          </button>
          <button
            type="button"
            className="settings-action-button settings-action-button-danger"
            disabled={!worktree.managed || busy}
            aria-label={`Delete worktree at ${worktree.workDir}`}
            onClick={() => onDeleteRequest(worktree)}
          >
            {busy ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
      <div className="worktrees-conversation-block">
        <div id={conversationsLabelId} className="worktrees-conversation-label">Conversations</div>
        <div className="worktrees-conversation-list" role="list" aria-labelledby={conversationsLabelId}>
          {worktree.conversations.map((conversation) => (
            <div key={conversation.id} className="worktrees-conversation-row" role="listitem" data-testid="worktree-conversation-row">
              <span className="worktrees-conversation-title">{conversation.name}</span>
              <span className="worktrees-conversation-meta">{conversation.provider} · {formatRelativeTime(conversation.updatedAt)}</span>
              <button
                type="button"
                className="settings-action-button worktrees-open-chat-button"
                aria-label={`Open ${conversation.name}`}
                onClick={() => { void onOpenConversation(conversation.id) }}
                data-testid="worktree-open-conversation"
              >
                Open
              </button>
            </div>
          ))}
        </div>
      </div>
      {!worktree.managed && (
        <div className="worktrees-note">This worktree was not created in Orchestrator, so deletion is disabled.</div>
      )}
    </div>
  )
}

function groupByRepo(worktrees: WorktreeInventoryItem[]): Array<{ repoRoot: string; items: WorktreeInventoryItem[] }> {
  const groups = new Map<string, WorktreeInventoryItem[]>()
  for (const worktree of worktrees) {
    const key = worktree.repoRoot ?? 'Unknown repository'
    const current = groups.get(key) ?? []
    current.push(worktree)
    groups.set(key, current)
  }
  return Array.from(groups, ([repoRoot, items]) => ({ repoRoot, items }))
}

function worktreeStateLabel(state: WorktreeInventoryItem['state']): string {
  if (state === 'failed') return 'Failed'
  if (state === 'pending') return 'Pending'
  return 'Ready'
}

function formatRelativeTime(timestamp: number): string {
  const elapsedMs = Math.max(0, Date.now() - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  if (elapsedMs < minute) return 'now'
  if (elapsedMs < hour) return `${Math.max(1, Math.floor(elapsedMs / minute))}m ago`
  if (elapsedMs < day) return `${Math.floor(elapsedMs / hour)}h ago`
  if (elapsedMs < week) return `${Math.floor(elapsedMs / day)}d ago`
  return `${Math.floor(elapsedMs / week)}w ago`
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
