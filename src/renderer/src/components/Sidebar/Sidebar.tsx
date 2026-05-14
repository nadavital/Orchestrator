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
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)'
      }}
    >
      <div
        className="shrink-0"
        style={{ height: 64, WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Project list */}
      <div className="flex items-center justify-between px-4 pb-1">
        <span className="text-sm" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
          Projects
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
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--control-bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Icon name="plus" size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-1">
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
        className="shrink-0 px-2.5 py-2.5"
      >
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-3 w-full text-sm transition-colors"
          style={{
            color: 'var(--text-secondary)',
            background: 'transparent',
            borderRadius: 'var(--radius-lg)',
            padding: '8px 10px'
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
