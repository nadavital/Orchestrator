import type { IpcMain } from 'electron'
import { dialog, app, shell, session } from 'electron'
import { execFile } from 'child_process'
import { request as httpRequest } from 'http'
import { closeSync, openSync, readFileSync, readSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, extname, join } from 'path'
import type { Attachment, CapabilityCreateRequest, CapabilityDeleteRequest, CapabilitySyncRequest, CapabilityUpdateRequest, PerformanceMetric, TranscriptPageRequest } from '../types'
import { projectStore } from './projects'
import { sessionManager } from './sessions'
import { gitManager } from './git'
import { settingsStore } from './settings'
import { terminalManager } from './terminal'
import { petOverlayManager } from './petOverlay'
import { getAppProfile } from './appProfile'
import { getProviderDiagnosticsAsync, getProviderRuntimeInfo, runProviderCommandSurfaceAsync } from './providers'
import { resolveWorkspaceFileReference } from './workspaceResolver'
import { discoverClaudeExtensions } from './claudeExtensions'
import { listProviderResources } from './providerResources'
import { createCapability } from './capabilityCreator'
import { deleteCapability, updateCapability } from './capabilityManager'
import { applyCapabilitySync, previewCapabilitySync } from './capabilitySync'
import { performanceSnapshot, recordPerformanceMetric, resetPerformanceMetrics } from './performanceTelemetry'
import { providerManifests } from './providerManifest'

type PreferredEditor = 'system' | 'vscode' | 'vscode-insiders' | 'cursor' | 'zed'
type FilePreviewResult =
  | { kind: 'text'; size: number; text: string; truncated: boolean }
  | { kind: 'markdown'; size: number; text: string; truncated: boolean }
  | { kind: 'image' | 'pdf' | 'html' | 'audio' | 'video' | 'binary'; size: number; truncated: boolean }
  | { kind: 'missing' | 'unreadable'; size?: number; truncated: false }

interface BrowserAssetRequest {
  inventoryId: string
  pageUrl?: string | null
  assets: Array<{
    id: string
    kind: string
    name: string
    url: string
  }>
}

interface BrowserLocalTarget {
  url: string
  title: string | null
  source: 'port-scan' | 'recent'
}

interface PastedAttachmentRequest {
  name?: string
  mimeType?: string
  bytes: ArrayBuffer | Uint8Array
}

const FILE_PREVIEW_LIMIT = 80_000
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx'])
const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.aiff', '.m4a', '.aac', '.flac', '.ogg'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm'])
const BINARY_EXTENSIONS = new Set([
  '.bin', '.exe', '.dmg', '.zip', '.gz', '.tgz', '.br', '.7z', '.woff', '.woff2', '.ttf', '.otf', '.ico', '.icns', '.wasm', '.sqlite',
  '.db', '.jar', '.class', '.so', '.dylib'
])

const BROWSER_ARTIFACT_DIR = 'orchestrator-browser-artifacts'
const COMPOSER_ATTACHMENT_DIR = 'orchestrator-composer-attachments'
const BROWSER_LOCAL_TARGET_PORTS = [
  3000, 3001, 3020, 4000, 4010, 5000, 5010, 5173, 5174, 6006, 7000, 8000, 8080, 8888, 9000
]
const MIME_EXTENSIONS: Record<string, string> = {
  'application/json': '.json',
  'application/pdf': '.pdf',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'text/csv': '.csv',
  'text/html': '.html',
  'text/markdown': '.md',
  'text/plain': '.txt'
}

const EDITOR_APPS: Record<Exclude<PreferredEditor, 'system'>, { label: string; macAppName: string }> = {
  vscode: { label: 'VS Code', macAppName: 'Visual Studio Code' },
  'vscode-insiders': { label: 'VS Code Insiders', macAppName: 'Visual Studio Code - Insiders' },
  cursor: { label: 'Cursor', macAppName: 'Cursor' },
  zed: { label: 'Zed', macAppName: 'Zed' }
}

