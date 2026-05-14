import type { Project } from '../../types'
import { useProjectStore } from '../../store/projects'
import { useSessionStore } from '../../store/sessions'
import ProjectSection from './ProjectSection'
import Icon from '../shared/Icon'

export async function pickAndAddProject(addProject: (p: Project) => void): Promise<void> {
  const dir = await window.api.dialog.openDirectory()
  if (!dir) return
  const name = dir.split('/').pop() ?? dir
  const project = await window.api.projects.add(name, dir)
  addProject(project)
}

export default function Sidebar(): JSX.Element {
  const { projects, addProject } = useProjectStore()
  const { sessions, setShowSettings } = useSessionStore()

  const handleAddProject = (): void => {
    pickAndAddProject(addProject)
  }

  return (
    <aside
      className="flex flex-col overflow-hidden shrink-0"
      style={{
        width: 282,
        background: 'var(--panel-bg)',
        borderRight: '1px solid var(--border-subtle)',
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)'
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 shrink-0"
        style={{ height: 48 }}
      >
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Orchestrator
        </span>
        <button
          onClick={handleAddProject}
          className="grid place-items-center transition-colors"
          style={{
            width: 30,
            height: 30,
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-secondary)',
            background: 'transparent'
          }}
          title="Add project"
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
        >
          <Icon name="plus" size={15} />
        </button>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {projects.map((project) => {
          const projectSessions = sessions.filter((s) => s.projectId === project.id)
          return (
            <ProjectSection
              key={project.id}
              project={project}
              sessions={projectSessions}
            />
          )
        })}
      </div>

      {/* Footer */}
      <div
        className="shrink-0 px-3 py-3"
      >
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-3 w-full text-sm transition-colors"
          style={{
            color: 'var(--text-secondary)',
            background: 'transparent',
            borderRadius: 'var(--radius-lg)',
            padding: '10px 12px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--control-bg-hover)'
            e.currentTarget.style.color = 'var(--text-primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
        >
          <Icon name="settings" size={17} />
          Settings
        </button>
      </div>
    </aside>
  )
}
