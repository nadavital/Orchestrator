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
        <div data-testid="project-empty-state" className="w-full max-w-[460px]">
          <div
            className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{
              background: 'color-mix(in srgb, var(--accent) 10%, var(--surface-bg))',
              border: '1px solid color-mix(in srgb, var(--accent) 22%, var(--border-subtle))',
              color: 'var(--accent)',
            }}
          >
            <Icon name="folder" size={26} />
          </div>
          <div className="mb-2 text-xl font-semibold tracking-normal" style={{ color: 'var(--color-text)' }}>
            Add a project
          </div>
          <div className="mx-auto mb-6 max-w-[340px] text-sm leading-6">
            Choose a local folder to start a chat in that workspace.
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
