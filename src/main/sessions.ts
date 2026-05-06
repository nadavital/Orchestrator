import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import Store from 'electron-store'
import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { Session, ChatMessage, RunEvent, RunRequest, SessionStatus } from '../types'
import { PROVIDER_DEFS } from '../types'
import { gitManager } from './git'
import { getProvider, PROVIDERS, resolveProviderBinary, resolveProviderCommand } from './providers'
import { eventsToMessages } from './runEvents'
import { settingsStore } from './settings'
import { migrateLegacyUserData } from './userDataMigration'

interface SessionStore {
  sessions: Session[]
}

migrateLegacyUserData()

const store = new Store<SessionStore>({ defaults: { sessions: [] } })

const activePtys = new Map<string, IPty>()

function normalizeSession(session: Session): Session {
  return {
    ...session,
    providerSessionId: session.providerSessionId ?? session.claudeSessionId ?? null
  }
}

function send(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}

function requestFromSession(session: Session, prompt: string): RunRequest {
  return {
    prompt,
    cwd: session.workDir,
    model: session.model,
    effort: session.effort,
    providerSessionId: session.providerSessionId ?? session.claudeSessionId ?? null,
    executionPolicy: session.permissionMode ?? 'default',
    allowedTools: session.allowedTools ?? [],
    useThinking: session.useThinking,
    useFast: session.useFast
  }
}

function classifyFailure(content?: string): SessionStatus {
  if (/authentication required|authentication_failed|not logged in|login|api key|apiKeyHelper|unauthorized|keychain|SecItemCopyMatching/i.test(content ?? '')) {
    return 'auth_error'
  }
  if (/model .*unavailable|model unavailable|unknown model|invalid model|no models available/i.test(content ?? '')) {
    return 'model_error'
  }
  return 'provider_error'
}

function isPausedOrFailed(status: SessionStatus): boolean {
  return [
    'waiting_for_permission',
    'waiting_for_user',
    'reconnecting',
    'auth_error',
    'model_error',
    'provider_error',
    'error'
  ].includes(status)
}

