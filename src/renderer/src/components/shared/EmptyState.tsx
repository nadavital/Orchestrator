import { useProjectStore } from '../../store/projects'
import { pickAndAddProject } from '../Sidebar/Sidebar'

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
          <svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--color-accent)' }}>
            <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM4.28 5.22a.75.75 0 0 0-1.06 1.06L5.44 8.5 3.22 10.72a.75.75 0 1 0 1.06 1.06l2.75-2.75a.75.75 0 0 0 0-1.06Zm3.47 5.28a.75.75 0 0 1 0-1.5h3a.75.75 0 0 1 0 1.5Z" />
          </svg>
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
