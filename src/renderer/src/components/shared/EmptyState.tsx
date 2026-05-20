import { useProjectStore } from '../../store/projects'
import { useSessionStore } from '../../store/sessions'
import { pickAndAddProject } from '../Sidebar/Sidebar'
import { Button } from './designSystem'
import Icon from './Icon'

export default function EmptyState(): JSX.Element {
  const { projects, addProject } = useProjectStore()
  const { addSession, setActiveSession, setShowCapabilities, setShowSettings } = useSessionStore()
  const hasProjects = projects.length > 0

  const handleAddProject = async (): Promise<void> => {
    const project = await pickAndAddProject(addProject)
    if (!project) return
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

  if (!hasProjects) {
    return (
      <div
        className="flex-1 min-w-0 flex items-start justify-center px-8 pb-10 pt-[18vh] text-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <div data-testid="project-empty-state" className="w-full max-w-[460px]">
          <div
            className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl"
            style={{
              background: 'var(--control-bg)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)'
            }}
          >
            <Icon name="folder" size={20} />
          </div>
          <div className="text-[22px] font-semibold leading-7 tracking-normal" style={{ color: 'var(--color-text)' }}>
            Add a project
          </div>
          <div className="mx-auto mb-6 mt-2 max-w-[320px] text-sm leading-6">
            Open a local folder to start a workspace chat.
          </div>
          <Button
            dataTestId="project-empty-state-add"
            variant="primary"
            onClick={() => { void handleAddProject() }}
            className="h-9 px-4 text-sm"
          >
            <Icon name="plus" size={14} />
            Add project
          </Button>
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
