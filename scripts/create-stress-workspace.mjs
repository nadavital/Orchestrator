#!/usr/bin/env node
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const profileName = argValue('--profile') ?? 'stress-workspace'
const projectCount = Number(argValue('--projects') ?? 8)
const sessionsPerProject = Number(argValue('--sessions') ?? 35)
const messagesPerSession = Number(argValue('--messages') ?? 180)
const userDataDir = argValue('--user-data-dir') ?? join(tmpdir(), 'orchestrator-profiles', profileName)
const workspaceRoot = argValue('--workspace-dir') ?? join(tmpdir(), 'orchestrator-stress-workspace')

rmSync(userDataDir, { recursive: true, force: true })
rmSync(workspaceRoot, { recursive: true, force: true })
mkdirSync(userDataDir, { recursive: true })
mkdirSync(workspaceRoot, { recursive: true })

const projects = []
const sessions = []
const baseTime = Date.now() - 1000 * 60 * 60 * 24

for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
  const projectId = randomUUID()
  const projectPath = join(workspaceRoot, `project-${projectIndex + 1}`)
  mkdirSync(projectPath, { recursive: true })
  const projectSessionIds = []

  for (let sessionIndex = 0; sessionIndex < sessionsPerProject; sessionIndex += 1) {
    const sessionId = randomUUID()
    projectSessionIds.push(sessionId)
    const createdAt = baseTime + projectIndex * 100000 + sessionIndex * 1000
    const messages = stressMessages(messagesPerSession, createdAt, projectIndex, sessionIndex)
    sessions.push({
      id: sessionId,
      name: `Stress chat ${projectIndex + 1}.${sessionIndex + 1}`,
      pinned: sessionIndex % 17 === 0,
      projectId,
      workDir: projectPath,
      useWorktree: false,
      repoRoot: projectPath,
      providerSessionId: null,
      status: sessionIndex % 29 === 0 ? 'waiting_for_permission' : 'idle',
      messages,
      createdAt,
      provider: ['claude', 'codex', 'cursor', 'copilot'][sessionIndex % 4],
      model: 'stress-model',
      effort: 'normal',
      agentName: null,
      permissionMode: 'default',
      allowedTools: [],
      disallowedTools: [],
      availableTools: [],
      additionalDirs: [],
      runtime: sessionIndex % 4 === 1 ? 'app-server' : 'headless'
    })
  }

  projects.push({
    id: projectId,
    name: `Stress Project ${projectIndex + 1}`,
    rootPath: projectPath,
    sessionIds: projectSessionIds
  })
}

const configPath = join(userDataDir, 'config.json')
writeFileSync(configPath, JSON.stringify({ projects, sessions }, null, 2))

console.log(JSON.stringify({
  profile: profileName,
  userDataDir,
  workspaceRoot,
  configPath,
  projects: projects.length,
  sessions: sessions.length,
  messages: sessions.reduce((sum, session) => sum + session.messages.length, 0),
  launchEnv: {
    ORCHESTRATOR_PROFILE: profileName,
    ORCHESTRATOR_USER_DATA_DIR: userDataDir,
    ORCHESTRATOR_DISABLE_PET_OVERLAY: '1'
  }
}, null, 2))

function stressMessages(count, createdAt, projectIndex, sessionIndex) {
  const messages = []
  for (let index = 0; index < count; index += 1) {
    const role = index % 2 === 0 ? 'user' : 'assistant'
    const isMarkdown = index % 13 === 0
    messages.push({
      id: `${projectIndex}-${sessionIndex}-${index}`,
      role,
      type: 'text',
      content: isMarkdown
        ? [
            `Stress message ${index} for project ${projectIndex + 1}`,
            '',
            '| Area | Check |',
            '| --- | --- |',
            '| transcript | page rendering |',
            '| markdown | table and code cost |',
            '',
            '```ts',
            `export const fixture${index} = ${index}`,
            '```'
          ].join('\n')
        : `Stress ${role} message ${index}. This is deterministic transcript content for sidebar, search, hydration, and rendering benchmarks.`,
      timestamp: createdAt + index
    })
  }
  return messages
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index >= 0) return process.argv[index + 1]
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return inline ? inline.slice(name.length + 1) : undefined
}
