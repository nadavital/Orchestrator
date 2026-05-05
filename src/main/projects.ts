import Store from 'electron-store'
import type { Project } from '../types'
import { v4 as uuidv4 } from 'uuid'

interface StoreSchema {
  projects: Project[]
}

const store = new Store<StoreSchema>({
  defaults: { projects: [] }
})

export const projectStore = {
  list(): Project[] {
    return store.get('projects', [])
  },

  add(name: string, rootPath: string): Project {
    const project: Project = { id: uuidv4(), name, rootPath, sessionIds: [] }
    const projects = store.get('projects', [])
    projects.push(project)
    store.set('projects', projects)
    return project
  },

  remove(id: string): void {
    const projects = store.get('projects', []).filter((p) => p.id !== id)
    store.set('projects', projects)
  },

  addSession(projectId: string, sessionId: string): void {
    const projects = store.get('projects', [])
    const p = projects.find((p) => p.id === projectId)
    if (p && !p.sessionIds.includes(sessionId)) {
      p.sessionIds.push(sessionId)
      store.set('projects', projects)
    }
  },

  removeSession(projectId: string, sessionId: string): void {
    const projects = store.get('projects', [])
    const p = projects.find((p) => p.id === projectId)
    if (p) {
      p.sessionIds = p.sessionIds.filter((id) => id !== sessionId)
      store.set('projects', projects)
    }
  }
}
