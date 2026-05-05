import { BrowserWindow, screen, dialog, app } from 'electron'
import { isAbsolute, join, normalize } from 'path'
import { readFileSync, mkdirSync, existsSync, readdirSync, cpSync, rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { is } from '@electron-toolkit/utils'
import { settingsStore } from './settings'
import { sessionManager } from './sessions'

export interface PetManifest {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
  kind: string
  animFrames?: Partial<Record<string, number>>
}

export interface PetEntry extends PetManifest {
  spritesheetDataUrl: string
}

type PetPlacement = 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'

export interface PetLayout {
  mascotLeft: number
  mascotTop: number
  trayLeft: number
  trayTop: number
  placement: PetPlacement
}

interface Size {
  width: number
  height: number
}

interface Rect extends Size {
  x: number
  y: number
}

export interface PetConfig {
  pets: PetEntry[]
  selectedPetId: string
  isOpen: boolean
  sessions: ReturnType<typeof sessionManager.list>
  initialLayout: PetLayout
}

export interface CodexPetImportResult {
  imported: number
  skipped: number
  pets: PetManifest[]
}

// ── Layout constants ──────────────────────────────────────────────────────────
const FALLBACK_MASCOT: Size = { width: 96, height: 104 }
const FALLBACK_TRAY: Size = { width: 264, height: 0 }
const TRAY_W = 264
const WINDOW_PAD = 8
const TRAY_GAP = 8

const TRAY_ITEM_H = 36   // height per notification card
const TRAY_CARD_GAP = 5  // gap between cards

const THROW_TICK_MS = 16
const THROW_FRICTION = 0.88
const MIN_COAST_SPEED = 65
const MAX_COAST_MS = 900
const SCREEN_MARGIN = 24

const CODEX_PET_NAMES: Record<string, string> = {
  bsod: 'BSOD',
  codex: 'Codex',
  dewey: 'Dewey',
  fireball: 'Fireball',
  'null-signal': 'Null Signal',
  rocky: 'Rocky',
  seedy: 'Seedy',
  stacky: 'Stacky',
}

// ── State ─────────────────────────────────────────────────────────────────────
let petWin: BrowserWindow | null = null
let anchor = { x: 0, y: 0 }   // mascot top-left screen position
let pointerAnchorX = 0         // click offset within mascot x
let pointerAnchorY = 0         // click offset within mascot y
let trayCount = 0              // number of visible tray cards (0-2)
let traySize: Size = { ...FALLBACK_TRAY }
let mascotSize: Size = { ...FALLBACK_MASCOT }
let throwTimer: ReturnType<typeof setTimeout> | null = null
let pointerInteractive = false
let mainWindowRef: BrowserWindow | null = null
let createMainWindowFn: (() => void) | null = null
let lastLayout: (PetLayout & { windowBounds: Rect }) | null = null
let placement: PetPlacement = 'bottom-end'
let displayListenersAttached = false

// ── Pet loading ───────────────────────────────────────────────────────────────
function builtInPetsDir(): string {
  return is.dev
    ? join(app.getAppPath(), 'resources/pets')
    : join(process.resourcesPath, 'pets')
}

function userPetsDir(): string {
  return join(app.getPath('userData'), 'pets')
}

function loadPets(): PetEntry[] {
  const dirs: string[] = []
  const builtIn = builtInPetsDir()
  if (existsSync(builtIn)) {
    for (const entry of readdirSync(builtIn)) dirs.push(join(builtIn, entry))
  }
  const user = userPetsDir()
  if (existsSync(user)) {
    for (const entry of readdirSync(user)) dirs.push(join(user, entry))
  }
  return dirs.flatMap((dir) => {
    try {
      const manifestPath = join(dir, 'pet.json')
      if (!existsSync(manifestPath)) return []
      const manifest: PetManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      const sheetPath = join(dir, manifest.spritesheetPath)
      if (!existsSync(sheetPath)) return []
      const ext = manifest.spritesheetPath.endsWith('.png') ? 'png' : 'webp'
      const spritesheetDataUrl = `data:image/${ext};base64,${readFileSync(sheetPath).toString('base64')}`
      return [{ ...manifest, spritesheetDataUrl }]
    } catch {
      return []
    }
  })
}

function isSafeRelativePath(path: string): boolean {
  if (!path || isAbsolute(path)) return false
  return !normalize(path).split(/[\\/]/).includes('..')
}

function assertSafeManifest(manifest: PetManifest): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(manifest.id)) {
    throw new Error('Pet id may only contain letters, numbers, dots, dashes, and underscores')
  }
  if (!isSafeRelativePath(manifest.spritesheetPath)) {
    throw new Error('Pet spritesheet path must be relative to the bundle')
  }
}

