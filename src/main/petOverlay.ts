import { BrowserWindow, screen, dialog, app } from 'electron'
import { join } from 'path'
import { readFileSync, mkdirSync, existsSync, readdirSync, cpSync } from 'fs'
import { execSync } from 'child_process'
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

export interface PetLayout {
  mascotTop: number
  trayTop: number
}

export interface PetConfig {
  pets: PetEntry[]
  selectedPetId: string
  isOpen: boolean
  sessions: ReturnType<typeof sessionManager.list>
  initialLayout: PetLayout
}

// ── Layout constants ──────────────────────────────────────────────────────────
const MASCOT_W = 96
const MASCOT_H = 104
const TRAY_W = 264
const PAD = 8
const TRAY_GAP = 8
const VIEWPORT_W = TRAY_W + 2 * PAD   // 280
const MASCOT_IN_WIN_X = VIEWPORT_W - PAD - MASCOT_W  // 176 — mascot right-aligns with tray

const TRAY_ITEM_H = 36   // height per notification card
const TRAY_CARD_GAP = 5  // gap between cards

const THROW_TICK_MS = 16
const THROW_FRICTION = 0.88
const MIN_COAST_SPEED = 65
const MAX_COAST_MS = 900
const SCREEN_MARGIN = 24

// ── State ─────────────────────────────────────────────────────────────────────
let petWin: BrowserWindow | null = null
let anchor = { x: 0, y: 0 }   // mascot top-left screen position
let pointerAnchorX = 0         // click offset within mascot x
let pointerAnchorY = 0         // click offset within mascot y
let trayCount = 0              // number of visible tray cards (0-2)
let trayPxH = 0               // actual rendered tray height reported by renderer
let throwTimer: ReturnType<typeof setTimeout> | null = null
let pointerInteractive = false
let mainWindowRef: BrowserWindow | null = null
let createMainWindowFn: (() => void) | null = null
let lastSentLayout: PetLayout | null = null

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

// ── Layout computation ────────────────────────────────────────────────────────
function trayH(count: number): number {
  if (count === 0) return 0
  // Use renderer-reported height when available (cards can vary due to body text)
  return trayPxH > 0 ? trayPxH : count * TRAY_ITEM_H + (count - 1) * TRAY_CARD_GAP
}

function computeLayout(a: { x: number; y: number }, count: number): { mascotTop: number; trayTop: number; windowH: number } {
  const d = screen.getDisplayNearestPoint(a).workArea
  const midY = d.y + d.height / 2
  const th = trayH(count)

  let mascotTop: number
  let trayTop: number
  let windowH: number

  if (count > 0 && a.y >= midY) {
    // Bottom half — tray above mascot
    mascotTop = PAD + th + TRAY_GAP
    trayTop = PAD
    windowH = mascotTop + MASCOT_H + PAD
  } else {
    // Top half or no tray — tray below mascot
    mascotTop = PAD
    trayTop = PAD + MASCOT_H + TRAY_GAP
    windowH = count > 0 ? trayTop + th + PAD : PAD + MASCOT_H + PAD
  }

  return { mascotTop, trayTop, windowH }
}

function anchorToWindowBounds(a: { x: number; y: number }, mascotTop: number, windowH: number): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(a.x - MASCOT_IN_WIN_X),
    y: Math.round(a.y - mascotTop),
    width: VIEWPORT_W,
    height: windowH,
  }
}

function clampAnchor(a: { x: number; y: number }): { x: number; y: number } {
  const d = screen.getDisplayNearestPoint(a).workArea
  return {
    x: Math.max(d.x, Math.min(d.x + d.width - MASCOT_W, a.x)),
    y: Math.max(d.y, Math.min(d.y + d.height - MASCOT_H, a.y)),
  }
}

function defaultAnchor(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay()
  return {
    x: workArea.x + workArea.width - SCREEN_MARGIN - MASCOT_W,
    y: workArea.y + workArea.height - SCREEN_MARGIN - MASCOT_H,
  }
}

function applyLayout(): void {
  if (!petWin || petWin.isDestroyed()) return
  const { mascotTop, trayTop, windowH } = computeLayout(anchor, trayCount)
  petWin.setBounds(anchorToWindowBounds(anchor, mascotTop, windowH))

  // Only send to renderer when layout actually changes
  if (!lastSentLayout || lastSentLayout.mascotTop !== mascotTop || lastSentLayout.trayTop !== trayTop) {
    lastSentLayout = { mascotTop, trayTop }
    petWin.webContents.send('pet:layout', { mascotTop, trayTop })
  }
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
  anchor = clampAnchor(saved || defaultAnchor())

  const { mascotTop, windowH } = computeLayout(anchor, trayCount)
  const bounds = anchorToWindowBounds(anchor, mascotTop, windowH)

  petWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: VIEWPORT_W,
    height: windowH,
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
    const { mascotTop, trayTop } = computeLayout(anchor, trayCount)
    return {
      pets: loadPets(),
      selectedPetId: settingsStore.get('selectedPetId', 'ditto') as string,
      isOpen: settingsStore.get('petOpen', true) as boolean,
      sessions: sessionManager.list(),
      initialLayout: { mascotTop, trayTop },
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
      execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'ignore' })
      const manifestPath = join(tmpDir, 'pet.json')
      if (!existsSync(manifestPath)) throw new Error('Missing pet.json')
      const manifest: PetManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      const sheetPath = join(tmpDir, manifest.spritesheetPath)
      if (!existsSync(sheetPath)) throw new Error('Missing spritesheet')
      const destDir = join(userPetsDir(), manifest.id)
      mkdirSync(destDir, { recursive: true })
      cpSync(tmpDir, destDir, { recursive: true })
      return manifest
    } finally {
      try { execSync(`rm -rf "${tmpDir}"`, { stdio: 'ignore' }) } catch { /* ignore */ }
    }
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
    const { mascotTop } = computeLayout(anchor, trayCount)
    pointerAnchorX = clientX - MASCOT_IN_WIN_X
    pointerAnchorY = clientY - mascotTop
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
    if (h === trayPxH) return
    trayPxH = h
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