function normalizePreferredEditor(value: unknown): PreferredEditor {
  return value === 'vscode' || value === 'vscode-insiders' || value === 'cursor' || value === 'zed'
    ? value
    : 'system'
}

function previewFile(filePath: string): FilePreviewResult {
  try {
    if (!existsSync(filePath)) return { kind: 'missing', truncated: false }
    const stat = statSync(filePath)
    if (!stat.isFile()) return { kind: 'unreadable', size: stat.size, truncated: false }
    const size = stat.size
    const extension = extname(filePath).toLowerCase()
    if (IMAGE_EXTENSIONS.has(extension)) return { kind: 'image', size, truncated: false }
    if (extension === '.pdf') return { kind: 'pdf', size, truncated: false }
    if (HTML_EXTENSIONS.has(extension)) return { kind: 'html', size, truncated: false }
    if (AUDIO_EXTENSIONS.has(extension)) return { kind: 'audio', size, truncated: false }
    if (VIDEO_EXTENSIONS.has(extension)) return { kind: 'video', size, truncated: false }
    if (BINARY_EXTENSIONS.has(extension)) return { kind: 'binary', size, truncated: false }

    const byteCount = Math.min(size, FILE_PREVIEW_LIMIT)
    const buffer = Buffer.alloc(byteCount)
    const fd = openSync(filePath, 'r')
    try {
      readSync(fd, buffer, 0, byteCount, 0)
    } finally {
      closeSync(fd)
    }
    if (looksBinary(buffer)) return { kind: 'binary', size, truncated: false }
    const text = buffer.toString('utf8')
    if (MARKDOWN_EXTENSIONS.has(extension)) {
      return {
        kind: 'markdown',
        size,
        text,
        truncated: size > FILE_PREVIEW_LIMIT
      }
    }
    return {
      kind: 'text',
      size,
      text,
      truncated: size > FILE_PREVIEW_LIMIT
    }
  } catch {
    return { kind: 'unreadable', truncated: false }
  }
}

function writeBrowserDataUrlArtifact(dataUrl: string, suggestedName?: string): { path: string; size: number } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) throw new Error('Invalid browser artifact data URL')
  const isBase64 = match[2] === ';base64'
  const payload = match[3] ?? ''
  const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
  const dir = join(tmpdir(), BROWSER_ARTIFACT_DIR)
  mkdirSync(dir, { recursive: true })
  const safeName = sanitizeArtifactName(suggestedName || `browser-screenshot-${Date.now()}.png`)
  const filePath = join(dir, uniqueArtifactName(dir, safeName))
  writeFileSync(filePath, buffer)
  return { path: filePath, size: buffer.byteLength }
}

function writePastedAttachment(request: PastedAttachmentRequest): { path: string; name: string; size: number; mimeType?: string } {
  const buffer = request.bytes instanceof ArrayBuffer
    ? Buffer.from(request.bytes)
    : Buffer.from(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength)
  const dir = join(tmpdir(), COMPOSER_ATTACHMENT_DIR)
  mkdirSync(dir, { recursive: true })
  const name = clipboardAttachmentName(request.name, request.mimeType)
  const filePath = join(dir, uniqueArtifactName(dir, name))
  writeFileSync(filePath, buffer)
  return {
    path: filePath,
    name: basename(filePath),
    size: buffer.byteLength,
    mimeType: request.mimeType || undefined
  }
}