function titleCasePetId(id: string): string {
  return id
    .split('-')
    .map((part) => part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part)
    .join(' ')
}

function slugifyPetId(id: string): string {
  const slug = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'custom'
}

function codexAssetDirs(): string[] {
  return [
    '/Applications/Codex.app/Contents/Resources/app.asar/webview/assets',
    join(app.getPath('home'), 'Applications/Codex.app/Contents/Resources/app.asar/webview/assets'),
  ]
}

function codexSpritesheetEntries(): Array<{ id: string; fileName: string; sourcePath: string }> {
  const entries: Array<{ id: string; fileName: string; sourcePath: string }> = []
  for (const dir of codexAssetDirs()) {
    if (!existsSync(dir)) continue
    for (const fileName of readdirSync(dir)) {
      const match = /^(.+)-spritesheet-v4-[^.]+\.webp$/.exec(fileName)
      if (!match) continue
      entries.push({
        id: match[1],
        fileName,
        sourcePath: join(dir, fileName),
      })
    }
    if (entries.length > 0) return entries
  }
  return entries
}

function codexCustomPetDirs(): string[] {
  return [
    join(app.getPath('home'), 'Library/Application Support/Codex/avatars'),
    join(app.getPath('home'), 'Library/Application Support/Codex/pets'),
  ]
}

function codexCustomPetEntries(): Array<{ id: string; manifest: PetManifest; sourcePath: string }> {
  const entries = new Map<string, { id: string; manifest: PetManifest; sourcePath: string }>()
  for (const root of codexCustomPetDirs()) {
    if (!existsSync(root)) continue
    for (const dirName of readdirSync(root)) {
      const dir = join(root, dirName)
      const manifestPath = existsSync(join(dir, 'pet.json'))
        ? join(dir, 'pet.json')
        : existsSync(join(dir, 'avatar.json'))
          ? join(dir, 'avatar.json')
          : null
      if (!manifestPath) continue
      try {
        const sourceManifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Partial<PetManifest>
        const sourceId = slugifyPetId(sourceManifest.id ?? dirName)
        const spritesheetPath = typeof sourceManifest.spritesheetPath === 'string'
          ? sourceManifest.spritesheetPath
          : 'spritesheet.webp'
        if (!isSafeRelativePath(spritesheetPath)) continue
        const sourcePath = join(dir, spritesheetPath)
        if (!existsSync(sourcePath)) continue
        if (entries.has(sourceId)) continue
        entries.set(sourceId, {
          id: sourceId,
          sourcePath,
          manifest: {
            id: `codex-custom-${sourceId}`,
            displayName: sourceManifest.displayName ?? titleCasePetId(sourceId),
            description: sourceManifest.description ?? 'Imported from Codex custom pets.',
            spritesheetPath: 'spritesheet.webp',
            kind: 'codex-custom',
            animFrames: sourceManifest.animFrames,
          },
        })
      } catch {
        // Ignore invalid custom pet folders.
      }
    }
  }
  return [...entries.values()]
}

