import { useProjectStore } from '../../store/projects'
import { pickAndAddProject } from '../Sidebar/Sidebar'
import Icon from './Icon'

export default function EmptyState(): JSX.Element {
  const { projects, addProject } = useProjectStore()
  const hasProjects = projects.length > 0

  const handleAddProject = (): void => {
    pickAndAddProject(addProject)
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
          <Icon name="terminal" size={28} />
        </div>
          <div className="text-center">
            <div className="font-semibold text-sm mb-1" style={{ color: 'var(--color-text)' }}>
            Orchestrator
            </div>
          <div className="text-sm mb-5">
            Add a project folder to get started.
          </div>
          <button
            onClick={handleAddProject}
            className="px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-lg)' }}
          >
            Add Project
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