async function bundleBrowserAssets(request: BrowserAssetRequest): Promise<{
  directoryPath: string
  manifestPath: string
  assets: Array<{ id: string; kind: string; name: string; url: string; path: string; contentType: string | null }>
  failures: Array<{ id: string; kind: string; name: string; url: string; reason: string }>
  summary: { requestedCount: number; downloadedCount: number; failedCount: number }
}> {
  const dir = join(tmpdir(), BROWSER_ARTIFACT_DIR, sanitizeArtifactName(request.inventoryId || `inventory-${Date.now()}`))
  mkdirSync(dir, { recursive: true })
  const downloaded: Array<{ id: string; kind: string; name: string; url: string; path: string; contentType: string | null }> = []
  const failures: Array<{ id: string; kind: string; name: string; url: string; reason: string }> = []

  for (const asset of request.assets.slice(0, 80)) {
    try {
      if (!/^https?:/i.test(asset.url) && !/^data:/i.test(asset.url)) {
        throw new Error('Only http, https, and data URLs can be bundled')
      }
      const safeName = uniqueArtifactName(dir, sanitizeArtifactName(asset.name || `${asset.kind}-${asset.id}`))
      const filePath = join(dir, safeName)
      let contentType: string | null = null
      let buffer: Buffer
      if (/^data:/i.test(asset.url)) {
        const saved = writeBrowserDataUrlArtifact(asset.url, safeName)
        buffer = Buffer.from(readFileSync(saved.path))
        contentType = /^data:([^;,]+)/i.exec(asset.url)?.[1] ?? null
      } else {
        const response = await fetch(asset.url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        contentType = response.headers.get('content-type')
        buffer = Buffer.from(await response.arrayBuffer())
      }
      writeFileSync(filePath, buffer)
      downloaded.push({ ...asset, path: filePath, contentType })
    } catch (error) {
      failures.push({ ...asset, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify({
    pageUrl: request.pageUrl ?? null,
    inventoryId: request.inventoryId,
    assets: downloaded,
    failures,
    summary: {
      requestedCount: request.assets.length,
      downloadedCount: downloaded.length,
      failedCount: failures.length
    }
  }, null, 2))

  return {
    directoryPath: dir,
    manifestPath,
    assets: downloaded,
    failures,
    summary: {
      requestedCount: request.assets.length,
      downloadedCount: downloaded.length,
      failedCount: failures.length
    }
  }
}

async function discoverBrowserLocalTargets(recentUrls: string[] = []): Promise<BrowserLocalTarget[]> {
  const candidates = new Map<string, BrowserLocalTarget['source']>()
  for (const port of BROWSER_LOCAL_TARGET_PORTS) {
    candidates.set(`http://127.0.0.1:${port}/`, 'port-scan')
  }
  const smokeUrl = normalizeLocalBrowserUrl(process.env.ORCHESTRATOR_BROWSER_SMOKE_URL)
  if (smokeUrl) candidates.set(smokeUrl, 'recent')
  for (const url of recentUrls.slice(0, 12)) {
    const normalized = normalizeLocalBrowserUrl(url)
    if (normalized) candidates.set(normalized, 'recent')
  }

  const targets = await Promise.all(
    [...candidates.entries()].slice(0, 28).map(([url, source]) => probeBrowserLocalTarget(url, source))
  )
  const seen = new Set<string>()
  return targets
    .filter((target): target is BrowserLocalTarget => Boolean(target))
    .filter((target) => {
      const key = target.url.replace(/\/+$/, '')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 6)
}

function normalizeLocalBrowserUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const parsed = new URL(raw.trim())
    if (parsed.protocol !== 'http:') return null
    if (!['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(parsed.hostname)) return null
    parsed.hostname = '127.0.0.1'
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

function probeBrowserLocalTarget(url: string, source: BrowserLocalTarget['source']): Promise<BrowserLocalTarget | null> {
  return new Promise((resolve) => {
    const request = httpRequest(url, {
      method: 'GET',
      timeout: 700,
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.1',
        'User-Agent': 'Orchestrator local browser discovery'
      }
    }, (response) => {
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer) => {
        if (length >= 16_384) return
        const next = chunk.subarray(0, Math.max(0, 16_384 - length))
        chunks.push(next)
        length += next.byteLength
      })
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        const title = /<title[^>]*>([^<]+)<\/title>/i.exec(body)?.[1]?.replace(/\s+/g, ' ').trim() || null
        resolve({ url, title, source })
      })
    })
    request.on('timeout', () => {
      request.destroy()
      resolve(null)
    })
    request.on('error', () => resolve(null))
    request.end()
  })
}

function sanitizeArtifactName(name: string): string {
  const compact = name.replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96)
  return compact || `artifact-${Date.now()}`
}

function clipboardAttachmentName(name?: string, mimeType?: string): string {
  const extension = mimeType ? MIME_EXTENSIONS[mimeType.toLowerCase()] : ''
  const fallback = mimeType?.startsWith('image/') ? `pasted-image-${Date.now()}${extension || '.png'}` : `pasted-file-${Date.now()}${extension}`
  const safeName = sanitizeArtifactName(basename(name || fallback))
  return extension && !extname(safeName) ? `${safeName}${extension}` : safeName
}

function uniqueArtifactName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name
  const extension = extname(name)
  const stem = extension ? name.slice(0, -extension.length) : name
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}${extension}`
    if (!existsSync(join(dir, candidate))) return candidate
  }
  return `${stem}-${Date.now()}${extension}`
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false
  let suspicious = 0
  const sampleLength = Math.min(buffer.length, 4096)
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = buffer[index]
    if (byte === 0) return true
    const allowedControl = byte === 7 || byte === 8 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 27
    if (byte < 32 && !allowedControl) suspicious += 1
  }
  return suspicious / sampleLength > 0.08
}

async function openPathWithPreferredEditor(filePath: string): Promise<string> {
  const editor = normalizePreferredEditor(settingsStore.get('preferredEditor', 'system'))
  if (editor === 'system') return shell.openPath(filePath)

  const appInfo = EDITOR_APPS[editor]
  if (process.platform !== 'darwin') return shell.openPath(filePath)

  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-a', appInfo.macAppName, filePath], (error, _stdout, stderr) => {
      if (!error) {
        resolve('')
        return
      }
      const details = stderr.trim() || error.message
      resolve(`Unable to open in ${appInfo.label}${details ? `: ${details}` : '.'}`)
    })
  })
}

export function registerIpcHandlers(ipcMain: IpcMain): void {
  // App profile
  ipcMain.handle('app:getProfile', () => getAppProfile())

  // Projects
  ipcMain.handle('projects:list', () => projectStore.list())
  ipcMain.handle('projects:add', (_, name: string, rootPath: string) =>
    projectStore.add(name, rootPath)
  )
  ipcMain.handle('projects:remove', (_, id: string) => projectStore.remove(id))
  ipcMain.handle('projects:updateName', (_, id: string, name: string) => projectStore.updateName(id, name))
  ipcMain.handle('projects:updatePinned', (_, id: string, pinned: boolean) => projectStore.updatePinned(id, pinned))
  ipcMain.handle('projects:addSession', (_, projectId: string, sessionId: string) =>
    projectStore.addSession(projectId, sessionId)
  )
  ipcMain.handle('projects:removeSession', (_, projectId: string, sessionId: string) =>
    projectStore.removeSession(projectId, sessionId)
  )

  // Sessions
  ipcMain.handle('sessions:list', () => sessionManager.list())
  ipcMain.handle('sessions:listSummaries', () => sessionManager.listSummaries())
  ipcMain.handle('sessions:get', (_, id: string) => sessionManager.get(id))
  ipcMain.handle('sessions:getTranscriptPage', (_, id: string, request?: TranscriptPageRequest) =>
    sessionManager.getTranscriptPage(id, request ?? {})
  )
  ipcMain.handle('sessions:searchTranscript', (_, id: string, query: string, limit?: number) =>
    sessionManager.searchTranscript(id, query, limit)
  )
  ipcMain.handle('sessions:create', (_, opts) => sessionManager.create(opts))
  ipcMain.handle('sessions:sendMessage', (_, sessionId: string, prompt: string, useWorktree?: boolean, attachments?: Attachment[]) =>
    sessionManager.sendMessage(sessionId, prompt, useWorktree, attachments ?? [])
  )
  ipcMain.handle('sessions:answerSideQuestion', (_, sessionId: string, question: string) =>
    sessionManager.answerSideQuestion(sessionId, question)
  )
  ipcMain.handle('sessions:updateName', (_, id: string, name: string) =>
    sessionManager.updateName(id, name)
  )
  ipcMain.handle('sessions:updatePinned', (_, id: string, pinned: boolean) =>
    sessionManager.updatePinned(id, pinned)
  )
  ipcMain.handle('sessions:updateSettings', (_, id: string, patch: {
    provider?: string
    model?: string
    effort?: string
    agentName?: string | null
    permissionMode?: string
    runtime?: 'headless' | 'interactive' | 'sdk' | 'app-server'
    useThinking?: boolean
    useFast?: boolean
    allowedTools?: string[]
    disallowedTools?: string[]
    availableTools?: string[]
    additionalDirs?: string[]
  }) =>
    sessionManager.updateSettings(id, patch)
  )
  ipcMain.handle('sessions:checkProviders', () => sessionManager.checkProviders())
  ipcMain.handle('sessions:stop', (_, sessionId: string) => sessionManager.stop(sessionId))
  ipcMain.handle('sessions:steerQueuedMessage', (_, sessionId: string, messageId: string) =>
    sessionManager.steerQueuedMessage(sessionId, messageId)
  )
  ipcMain.handle('sessions:remove', (_, sessionId: string) => sessionManager.remove(sessionId))
  ipcMain.handle('sessions:getDiff', (_, sessionId: string) => sessionManager.getDiff(sessionId))
  ipcMain.handle('sessions:getChangedFiles', (_, sessionId: string) => {
    const session = sessionManager.get(sessionId)
    if (!session) return []
    return gitManager.getChangedFiles(session.workDir)
  })
  ipcMain.handle('sessions:getDiffForFile', (_, sessionId: string, filePath: string) => {
    const session = sessionManager.get(sessionId)
    if (!session) return ''
    return gitManager.getDiffForFile(session.workDir, filePath)
  })
  ipcMain.handle('sessions:writeToPty', (_, sessionId: string, data: string) =>
    sessionManager.writeToPty(sessionId, data)
  )
  ipcMain.handle('sessions:grantAndResume', (_, sessionId: string, toolNames: string[]) =>
    sessionManager.grantAndResume(sessionId, toolNames)
  )
  ipcMain.handle('sessions:allowOnceAndResume', (_, sessionId: string, toolNames: string[]) =>
    sessionManager.allowOnceAndResume(sessionId, toolNames)
  )
  ipcMain.handle('sessions:answerUserInput', (_, sessionId: string, answer: string) =>
    sessionManager.answerUserInput(sessionId, answer)
  )
  ipcMain.handle('sessions:denyPermission', (_, sessionId: string) =>
    sessionManager.denyPermission(sessionId)
  )

  // Providers
  ipcMain.handle('providers:getRuntimeInfo', () => getProviderRuntimeInfo())
  ipcMain.handle('providers:getManifest', () => providerManifests())
  ipcMain.handle('providers:getDiagnostics', (_, providerId?: string) => getProviderDiagnosticsAsync(providerId))
  ipcMain.handle('providers:runCommandSurface', (_, providerId: string, surfaceId: string) =>
    runProviderCommandSurfaceAsync(providerId, surfaceId)
  )
  ipcMain.handle('providers:listResources', (_, providerId?: string, cwd?: string) =>
    listProviderResources(providerId, cwd)
  )
  ipcMain.handle('providers:createCapability', (_, request: CapabilityCreateRequest) =>
    createCapability(request)
  )
  ipcMain.handle('providers:updateCapability', (_, request: CapabilityUpdateRequest) =>
    updateCapability(request)
  )
  ipcMain.handle('providers:deleteCapability', (_, request: CapabilityDeleteRequest) =>
    deleteCapability(request)
  )
  ipcMain.handle('providers:previewCapabilitySync', (_, request: CapabilitySyncRequest) =>
    previewCapabilitySync(request)
  )
  ipcMain.handle('providers:syncCapability', (_, request: CapabilitySyncRequest) =>
    applyCapabilitySync(request)
  )
  ipcMain.handle('providers:discoverClaudeExtensions', (_, workDir: string) =>
    discoverClaudeExtensions(workDir)
  )

  // Performance
  ipcMain.handle('performance:record', (_, metric: Omit<PerformanceMetric, 'id'>) =>
    recordPerformanceMetric(metric)
  )
  ipcMain.handle('performance:snapshot', () => performanceSnapshot())
  ipcMain.handle('performance:reset', () => resetPerformanceMetrics())

  // Git
  ipcMain.handle('git:isGitRepo', (_, dir: string) => gitManager.isGitRepo(dir))
  ipcMain.handle('git:getCurrentBranch', (_, dir: string) => gitManager.getCurrentBranch(dir))

  // Browser side panel
  ipcMain.handle('browser:openExternal', (_, url: string): Promise<void> => shell.openExternal(url))
  ipcMain.handle('browser:clearData', async (_, kind: string = 'all'): Promise<void> => {
    const browserSession = session.fromPartition('persist:orchestrator-side-browser')
    const dataTypesByKind = {
      all: ['cache', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'],
      cache: ['cache'],
      cookies: ['cookies'],
      siteData: ['fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL']
    } as const
    const clearKind =
      kind === 'cache' || kind === 'cookies' || kind === 'siteData' || kind === 'all' ? kind : 'all'
    if (clearKind === 'all' || clearKind === 'cookies') {
      await browserSession.clearAuthCache()
    }
    await browserSession.clearData({ dataTypes: [...dataTypesByKind[clearKind]] })
  })
  ipcMain.handle('browser:saveDataUrlArtifact', (_, dataUrl: string, suggestedName?: string) =>
    writeBrowserDataUrlArtifact(dataUrl, suggestedName)
  )
  ipcMain.handle('browser:discoverLocalTargets', (_, recentUrls?: string[]) =>
    discoverBrowserLocalTargets(recentUrls)
  )
  ipcMain.handle('browser:bundleAssets', (_, request: BrowserAssetRequest) =>
    bundleBrowserAssets(request)
  )
  ipcMain.handle('attachments:savePastedFile', (_, request: PastedAttachmentRequest) =>
    writePastedAttachment(request)
  )

  // App settings
  ipcMain.handle('settings:get', () => settingsStore.store)
  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    settingsStore.set(key as keyof typeof settingsStore.store, value as never)
  })

  // File system (for provider instructions and skills)
  ipcMain.handle('fs:resolveHome', () => app.getPath('home'))
  ipcMain.handle('fs:readFile', (_, filePath: string): string | null => {
    try { return readFileSync(filePath, 'utf-8') } catch { return null }
  })
  ipcMain.handle('fs:previewFile', (_, filePath: string): FilePreviewResult => previewFile(filePath))
  ipcMain.handle('fs:writeFile', (_, filePath: string, content: string): void => {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, 'utf-8')
  })
  ipcMain.handle('fs:listDir', (_, dirPath: string): string[] | null => {
    try { return readdirSync(dirPath) } catch { return null }
  })
  ipcMain.handle('fs:statPath', (_, filePath: string): { exists: boolean; isFile?: boolean; isDirectory?: boolean; size?: number } => {
    try {
      if (!existsSync(filePath)) return { exists: false }
      const stat = statSync(filePath)
      return {
        exists: true,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        size: stat.size
      }
    } catch {
      return { exists: false }
    }
  })
  ipcMain.handle('fs:resolveWorkspaceFileReference', (_, cwd: string, filePath: string): string | null =>
    resolveWorkspaceFileReference(cwd, filePath)
  )
  ipcMain.handle('fs:openPath', (_, filePath: string): Promise<string> => openPathWithPreferredEditor(filePath))
  ipcMain.handle('fs:showInFolder', (_, filePath: string): void => shell.showItemInFolder(filePath))

  // User shell terminal (separate from provider subprocesses)
  ipcMain.handle('terminal:spawn', (_, sessionId: string, workDir: string) =>
    terminalManager.spawn(sessionId, workDir)
  )
  ipcMain.handle('terminal:write', (_, sessionId: string, data: string) =>
    terminalManager.write(sessionId, data)
  )
  ipcMain.handle('terminal:runCommand', (_, sessionId: string, command: string) =>
    terminalManager.runCommand(sessionId, command)
  )
  ipcMain.handle('terminal:resize', (_, sessionId: string, cols: number, rows: number) =>
    terminalManager.resize(sessionId, cols, rows)
  )
  ipcMain.handle('terminal:getBuffer', (_, terminalId: string) =>
    terminalManager.getBuffer(terminalId)
  )
  ipcMain.handle('terminal:clear', (_, terminalId: string) =>
    terminalManager.clear(terminalId)
  )
  ipcMain.handle('terminal:kill', (_, terminalId: string) =>
    terminalManager.kill(terminalId)
  )

  // File dialog
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:openFiles', async (): Promise<Array<{ path: string; name: string; size?: number }> | null> => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return null
    return result.filePaths.map((filePath) => {
      let size: number | undefined
      try { size = statSync(filePath).size } catch { /* ignore stat races */ }
      return { path: filePath, name: basename(filePath), size }
    })
  })

  // Pet overlay
  ipcMain.handle('pet:getConfig', () => petOverlayManager.getConfig())
  ipcMain.handle('pet:selectPet', (_, id: string) => petOverlayManager.selectPet(id))
  ipcMain.handle('pet:import', () => petOverlayManager.importPet())
  ipcMain.handle('pet:importCodexPets', () => petOverlayManager.importCodexPets())
  ipcMain.handle('pet:setOpen', (_, v: boolean) => petOverlayManager.setOpen(v))
  ipcMain.handle('pet:close', () => petOverlayManager.setOpen(false))
  ipcMain.handle('pet:focusMain', (_, sessionId?: string) => petOverlayManager.focusMain(sessionId))
  ipcMain.on('pet:drag:start', (_, clientX: number, clientY: number) =>
    petOverlayManager.dragStart(clientX, clientY))
  ipcMain.on('pet:drag:move', (_, screenX: number, screenY: number) =>
    petOverlayManager.dragMove(screenX, screenY))
  ipcMain.on('pet:drag:end', () => petOverlayManager.dragEnd())
  ipcMain.on('pet:drag:release', (_, vx: number, vy: number) =>
    petOverlayManager.dragRelease(vx, vy))
  ipcMain.on('pet:pointer', (_, v: boolean) => petOverlayManager.setPointerInteractive(v))
  ipcMain.on('pet:keyboard', (_, v: boolean) => petOverlayManager.setKeyboardInteractive(v))
  ipcMain.on('pet:trayCount', (_, count: number) => petOverlayManager.setTrayCount(count))
  ipcMain.on('pet:trayHeight', (_, h: number) => petOverlayManager.setTrayHeight(h))
  ipcMain.on('pet:traySize', (_, size: { width: number; height: number }) => petOverlayManager.setTraySize(size))
  ipcMain.on('pet:elementMetrics', (_, metrics: { isTrayVisible: boolean; mascot: { width: number; height: number }; tray: { width: number; height: number } | null }) =>
    petOverlayManager.setElementMetrics(metrics))
  ipcMain.on('pet:mascotSize', (_, size: { width: number; height: number }) => petOverlayManager.setMascotSize(size))
  ipcMain.on('pet:mascotResizePreview', (_, width: number) => petOverlayManager.setMascotResizePreview(width))
  ipcMain.on('pet:mascotWidth', (_, width: number) => petOverlayManager.setMascotWidth(width))
}