// ── Layout computation ────────────────────────────────────────────────────────
function trayH(count: number): number {
  if (count === 0) return 0
  // Use renderer-reported height when available (cards can vary due to body text)
  return traySize.height > 0 ? traySize.height : count * TRAY_ITEM_H + (count - 1) * TRAY_CARD_GAP
}

function rectRight(rect: Rect): number {
  return rect.x + rect.width
}

function rectBottom(rect: Rect): number {
  return rect.y + rect.height
}

function unionRects(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map(rectRight))
  const bottom = Math.max(...rects.map(rectBottom))
  return { x, y, width: right - x, height: bottom - y }
}

function overflowScore(rect: Rect, workArea: Rect): number {
  return (
    Math.max(0, workArea.x - rect.x) +
    Math.max(0, rectRight(rect) - rectRight(workArea)) +
    Math.max(0, workArea.y - rect.y) +
    Math.max(0, rectBottom(rect) - rectBottom(workArea))
  )
}

function clampRect(rect: Rect, workArea: Rect): Rect {
  const maxX = rectRight(workArea) - Math.min(rect.width, workArea.width)
  const maxY = rectBottom(workArea) - Math.min(rect.height, workArea.height)
  return {
    ...rect,
    x: Math.max(workArea.x, Math.min(maxX, rect.x)),
    y: Math.max(workArea.y, Math.min(maxY, rect.y)),
  }
}

function preferredPlacements(a: { x: number; y: number }, workArea: Rect): PetPlacement[] {
  const vertical = a.y < workArea.y + workArea.height / 2 ? 'bottom' : 'top'
  const horizontal = a.x < workArea.x + workArea.width / 2 ? 'start' : 'end'
  const primary = `${vertical}-${horizontal}` as PetPlacement
  const secondary = `${vertical}-${horizontal === 'start' ? 'end' : 'start'}` as PetPlacement
  const tertiary = `${vertical === 'top' ? 'bottom' : 'top'}-${horizontal}` as PetPlacement
  const rest = (['top-start', 'top-end', 'bottom-start', 'bottom-end'] as PetPlacement[])
    .filter((p) => p !== primary && p !== secondary && p !== tertiary)
  return [primary, secondary, tertiary, ...rest]
}

function trayRectForPlacement(mascot: Rect, tray: Size, p: PetPlacement): Rect {
  const vertical = p.startsWith('top') ? 'top' : 'bottom'
  const horizontal = p.endsWith('start') ? 'start' : 'end'
  return {
    x: horizontal === 'start' ? mascot.x : rectRight(mascot) - tray.width,
    y: vertical === 'top' ? mascot.y - TRAY_GAP - tray.height : rectBottom(mascot) + TRAY_GAP,
    width: tray.width,
    height: tray.height,
  }
}

function computeLayout(a: { x: number; y: number }, count: number): PetLayout & { windowBounds: Rect } {
  const workArea = screen.getDisplayNearestPoint(a).workArea
  const mascot: Rect = { x: a.x, y: a.y, ...mascotSize }
  const visibleTraySize: Size = {
    width: Math.max(traySize.width || TRAY_W, TRAY_W),
    height: trayH(count),
  }

  let chosenPlacement = placement
  let trayRect: Rect | null = null

  if (count > 0 && visibleTraySize.height > 0) {
    const preferred = preferredPlacements(a, workArea)
    const candidates = (['top-start', 'top-end', 'bottom-start', 'bottom-end'] as PetPlacement[])
      .map((p) => {
        const rawTray = trayRectForPlacement(mascot, visibleTraySize, p)
        const union = unionRects([mascot, rawTray])
        const preferencePenalty = preferred.indexOf(p) * 10
        const previousBias = p === placement ? -4 : 0
        return {
          placement: p,
          score: overflowScore(union, workArea) * 100 + preferencePenalty + previousBias,
          rawTray,
        }
      })
      .sort((a, b) => a.score - b.score)

    chosenPlacement = candidates[0].placement
    trayRect = clampRect(candidates[0].rawTray, workArea)
  }

  const visibleRects = trayRect ? [mascot, trayRect] : [mascot]
  const content = unionRects(visibleRects)
  return {
    mascotLeft: Math.round(mascot.x - content.x + WINDOW_PAD),
    mascotTop: Math.round(mascot.y - content.y + WINDOW_PAD),
    trayLeft: Math.round((trayRect?.x ?? content.x) - content.x + WINDOW_PAD),
    trayTop: Math.round((trayRect?.y ?? content.y) - content.y + WINDOW_PAD),
    placement: chosenPlacement,
    windowBounds: {
      x: Math.round(content.x - WINDOW_PAD),
      y: Math.round(content.y - WINDOW_PAD),
      width: Math.ceil(content.width + WINDOW_PAD * 2),
      height: Math.ceil(content.height + WINDOW_PAD * 2),
    },
  }
}

