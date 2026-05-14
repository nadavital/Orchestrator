import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { electronApp, is } from '@electron-toolkit/utils'
import { configureAppProfile, getAppProfile } from './appProfile'

const appProfile = configureAppProfile()

let registerIpcHandlers: typeof import('./ipc').registerIpcHandlers
let createPetOverlayWindow: typeof import('./petOverlay').createPetOverlayWindow
let setCreateMainWindowCallback: typeof import('./petOverlay').setCreateMainWindowCallback
let projectStore: typeof import('./projects').projectStore
let sessionManager: typeof import('./sessions').sessionManager

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: appProfile.isIsolated ? `Orchestrator - ${appProfile.displayName}` : 'Orchestrator',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 20, y: 24 },
    backgroundColor: '#00000000',
    transparent: true,
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    mainWindow!.setTitle(appProfile.isIsolated ? `Orchestrator - ${appProfile.displayName}` : '')
    if (!getAppProfile().disablePetOverlay) {
      createPetOverlayWindow(mainWindow!)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  maybeRunAutomatedUiSmoke(mainWindow)
}

function maybeRunAutomatedUiSmoke(win: BrowserWindow): void {
  const outputPath = process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT
  if (!outputPath) return
  const screenshotPath = process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_SCREENSHOT

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      win.webContents.executeJavaScript(`
        (async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const profile = await window.api.app.getProfile();
          let projects = await window.api.projects.list();
          if (projects.length === 0) {
            const root = ${JSON.stringify(process.env.ORCHESTRATOR_SMOKE_WORKSPACE_DIR ?? process.cwd())};
            const project = await window.api.projects.add('Automated UI Smoke', root);
            projects = [project];
          }
          let sessions = await window.api.sessions.list();
          if (sessions.length === 0) {
            const project = projects[0];
            const session = await window.api.sessions.create({
              projectId: project.id,
              workDir: project.rootPath,
              useWorktree: false,
              repoRoot: project.rootPath
            });
            await window.api.projects.addSession(project.id, session.id);
          }
          await sleep(900);
          const bodyText = document.body.innerText;
          const buttons = [...document.querySelectorAll('button')].map((button) => ({
            text: button.textContent?.trim() ?? '',
            title: button.getAttribute('title') ?? '',
            label: button.getAttribute('aria-label') ?? ''
          }));
          const textarea = document.querySelector('textarea');
          textarea?.focus();
          if (textarea) {
            textarea.value = '/btw smoke check';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await sleep(100);
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'settings' || ${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'resources') {
            const settingsButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.trim() === 'Settings' || button.getAttribute('title') === 'Settings');
            settingsButton?.click();
            await sleep(450);
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'resources') {
            const resourcesButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('Resources'));
            resourcesButton?.click();
            await sleep(450);
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'terminal') {
            const terminalButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Toggle terminal');
            terminalButton?.click();
            await sleep(700);
          }
          return {
            profile,
            title: document.title,
            bodyText,
            hasProfileBadge: bodyText.includes(profile.displayName + ' profile'),
            hasComposer: Boolean(textarea),
            hasSidebarNavigation: buttons.some((button) =>
              button.title === 'Settings' ||
              button.label === 'Settings' ||
              button.label === 'Resources' ||
              button.text.includes('Resources')
            ),
            hasSideQuestionCommandText: bodyText.includes('/btw') || Boolean(textarea && textarea.value.includes('/btw')),
            buttonCount: buttons.length,
            buttons: buttons.slice(0, 30)
          };
        })()
      `).then(async (result) => {
        if (screenshotPath) {
          const image = await win.webContents.capturePage()
          writeFileSync(screenshotPath, image.toPNG())
        }
        writeFileSync(outputPath, JSON.stringify({ ok: true, result, screenshotPath }, null, 2))
        app.quit()
      }).catch((error) => {
        writeFileSync(outputPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
        app.quit()
      })
    }, 700)
  })
}

app.whenReady().then(async () => {
  ;({ registerIpcHandlers } = await import('./ipc'))
  ;({ createPetOverlayWindow, setCreateMainWindowCallback } = await import('./petOverlay'))
  ;({ projectStore } = await import('./projects'))
  ;({ sessionManager } = await import('./sessions'))

  electronApp.setAppUserModelId('com.orchestrator.app')

  registerIpcHandlers(ipcMain)
  setCreateMainWindowCallback(createWindow)
  await bootstrapAutomatedUiSmokeState()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

async function bootstrapAutomatedUiSmokeState(): Promise<void> {
  if (!process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT) return
  const workspace = process.env.ORCHESTRATOR_SMOKE_WORKSPACE_DIR ?? process.cwd()
  const existing = projectStore.list()
  const project = existing[0] ?? projectStore.add('Automated UI Smoke', workspace)
  const existingSessions = sessionManager.list()
  if (existingSessions.some((session) => session.projectId === project.id)) return
  const session = await sessionManager.create({
    projectId: project.id,
    workDir: project.rootPath,
    useWorktree: false,
    repoRoot: project.rootPath
  })
  projectStore.addSession(project.id, session.id)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
