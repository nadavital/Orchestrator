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
        className="flex-1 flex flex-col items-center justify-center gap-5"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <div
          className="flex items-center justify-center"
          style={{
            width: 64,
            height: 64,
            background: 'var(--surface-bg)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-soft)'
          }}
        >
          <Icon name="folder" size={28} />
        </div>
          <div className="text-center">
            <div className="font-semibold text-base mb-1" style={{ color: 'var(--color-text)' }}>
            Open a project
            </div>
          <div className="text-sm mb-5">
            Add a project folder to start chatting with your local code.
          </div>
          <button
            onClick={() => { void handleAddProject() }}
            className="px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-lg)' }}
          >
            Add project folder
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
