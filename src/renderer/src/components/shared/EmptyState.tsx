import { useProjectStore } from '../../store/projects'
import { useSessionStore } from '../../store/sessions'
import { pickAndAddProject } from '../Sidebar/Sidebar'
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
        data-testid="project-empty-state"
        className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <Icon name="folder" size={30} />
        <div>
          <div className="mb-1 text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            No projects
          </div>
          <div className="mb-5 text-sm">
            Choose a local folder to start.
          </div>
          <button
            onClick={() => { void handleAddProject() }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-md)' }}
          >
            <Icon name="plus" size={14} />
            Add project
          </button>
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
