import Store from 'electron-store'
import type { CodexProjectImportResult, Project } from '../types'
import { v4 as uuidv4 } from 'uuid'
import { migrateLegacyUserData } from './userDataMigration'
import { discoverCodexProjectCandidates, normalizeWorkspacePath } from './codexProjectImport'

interface StoreSchema {
  projects: Project[]
}

migrateLegacyUserData()

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

  importCodexProjects(): CodexProjectImportResult {
    const candidates = discoverCodexProjectCandidates()
    const projects = store.get('projects', [])
    const existing = new Set(projects.map((project) => normalizeWorkspacePath(project.rootPath).toLowerCase()))
    const imported: Project[] = []
    let skippedExisting = 0

    for (const candidate of candidates) {
      const key = normalizeWorkspacePath(candidate.rootPath).toLowerCase()
      if (existing.has(key)) {
        skippedExisting += 1
        continue
      }

      const project: Project = {
        id: uuidv4(),
        name: candidate.name,
        rootPath: candidate.rootPath,
        sessionIds: []
      }
      projects.push(project)
      imported.push(project)
      existing.add(key)
    }

    if (imported.length > 0) store.set('projects', projects)
    return { imported, skippedExisting, scanned: candidates.length }
  },

  remove(id: string): void {
    const projects = store.get('projects', []).filter((p) => p.id !== id)
    store.set('projects', projects)
  },

  updateName(id: string, name: string): void {
    const projects = store.get('projects', [])
    const project = projects.find((p) => p.id === id)
    const trimmed = name.trim()
    if (project && trimmed) {
      project.name = trimmed
      store.set('projects', projects)
    }
  },

  updatePinned(id: string, pinned: boolean): void {
    const projects = store.get('projects', [])
    const project = projects.find((p) => p.id === id)
    if (project) {
      project.pinned = pinned
      store.set('projects', projects)
    }
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
