import { useState } from 'react'
import { useProjectStore } from '../../store/projects'
import { useSessionStore } from '../../store/sessions'
import { pickAndAddProject } from '../Sidebar/Sidebar'
import { Button } from './designSystem'
import Icon from './Icon'

export default function EmptyState(): JSX.Element {
  const { projects, addProject } = useProjectStore()
  const { addSession, setActiveSession, setShowCapabilities, setShowSettings } = useSessionStore()
  const [isImporting, setIsImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const hasProjects = projects.length > 0

  const handleAddProject = async (): Promise<void> => {
    const project = await pickAndAddProject(addProject)
    if (!project) return
    await openProjectSession(project)
  }

  const openProjectSession = async (project: { id: string; rootPath: string }): Promise<void> => {
    const session = await window.api.sessions.create({
      projectId: project.id,
      workDir: project.rootPath,
      useWorktree: false,
      repoRoot: project.rootPath
    })
    await window.api.projects.addSession(project.id, session.id)
    addSession(session)
    setActiveSession(session.id)
    setShowCapabilities(false)
    setShowSettings(false)
  }

  const handleImportCodexProjects = async (): Promise<void> => {
    if (isImporting) return
    setIsImporting(true)
    setImportMessage(null)
    try {
      const result = await window.api.projects.importCodex()
      result.imported.forEach(addProject)
      if (result.imported[0]) {
        await openProjectSession(result.imported[0])
        return
      }
      setImportMessage(result.scanned > 0 ? 'Recent Codex projects are already here.' : 'No recent Codex projects found.')
    } catch {
      setImportMessage('Could not import Codex projects.')
    } finally {
      setIsImporting(false)
    }
  }

  if (!hasProjects) {
    return (
      <div
        className="flex-1 min-w-0 flex items-start justify-center px-8 pb-10 pt-[20vh] text-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <div data-testid="project-empty-state" className="w-full max-w-[360px]">
          <div
            className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-lg"
            style={{
              background: 'var(--control-bg)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)'
            }}
          >
            <Icon name="folder" size={17} />
          </div>
          <div className="text-[18px] font-semibold leading-6 tracking-normal" style={{ color: 'var(--color-text)' }}>
            Open a project
          </div>
          <div className="mx-auto mb-4 mt-1.5 max-w-[360px] text-[13px] leading-5">
            Choose a local folder to start chatting in that workspace.
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              dataTestId="project-empty-state-add"
              onClick={() => { void handleAddProject() }}
              className="h-8 px-3 text-xs"
            >
              <Icon name="plus" size={14} />
              Open folder
            </Button>
            <Button
              dataTestId="project-empty-state-import-codex"
              onClick={() => { void handleImportCodexProjects() }}
              disabled={isImporting}
              variant="ghost"
              className="h-8 px-2.5 text-xs"
            >
              <Icon name="sparkles" size={14} />
              {isImporting ? 'Importing' : 'Import Codex'}
            </Button>
          </div>
          {importMessage && (
            <div className="mt-3 text-[12px] leading-4" style={{ color: 'var(--text-tertiary)' }}>
              {importMessage}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-2"
      style={{ color: 'var(--color-text-muted)' }}
    >
      <div className="text-sm">Select a session or create a new one.</div>
    </div>
  )
}
