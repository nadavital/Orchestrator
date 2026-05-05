import { create } from 'zustand'
import type { Project } from '../types'

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (id: string) => void
  setActiveProject: (id: string | null) => void
  addSessionToProject: (projectId: string, sessionId: string) => void
  removeSessionFromProject: (projectId: string, sessionId: string) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  activeProjectId: null,
  setProjects: (projects) => set({ projects }),
  addProject: (project) => set((s) => ({ projects: [...s.projects, project] })),
  removeProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
  setActiveProject: (id) => set({ activeProjectId: id }),
  addSessionToProject: (projectId, sessionId) =>
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId && !p.sessionIds.includes(sessionId)
          ? { ...p, sessionIds: [...p.sessionIds, sessionId] }
          : p
      )
    })),
  removeSessionFromProject: (projectId, sessionId) =>
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? { ...p, sessionIds: p.sessionIds.filter((id) => id !== sessionId) }
          : p
      )
    }))
}))