function clampAnchor(a: { x: number; y: number }): { x: number; y: number } {
  const d = screen.getDisplayNearestPoint(a).workArea
  return {
    x: Math.max(d.x, Math.min(d.x + d.width - mascotSize.width, a.x)),
    y: Math.max(d.y, Math.min(d.y + d.height - mascotSize.height, a.y)),
  }
}

function defaultAnchor(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - SCREEN_MARGIN - mascotSize.width,
    y: workArea.y + workArea.height - SCREEN_MARGIN - mascotSize.height,
  }
}

function applyLayout(): void {
  if (!petWin || petWin.isDestroyed()) return
  const layout = computeLayout(anchor, trayCount)
  petWin.setContentBounds(layout.windowBounds)
  placement = layout.placement

  // Only send to renderer when layout actually changes
  if (
    !lastLayout ||
    lastLayout.mascotLeft !== layout.mascotLeft ||
    lastLayout.mascotTop !== layout.mascotTop ||
    lastLayout.trayLeft !== layout.trayLeft ||
    lastLayout.trayTop !== layout.trayTop ||
    lastLayout.placement !== layout.placement
  ) {
    lastLayout = layout
    petWin.webContents.send('pet:layout', {
      mascotLeft: layout.mascotLeft,
      mascotTop: layout.mascotTop,
      trayLeft: layout.trayLeft,
      trayTop: layout.trayTop,
      placement: layout.placement,
    })
  }
}

function handleDisplayChanged(): void {
  anchor = clampAnchor(anchor)
  settingsStore.set('petPosition', { ...anchor })
  applyLayout()
}

function attachDisplayListeners(): void {
  if (displayListenersAttached) return
  displayListenersAttached = true
  screen.on('display-added', handleDisplayChanged)
  screen.on('display-removed', handleDisplayChanged)
  screen.on('display-metrics-changed', handleDisplayChanged)
}