export const sessionManager = {
  list(): Session[] {
    return store.get('sessions', []).map(normalizeSession)
  },

  get(id: string): Session | undefined {
    const session = store.get('sessions', []).find((s) => s.id === id)
    return session ? normalizeSession(session) : undefined
  },

  save(session: Session): void {
    const sessions = store.get('sessions', [])
    const idx = sessions.findIndex((s) => s.id === session.id)
    if (idx >= 0) sessions[idx] = session
    else sessions.push(session)
    store.set('sessions', sessions)
  },

  updateStatus(id: string, status: SessionStatus): void {
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (s) {
      s.status = status
      store.set('sessions', sessions)
      send('session:status', { id, status })
    }
  },

  appendMessage(id: string, messages: ChatMessage[]): void {
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (s) {
      s.messages.push(...messages)
      store.set('sessions', sessions)
      send('session:messages', { id, messages })
    }
  },

  async create(opts: {
    projectId: string
    workDir: string
    useWorktree: boolean
    repoRoot?: string
  }): Promise<Session> {
    const id = uuidv4()
    let workDir = opts.workDir

    if (opts.useWorktree && opts.repoRoot) {
      workDir = await gitManager.createWorktree(opts.repoRoot, id)
    }

    const defaultProvider = settingsStore.get('defaultProvider', 'claude') as string
    const providerDef = PROVIDER_DEFS[defaultProvider] ?? PROVIDER_DEFS.claude
    const storedModels = settingsStore.get('defaultModels', {}) as Record<string, string>
    const storedEfforts = settingsStore.get('defaultEfforts', {}) as Record<string, string>
    const defaultModel = storedModels[providerDef.id] ?? providerDef.models[0]?.id ?? ''
    const defaultEffort = storedEfforts[providerDef.id] ?? providerDef.effortLevels[0]?.id ?? 'normal'

    const session: Session = {
      id,
      name: 'New Chat',
      projectId: opts.projectId,
      workDir,
      useWorktree: opts.useWorktree,
      repoRoot: opts.repoRoot,
      providerSessionId: null,
      status: 'idle',
      messages: [],
      createdAt: Date.now(),
      provider: defaultProvider,
      model: defaultModel,
      effort: defaultEffort,
      permissionMode: 'default',
      allowedTools: []
    }

    this.save(session)
    send('session:created', session)
    return session
  },

  updateName(id: string, name: string): void {
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (s) {
      s.name = name
      store.set('sessions', sessions)
      send('session:renamed', { id, name })
    }
  },

  async sendMessage(sessionId: string, prompt: string, useWorktree?: boolean): Promise<void> {
    const session = this.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    if (activePtys.has(sessionId)) return

    // Lazy worktree creation on first message if requested
    if (useWorktree !== undefined && session.messages.length === 0) {
      const sessions = store.get('sessions', [])
      const s = sessions.find((s) => s.id === sessionId)
      if (s) {
        if (useWorktree && s.repoRoot) {
          const worktreePath = await gitManager.createWorktree(s.repoRoot, sessionId)
          s.workDir = worktreePath
          s.useWorktree = true
        } else {
          s.useWorktree = false
        }
        store.set('sessions', sessions)
        send('session:updated', { id: sessionId, workDir: s.workDir, useWorktree: s.useWorktree })
      }
    }

    // Auto-name session from first user message (uniform across all providers)
    const freshSession = this.get(sessionId)
    if (freshSession && freshSession.messages.filter((m) => m.role === 'user').length === 0) {
      const collapsed = prompt.replace(/\s+/g, ' ').trim()
      const autoName = collapsed.length > 60 ? collapsed.slice(0, 60) + '…' : collapsed
      this.updateName(sessionId, autoName)
    }

    this.updateStatus(sessionId, 'running')

    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      type: 'text',
      content: prompt,
      timestamp: Date.now()
    }
    this.appendMessage(sessionId, [userMsg])

    const currentSession = this.get(sessionId)!
    const provider = getProvider(currentSession.provider ?? 'claude')
    const runRequest = requestFromSession(currentSession, prompt)
    const command = resolveProviderCommand(provider, provider.buildStartCommand(runRequest))
    if (!command) {
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: `${provider.id} CLI is not available. Check provider settings or install ${provider.binary}.`,
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'error')
      return
    }
    const pty = spawn(command.binary, command.args, {
      name: 'xterm-color',
      cwd: currentSession.workDir,
      env: { ...process.env, TERM: 'xterm-256color' },
      cols: 220,
      rows: 50
    })

    activePtys.set(sessionId, pty)

    let buffer = ''

    pty.onData((data) => {
      send('session:raw', { id: sessionId, data })

      if (/\[y\/n\]/i.test(data) || /\[yes\/no\]/i.test(data)) {
        this.updateStatus(sessionId, 'waiting_for_user')
        send('session:needsInput', { id: sessionId })
      }

      buffer += data
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) this.applyRunEvents(sessionId, provider.parseOutputLine(line))
    })

    pty.onExit(() => {
      activePtys.delete(sessionId)
      if (!isPausedOrFailed(this.get(sessionId)?.status ?? 'idle')) {
        this.updateStatus(sessionId, 'idle')
      }
    })
  },

  applyRunEvents(sessionId: string, events: RunEvent[]): void {
    if (events.length === 0) return

    send('session:events', {
      id: sessionId,
      events: events.map((event) => ({
        id: uuidv4(),
        timestamp: Date.now(),
        event
      }))
    })

    const sessionStarted = events.find((event) => event.type === 'session.started')
    if (sessionStarted?.type === 'session.started') {
      const sessions = store.get('sessions', [])
      const s = sessions.find((s) => s.id === sessionId)
      if (s) {
        s.providerSessionId = sessionStarted.providerSessionId
        s.claudeSessionId = sessionStarted.providerSessionId
        store.set('sessions', sessions)
      }
    }

    const currentSession = this.get(sessionId)
    const repeatedReconnect = events.find((event) =>
      (event.type === 'connection.reconnecting' || event.type === 'connection.retrying') &&
      typeof event.attempt === 'number' &&
      event.attempt >= 2
    )
    if (currentSession?.provider === 'cursor' && repeatedReconnect) {
      const pty = activePtys.get(sessionId)
      if (pty) {
        pty.kill()
        activePtys.delete(sessionId)
      }
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: 'Cursor Agent is reconnecting repeatedly. The run was stopped before it could hang. Try Cursor again after the CLI transport recovers.',
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'provider_error')
      return
    }

    if (events.some((event) => event.type === 'permission.requested')) {
      this.updateStatus(sessionId, 'waiting_for_permission')
    } else if (events.some((event) => event.type === 'user_input.requested')) {
      const pty = activePtys.get(sessionId)
      if (pty) {
        pty.kill()
        activePtys.delete(sessionId)
      }
      this.updateStatus(sessionId, 'waiting_for_user')
    } else if (events.some((event) => event.type === 'connection.reconnecting' || event.type === 'connection.retrying')) {
      this.updateStatus(sessionId, 'reconnecting')
    } else {
      const failed = [...events].reverse().find((event) => event.type === 'run.failed')
      const completed = [...events].reverse().find((event) => event.type === 'run.completed')
      if (failed?.type === 'run.failed') {
        if (currentSession?.status === 'waiting_for_user') return
        const pty = activePtys.get(sessionId)
        if (pty) {
          pty.kill()
          activePtys.delete(sessionId)
        }
        this.updateStatus(sessionId, classifyFailure(failed.content))
      } else if (completed?.type === 'run.completed') {
        this.updateStatus(sessionId, 'idle')
      }
    }

    const messages = eventsToMessages(events)
    if (messages.length > 0) this.appendMessage(sessionId, messages)
  },

  updateSettings(id: string, patch: { provider?: string; model?: string; effort?: string; permissionMode?: string; useThinking?: boolean; useFast?: boolean }): void {
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === id)
    if (s) {
      Object.assign(s, patch)
      store.set('sessions', sessions)
      send('session:settingsUpdated', { id, ...patch })
    }
  },

  stop(sessionId: string): void {
    const pty = activePtys.get(sessionId)
    if (pty) {
      pty.kill()
      activePtys.delete(sessionId)
      this.updateStatus(sessionId, 'idle')
    }
  },

  async grantAndResume(sessionId: string, toolNames: string[]): Promise<void> {
    const session = this.get(sessionId)
    if (!session || !session.providerSessionId) return
    if (activePtys.has(sessionId)) return

    // Persist newly granted tools on the session
    const sessions = store.get('sessions', [])
    const s = sessions.find((s) => s.id === sessionId)
    if (s) {
      s.allowedTools = [...new Set([...(s.allowedTools ?? []), ...toolNames])]
      store.set('sessions', sessions)
    }

    this.updateStatus(sessionId, 'running')

    // Re-read session so the run request picks up updated allowedTools
    const currentSession = this.get(sessionId)!
    const resumeProvider = getProvider(currentSession.provider ?? 'claude')
    const runRequest = requestFromSession(currentSession, 'Permission granted. Please continue.')
    const command = resolveProviderCommand(resumeProvider, resumeProvider.buildResumeCommand(runRequest))
    if (!command) {
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: `${resumeProvider.id} CLI is not available. Check provider settings or install ${resumeProvider.binary}.`,
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'error')
      return
    }

    const pty = spawn(command.binary, command.args, {
      name: 'xterm-color',
      cwd: currentSession.workDir,
      env: { ...process.env, TERM: 'xterm-256color' },
      cols: 220,
      rows: 50
    })

    activePtys.set(sessionId, pty)
    let buffer = ''

    pty.onData((data) => {
      send('session:raw', { id: sessionId, data })
      buffer += data
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) this.applyRunEvents(sessionId, resumeProvider.parseOutputLine(line))
    })

    pty.onExit(() => {
      activePtys.delete(sessionId)
      if (!isPausedOrFailed(this.get(sessionId)?.status ?? 'idle')) {
        this.updateStatus(sessionId, 'idle')
      }
    })
  },

  async answerUserInput(sessionId: string, answer: string): Promise<void> {
    const session = this.get(sessionId)
    if (!session) return
    const trimmed = answer.trim()
    if (!trimmed) return

    const active = activePtys.get(sessionId)
    if (active) {
      active.write(`${trimmed}\n`)
      this.updateStatus(sessionId, 'running')
      return
    }

    if (!session.providerSessionId) return

    this.appendMessage(sessionId, [{
      id: uuidv4(),
      role: 'user',
      type: 'text',
      content: trimmed,
      timestamp: Date.now()
    }])
    this.updateStatus(sessionId, 'running')

    const currentSession = this.get(sessionId)!
    const resumeProvider = getProvider(currentSession.provider ?? 'claude')
    const runRequest = requestFromSession(
      currentSession,
      `User answered the pending question:\n\n${trimmed}\n\nPlease continue from where you stopped.`
    )
    const command = resolveProviderCommand(resumeProvider, resumeProvider.buildResumeCommand(runRequest))
    if (!command) {
      this.appendMessage(sessionId, [{
        id: uuidv4(),
        role: 'system',
        type: 'result',
        content: `${resumeProvider.id} CLI is not available. Check provider settings or install ${resumeProvider.binary}.`,
        subtype: 'error_during_execution',
        timestamp: Date.now()
      }])
      this.updateStatus(sessionId, 'error')
      return
    }

    const pty = spawn(command.binary, command.args, {
      name: 'xterm-color',
      cwd: currentSession.workDir,
      env: { ...process.env, TERM: 'xterm-256color' },
      cols: 220,
      rows: 50
    })

    activePtys.set(sessionId, pty)
    let buffer = ''

    pty.onData((data) => {
      send('session:raw', { id: sessionId, data })
      buffer += data
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) this.applyRunEvents(sessionId, resumeProvider.parseOutputLine(line))
    })

    pty.onExit(() => {
      activePtys.delete(sessionId)
      if (!isPausedOrFailed(this.get(sessionId)?.status ?? 'idle')) {
        this.updateStatus(sessionId, 'idle')
      }
    })
  },

  denyPermission(sessionId: string): void {
    this.appendMessage(sessionId, [{
      id: uuidv4(),
      role: 'system',
      type: 'result',
      content: 'Permission denied by user.',
      subtype: 'permission_denied',
      timestamp: Date.now()
    }])
    this.updateStatus(sessionId, 'idle')
  },

  checkProviders(): Record<string, boolean> {
    const result: Record<string, boolean> = {}
    for (const provider of Object.values(PROVIDERS)) {
      result[provider.id] = resolveProviderBinary(provider) !== null
    }
    return result
  },

  writeToPty(sessionId: string, data: string): void {
    activePtys.get(sessionId)?.write(data)
  },

  async remove(sessionId: string): Promise<void> {
    this.stop(sessionId)
    const session = this.get(sessionId)
    if (session?.useWorktree && session.repoRoot && session.workDir) {
      try {
        await gitManager.removeWorktree(session.repoRoot, session.workDir)
      } catch {
        /* ignore cleanup errors */
      }
    }
    const sessions = store.get('sessions', []).filter((s) => s.id !== sessionId)
    store.set('sessions', sessions)
  },

  async getDiff(sessionId: string): Promise<string> {
    const session = this.get(sessionId)
    if (!session) return ''
    return gitManager.getDiff(session.workDir)
  }
}
