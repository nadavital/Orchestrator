import { useEffect, useState } from 'react'
import type { SessionListItem } from '../../types'
import type { AppProfile } from '../../env'
import { useProjectStore } from '../../store/projects'
import { useSessionStore } from '../../store/sessions'
import {
  ConfirmDialog,
  SettingsContentGroup,
  SettingsContentLayout,
  SettingsGroupContent,
  SettingsPageSection,
  SettingsRow,
  SettingsSurface
} from '../shared/designSystem'

type DataControlsActionStatus = {
  text: string
  tone: 'info' | 'danger'
}

export default function DataControlsSettingsPage(): JSX.Element {
  const [profile, setProfile] = useState<AppProfile | null>(null)
  const [archivedSessions, setArchivedSessions] = useState<SessionListItem[]>([])
  const [archiveStatus, setArchiveStatus] = useState<DataControlsActionStatus | null>(null)
  const [pendingDeleteSession, setPendingDeleteSession] = useState<SessionListItem | null>(null)
  const addSession = useSessionStore((state) => state.addSession)
  const addSessionToProject = useProjectStore((state) => state.addSessionToProject)

  useEffect(() => {
    window.api.app.getProfile().then(setProfile).catch(() => setProfile(null))
    void refreshArchivedSessions()
  }, [])

  const refreshArchivedSessions = async (): Promise<SessionListItem[]> => {
    const archived = await window.api.sessions.listArchivedSummaries()
    setArchivedSessions(archived)
    return archived
  }

  const refreshArchivedSessionsWithStatus = async (): Promise<void> => {
    try {
      const archived = await refreshArchivedSessions()
      setArchiveStatus({
        text: archived.length === 0 ? 'Archived chats refreshed' : `Archived chats refreshed: ${archived.length}`,
        tone: 'info'
      })
    } catch (error) {
      setArchiveStatus({ text: `Refresh failed: ${errorText(error)}`, tone: 'danger' })
    }
  }

  const openDataFolder = async (): Promise<void> => {
    if (!profile?.userDataDir) return
    try {
      await window.api.fs.openPath(profile.userDataDir)
      setArchiveStatus({ text: 'Opened data folder', tone: 'info' })
    } catch (error) {
      setArchiveStatus({ text: `Open data folder failed: ${errorText(error)}`, tone: 'danger' })
    }
  }

  const copyDataPath = async (): Promise<void> => {
    if (!profile?.userDataDir) return
    try {
      await writeClipboardText(profile.userDataDir)
      setArchiveStatus({ text: 'Data path copied', tone: 'info' })
    } catch {
      setArchiveStatus({ text: 'Unable to copy data path', tone: 'danger' })
    }
  }

  const restoreArchivedSession = async (sessionId: string): Promise<void> => {
    try {
      const restored = await window.api.sessions.restoreArchived(sessionId)
      if (!restored) {
        setArchiveStatus({ text: 'Archived chat not found', tone: 'danger' })
        return
      }
      addSession(restored)
      addSessionToProject(restored.projectId, restored.id)
      await refreshArchivedSessions()
      setArchiveStatus({ text: `Restored ${restored.name}`, tone: 'info' })
    } catch (error) {
      setArchiveStatus({ text: `Restore failed: ${errorText(error)}`, tone: 'danger' })
    }
  }

  const deleteArchivedSession = async (session: SessionListItem): Promise<void> => {
    try {
      await window.api.sessions.remove(session.id)
      await refreshArchivedSessions()
      setArchiveStatus({ text: `Deleted ${session.name}`, tone: 'info' })
      setPendingDeleteSession((current) => current?.id === session.id ? null : current)
    } catch (error) {
      setArchiveStatus({ text: `Delete failed: ${errorText(error)}`, tone: 'danger' })
    }
  }

  return (
    <div
      data-settings-page-module="data-controls"
      data-settings-data-controls-action-status={archiveStatus?.text ?? ''}
      data-settings-data-controls-action-status-tone={archiveStatus?.tone ?? ''}
    >
      <SettingsPageSection dataTestId="data-controls-settings-section" className="data-controls-settings-page">
        <SettingsContentLayout
          title="Data controls"
          subtitle="Review where Orchestrator stores local app data and manage archived chats before permanent deletion."
          dataTestId="settings-content-layout-data"
        >
          <SettingsContentGroup className="data-controls-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Local profile</div>
              <div className="settings-content-description">Current Electron profile and user-data directory for this app window.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="data-controls-surface">
                <SettingsRow
                  label="Profile"
                  description="Profile currently backing this window."
                  control={<span className="data-controls-value">{profile?.displayName ?? 'Default'}{profile?.isIsolated ? ' isolated profile' : ' profile'}</span>}
                />
                <SettingsRow
                  label="User data"
                  description="Local app data directory."
                  className="data-controls-path-row"
                  control={(
                    <div className="data-controls-path-control">
                      <code className="data-controls-path">{profile?.userDataDir ?? 'Loading...'}</code>
                      <div className="data-controls-actions">
                        <button
                          type="button"
                          className="settings-action-button"
                          disabled={!profile?.userDataDir}
                          onClick={() => { void openDataFolder() }}
                        >
                          Open data folder
                        </button>
                        <button
                          type="button"
                          className="settings-action-button"
                          disabled={!profile?.userDataDir}
                          onClick={() => { void copyDataPath() }}
                        >
                          Copy path
                        </button>
                      </div>
                    </div>
                  )}
                />
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>

          <SettingsContentGroup className="data-controls-content-group">
            <div className="settings-content-heading">
              <div className="settings-content-title">Archived chats</div>
              <div className="settings-content-description">Chats are archived first so they can be restored or intentionally removed later.</div>
            </div>
            <SettingsGroupContent>
              <SettingsSurface className="data-controls-surface" dataTestId="settings-archived-chat-surface">
                <SettingsRow
                  label="Inventory"
                  description={archivedSessions.length === 0 ? 'No archived chats' : `${archivedSessions.length} archived chat${archivedSessions.length === 1 ? '' : 's'}`}
                  control={(
                    <button type="button" className="settings-action-button" onClick={() => void refreshArchivedSessionsWithStatus()}>
                      Refresh
                    </button>
                  )}
                />
                {archivedSessions.length > 0 && (
                  <div className="data-controls-archived-list" data-testid="settings-archived-chat-list">
                    {archivedSessions.map((session) => (
                      <div key={session.id} className="data-controls-archived-row" data-testid="settings-archived-chat-row">
                        <div className="data-controls-archived-copy">
                          <div className="data-controls-archived-title">{session.name}</div>
                          <div className="data-controls-archived-meta">
                            {session.messageCount} message{session.messageCount === 1 ? '' : 's'} · archived {formatRelativeTime(session.archivedAt ?? session.createdAt)}
                          </div>
                        </div>
                        <div className="data-controls-actions">
                          <button type="button" className="settings-action-button" onClick={() => void restoreArchivedSession(session.id)}>
                            Restore
                          </button>
                          <button
                            type="button"
                            className="settings-action-button settings-action-button-danger"
                            onClick={() => setPendingDeleteSession(session)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {archiveStatus && (
                  <div
                    className="data-controls-status"
                    data-testid="data-controls-action-status"
                    data-data-controls-action-status-tone={archiveStatus.tone}
                    role={archiveStatus.tone === 'danger' ? 'alert' : 'status'}
                    aria-live={archiveStatus.tone === 'danger' ? 'assertive' : 'polite'}
                    aria-atomic="true"
                  >
                    {archiveStatus.text}
                  </div>
                )}
              </SettingsSurface>
            </SettingsGroupContent>
          </SettingsContentGroup>
        </SettingsContentLayout>
        {pendingDeleteSession && (
          <ConfirmDialog
            dataTestId="data-controls-delete-confirm-dialog"
            title="Permanently delete archived chat?"
            description={`"${pendingDeleteSession.name}" will be removed from local data. This cannot be undone.`}
            confirmLabel="Delete"
            onCancel={() => setPendingDeleteSession(null)}
            onConfirm={() => { void deleteArchivedSession(pendingDeleteSession) }}
          />
        )}
      </SettingsPageSection>
    </div>
  )
}

async function writeClipboardText(text: string): Promise<void> {
  if (typeof window.api.clipboard?.writeText === 'function') {
    const didWrite = await window.api.clipboard.writeText(text)
    if (didWrite) return
  }
  await navigator.clipboard.writeText(text)
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
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
