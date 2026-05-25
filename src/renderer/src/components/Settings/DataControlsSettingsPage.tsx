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

export default function DataControlsSettingsPage(): JSX.Element {
  const [profile, setProfile] = useState<AppProfile | null>(null)
  const [archivedSessions, setArchivedSessions] = useState<SessionListItem[]>([])
  const [archiveStatus, setArchiveStatus] = useState<string | null>(null)
  const [pendingDeleteSession, setPendingDeleteSession] = useState<SessionListItem | null>(null)
  const addSession = useSessionStore((state) => state.addSession)
  const addSessionToProject = useProjectStore((state) => state.addSessionToProject)

  useEffect(() => {
    window.api.app.getProfile().then(setProfile).catch(() => setProfile(null))
    void refreshArchivedSessions()
  }, [])

  const refreshArchivedSessions = async (): Promise<void> => {
    const archived = await window.api.sessions.listArchivedSummaries()
    setArchivedSessions(archived)
  }

  const restoreArchivedSession = async (sessionId: string): Promise<void> => {
    const restored = await window.api.sessions.restoreArchived(sessionId)
    if (!restored) return
    addSession(restored)
    addSessionToProject(restored.projectId, restored.id)
    await refreshArchivedSessions()
    setArchiveStatus(`Restored ${restored.name}`)
  }

  const deleteArchivedSession = async (session: SessionListItem): Promise<void> => {
    await window.api.sessions.remove(session.id)
    await refreshArchivedSessions()
    setArchiveStatus(`Deleted ${session.name}`)
    setPendingDeleteSession((current) => current?.id === session.id ? null : current)
  }

  return (
    <div data-settings-page-module="data-controls">
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
                          onClick={() => { if (profile?.userDataDir) void window.api.fs.openPath(profile.userDataDir) }}
                        >
                          Open data folder
                        </button>
                        <button
                          type="button"
                          className="settings-action-button"
                          disabled={!profile?.userDataDir}
                          onClick={() => { if (profile?.userDataDir) void navigator.clipboard.writeText(profile.userDataDir) }}
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
                    <button type="button" className="settings-action-button" onClick={() => void refreshArchivedSessions()}>
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
                {archiveStatus && <div className="data-controls-status">{archiveStatus}</div>}
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
