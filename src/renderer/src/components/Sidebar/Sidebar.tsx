import type { Project } from '../../types'
import { useProjectStore } from '../../store/projects'
import { useSessionStore } from '../../store/sessions'
import ProjectSection from './ProjectSection'

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
        width: 240,
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)'
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
          Projects
        </span>
        <button
          onClick={handleAddProject}
          className="rounded p-0.5 transition-colors"
          style={{ color: 'var(--color-text-muted)' }}
          title="Add project"
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
          </svg>
        </button>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-1">
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
        className="shrink-0 px-3 py-2"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-xs transition-colors"
          style={{ color: 'var(--color-text-muted)', background: 'transparent' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--color-surface2)'
            e.currentTarget.style.color = 'var(--color-text)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-muted)'
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.533.01 7.766 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z" />
          </svg>
          Settings
        </button>
      </div>
    </aside>
  )
}