function refreshCursorAtCurrentMousePosition(): void {
  if (!petWin || petWin.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  const bounds = petWin.getBounds()
  petWin.webContents.sendInputEvent({
    type: 'mouseMove',
    x: Math.round(cursor.x - bounds.x),
    y: Math.round(cursor.y - bounds.y),
    movementX: 0,
    movementY: 0,
  } as Electron.MouseInputEvent)
}

// ── Public API ────────────────────────────────────────────────────────────────
export function setCreateMainWindowCallback(fn: () => void): void {
  createMainWindowFn = fn
}

export function createPetOverlayWindow(mainWin: BrowserWindow): void {
  if (petWin && !petWin.isDestroyed()) {
    petWin.destroy()
    petWin = null
  }
  mainWindowRef = mainWin
  const isOpen = settingsStore.get('petOpen', true) as boolean
  const saved = settingsStore.get('petPosition', null) as { x: number; y: number } | null
  placement = settingsStore.get('petPlacement', 'bottom-end') as PetPlacement
  anchor = clampAnchor(saved || defaultAnchor())
  attachDisplayListeners()

  const layout = computeLayout(anchor, trayCount)
  lastLayout = layout

  petWin = new BrowserWindow({
    x: layout.windowBounds.x,
    y: layout.windowBounds.y,
    width: layout.windowBounds.width,
    height: layout.windowBounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/petOverlay.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  petWin.setAlwaysOnTop(true, 'floating')
  if (process.platform === 'darwin') {
    petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  } else {
    petWin.setVisibleOnAllWorkspaces(true)
  }
  petWin.setIgnoreMouseEvents(true, { forward: true })
  petWin.setMenuBarVisibility(false)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    petWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/pet-overlay/index.html`)
  } else {
    petWin.loadFile(join(__dirname, '../renderer/pet-overlay/index.html'))
  }

  petWin.webContents.on('did-finish-load', () => {
    if (isOpen) {
      petWin?.moveTop()
      petWin?.showInactive()
    }
  })

  petWin.on('closed', () => { petWin = null })
}

export const petOverlayManager = {
  getConfig(): PetConfig {
    const layout = computeLayout(anchor, trayCount)
    return {
      pets: loadPets(),
      selectedPetId: settingsStore.get('selectedPetId', 'ditto') as string,
      isOpen: settingsStore.get('petOpen', true) as boolean,
      sessions: sessionManager.list(),
      initialLayout: {
        mascotLeft: layout.mascotLeft,
        mascotTop: layout.mascotTop,
        trayLeft: layout.trayLeft,
        trayTop: layout.trayTop,
        placement: layout.placement,
      },
    }
  },

  selectPet(id: string): void {
    settingsStore.set('selectedPetId', id)
    petWin?.webContents.send('pet:configUpdated', { selectedPetId: id })
  },

  setOpen(v: boolean): void {
    settingsStore.set('petOpen', v)
    if (!petWin) return
    if (v) {
      petWin.moveTop()
      petWin.showInactive()
    } else {
      petWin.hide()
    }
  },

  async importPet(): Promise<PetManifest | null> {
    const result = await dialog.showOpenDialog({
      title: 'Import Pet',
      filters: [{ name: 'Pet Bundle', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const zipPath = result.filePaths[0]
    const tmpDir = join(app.getPath('temp'), `pet-import-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    try {
      execFileSync('unzip', ['-o', zipPath, '-d', tmpDir], { stdio: 'ignore' })
      const manifestPath = join(tmpDir, 'pet.json')
      if (!existsSync(manifestPath)) throw new Error('Missing pet.json')
      const manifest: PetManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      assertSafeManifest(manifest)
      const sheetPath = join(tmpDir, manifest.spritesheetPath)
      if (!existsSync(sheetPath)) throw new Error('Missing spritesheet')
      const destDir = join(userPetsDir(), manifest.id)
      mkdirSync(destDir, { recursive: true })
      cpSync(tmpDir, destDir, { recursive: true })
      return manifest
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  },

  importCodexPets(): CodexPetImportResult {
    const pets: PetManifest[] = []
    let skipped = 0

    for (const entry of codexSpritesheetEntries()) {
      if (!CODEX_PET_NAMES[entry.id]) {
        skipped++
        continue
      }
      const id = `codex-${entry.id}`
      const manifest: PetManifest = {
        id,
        displayName: CODEX_PET_NAMES[entry.id] ?? titleCasePetId(entry.id),
        description: `Imported from Codex desktop (${entry.fileName}).`,
        spritesheetPath: 'spritesheet.webp',
        kind: 'codex',
      }
      assertSafeManifest(manifest)
      const destDir = join(userPetsDir(), id)
      mkdirSync(destDir, { recursive: true })
      writeFileSync(join(destDir, 'spritesheet.webp'), readFileSync(entry.sourcePath))
      writeFileSync(join(destDir, 'pet.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      pets.push(manifest)
    }

    for (const entry of codexCustomPetEntries()) {
      assertSafeManifest(entry.manifest)
      const destDir = join(userPetsDir(), entry.manifest.id)
      mkdirSync(destDir, { recursive: true })
      writeFileSync(join(destDir, 'spritesheet.webp'), readFileSync(entry.sourcePath))
      writeFileSync(join(destDir, 'pet.json'), `${JSON.stringify(entry.manifest, null, 2)}\n`)
      pets.push(entry.manifest)
    }

    return { imported: pets.length, skipped, pets }
  },

  focusMain(sessionId?: string): void {
    const all = BrowserWindow.getAllWindows()
    const mainWin =
      (mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null) ??
      all.find((w) => w !== petWin && !w.isDestroyed()) ??
      null
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.focus()
      if (sessionId) mainWin.webContents.send('pet:navigate', sessionId)
    } else if (createMainWindowFn) {
      createMainWindowFn()
    }
  },

  dragStart(clientX: number, clientY: number): void {
    if (throwTimer) { clearTimeout(throwTimer); throwTimer = null }
    const layout = computeLayout(anchor, trayCount)
    pointerAnchorX = clientX - layout.mascotLeft
    pointerAnchorY = clientY - layout.mascotTop
  },

  dragMove(): void {
    if (!petWin) return
    const cursor = screen.getCursorScreenPoint()
    anchor = clampAnchor({
      x: cursor.x - pointerAnchorX,
      y: cursor.y - pointerAnchorY,
    })
    applyLayout()
  },

  dragEnd(): void {
    settingsStore.set('petPosition', { ...anchor })
    settingsStore.set('petPlacement', placement)
  },

  dragRelease(vx: number, vy: number): void {
    if (!petWin) return
    let cvx = vx
    let cvy = vy
    let elapsed = 0
    const tick = (): void => {
      if (!petWin) return
      elapsed += THROW_TICK_MS
      const nx = anchor.x + (cvx * THROW_TICK_MS) / 1000
      const ny = anchor.y + (cvy * THROW_TICK_MS) / 1000
      const clamped = clampAnchor({ x: nx, y: ny })
      if (clamped.x !== nx) cvx = 0
      if (clamped.y !== ny) cvy = 0
      anchor = clamped
      applyLayout()
      cvx *= THROW_FRICTION
      cvy *= THROW_FRICTION
      if (elapsed >= MAX_COAST_MS || Math.hypot(cvx, cvy) < MIN_COAST_SPEED) {
        settingsStore.set('petPosition', { ...anchor })
        settingsStore.set('petPlacement', placement)
        return
      }
      throwTimer = setTimeout(tick, THROW_TICK_MS)
    }
    throwTimer = setTimeout(tick, THROW_TICK_MS)
  },

  setTrayCount(count: number): void {
    if (count === trayCount) return
    trayCount = count
    applyLayout()
  },

  setTrayHeight(h: number): void {
    if (h === traySize.height) return
    traySize = { ...traySize, height: h }
    applyLayout()
  },

  setTraySize(size: Size): void {
    const width = Math.ceil(size.width)
    const height = Math.ceil(size.height)
    if (width === traySize.width && height === traySize.height) return
    traySize = { width, height }
    applyLayout()
  },

  setMascotSize(size: Size): void {
    const width = Math.ceil(size.width)
    const height = Math.ceil(size.height)
    if (width === mascotSize.width && height === mascotSize.height) return
    mascotSize = { width, height }
    anchor = clampAnchor(anchor)
    applyLayout()
  },

  setPointerInteractive(v: boolean): void {
    if (!petWin || v === pointerInteractive) return
    pointerInteractive = v
    if (v) {
      petWin.setIgnoreMouseEvents(false)
    } else {
      petWin.setIgnoreMouseEvents(true, { forward: true })
    }
    refreshCursorAtCurrentMousePosition()
  }
}
