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
        className="flex-1 min-w-0 flex items-center justify-center px-8 py-10 text-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <div data-testid="project-empty-state" className="w-full max-w-[420px] py-8">
          <div className="mb-3 flex items-center justify-center gap-2">
            <Icon name="folder" size={18} />
            <div className="text-xl font-semibold tracking-normal" style={{ color: 'var(--color-text)' }}>
              Add a project
            </div>
          </div>
          <div className="mx-auto mb-6 max-w-[300px] text-sm leading-6">
            Open a local folder to start a workspace chat.
          </div>
          <Button
            dataTestId="project-empty-state-add"
            variant="primary"
            onClick={() => { void handleAddProject() }}
            className="px-4 py-2 text-sm"
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
