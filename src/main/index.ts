import { app, shell, BrowserWindow, ipcMain, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { electronApp, is } from '@electron-toolkit/utils'
import { configureAppProfile, getAppProfile } from './appProfile'
import type { ChatMessage } from '../types'
import { APP_COMMANDS } from '../types/appCommands'
import type { AppMenuCommand } from '../types/appCommands'

const appProfile = configureAppProfile()

let registerIpcHandlers: typeof import('./ipc').registerIpcHandlers
let createPetOverlayWindow: typeof import('./petOverlay').createPetOverlayWindow
let destroyPetOverlayWindow: typeof import('./petOverlay').destroyPetOverlayWindow
let setCreateMainWindowCallback: typeof import('./petOverlay').setCreateMainWindowCallback
let projectStore: typeof import('./projects').projectStore
let sessionManager: typeof import('./sessions').sessionManager

let mainWindow: BrowserWindow | null = null

function sendAppMenuCommand(command: AppMenuCommand): void {
  mainWindow?.webContents.send('app:menu-command', command)
}

function installApplicationMenu(): void {
  const isMac = process.platform === 'darwin'
  const appSubmenu: MenuItemConstructorOptions[] = [
    { role: 'about' },
    { type: 'separator' },
    { role: 'services' },
    { type: 'separator' },
    { role: 'hide' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' }
  ]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: app.name, submenu: appSubmenu } satisfies MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        menuCommand('new-chat'),
        menuCommand('open-command-menu'),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        menuCommand('search-transcript')
      ]
    },
    {
      label: 'Chat',
      submenu: [
        menuCommand('rename-chat'),
        menuCommand('toggle-chat-pin'),
        { type: 'separator' },
        menuCommand('previous-chat'),
        menuCommand('next-chat'),
        menuCommand('previous-recent-chat'),
        menuCommand('next-recent-chat'),
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, index): MenuItemConstructorOptions => ({
          label: `Go to Chat ${index + 1}`,
          accelerator: `CmdOrCtrl+${index + 1}`,
          click: () => sendAppMenuCommand(`go-chat-${index + 1}` as AppMenuCommand)
        }))
      ]
    },
    {
      label: 'View',
      submenu: [
        menuCommand('toggle-inspector'),
        menuCommand('toggle-terminal'),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])
      ]
    },
    {
      label: 'Help',
      submenu: [
        menuCommand('keyboard-shortcuts'),
        menuCommand('settings')
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function menuCommand(command: keyof typeof APP_COMMANDS): MenuItemConstructorOptions {
  const definition = APP_COMMANDS[command]
  return {
    label: definition.menuLabel ?? definition.label,
    accelerator: definition.accelerator,
    click: () => sendAppMenuCommand(definition.id)
  }
}

function isBrokenPipeError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EPIPE'
}

function installBrokenPipeGuards(): void {
  const ignoreBrokenPipe = (error: NodeJS.ErrnoException): void => {
    if (isBrokenPipeError(error)) return
    throw error
  }
  const ignoreUncaughtBrokenPipe = (error: Error): void => {
    if (isBrokenPipeError(error)) return
    process.removeListener('uncaughtException', ignoreUncaughtBrokenPipe)
    throw error
  }

  process.stdout.on('error', ignoreBrokenPipe)
  process.stderr.on('error', ignoreBrokenPipe)
  process.on('uncaughtException', ignoreUncaughtBrokenPipe)
}

installBrokenPipeGuards()

function installWebviewGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const src = typeof params.src === 'string' ? params.src : ''
      if (!isAllowedWebviewNavigation(src)) {
        event.preventDefault()
        return
      }
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.allowRunningInsecureContent = false
      webPreferences.plugins = false
      params.allowpopups = 'false'
    })

    if (contents.getType() !== 'webview') return

    contents.setWindowOpenHandler(({ url }) => {
      openExternalIfAllowed(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (isAllowedWebviewNavigation(url)) return
      event.preventDefault()
      openExternalIfAllowed(url)
    })
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
  })
}

function isAllowedWebviewNavigation(rawUrl: string): boolean {
  if (!rawUrl || rawUrl === 'about:blank') return true
  try {
    const url = new URL(rawUrl)
    return ['http:', 'https:', 'file:', 'about:'].includes(url.protocol)
  } catch {
    return false
  }
}

function openExternalIfAllowed(rawUrl: string): void {
  try {
    const url = new URL(rawUrl)
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) {
      void shell.openExternal(rawUrl)
    }
  } catch {
    // Ignore malformed popup targets from guest contents.
  }
}

installWebviewGuards()

function createWindow(): void {
  const isAutomatedUiSmoke = Boolean(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT)
  const shouldForegroundWindow =
    !isAutomatedUiSmoke || process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_FOREGROUND === '1'

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
      contextIsolation: true,
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (shouldForegroundWindow) {
      mainWindow!.show()
    } else {
      mainWindow!.showInactive()
    }
    mainWindow!.setTitle(appProfile.isIsolated ? `Orchestrator - ${appProfile.displayName}` : '')
    if (!getAppProfile().disablePetOverlay) {
      createPetOverlayWindow(mainWindow!)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const rendererHash = process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'design-system'
    ? 'design-system'
    : undefined

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${rendererHash ? `#${rendererHash}` : ''}`)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), rendererHash ? { hash: rendererHash } : undefined)
  }

  maybeRunAutomatedUiSmoke(mainWindow)
}

function maybeRunAutomatedUiSmoke(win: BrowserWindow): void {
  const outputPath = process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT
  if (!outputPath) return
  const screenshotPath = process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_SCREENSHOT
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'scroll') {
    runAutomatedScrollSmoke(win, outputPath, screenshotPath)
    return
  }
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'sidebar') {
    runAutomatedSidebarSmoke(win, outputPath, screenshotPath)
    return
  }
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'transcript-layout') {
    runAutomatedTranscriptLayoutSmoke(win, outputPath, screenshotPath)
    return
  }
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'pet-overlay') {
    runAutomatedPetOverlaySmoke(win, outputPath, screenshotPath)
    return
  }
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'session-switch') {
    runAutomatedSessionSwitchSmoke(win, outputPath, screenshotPath)
    return
  }
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'transcript-stress') {
    runAutomatedTranscriptStressSmoke(win, outputPath, screenshotPath)
    return
  }
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'motion-reduced') {
    runAutomatedReducedMotionSmoke(win, outputPath, screenshotPath)
    return
  }
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'empty-state') {
    runAutomatedEmptyStateSmoke(win, outputPath, screenshotPath)
    return
  }

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
          const textarea = document.querySelector('textarea');
          textarea?.focus();
          if (textarea && !['composer', 'extensions'].includes(${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)})) {
            textarea.value = '/btw smoke check';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await sleep(100);
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'inspector') {
            const chatActionsButton = document.querySelector('[data-testid="titlebar-chat-actions"]');
            const headerActions = document.querySelector('[data-testid="titlebar-actions"]')?.getAttribute('data-header-actions') ?? '';
            var headerActionMenuWorks =
              headerActions.includes('folder') &&
              headerActions.includes('project') &&
              headerActions.includes('session') &&
              headerActions.includes('provider-session');
            if (chatActionsButton instanceof HTMLElement) {
              chatActionsButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              await sleep(120);
              headerActionMenuWorks = headerActionMenuWorks ||
                (
                  document.body.innerText.includes('Copy folder path') &&
                  document.body.innerText.includes('Copy project path') &&
                  document.body.innerText.includes('Copy session ID') &&
                  document.body.innerText.includes('Copy provider session ID')
                );
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
              await sleep(80);
            }
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'settings' || ${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'pets') {
            const settingsButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.trim() === 'Settings' || button.getAttribute('title') === 'Settings');
            settingsButton?.click();
            await sleep(450);
            if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'settings') {
              const appearanceButton = [...document.querySelectorAll('button')]
                .find((button) => button.textContent?.includes('Appearance'));
              appearanceButton?.click();
              await sleep(260);
              const themeImport = document.querySelector('[data-testid="theme-import-input"]');
              if (themeImport instanceof HTMLTextAreaElement) {
                const setter = Object.getOwnPropertyDescriptor(themeImport.constructor.prototype, 'value')?.set;
                setter?.call(themeImport, 'codex-theme-v1:{"variant":"light","codeThemeId":"github-light","theme":{"accent":"#2255aa","surface":"#ffffff","ink":"#111111","contrast":50,"opaqueWindows":false}}');
                themeImport.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(80);
                const importButton = document.querySelector('[data-testid="theme-import-button"]');
                if (importButton instanceof HTMLButtonElement) importButton.click();
                await sleep(160);
              }
              var themeImportWorks = document.querySelector('[data-testid="theme-import-status"]')?.textContent?.includes('Theme imported') === true;
              var themeSharingControls = Boolean(document.querySelector('[data-testid="copy-light-theme"]')) && Boolean(document.querySelector('[data-testid="appearance-light-chrome-editor"]'));
              const appearanceText = document.querySelector('[data-testid="appearance-settings-section"]')?.textContent ?? '';
              var settingsTaxonomyWorks =
                appearanceText.includes('Mode') &&
                appearanceText.includes('Presets') &&
                appearanceText.includes('Theme editor') &&
                appearanceText.includes('Sharing') &&
                appearanceText.includes('Layout and reading');
              const diagnosticsButton = [...document.querySelectorAll('button')]
                .find((button) => button.textContent?.includes('Providers'));
              diagnosticsButton?.click();
              await sleep(450);
              const advancedButton = [...document.querySelectorAll('button')]
                .find((button) => button.textContent?.includes('Advanced'));
              advancedButton?.click();
              await sleep(450);
              const diagnosticsSection = document.querySelector('[data-testid="provider-settings-section"]');
              var settingsDiagnosticsSectionWorks =
                diagnosticsSection instanceof HTMLElement &&
                diagnosticsSection.innerText.includes('Provider details') &&
                diagnosticsSection.innerText.includes('Config file');
              var settingsUsageDiagnosticsWorks =
                diagnosticsSection instanceof HTMLElement &&
                diagnosticsSection.innerText.includes('Usage') &&
                diagnosticsSection.innerText.includes('Captured runs') &&
                diagnosticsSection.innerText.includes('Tokens') &&
                diagnosticsSection.innerText.includes('Cost') &&
                diagnosticsSection.innerText.includes('Budget/fallback') &&
                Boolean(document.querySelector('[data-testid="provider-usage-diagnostics-card"]'));
              const dataButton = [...document.querySelectorAll('button')]
                .find((button) => button.textContent?.includes('Data controls'));
              dataButton?.click();
              await sleep(220);
              const dataSection = document.querySelector('[data-testid="data-controls-settings-section"]');
              var settingsDataControlsWorks =
                dataSection instanceof HTMLElement &&
                dataSection.innerText.includes('Local profile') &&
                dataSection.innerText.includes('User data') &&
                dataSection.innerText.includes('Open data folder');
            }
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'resources' || ${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'capabilities') {
            const capabilitiesButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('Capabilities'));
            capabilitiesButton?.click();
            await sleep(450);
            for (let index = 0; index < 20; index += 1) {
              const text = document.body.innerText;
              if (!text.includes('Refreshing') && !text.includes('Loading capabilities')) break;
              await sleep(500);
            }
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'pets') {
            const petsButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('Pets'));
            petsButton?.click();
            await sleep(450);
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'terminal') {
            const terminalButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Toggle terminal');
            terminalButton?.click();
            await sleep(700);
            const newTerminalButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'New terminal');
            if (newTerminalButton instanceof HTMLButtonElement) {
              newTerminalButton.click();
              await sleep(260);
            }
            const bottomPanelWithTabs = document.querySelector('[data-testid="session-bottom-panel"]');
            var terminalTabsPersistState =
              bottomPanelWithTabs instanceof HTMLElement &&
              bottomPanelWithTabs.dataset.bottomPanelTabs?.includes(',') === true &&
              bottomPanelWithTabs.dataset.bottomPanelActiveTab !== '0';
            const hideTerminalButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Hide terminal');
            if (hideTerminalButton instanceof HTMLButtonElement) {
              hideTerminalButton.click();
              await sleep(180);
            }
            terminalButton?.click();
            await sleep(260);
            const bottomPanelRestored = document.querySelector('[data-testid="session-bottom-panel"]');
            var terminalRestoreWorks =
              bottomPanelRestored instanceof HTMLElement &&
              bottomPanelRestored.dataset.bottomPanelTabs?.includes(',') === true &&
              bottomPanelRestored.dataset.bottomPanelActiveTab !== '0' &&
              Number(bottomPanelRestored.dataset.bottomPanelHeight ?? '0') >= 120;
            const terminalTabs = [...document.querySelectorAll('[data-testid="session-bottom-panel"] [role="tab"]')];
            var terminalTabMenuWorks = false;
            var terminalTabReorderWorks = false;
            if (terminalTabs.length >= 2) {
              const beforeOrder = document.querySelector('[data-testid="session-bottom-panel"]')?.getAttribute('data-bottom-panel-tabs') ?? '';
              const secondTab = terminalTabs[1];
              secondTab.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: secondTab.getBoundingClientRect().left + 12,
                clientY: secondTab.getBoundingClientRect().bottom + 4
              }));
              await sleep(140);
              terminalTabMenuWorks =
                document.body.innerText.includes('Move tab left') &&
                document.body.innerText.includes('Move tab right') &&
                document.body.innerText.includes('Close terminal tab');
              const moveLeft = [...document.querySelectorAll('[role="menuitem"]')]
                .find((item) => item.textContent?.includes('Move tab left'));
              if (moveLeft instanceof HTMLButtonElement) {
                moveLeft.click();
                await sleep(160);
                const afterOrder = document.querySelector('[data-testid="session-bottom-panel"]')?.getAttribute('data-bottom-panel-tabs') ?? '';
                terminalTabReorderWorks = beforeOrder.includes(',') && beforeOrder !== afterOrder;
              }
            }
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'inspector') {
            const sidebarButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Toggle sidebar');
            sidebarButton?.click();
            await sleep(700);
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'extensions') {
            const setNativeValue = (element, value) => {
              const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
              setter?.call(element, value);
            };
            if (textarea) {
              setNativeValue(textarea, '/extensions');
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(220);
              const extensionCommand = [...document.querySelectorAll('button')]
                .find((button) => button.textContent?.includes('/extensions'));
              extensionCommand?.click();
              await sleep(900);
            }
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'inspector') {
            const rightPanelBefore = document.querySelector('[data-testid="session-right-panel"]');
            const widthBefore = Number(rightPanelBefore?.getAttribute('data-right-panel-width') ?? '0');
            const primaryBefore = document.querySelector('[data-testid="session-primary-content"]');
            const primaryWidthBefore = primaryBefore instanceof HTMLElement ? primaryBefore.getBoundingClientRect().width : 0;
            const expandButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Maximize inspector');
            if (expandButton instanceof HTMLButtonElement) {
              expandButton.click();
              await sleep(180);
            }
            const rightPanelExpanded = document.querySelector('[data-testid="session-right-panel"]');
            const primaryAfterExpand = document.querySelector('[data-testid="session-primary-content"]');
            const primaryWidthAfterExpand = primaryAfterExpand instanceof HTMLElement ? primaryAfterExpand.getBoundingClientRect().width : 0;
            var rightPanelExpandDebug = {
              widthBefore,
              dataWidthAfterExpand: Number(rightPanelExpanded?.getAttribute('data-right-panel-width') ?? '0'),
              actualWidthAfterExpand: rightPanelExpanded instanceof HTMLElement ? rightPanelExpanded.getBoundingClientRect().width : 0,
              fullWidthAfterExpand: rightPanelExpanded instanceof HTMLElement ? rightPanelExpanded.dataset.rightPanelFullWidth : null,
              primaryWidthBefore,
              primaryWidthAfterExpand
            };
            var rightPanelExpandWorks =
              rightPanelExpanded instanceof HTMLElement &&
              rightPanelExpanded.dataset.rightPanelFullWidth === 'true' &&
              rightPanelExpanded.getBoundingClientRect().width > widthBefore + 40 &&
              primaryWidthAfterExpand >= primaryWidthBefore - 8;
            const restoreButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Restore inspector');
            if (restoreButton instanceof HTMLButtonElement) {
              restoreButton.click();
              await sleep(120);
            }
            const diffSearch = document.querySelector('[data-testid="diff-file-search"]');
            if (diffSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(diffSearch.constructor.prototype, 'value')?.set;
              setter?.call(diffSearch, 'review-base');
              diffSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            var reviewSearchWorks =
              document.body.innerText.includes('review-base.txt') &&
              document.body.innerText.includes('after review') &&
              document.body.innerText.includes('No diff available') === false;
            if (diffSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(diffSearch.constructor.prototype, 'value')?.set;
              setter?.call(diffSearch, 'binary-preview-smoke');
              diffSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            const binaryReviewButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('binary-preview-smoke.bin'));
            if (binaryReviewButton instanceof HTMLButtonElement) {
              binaryReviewButton.click();
              await sleep(220);
            }
            var reviewBinaryStateWorks =
              Boolean(document.querySelector('[data-testid="review-binary-state"]')) &&
              document.body.innerText.includes('Binary file changed');
            if (diffSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(diffSearch.constructor.prototype, 'value')?.set;
              setter?.call(diffSearch, '');
              diffSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(120);
            }
            const filesTabButton = document.querySelector('[data-tab-id="files"]')?.closest('[role="tab"]');
            if (filesTabButton instanceof HTMLElement) {
              filesTabButton.click();
            } else {
              const inspectorToolsButton = [...document.querySelectorAll('button')]
                .find((button) => button.getAttribute('title') === 'Add inspector tab');
              if (inspectorToolsButton instanceof HTMLButtonElement) {
                inspectorToolsButton.click();
                await sleep(120);
                const filesMenuItem = [...document.querySelectorAll('[role="menuitem"]')]
                  .find((item) => item.textContent?.includes('Files'));
                if (filesMenuItem instanceof HTMLElement) filesMenuItem.click();
              }
            }
            {
              await sleep(260);
            }
            const fileSearch = document.querySelector('[data-testid="workspace-file-search"]');
            if (fileSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(fileSearch.constructor.prototype, 'value')?.set;
              setter?.call(fileSearch, 'nested note');
              fileSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(220);
            }
            const nestedFileButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('nested note.md'));
            if (nestedFileButton instanceof HTMLButtonElement) {
              nestedFileButton.click();
              await sleep(220);
            }
            const addFileButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Add file to chat');
            if (addFileButton instanceof HTMLButtonElement) {
              addFileButton.click();
              await sleep(180);
            }
            var filesTabSearchWorks =
              document.body.innerText.includes('nested note.md') &&
              document.body.innerText.includes('Nested file smoke preview') &&
              document.body.innerText.includes('Nested Folder');
            var filesTabAttachWorks =
              [...document.querySelectorAll('.attachment-pill')]
                .some((attachment) => attachment.textContent?.includes('nested note.md'));
            if (fileSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(fileSearch.constructor.prototype, 'value')?.set;
              setter?.call(fileSearch, 'binary-preview-smoke');
              fileSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            const binaryFileButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('binary-preview-smoke.bin'));
            if (binaryFileButton instanceof HTMLButtonElement) {
              binaryFileButton.click();
              await sleep(160);
            }
            var filesBinaryPreviewWorks =
              document.body.innerText.includes('Binary file preview unavailable') &&
              !document.querySelector('[data-testid="workspace-text-preview"]');
            if (fileSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(fileSearch.constructor.prototype, 'value')?.set;
              setter?.call(fileSearch, 'does-not-exist-smoke');
              fileSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(120);
            }
            var filesNoResultsWorks =
              document.body.innerText.includes('No matching files') &&
              !document.querySelector('[data-testid="workspace-text-preview"]') &&
              (addFileButton instanceof HTMLButtonElement ? addFileButton.disabled : true);
            const browserPanelTabButton = document.querySelector('[data-tab-id="browser"]')?.closest('[role="tab"]');
            if (browserPanelTabButton instanceof HTMLElement) {
              browserPanelTabButton.click();
            } else {
              const inspectorToolsButton = [...document.querySelectorAll('button')]
                .find((button) => button.getAttribute('title') === 'Add inspector tab');
              if (inspectorToolsButton instanceof HTMLButtonElement) {
                inspectorToolsButton.click();
                await sleep(120);
                const browserMenuItem = [...document.querySelectorAll('[role="menuitem"]')]
                  .find((item) => item.textContent?.includes('Browser'));
                if (browserMenuItem instanceof HTMLElement) browserMenuItem.click();
              }
            }
            {
              await sleep(260);
            }
            const browserInput = document.querySelector('[data-testid="browser-url-input"]');
            if (browserInput instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(browserInput.constructor.prototype, 'value')?.set;
              setter?.call(browserInput, ${JSON.stringify(process.env.ORCHESTRATOR_BROWSER_SMOKE_URL ?? 'http://127.0.0.1:9')});
              browserInput.dispatchEvent(new Event('input', { bubbles: true }));
              browserInput.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              await sleep(1200);
            }
            const browserActionsButton = document.querySelector('[data-testid="browser-actions-menu"]');
            if (browserActionsButton instanceof HTMLButtonElement) {
              browserActionsButton.click();
              await sleep(160);
            }
            const browserWebview = document.querySelector('[data-testid="browser-webview"]');
            const captureBrowserButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Capture screenshot');
            if (captureBrowserButton instanceof HTMLButtonElement) {
              captureBrowserButton.click();
              await sleep(500);
            }
            var browserTabWorks =
              browserWebview instanceof HTMLElement &&
              typeof browserWebview.getAttribute === 'function' &&
              document.body.innerText.includes('Orchestrator Browser Smoke');
            var browserScreenshotWorks = Boolean(document.querySelector('[data-testid="browser-screenshot-preview"]'));
            const browserPanel = document.querySelector('[data-testid="browser-panel"]');
            const findInPageButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Find in page');
            var browserFindWorks = false;
            if (findInPageButton instanceof HTMLButtonElement) {
              findInPageButton.click();
              await sleep(120);
              const findInput = document.querySelector('[data-testid="browser-find-input"]');
              if (findInput instanceof HTMLInputElement) {
                const setter = Object.getOwnPropertyDescriptor(findInput.constructor.prototype, 'value')?.set;
                setter?.call(findInput, 'Browser');
                findInput.dispatchEvent(new Event('input', { bubbles: true }));
                for (let index = 0; index < 20; index += 1) {
                  const matches = Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-matches') ?? '0');
                  if (matches > 0) break;
                  await sleep(100);
                }
                browserFindWorks =
                  document.activeElement === findInput &&
                  findInput.value === 'Browser' &&
                  Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-matches') ?? '0') > 0;
              }
            }
            const browserActionsButtonAfterFind = document.querySelector('[data-testid="browser-actions-menu"]');
            if (browserActionsButtonAfterFind instanceof HTMLButtonElement) {
              browserActionsButtonAfterFind.click();
              await sleep(120);
            }
            const zoomInButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Zoom in');
            if (zoomInButton instanceof HTMLButtonElement) {
              zoomInButton.click();
              await sleep(120);
            }
            var browserZoomWorks =
              Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-zoom') ?? '1') > 1;
            const mobilePreviewButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Mobile preview');
            if (mobilePreviewButton instanceof HTMLButtonElement) {
              mobilePreviewButton.click();
              await sleep(120);
            }
            const browserViewportFrame = document.querySelector('[data-testid="browser-viewport-frame"]');
            var browserDeviceModeWorks =
              document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-device-mode') === 'mobile' &&
              browserViewportFrame instanceof HTMLElement &&
              browserViewportFrame.getBoundingClientRect().width <= 410;
            const noCacheButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Reload without cache');
            if (noCacheButton instanceof HTMLButtonElement) {
              noCacheButton.click();
              for (let index = 0; index < 30; index += 1) {
                if (Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-cache-reloads') ?? '0') > 0) break;
                await sleep(100);
              }
            }
            var browserCacheReloadWorks =
              Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-cache-reloads') ?? '0') > 0;
            const newBrowserTabButton = document.querySelector('[data-testid="browser-new-tab"]');
            if (newBrowserTabButton instanceof HTMLButtonElement) {
              newBrowserTabButton.click();
              await sleep(120);
            }
            var browserMultiTabWorks =
              Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-tab-count') ?? '0') >= 2;
            const browserTabs = [...document.querySelectorAll('[data-testid="browser-tab"]')];
            if (browserTabs[0] instanceof HTMLButtonElement) {
              browserTabs[0].click();
              await sleep(240);
            }
            const runBrowserInspectionButton = document.querySelector('[data-testid="browser-run-inspection"]');
            if (runBrowserInspectionButton instanceof HTMLButtonElement) {
              runBrowserInspectionButton.click();
              for (let index = 0; index < 30; index += 1) {
                const targetCount = Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-dom-targets') ?? '0');
                const assetCount = Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-asset-count') ?? '0');
                if (targetCount > 0 && assetCount > 0) break;
                await sleep(100);
              }
            }
            var browserInspectionWorks =
              Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-dom-targets') ?? '0') > 0 &&
              Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-asset-count') ?? '0') > 0;
            const targetsInspectorButton = document.querySelector('[data-testid="browser-inspector-targets"]');
            if (targetsInspectorButton instanceof HTMLButtonElement) {
              targetsInspectorButton.click();
              await sleep(120);
            }
            var browserTargetsPaneWorks =
              document.querySelector('[data-testid="browser-target-select"]') instanceof HTMLSelectElement &&
              document.body.innerText.includes('Point click') &&
              document.body.innerText.includes('Clipboard');
            const assetsInspectorButton = document.querySelector('[data-testid="browser-inspector-assets"]');
            if (assetsInspectorButton instanceof HTMLButtonElement) {
              assetsInspectorButton.click();
              await sleep(120);
            }
            const bundleAssetsButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('Bundle files'));
            if (bundleAssetsButton instanceof HTMLButtonElement) {
              bundleAssetsButton.click();
              for (let index = 0; index < 30; index += 1) {
                if ((document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-asset-bundle-path') ?? '').length > 0) break;
                await sleep(100);
              }
            }
            var browserAssetBundleWorks =
              (document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-asset-bundle-path') ?? '').includes('manifest.json');
            const securityInspectorButton = document.querySelector('[data-testid="browser-inspector-security"]');
            if (securityInspectorButton instanceof HTMLButtonElement) {
              securityInspectorButton.click();
              await sleep(120);
            }
            var browserSecurityPaneWorks =
              document.body.innerText.includes('Approval') &&
              document.body.innerText.includes('Allowed') &&
              document.body.innerText.includes('Downloads') &&
              document.body.innerText.includes('Uploads');
            const hideBrowserButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Hide browser surface');
            if (hideBrowserButton instanceof HTMLButtonElement) {
              hideBrowserButton.click();
              await sleep(120);
            }
            var browserVisibilityControlWorks =
              document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-visible') === 'false';
            const showBrowserButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Show browser surface');
            if (showBrowserButton instanceof HTMLButtonElement) {
              showBrowserButton.click();
              await sleep(120);
            }
            const browserTabButton = document.querySelector('[data-tab-id="browser"]')?.closest('[role="tab"]');
            var rightPanelContextMenuWorks = false;
            var rightPanelTabReorderWorks = false;
            if (browserTabButton instanceof HTMLElement) {
              const beforeOrder = document.querySelector('[data-testid="session-right-panel"]')?.getAttribute('data-right-panel-tabs') ?? '';
              browserTabButton.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: browserTabButton.getBoundingClientRect().left + 12,
                clientY: browserTabButton.getBoundingClientRect().bottom + 4
              }));
              for (let index = 0; index < 15; index += 1) {
                if (document.body.innerText.includes('Move tab left')) break;
                await sleep(100);
              }
              rightPanelContextMenuWorks =
                document.body.innerText.includes('Move tab left') &&
                document.body.innerText.includes('Move tab right') &&
                document.body.innerText.includes('Close tab');
              const moveLeft = [...document.querySelectorAll('[role="menuitem"]')]
                .find((item) => item.textContent?.includes('Move tab left'));
              if (moveLeft instanceof HTMLButtonElement) {
                moveLeft.click();
                for (let index = 0; index < 15; index += 1) {
                  const afterOrder = document.querySelector('[data-testid="session-right-panel"]')?.getAttribute('data-right-panel-tabs') ?? '';
                  rightPanelTabReorderWorks =
                    beforeOrder.includes('files,browser') &&
                    afterOrder.includes('browser,files');
                  if (rightPanelTabReorderWorks) break;
                  await sleep(100);
                }
              }
            }
            const openBlankSideChat = async () => {
              const activeTextarea = document.querySelector('textarea');
              if (!(activeTextarea instanceof HTMLTextAreaElement)) return;
              const setter = Object.getOwnPropertyDescriptor(activeTextarea.constructor.prototype, 'value')?.set;
              setter?.call(activeTextarea, '/btw');
              activeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(80);
              const sendButton = [...document.querySelectorAll('button')]
                .find((button) => button.getAttribute('title')?.startsWith('Send'));
              if (sendButton instanceof HTMLButtonElement) sendButton.click();
              await sleep(220);
            };
            await openBlankSideChat();
            await openBlankSideChat();
            const sideChatTabsBeforeClose = document.querySelectorAll('[data-tab-id^="sidechat:"]').length;
            var sideChatTabsWork = sideChatTabsBeforeClose >= 2;
            const sideChatTabs = [...document.querySelectorAll('[data-tab-id^="sidechat:"]')]
              .map((label) => label.closest('[role="tab"]'))
              .filter(Boolean);
            const setNativeValue = (element, value) => {
              const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
              setter?.call(element, value);
            };
            var sideChatDraftPersistenceWorks = false;
            if (sideChatTabs.length >= 2) {
              const firstSideTab = sideChatTabs[0];
              const secondSideTab = sideChatTabs[1];
              secondSideTab.click();
              await sleep(80);
              let sideInput = document.querySelector('[data-testid="side-chat-input"]');
              if (sideInput instanceof HTMLInputElement) {
                setNativeValue(sideInput, 'draft for second side chat');
                sideInput.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(80);
              }
              firstSideTab.click();
              await sleep(80);
              sideInput = document.querySelector('[data-testid="side-chat-input"]');
              if (sideInput instanceof HTMLInputElement) {
                setNativeValue(sideInput, 'draft for first side chat');
                sideInput.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(80);
              }
              secondSideTab.click();
              await sleep(80);
              const secondInput = document.querySelector('[data-testid="side-chat-input"]');
              const secondDraftRestored = secondInput instanceof HTMLInputElement && secondInput.value === 'draft for second side chat';
              firstSideTab.click();
              await sleep(80);
              const firstInput = document.querySelector('[data-testid="side-chat-input"]');
              const firstDraftRestored = firstInput instanceof HTMLInputElement && firstInput.value === 'draft for first side chat';
              sideChatDraftPersistenceWorks =
                secondDraftRestored &&
                firstDraftRestored &&
                document.querySelector('[data-testid="side-chat-panel"]')?.getAttribute('data-side-chat-message-count') === '0';
            }
            const closeSideChatButton = [...document.querySelectorAll('[title^="Close Side chat"]')].at(-1);
            if (closeSideChatButton instanceof HTMLElement) {
              closeSideChatButton.click();
              await sleep(160);
            }
            var sideChatCloseWorks =
              sideChatTabsWork &&
              document.querySelectorAll('[data-tab-id^="sidechat:"]').length === sideChatTabsBeforeClose - 1;
            const changesTabButton = document.querySelector('[data-tab-id="diff"]')?.closest('[role="tab"]');
            if (changesTabButton instanceof HTMLElement) {
              changesTabButton.click();
              await sleep(120);
            }
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'capabilities') {
            const createButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.trim() === 'Create');
            createButton?.click();
            await sleep(120);
            var capabilityMenuOpened = Boolean(document.querySelector('.cap-create-menu [role="menu"]'));
            var capabilityMenuArrowFocus = false;
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            await sleep(40);
            capabilityMenuArrowFocus = document.activeElement?.getAttribute('role') === 'menuitem';
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(120);
            var capabilityMenuClosedWithEscape = !document.querySelector('.cap-create-menu [role="menu"]');
            var capabilityMenuFocusReturned = document.activeElement === createButton;
            createButton?.click();
            await sleep(120);
            const skillMenuItem = [...document.querySelectorAll('[role="menuitem"]')]
              .find((button) => button.textContent?.includes('Skill'));
            skillMenuItem?.click();
            await sleep(180);
            const capabilitySheet = document.querySelector('.motion-sheet');
            var capabilitySheetOpened = Boolean(capabilitySheet);
            var capabilitySheetFocused = Boolean(capabilitySheet?.contains(document.activeElement));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
            await sleep(40);
            var capabilitySheetFocusStayedInside = Boolean(document.querySelector('.motion-sheet')?.contains(document.activeElement));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(120);
            var capabilitySheetClosedWithEscape = !document.querySelector('.motion-sheet');

            const setNativeValue = (element, value) => {
              const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
              setter?.call(element, value);
            };
            const search = document.querySelector('.capabilities-search');
            if (search instanceof HTMLInputElement) {
              setNativeValue(search, 'Orchestrator Smoke Skill');
              search.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(180);
            }
            const skillsTab = [...document.querySelectorAll('.segmented-control-button')]
              .find((button) => button.textContent?.includes('Skills'));
            skillsTab?.click();
            await sleep(180);

            const openCapabilityAction = async (label) => {
              const actionButtons = [...document.querySelectorAll('button')]
                .filter((button) => button.getAttribute('aria-label') === 'Capability actions');
              for (const actionButton of actionButtons) {
                actionButton.click();
                await sleep(80);
                const item = [...document.querySelectorAll('[role="menuitem"]')]
                  .find((button) => button.textContent?.includes(label) && !button.disabled);
                if (item) {
                  item.click();
                  await sleep(180);
                  return true;
                }
                window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                await sleep(60);
              }
              return false;
            };

            var capabilityEditActionClicked = await openCapabilityAction('Edit');
            var capabilityEditSheetOpened = Boolean(document.querySelector('.motion-sheet'));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(120);
            var capabilitySyncActionClicked = await openCapabilityAction('Sync');
            var capabilitySyncSheetOpened = Boolean(document.querySelector('.motion-sheet'));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(120);
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'composer') {
            const permissionButton = document.querySelector('[data-testid="composer-permission-menu"]');
            permissionButton?.click();
            await sleep(140);
            var composerPermissionMenuOpened = Boolean(document.querySelector('.motion-popover-surface'));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(140);
            var composerPermissionMenuClosedWithEscape = !document.querySelector('.motion-popover-surface');
            var composerPermissionFocusReturned = document.activeElement === permissionButton;

            const agentButton = document.querySelector('[data-testid="composer-agent-menu"]');
            agentButton?.click();
            await sleep(140);
            var composerAgentMenuOpened = Boolean(document.querySelector('.motion-popover-surface'));
            document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 1, clientY: 1 }));
            await sleep(140);
            var composerAgentMenuClosedWithOutsideClick = !document.querySelector('.motion-popover-surface');
            var composerAgentFocusReturned = document.activeElement === agentButton;
          }
          const bodyText = document.body.innerText;
          const rightPanel = document.querySelector('[data-testid="session-right-panel"]');
          const headerMetadataText = document.querySelector('[data-testid="session-header-metadata"]')?.textContent ?? '';
          const headerIdentityWorks =
            Boolean(document.querySelector('[data-testid="session-header-environment"]')) &&
            headerMetadataText.includes('Automated UI Smoke') &&
            headerMetadataText.includes('Claude') &&
            headerMetadataText.length > 'Automated UI Smoke'.length;
          const buttons = [...document.querySelectorAll('button')].map((button) => ({
            text: button.textContent?.trim() ?? '',
            title: button.getAttribute('title') ?? '',
            label: button.getAttribute('aria-label') ?? ''
          }));
          return {
            profile,
            title: document.title,
            bodyText,
            hasDesignSystemPreview: Boolean(document.querySelector('[data-testid="design-system-preview"]')),
            hasDesignSystemContract: Boolean(document.querySelector('[data-testid="design-system-contract"]')),
            motionRowCount: document.querySelectorAll('.motion-row').length,
            surfaceRowCount: document.querySelectorAll('.surface-row').length,
            hasProfileBadge: bodyText.includes(profile.displayName + ' profile'),
            hasComposer: Boolean(textarea),
            hasSidebarNavigation: buttons.some((button) =>
              button.title === 'Settings' ||
              button.label === 'Settings' ||
              button.text === 'Settings' ||
              button.label === 'Resources' ||
              button.text.includes('Resources')
            ),
            headerIdentityWorks,
            headerActionMenuWorks: typeof headerActionMenuWorks === 'boolean' ? headerActionMenuWorks : null,
            hasInspectorTabs: bodyText.includes('Changes') && !bodyText.includes('Usage') && !bodyText.includes('Plan') && !bodyText.includes('Agents'),
            hasRightPanelState: rightPanel instanceof HTMLElement &&
              rightPanel.dataset.rightPanelActiveTab === 'diff' &&
              rightPanel.dataset.rightPanelTabs?.includes('diff') === true &&
              Number(rightPanel.dataset.rightPanelWidth ?? '0') >= 360,
            rightPanelExpandWorks: typeof rightPanelExpandWorks === 'boolean' ? rightPanelExpandWorks : null,
            rightPanelExpandDebug: typeof rightPanelExpandDebug === 'object' ? rightPanelExpandDebug : null,
            reviewSearchWorks: typeof reviewSearchWorks === 'boolean' ? reviewSearchWorks : null,
            reviewBinaryStateWorks: typeof reviewBinaryStateWorks === 'boolean' ? reviewBinaryStateWorks : null,
            filesTabSearchWorks: typeof filesTabSearchWorks === 'boolean' ? filesTabSearchWorks : null,
            filesTabAttachWorks: typeof filesTabAttachWorks === 'boolean' ? filesTabAttachWorks : null,
            filesBinaryPreviewWorks: typeof filesBinaryPreviewWorks === 'boolean' ? filesBinaryPreviewWorks : null,
            filesNoResultsWorks: typeof filesNoResultsWorks === 'boolean' ? filesNoResultsWorks : null,
            browserTabWorks: typeof browserTabWorks === 'boolean' ? browserTabWorks : null,
            browserScreenshotWorks: typeof browserScreenshotWorks === 'boolean' ? browserScreenshotWorks : null,
            browserFindWorks: typeof browserFindWorks === 'boolean' ? browserFindWorks : null,
            browserZoomWorks: typeof browserZoomWorks === 'boolean' ? browserZoomWorks : null,
            browserDeviceModeWorks: typeof browserDeviceModeWorks === 'boolean' ? browserDeviceModeWorks : null,
            browserCacheReloadWorks: typeof browserCacheReloadWorks === 'boolean' ? browserCacheReloadWorks : null,
            browserMultiTabWorks: typeof browserMultiTabWorks === 'boolean' ? browserMultiTabWorks : null,
            browserInspectionWorks: typeof browserInspectionWorks === 'boolean' ? browserInspectionWorks : null,
            browserTargetsPaneWorks: typeof browserTargetsPaneWorks === 'boolean' ? browserTargetsPaneWorks : null,
            browserAssetBundleWorks: typeof browserAssetBundleWorks === 'boolean' ? browserAssetBundleWorks : null,
            browserSecurityPaneWorks: typeof browserSecurityPaneWorks === 'boolean' ? browserSecurityPaneWorks : null,
            browserVisibilityControlWorks: typeof browserVisibilityControlWorks === 'boolean' ? browserVisibilityControlWorks : null,
            rightPanelContextMenuWorks: typeof rightPanelContextMenuWorks === 'boolean' ? rightPanelContextMenuWorks : null,
            rightPanelTabReorderWorks: typeof rightPanelTabReorderWorks === 'boolean' ? rightPanelTabReorderWorks : null,
            sideChatTabsWork: typeof sideChatTabsWork === 'boolean' ? sideChatTabsWork : null,
            sideChatDraftPersistenceWorks: typeof sideChatDraftPersistenceWorks === 'boolean' ? sideChatDraftPersistenceWorks : null,
            sideChatCloseWorks: typeof sideChatCloseWorks === 'boolean' ? sideChatCloseWorks : null,
            terminalTabsPersistState: typeof terminalTabsPersistState === 'boolean' ? terminalTabsPersistState : null,
            terminalRestoreWorks: typeof terminalRestoreWorks === 'boolean' ? terminalRestoreWorks : null,
            terminalTabMenuWorks: typeof terminalTabMenuWorks === 'boolean' ? terminalTabMenuWorks : null,
            terminalTabReorderWorks: typeof terminalTabReorderWorks === 'boolean' ? terminalTabReorderWorks : null,
            themeImportWorks: typeof themeImportWorks === 'boolean' ? themeImportWorks : null,
            themeSharingControls: typeof themeSharingControls === 'boolean' ? themeSharingControls : null,
            settingsTaxonomyWorks: typeof settingsTaxonomyWorks === 'boolean' ? settingsTaxonomyWorks : null,
            settingsDiagnosticsSectionWorks: typeof settingsDiagnosticsSectionWorks === 'boolean' ? settingsDiagnosticsSectionWorks : null,
            settingsUsageDiagnosticsWorks: typeof settingsUsageDiagnosticsWorks === 'boolean' ? settingsUsageDiagnosticsWorks : null,
            settingsDataControlsWorks: typeof settingsDataControlsWorks === 'boolean' ? settingsDataControlsWorks : null,
            hasExtensionsPanel: bodyText.includes('Extensions') && bodyText.includes('Local Instructions'),
            hasExtensionsPanelTabs: bodyText.includes('Claude Code Extensions') || bodyText.includes('Codex CLI Extensions') || bodyText.includes('Extensions'),
            hasSideQuestionCommandText: bodyText.includes('/btw') || Boolean(textarea && textarea.value.includes('/btw')),
            capabilityMenuOpened: typeof capabilityMenuOpened === 'boolean' ? capabilityMenuOpened : null,
            capabilityMenuArrowFocus: typeof capabilityMenuArrowFocus === 'boolean' ? capabilityMenuArrowFocus : null,
            capabilityMenuClosedWithEscape: typeof capabilityMenuClosedWithEscape === 'boolean' ? capabilityMenuClosedWithEscape : null,
            capabilityMenuFocusReturned: typeof capabilityMenuFocusReturned === 'boolean' ? capabilityMenuFocusReturned : null,
            capabilitySheetOpened: typeof capabilitySheetOpened === 'boolean' ? capabilitySheetOpened : null,
            capabilitySheetFocused: typeof capabilitySheetFocused === 'boolean' ? capabilitySheetFocused : null,
            capabilitySheetFocusStayedInside: typeof capabilitySheetFocusStayedInside === 'boolean' ? capabilitySheetFocusStayedInside : null,
            capabilitySheetClosedWithEscape: typeof capabilitySheetClosedWithEscape === 'boolean' ? capabilitySheetClosedWithEscape : null,
            capabilityEditActionClicked: typeof capabilityEditActionClicked === 'boolean' ? capabilityEditActionClicked : null,
            capabilityEditSheetOpened: typeof capabilityEditSheetOpened === 'boolean' ? capabilityEditSheetOpened : null,
            capabilitySyncActionClicked: typeof capabilitySyncActionClicked === 'boolean' ? capabilitySyncActionClicked : null,
            capabilitySyncSheetOpened: typeof capabilitySyncSheetOpened === 'boolean' ? capabilitySyncSheetOpened : null,
            composerPermissionMenuOpened: typeof composerPermissionMenuOpened === 'boolean' ? composerPermissionMenuOpened : null,
            composerPermissionMenuClosedWithEscape: typeof composerPermissionMenuClosedWithEscape === 'boolean' ? composerPermissionMenuClosedWithEscape : null,
            composerPermissionFocusReturned: typeof composerPermissionFocusReturned === 'boolean' ? composerPermissionFocusReturned : null,
            composerAgentMenuOpened: typeof composerAgentMenuOpened === 'boolean' ? composerAgentMenuOpened : null,
            composerAgentMenuClosedWithOutsideClick: typeof composerAgentMenuClosedWithOutsideClick === 'boolean' ? composerAgentMenuClosedWithOutsideClick : null,
            composerAgentFocusReturned: typeof composerAgentFocusReturned === 'boolean' ? composerAgentFocusReturned : null,
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

function runAutomatedEmptyStateSmoke(win: BrowserWindow, outputPath: string, screenshotPath?: string): void {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            await sleep(500);
            const profile = await window.api.app.getProfile();
            const projects = await window.api.projects.list();
            const sessions = await window.api.sessions.list();
            const bodyText = document.body.innerText;
            const addProjectButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('Add project'));
            return {
              profile,
              projectCount: projects.length,
              sessionCount: sessions.length,
              emptyStateVisible: bodyText.includes('Add a project folder') || bodyText.includes('Open a project'),
              addProjectActionVisible: addProjectButton instanceof HTMLButtonElement
            };
          })()
        `)
        if (screenshotPath) {
          const image = await win.webContents.capturePage()
          writeFileSync(screenshotPath, image.toPNG())
        }
        writeFileSync(outputPath, JSON.stringify({ ok: true, result, screenshotPath }, null, 2))
        app.quit()
      } catch (error) {
        writeFileSync(outputPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
        app.quit()
      }
    }, 700)
  })
}

function runAutomatedSessionSwitchSmoke(win: BrowserWindow, outputPath: string, screenshotPath?: string): void {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const profile = getAppProfile()
        const sessions = sessionManager.list().filter((session) =>
          session.messages.some((message) => message.type === 'text' && message.content.includes('SESSION_SWITCH_SMOKE_'))
        )
        const first = sessions.find((session) =>
          session.messages.some((message) => message.type === 'text' && message.content.includes('SESSION_SWITCH_SMOKE_ONE'))
        ) ?? sessions[0]
        const second = sessions.find((session) =>
          session.messages.some((message) => message.type === 'text' && message.content.includes('SESSION_SWITCH_SMOKE_TWO'))
        ) ?? sessions[1]

        if (!first || !second) {
          writeFileSync(outputPath, JSON.stringify({ ok: true, result: { profile, firstTranscriptFound: false, secondTranscriptFound: false }, screenshotPath }, null, 2))
          app.quit()
          return
        }

        const summaryResult = await win.webContents.executeJavaScript(`
          (async () => {
            const summaries = await window.api.sessions.listSummaries();
            const first = summaries.find((session) => session.id === ${JSON.stringify(first.id)});
            const second = summaries.find((session) => session.id === ${JSON.stringify(second.id)});
            return {
              summaryTailBounded: Boolean(first && second && first.messageCount > first.messages.length && second.messageCount > second.messages.length && first.messages.length <= 8 && second.messages.length <= 8),
              firstSummaryMessageCount: first?.messageCount ?? null,
              firstSummaryRenderedMessages: first?.messages.length ?? null,
              secondSummaryMessageCount: second?.messageCount ?? null,
              secondSummaryRenderedMessages: second?.messages.length ?? null
            };
          })()
        `)

        win.webContents.send('pet:navigate', first.id)
        await new Promise((resolve) => setTimeout(resolve, 250))
        const before = await win.webContents.executeJavaScript(`
          (() => ({
            firstTranscriptFound: document.body.innerText.includes('SESSION_SWITCH_SMOKE_ONE'),
            firstTitleFound: document.querySelector('[data-testid="active-session-title"]')?.textContent?.includes(${JSON.stringify(first.name)}) ?? false,
            sessionViewAnimated: document.querySelector('[data-motion-view="session"]')?.classList.contains('motion-view-animated') ?? null
          }))()
        `)

        await win.webContents.executeJavaScript('window.__orchestratorSessionSwitchStart = performance.now()')
        win.webContents.send('pet:navigate', second.id)
        const after = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            let titleElapsedMs = null;
            for (let index = 0; index < 30; index += 1) {
              if (document.querySelector('[data-testid="active-session-title"]')?.textContent?.includes(${JSON.stringify(second.name)})) {
                titleElapsedMs = performance.now() - window.__orchestratorSessionSwitchStart;
                break;
              }
              await sleep(10);
            }
            for (let index = 0; index < 120; index += 1) {
              const transcriptText = document.querySelector('[data-testid="transcript-scroll"]')?.innerText ?? '';
              if (transcriptText.includes('SESSION_SWITCH_SMOKE_TWO')) break;
              await sleep(10);
            }
            const transcriptText = document.querySelector('[data-testid="transcript-scroll"]')?.innerText ?? '';
            const switchElapsedMs = performance.now() - window.__orchestratorSessionSwitchStart;
            let fullHydratedAfterSwitch = false;
            for (let index = 0; index < 120; index += 1) {
              const loadEarlierText = document.querySelector('[data-testid="load-earlier-messages"]')?.textContent ?? '';
              if (loadEarlierText.includes('Show 381')) {
                fullHydratedAfterSwitch = true;
                break;
              }
              await sleep(10);
            }
            const scroller = document.querySelector('[data-testid="transcript-scroll"]');
            const lazyBeforeText = document.querySelector('[data-testid="load-earlier-messages"]')?.textContent ?? '';
            const lazyBeforeHidden = Number(lazyBeforeText.match(/Show\\s+([\\d,]+)/)?.[1]?.replace(/,/g, '') ?? 0);
            let lazyBeforeTop = null;
            let lazyAfterTop = null;
            let lazyAfterHidden = null;
            let lazyBeforeVisibleMessage = null;
            let lazyAfterVisibleMessage = null;
            if (scroller instanceof HTMLElement) {
              const firstVisibleMessageId = () => {
                const scrollerRect = scroller.getBoundingClientRect();
                const messages = Array.from(scroller.querySelectorAll('[data-message-id]'));
                const visible = messages.find((message) => {
                  const rect = message.getBoundingClientRect();
                  return rect.bottom > scrollerRect.top && rect.top < scrollerRect.bottom;
                });
                return visible?.getAttribute('data-message-id') ?? null;
              };
              scroller.scrollTop = Math.min(240, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
              scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
              lazyBeforeTop = scroller.scrollTop;
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              lazyBeforeVisibleMessage = firstVisibleMessageId();
              for (let index = 0; index < 5 && !lazyBeforeVisibleMessage; index += 1) {
                const currentLazyBeforeText = document.querySelector('[data-testid="load-earlier-messages"]')?.textContent ?? '';
                const currentLazyBeforeHidden = Number(currentLazyBeforeText.match(/Show\\s+([\\d,]+)/)?.[1]?.replace(/,/g, '') ?? 0);
                if (currentLazyBeforeHidden !== lazyBeforeHidden) break;
                lazyBeforeVisibleMessage = firstVisibleMessageId();
                if (lazyBeforeVisibleMessage) break;
                await sleep(10);
              }
              for (let index = 0; index < 60; index += 1) {
                const lazyAfterText = document.querySelector('[data-testid="load-earlier-messages"]')?.textContent ?? '';
                lazyAfterHidden = Number(lazyAfterText.match(/Show\\s+([\\d,]+)/)?.[1]?.replace(/,/g, '') ?? 0);
                if (lazyAfterHidden > 0 && lazyAfterHidden < lazyBeforeHidden) break;
                await sleep(20);
              }
              await sleep(80);
              lazyAfterTop = scroller.scrollTop;
              lazyAfterVisibleMessage = firstVisibleMessageId();
            }
            const messageOrdinal = (id) => Number(id?.match(/-(\\d+)$/)?.[1] ?? Number.NaN);
            const lazyBeforeOrdinal = messageOrdinal(lazyBeforeVisibleMessage);
            const lazyAfterOrdinal = messageOrdinal(lazyAfterVisibleMessage);
            window.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'f',
              code: 'KeyF',
              metaKey: true,
              bubbles: true,
              cancelable: true
            }));
            await sleep(60);
            const search = document.querySelector('[data-testid="transcript-search"]');
            let transcriptSearchFound = false;
            if (search instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(search.constructor.prototype, 'value')?.set;
              setter?.call(search, 'SESSION_SWITCH_SMOKE_TWO');
              search.dispatchEvent(new Event('input', { bubbles: true }));
              for (let index = 0; index < 60; index += 1) {
                if (document.body.innerText.includes('SESSION_SWITCH_SMOKE_TWO')) {
                  transcriptSearchFound = true;
                  break;
                }
                await sleep(20);
              }
            }
            const telemetry = await window.api.performance.snapshot();
            const mountedVirtualRows = document.querySelectorAll('[data-testid="virtual-transcript-row"]').length;
            const transcriptList = document.querySelector('[data-testid="virtualized-transcript"]');
            const renderedMessagesFromDom = Number(transcriptList?.getAttribute('data-rendered-message-count') ?? Number.NaN);
            const messageCountFromDom = Number(transcriptList?.getAttribute('data-total-message-count') ?? Number.NaN);
            return {
              secondTranscriptFound: transcriptText.includes('SESSION_SWITCH_SMOKE_TWO'),
              secondTitleFound: document.querySelector('[data-testid="active-session-title"]')?.textContent?.includes(${JSON.stringify(second.name)}) ?? false,
              longHistoryDeferred: Boolean(document.querySelector('[data-testid="load-earlier-messages"]')),
              fullHydratedAfterSwitch,
              autoLazyLoadedEarlier: lazyBeforeHidden > 0 && (lazyAfterHidden ?? lazyBeforeHidden) < lazyBeforeHidden,
              autoLazyAnchorPreserved: Boolean(lazyBeforeVisibleMessage && lazyAfterVisibleMessage) &&
                Number.isFinite(lazyBeforeOrdinal) &&
                Number.isFinite(lazyAfterOrdinal) &&
                Math.abs(lazyAfterOrdinal - lazyBeforeOrdinal) <= 2,
              lazyBeforeHidden,
              lazyAfterHidden,
              lazyAfterTop,
              lazyBeforeVisibleMessage,
              lazyAfterVisibleMessage,
              mountedVirtualRows,
              transcriptSearchFound,
              renderedMessages: window.__orchestratorSessionSwitchLastPerf?.renderedMessages ?? (Number.isFinite(renderedMessagesFromDom) ? renderedMessagesFromDom : null),
              messageCount: window.__orchestratorSessionSwitchLastPerf?.messageCount ?? (Number.isFinite(messageCountFromDom) ? messageCountFromDom : null),
              instrumentedTranscriptReadyMs: window.__orchestratorSessionSwitchLastPerf?.transcriptReadyMs ?? null,
              telemetryRecorded: telemetry.summaries.some((summary) => summary.name === 'session.switch.transcript-ready' || summary.name === 'transcript.initial-page-ready'),
              titleElapsedMs,
              switchElapsedMs,
              sessionViewAnimated: document.querySelector('[data-motion-view="session"]')?.classList.contains('motion-view-animated') ?? null
            };
          })()
        `)

        if (screenshotPath) {
          const image = await win.webContents.capturePage()
          writeFileSync(screenshotPath, image.toPNG())
        }
        writeFileSync(outputPath, JSON.stringify({ ok: true, result: { profile, ...summaryResult, ...before, ...after }, screenshotPath }, null, 2))
        app.quit()
      } catch (error) {
        writeFileSync(outputPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
        app.quit()
      }
    }, 700)
  })
}

function runAutomatedSidebarSmoke(win: BrowserWindow, outputPath: string, screenshotPath?: string): void {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const profile = getAppProfile()
        const sessions = sessionManager.list()
        const unread = sessions.find((session) => session.name === 'Sidebar unread idle')
        if (unread) {
          sessionManager.updateStatus(unread.id, 'running')
          await new Promise((resolve) => setTimeout(resolve, 120))
          sessionManager.updateStatus(unread.id, 'idle')
        }
        const running = sessions.find((session) => session.name === 'Sidebar running')
        if (running) sessionManager.updateStatus(running.id, 'running')
        const pinnedLive = sessions.find((session) => session.name === 'Sidebar pinned older')
        if (pinnedLive) {
          setTimeout(() => sessionManager.updateStatus(pinnedLive.id, 'running'), 1800)
          setTimeout(() => {
            sessionManager.appendMessage(pinnedLive.id, [{
              id: `sidebar-live-transition-${Date.now()}`,
              role: 'assistant',
              type: 'text',
              content: 'Sidebar pinned older finished a live transition.',
              timestamp: Date.now()
            }])
            sessionManager.updateStatus(pinnedLive.id, 'idle')
          }, 4300)
        }
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const rowFor = (name) => [...document.querySelectorAll('[data-testid="session-row"]')]
              .find((row) => row.textContent?.includes(name));
            const waitForRow = async (name) => {
              for (let index = 0; index < 80; index += 1) {
                const row = rowFor(name);
                if (row) return row;
                await sleep(25);
              }
              return null;
            };
            await waitForRow('Sidebar pinned recent');
            await sleep(250);

            const bodyText = document.body.innerText;
            const pinnedIndex = bodyText.indexOf('Pinned');
            const projectsIndex = bodyText.indexOf('Projects');
            const olderIndex = bodyText.indexOf('Sidebar pinned older');
            const recentIndex = bodyText.indexOf('Sidebar pinned recent');
            const pinnedAboveProjects = pinnedIndex >= 0 && projectsIndex >= 0 && pinnedIndex < projectsIndex;
            const pinnedOrderStable = recentIndex >= 0 && olderIndex >= 0 && olderIndex < recentIndex && recentIndex < projectsIndex;
            const projectBlock = projectsIndex >= 0 ? bodyText.slice(projectsIndex) : '';
            const pinnedRowsHiddenFromProjects =
              !projectBlock.includes('Sidebar pinned recent') &&
              !projectBlock.includes('Sidebar pinned older');

            const pinnedRecentRow = rowFor('Sidebar pinned recent');
            const pinnedRecentPin = pinnedRecentRow?.querySelector('[data-testid="session-pin-toggle"]');
            if (pinnedRecentPin instanceof HTMLElement) pinnedRecentPin.click();
            for (let index = 0; index < 80; index += 1) {
              const nextText = document.body.innerText;
              const nextProjectsIndex = nextText.indexOf('Projects');
              const nextProjectBlock = nextProjectsIndex >= 0 ? nextText.slice(nextProjectsIndex) : '';
              if (nextProjectBlock.includes('Sidebar pinned recent')) break;
              await sleep(25);
            }
            const afterUnpinText = document.body.innerText;
            const afterProjectsIndex = afterUnpinText.indexOf('Projects');
            const afterProjectBlock = afterProjectsIndex >= 0 ? afterUnpinText.slice(afterProjectsIndex) : '';
            const pinnedRowUnpinned = afterProjectBlock.includes('Sidebar pinned recent');

            const normalRow = await waitForRow('Sidebar normal idle');
            const normalPin = normalRow?.querySelector('[data-testid="session-pin-toggle"]');
            if (normalRow instanceof HTMLElement) {
              const rect = normalRow.getBoundingClientRect();
              normalRow.dispatchEvent(new MouseEvent('mouseover', {
                bubbles: true,
                clientX: rect.left + 12,
                clientY: rect.top + 12
              }));
            }
            if (normalPin instanceof HTMLElement) normalPin.focus({ preventScroll: true });
            await sleep(360);
            const hoverPinVisible = normalPin instanceof HTMLElement &&
              Number.parseFloat(getComputedStyle(normalPin).opacity || '0') > 0.5;
            const hoverCard = document.querySelector('[data-testid="session-hover-card"]');
            const hoverCardText = hoverCard instanceof HTMLElement ? hoverCard.innerText : '';
            const hoverCardVisible = hoverCard instanceof HTMLElement &&
              hoverCardText.includes('Sidebar normal idle') &&
              hoverCardText.includes('Project') &&
              hoverCardText.includes('Automated UI Smoke') &&
              hoverCardText.includes('Folder') &&
              hoverCardText.includes('Provider') &&
              hoverCardText.includes('Status');
            let singleHoverSurfaceWorks = false;
            const normalActionsButton = normalRow?.querySelector('[aria-label="Chat actions"], [title="Chat actions"]');
            if (normalActionsButton instanceof HTMLElement) {
              const actionRect = normalActionsButton.getBoundingClientRect();
              normalActionsButton.dispatchEvent(new MouseEvent('mouseover', {
                bubbles: true,
                clientX: actionRect.left + 8,
                clientY: actionRect.top + 8
              }));
              normalActionsButton.focus({ preventScroll: true });
              await sleep(180);
              const visibleTooltips = [...document.querySelectorAll('.orchestrator-tooltip[data-visible="true"]')];
              const visibleHoverCards = [...document.querySelectorAll('[data-testid="session-hover-card"]')];
              singleHoverSurfaceWorks =
                visibleTooltips.length === 1 &&
                visibleHoverCards.length === 0;
              normalActionsButton.blur();
              normalActionsButton.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
              await sleep(80);
            }
            const sidebar = document.querySelector('aside');
            const sidebarNoHorizontalOverflow = sidebar instanceof HTMLElement &&
              getComputedStyle(sidebar).overflowX === 'hidden' &&
              [...sidebar.querySelectorAll('.overflow-y-auto')].every((element) => (
                element instanceof HTMLElement && getComputedStyle(element).overflowX === 'hidden'
              ));
            const environmentIconVisible = Boolean(normalRow?.querySelector('[data-testid="session-environment-icon"]'));

            let actionRenameWorks = false;
            if (normalRow instanceof HTMLElement) {
              const actionsButton = normalActionsButton ?? normalRow.querySelector('[aria-label="Chat actions"], [title="Chat actions"]');
              if (actionsButton instanceof HTMLElement) actionsButton.click();
              await sleep(120);
              const renameMenuItem = [...document.querySelectorAll('[role="menuitem"]')]
                .find((item) => item.textContent?.includes('Rename'));
              if (renameMenuItem instanceof HTMLElement) renameMenuItem.click();
              await sleep(120);
              const input = document.querySelector('[data-testid="rename-chat-input"]');
              if (input instanceof HTMLInputElement) {
                const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
                setter?.call(input, 'Sidebar renamed by smoke');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                actionRenameWorks = Boolean(await waitForRow('Sidebar renamed by smoke'));
              }
            }

            const renamedRow = await waitForRow('Sidebar renamed by smoke');
            const renamedPin = renamedRow?.querySelector('[data-testid="session-pin-toggle"]');
            if (renamedPin instanceof HTMLElement) renamedPin.click();
            for (let index = 0; index < 80; index += 1) {
              const nextText = document.body.innerText;
              const nextProjectsIndex = nextText.indexOf('Projects');
              const nextPinnedBlock = nextProjectsIndex >= 0 ? nextText.slice(0, nextProjectsIndex) : nextText;
              if (nextPinnedBlock.includes('Sidebar renamed by smoke')) break;
              await sleep(25);
            }
            const afterPinText = document.body.innerText;
            const afterPinProjectsIndex = afterPinText.indexOf('Projects');
            const afterPinPinnedBlock = afterPinProjectsIndex >= 0 ? afterPinText.slice(0, afterPinProjectsIndex) : afterPinText;
            const olderAfterPinIndex = afterPinPinnedBlock.indexOf('Sidebar pinned older');
            const renamedPinnedIndex = afterPinPinnedBlock.indexOf('Sidebar renamed by smoke');
            const newPinAppended = olderAfterPinIndex >= 0 && renamedPinnedIndex > olderAfterPinIndex;
            let pinnedLiveRunningSpinner = false;
            let pinnedLiveUnreadDot = false;
            let pinnedLiveOrderStable = false;
            for (let index = 0; index < 80; index += 1) {
              const row = rowFor('Sidebar pinned older');
              if (row?.querySelector('[data-testid="session-status-spinner"]')) {
                pinnedLiveRunningSpinner = true;
                break;
              }
              await sleep(25);
            }
            for (let index = 0; index < 100; index += 1) {
              const row = rowFor('Sidebar pinned older');
              if (row?.querySelector('[data-testid="session-status-dot"]')) {
                pinnedLiveUnreadDot = true;
                const liveText = document.body.innerText;
                const liveProjectsIndex = liveText.indexOf('Projects');
                const livePinnedBlock = liveProjectsIndex >= 0 ? liveText.slice(0, liveProjectsIndex) : liveText;
                const liveOlderIndex = livePinnedBlock.indexOf('Sidebar pinned older');
                const liveRenamedIndex = livePinnedBlock.indexOf('Sidebar renamed by smoke');
                pinnedLiveOrderStable = liveOlderIndex >= 0 && liveRenamedIndex >= 0 && liveOlderIndex < liveRenamedIndex;
                break;
              }
              await sleep(25);
            }

            const unreadRow = await waitForRow('Sidebar unread idle');
            const errorRow = await waitForRow('Sidebar error');
            const runningRow = await waitForRow('Sidebar running');
            const allDots = [...document.querySelectorAll('[data-testid="session-status-dot"]')];
            const projectHeaderFor = (name) => [...document.querySelectorAll('[data-testid="project-section-header"]')]
              .find((header) => header.textContent?.includes(name));
            const projectActionButtonFor = (name) => {
              const header = projectHeaderFor(name);
              return header ? [...header.querySelectorAll('button')]
                .find((button) => button.getAttribute('title') === 'Project actions') : null;
            };
            let projectActionMenuWorks = false;
            let projectRenameWorks = false;
            let projectPinWorks = false;
            const primaryProjectActions = projectActionButtonFor('Automated UI Smoke');
            if (primaryProjectActions instanceof HTMLButtonElement) {
              primaryProjectActions.click();
              await sleep(140);
              const menuText = document.body.innerText;
              projectActionMenuWorks =
                menuText.includes('Rename project') &&
                menuText.includes('Pin project') &&
                menuText.includes('Open folder') &&
                menuText.includes('Archive project chats') &&
                menuText.includes('Remove project');
              const renameProject = [...document.querySelectorAll('[role="menuitem"]')]
                .find((item) => item.textContent?.includes('Rename project'));
              if (renameProject instanceof HTMLButtonElement) {
                renameProject.click();
                await sleep(120);
                const input = document.querySelector('input');
                if (input instanceof HTMLInputElement) {
                  const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
                  setter?.call(input, 'Sidebar renamed project');
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  input.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                  for (let index = 0; index < 60; index += 1) {
                    if (document.body.innerText.includes('Sidebar renamed project')) break;
                    await sleep(25);
                  }
                  projectRenameWorks = document.body.innerText.includes('Sidebar renamed project');
                }
              }
            }
            const secondaryProjectActions = projectActionButtonFor('Sidebar secondary project');
            if (secondaryProjectActions instanceof HTMLButtonElement) {
              secondaryProjectActions.click();
              await sleep(140);
              const pinProject = [...document.querySelectorAll('[role="menuitem"]')]
                .find((item) => item.textContent?.includes('Pin project'));
              if (pinProject instanceof HTMLButtonElement) {
                pinProject.click();
                await sleep(180);
                const nextText = document.body.innerText;
                const projectsStart = nextText.indexOf('Projects');
                const projectsText = projectsStart >= 0 ? nextText.slice(projectsStart) : nextText;
                const secondaryIndex = projectsText.indexOf('Sidebar secondary project');
                const primaryIndex = projectsText.indexOf('Sidebar renamed project');
                projectPinWorks = secondaryIndex >= 0 && primaryIndex >= 0 && secondaryIndex < primaryIndex;
              }
            }
            const organizeButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Organize sidebar');
            let organizeMenuWorks = false;
            if (organizeButton instanceof HTMLButtonElement) {
              organizeButton.click();
              await sleep(120);
              const menuText = document.body.innerText;
              const chronological = [...document.querySelectorAll('[role="menuitem"]')]
                .find((item) => item.textContent?.includes('Chronological list'));
              if (
                menuText.includes('By project') &&
                menuText.includes('Recent projects') &&
                menuText.includes('Sort by created') &&
                chronological instanceof HTMLButtonElement
              ) {
                chronological.click();
                await sleep(160);
                const chronologicalText = document.body.innerText;
                organizeButton.click();
                await sleep(80);
                const byProject = [...document.querySelectorAll('[role="menuitem"]')]
                  .find((item) => item.textContent?.includes('By project'));
                if (byProject instanceof HTMLButtonElement) byProject.click();
                await sleep(120);
                organizeMenuWorks =
                  chronologicalText.includes('Recent chats') &&
                  chronologicalText.includes('Sidebar running') &&
                  document.body.innerText.includes('Projects');
              }
            }
            return {
              pinnedAboveProjects,
              pinnedOrderStable,
              pinnedRowsHiddenFromProjects,
              pinnedRowUnpinned,
              newPinAppended,
              hoverPinVisible,
              hoverCardVisible,
              singleHoverSurfaceWorks,
              sidebarNoHorizontalOverflow,
              environmentIconVisible,
              actionRenameWorks,
              runningSpinnerVisible: Boolean(runningRow?.querySelector('[data-testid="session-status-spinner"]')),
              normalIdleDotHidden: !normalRow?.querySelector('[data-testid="session-status-dot"]'),
              unreadIdleDotVisible: Boolean(unreadRow?.querySelector('[data-testid="session-status-dot"]')),
              errorDotVisible: Boolean(errorRow?.querySelector('[data-testid="session-status-dot"]')),
              pinnedLiveRunningSpinner,
              pinnedLiveUnreadDot,
              pinnedLiveOrderStable,
              grayIdleDotsAbsent: allDots.length === 3,
              projectActionMenuWorks,
              projectRenameWorks,
              projectPinWorks,
              organizeMenuWorks,
              dotCount: allDots.length,
              bodyText: document.body.innerText
            };
          })()
        `)
        if (screenshotPath) {
          const image = await win.webContents.capturePage()
          writeFileSync(screenshotPath, image.toPNG())
        }
        writeFileSync(outputPath, JSON.stringify({ ok: true, result: { profile, ...result }, screenshotPath }, null, 2))
        app.quit()
      } catch (error) {
        writeFileSync(outputPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
        app.quit()
      }
    }, 700)
  })
}

function runAutomatedTranscriptLayoutSmoke(win: BrowserWindow, outputPath: string, screenshotPath?: string): void {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        win.setMinimumSize(520, 600)
        win.setSize(860, 720)
        const profile = getAppProfile()
        const session = sessionManager.list().find((candidate) => candidate.name === 'Transcript layout smoke')
        if (session) {
          win.webContents.send('pet:navigate', session.id)
          await new Promise((resolve) => setTimeout(resolve, 180))
          win.webContents.send('session:raw', {
            id: session.id,
            data: '{"type":"system","subtype":"raw_event","content":"RAW_TRANSCRIPT_EVENT_SHOULD_NOT_RENDER"}\n'
          })
          win.webContents.send('session:events', {
            id: session.id,
            events: [{
              id: 'raw-transcript-layout-event',
              timestamp: Date.now(),
              event: {
                type: 'session.started',
                providerSessionId: 'RAW_TRANSCRIPT_EVENT_SHOULD_NOT_RENDER'
              }
            }]
          })
        }
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const layoutProbe = () => {
              const scroller = document.querySelector('[data-testid="transcript-scroll"]');
              if (!(scroller instanceof HTMLElement)) return { transcriptFound: false };
              const viewportWidth = document.documentElement.clientWidth;
              const docScrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
              const scrollerRect = scroller.getBoundingClientRect();
              const isInsideScroller = (element) => {
                const rect = element.getBoundingClientRect();
                return rect.left >= scrollerRect.left - 2 && rect.right <= scrollerRect.right + 2;
              };
              const pre = document.querySelector('pre');
              const table = document.querySelector('table');
              const tableCells = [...document.querySelectorAll('td, th')].filter((cell) => cell instanceof HTMLElement);
              return {
                transcriptFound: true,
                viewportWidth,
                docScrollWidth,
                documentNoHorizontalOverflow: docScrollWidth <= viewportWidth + 2,
                transcriptNoHorizontalOverflow: scroller.scrollWidth <= scroller.clientWidth + 2,
                codeBlockBounded: pre instanceof HTMLElement && isInsideScroller(pre),
                codeBlockInternallyScrollable: pre instanceof HTMLElement && pre.scrollWidth > pre.clientWidth + 24,
                tableBounded: table instanceof HTMLElement && isInsideScroller(table),
                tableCellsWrap: tableCells.length > 0 && tableCells.every((cell) => {
                  const style = window.getComputedStyle(cell);
                  return style.whiteSpace === 'normal' && (style.overflowWrap === 'anywhere' || style.overflowWrap === 'break-word');
                })
              };
            };
            const waitForText = async (text) => {
              for (let index = 0; index < 80; index += 1) {
                if (document.body.innerText.includes(text)) return true;
                await sleep(25);
              }
              return false;
            };
            const layoutFixtureVisible = await waitForText('TRANSCRIPT_LAYOUT_SMOKE');
            await sleep(160);
            const searchHiddenInitially = !document.querySelector('[data-testid="transcript-search"]');
            window.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'k',
              code: 'KeyK',
              metaKey: true,
              bubbles: true,
              cancelable: true
            }));
            await sleep(120);
            const commandInput = document.querySelector('#command-palette-search');
            const commandPaletteOpens = commandInput instanceof HTMLInputElement && document.activeElement === commandInput;
            let commandPaletteSearchActionWorks = false;
            if (commandInput instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(commandInput.constructor.prototype, 'value')?.set;
              setter?.call(commandInput, 'search transcript');
              commandInput.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(80);
              document.querySelector('[data-command-id="search-transcript"]')?.click();
              await sleep(160);
              const commandSearch = document.querySelector('[data-testid="transcript-search"]');
              commandPaletteSearchActionWorks = commandSearch instanceof HTMLInputElement && document.activeElement === commandSearch;
              document.querySelector('[aria-label="Close transcript search"]')?.click();
              await sleep(80);
            }
            window.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'f',
              code: 'KeyF',
              metaKey: true,
              bubbles: true,
              cancelable: true
            }));
            let search = document.querySelector('[data-testid="transcript-search"]');
            for (let index = 0; index < 10 && !(search instanceof HTMLInputElement && document.activeElement === search); index += 1) {
              await sleep(50);
              search = document.querySelector('[data-testid="transcript-search"]');
            }
            const searchShortcutOpens = search instanceof HTMLInputElement && document.activeElement === search;

            const scroller = document.querySelector('[data-testid="transcript-scroll"]');
            if (!scroller) {
              return { transcriptFound: false, layoutFixtureVisible, bodyText: document.body.innerText };
            }

            const wideLayout = layoutProbe();
            const viewportWidth = wideLayout.viewportWidth;
            const docScrollWidth = wideLayout.docScrollWidth;
            const documentNoHorizontalOverflow = wideLayout.documentNoHorizontalOverflow;
            const transcriptNoHorizontalOverflow = wideLayout.transcriptNoHorizontalOverflow;
            const scrollerRect = scroller.getBoundingClientRect();
            const isInsideScroller = (element) => {
              const rect = element.getBoundingClientRect();
              return rect.left >= scrollerRect.left - 2 && rect.right <= scrollerRect.right + 2;
            };

            for (let index = 0; index < 20; index += 1) {
              const cards = [...document.querySelectorAll('[data-testid="file-reference-card"]')];
              if (cards.some((card) => card.textContent?.includes('explicit-missing-file.ts') && card.textContent?.includes('missing'))) break;
              await sleep(80);
            }
            const messageRows = [...document.querySelectorAll('[data-message-id]')];
            const pre = document.querySelector('pre');
            const table = document.querySelector('table');
            const fileCards = [...document.querySelectorAll('[data-testid="file-reference-card"]')];
            const messageRowsBounded = messageRows.length > 0 && messageRows.every(isInsideScroller);
            const codeBlockBounded = wideLayout.codeBlockBounded;
            const codeBlockInternallyScrollable = wideLayout.codeBlockInternallyScrollable;
            const tableBounded = wideLayout.tableBounded;
            const tableCellsWrap = wideLayout.tableCellsWrap;
            const fileCardsBounded = fileCards.length > 0 && fileCards.every(isInsideScroller);
            const relativeProseCardSuppressed = !fileCards.some((card) => card.textContent?.includes('DefinitelyMissingRelativeReviewFile.java'));
            const absoluteMissingFileCardDisabled = fileCards.some((card) => {
              const buttons = [...card.querySelectorAll('button')];
              return card.textContent?.includes('explicit-missing-file.ts') &&
                card.textContent?.includes('missing') &&
                buttons.length >= 2 &&
                buttons.every((button) => button.disabled);
            });
            let toolSummary = document.querySelector('[data-testid="tool-activity-summary"]');
            for (let index = 0; index < 10 && !toolSummary; index += 1) {
              scroller.scrollTop = Math.max(scroller.scrollHeight, scroller.clientHeight) * ((index + 1) / 10);
              scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
              await sleep(180);
              toolSummary = document.querySelector('[data-testid="tool-activity-summary"]');
            }
            const toolButton = toolSummary?.querySelector('.motion-disclosure-trigger');
            if (toolButton instanceof HTMLElement && toolButton.getAttribute('aria-expanded') !== 'true') {
              toolButton.click();
            }
            await sleep(160);
            const toolBody = document.querySelector('[data-testid="tool-activity-body"]');
            const expandedDocScrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
            const toolSummaryExpanded = toolButton instanceof HTMLElement && toolButton.getAttribute('aria-expanded') === 'true' && Boolean(toolBody);
            const toolSummaryBounded = toolBody instanceof HTMLElement && isInsideScroller(toolBody) && toolBody.clientHeight <= 240;
            const toolSummaryScrollable = toolBody instanceof HTMLElement && toolBody.scrollHeight > toolBody.clientHeight + 24;
            const transcriptText = scroller.innerText;
            document.querySelector('[aria-label="Close transcript search"]')?.click();
            await sleep(80);
            window.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'P',
              code: 'KeyP',
              metaKey: true,
              shiftKey: true,
              bubbles: true,
              cancelable: true
            }));
            await sleep(120);
            const shiftPaletteInput = document.querySelector('#command-palette-search');
            const commandPaletteShiftPOpens = shiftPaletteInput instanceof HTMLInputElement && document.activeElement === shiftPaletteInput;
            const commandPaletteGrouped = Boolean(document.querySelector('[data-command-group="Chat"]'));
            const commandPaletteRecentVisible = Boolean(document.querySelector('[data-command-group="Recent"]'));
            const commandPaletteShortcutLabels = [...document.querySelectorAll('[data-command-id="new-chat"] kbd')]
              .some((key) => key.textContent?.includes('⌘N') || key.textContent?.includes('CtrlN'));
            let commandPaletteFuzzyFindsTerminal = false;
            if (shiftPaletteInput instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(shiftPaletteInput.constructor.prototype, 'value')?.set;
              setter?.call(shiftPaletteInput, 'term');
              shiftPaletteInput.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(80);
              commandPaletteFuzzyFindsTerminal = Boolean(document.querySelector('[data-command-id="toggle-terminal"]'));
            }
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
            await sleep(100);

            return {
              transcriptFound: true,
              layoutFixtureVisible,
              searchHiddenInitially,
              commandPaletteOpens,
              commandPaletteShiftPOpens,
              commandPaletteGrouped,
              commandPaletteRecentVisible,
              commandPaletteShortcutLabels,
              commandPaletteFuzzyFindsTerminal,
              commandPaletteSearchActionWorks,
              searchShortcutOpens,
              hiddenMessageCopyQuiet: !document.body.innerText.includes('hidden for faster chat switching'),
              documentNoHorizontalOverflow,
              transcriptNoHorizontalOverflow,
              messageRowsBounded,
              codeBlockBounded,
              codeBlockInternallyScrollable,
              tableBounded,
              tableCellsWrap,
              fileCardsBounded,
              relativeProseCardSuppressed,
              absoluteMissingFileCardDisabled,
              toolSummaryExpanded,
              toolSummaryBounded,
              toolSummaryScrollable,
              rawEventsHiddenFromTranscript: !transcriptText.includes('RAW_TRANSCRIPT_EVENT_SHOULD_NOT_RENDER'),
              documentNoHorizontalOverflowAfterExpand: expandedDocScrollWidth <= viewportWidth + 2,
              docScrollWidth,
              expandedDocScrollWidth,
              viewportWidth,
              transcriptScrollWidth: scroller.scrollWidth,
              transcriptClientWidth: scroller.clientWidth,
              bodyText: document.body.innerText
            };
          })()
        `)
        if (session) {
          win.setSize(520, 720)
          win.webContents.send('pet:navigate', session.id)
          await new Promise((resolve) => setTimeout(resolve, 320))
        }
        const narrowResult = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            await sleep(160);
            const scroller = document.querySelector('[data-testid="transcript-scroll"]');
            if (!(scroller instanceof HTMLElement)) return { transcriptFound: false };
            for (let index = 0; index < 10; index += 1) {
              scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight) * (index / 9);
              scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
              await sleep(120);
              if (document.querySelector('pre') && document.querySelector('table')) break;
            }
            const viewportWidth = document.documentElement.clientWidth;
            const docScrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
            const scrollerRect = scroller.getBoundingClientRect();
            const isInsideScroller = (element) => {
              const rect = element.getBoundingClientRect();
              return rect.left >= scrollerRect.left - 2 && rect.right <= scrollerRect.right + 2;
            };
            const pre = document.querySelector('pre');
            const table = document.querySelector('table');
            const tableCells = [...document.querySelectorAll('td, th')].filter((cell) => cell instanceof HTMLElement);
            return {
              transcriptFound: true,
              narrowViewportWidth: viewportWidth,
              narrowDocumentNoHorizontalOverflow: docScrollWidth <= viewportWidth + 2,
              narrowTranscriptNoHorizontalOverflow: scroller.scrollWidth <= scroller.clientWidth + 2,
              narrowCodeBlockBounded: pre instanceof HTMLElement && isInsideScroller(pre),
              narrowCodeBlockInternallyScrollable: pre instanceof HTMLElement && pre.scrollWidth > pre.clientWidth + 24,
              narrowTableBounded: table instanceof HTMLElement && isInsideScroller(table),
              narrowTableCellsWrap: tableCells.length > 0 && tableCells.every((cell) => {
                const style = window.getComputedStyle(cell);
                return style.whiteSpace === 'normal' && (style.overflowWrap === 'anywhere' || style.overflowWrap === 'break-word');
              }),
              narrowRawEventsHiddenFromTranscript: !scroller.innerText.includes('RAW_TRANSCRIPT_EVENT_SHOULD_NOT_RENDER')
            };
          })()
        `)
        const shortcutResult = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            window.dispatchEvent(new KeyboardEvent('keydown', {
              key: '?',
              code: 'Slash',
              metaKey: true,
              shiftKey: true,
              bubbles: true,
              cancelable: true
            }));
            await sleep(180);
            const shortcutsSearch = document.querySelector('#settings-shortcut-search');
            return {
              keyboardShortcutsShortcutOpens: shortcutsSearch instanceof HTMLInputElement && document.body.innerText.includes('Command Palette')
            };
          })()
        `)
        if (screenshotPath) {
          const image = await win.webContents.capturePage()
          writeFileSync(screenshotPath, image.toPNG())
        }
        writeFileSync(outputPath, JSON.stringify({ ok: true, result: { profile, ...result, ...narrowResult, ...shortcutResult }, screenshotPath }, null, 2))
        app.quit()
      } catch (error) {
        writeFileSync(outputPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
        app.quit()
      }
    }, 700)
  })
}

function runAutomatedPetOverlaySmoke(win: BrowserWindow, outputPath: string, screenshotPath?: string): void {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const profile = getAppProfile()
        const session = sessionManager.list()[0] ?? null
        if (session) sessionManager.updateName(session.id, 'Overlay geometry smoke')

        let overlayWindow: BrowserWindow | null = null
        for (let attempt = 0; attempt < 30; attempt += 1) {
          overlayWindow = BrowserWindow.getAllWindows().find((candidate) =>
            candidate !== win && !candidate.isDestroyed() && candidate.webContents.getURL().includes('pet-overlay')
          ) ?? null
          if (overlayWindow) break
          await new Promise((resolve) => setTimeout(resolve, 150))
        }

        if (!overlayWindow) {
          writeFileSync(outputPath, JSON.stringify({ ok: true, result: { profile, overlayFound: false }, screenshotPath }, null, 2))
          app.quit()
          return
        }

        overlayWindow.showInactive()
        overlayWindow.moveTop()
        if (session) sessionManager.updateStatus(session.id, 'provider_error')
        await new Promise((resolve) => setTimeout(resolve, 900))

        const geometryResult = await overlayWindow.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const waitForOverlay = async () => {
              for (let index = 0; index < 240; index += 1) {
                if (document.querySelector('[data-avatar-mascot="true"]') && document.querySelector('[data-testid="avatar-overlay-notification-badge"]')) return true;
                await sleep(50);
              }
              return false;
            };
            const config = await window.petApi.pet.getConfig();
            const rectFor = (selector) => {
              const el = document.querySelector(selector);
              if (!el) return null;
              const rect = el.getBoundingClientRect();
              return {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height
              };
            };
            const tolerance = 3;
            const overlayReady = await waitForOverlay();
            if (!overlayReady) {
              return {
                overlayFound: true,
                badgeFound: false,
                trayFound: false,
                mascotFound: false,
                badgeInsideViewport: false,
                trayAligned: false,
                noHorizontalOverflow: true,
                noVerticalOverflow: true,
                resizeMaxInside: false,
                resizeMinInside: false,
                rowControlsReveal: false,
                rowExpandControlVisible: false,
                rowExpanded: false,
                trayCollapsed: false,
                trayReopened: false,
                resizeHandleFound: false,
                resizeHandleCompact: false,
                overlayRootCursorDefault: false,
                resizeGripMascotHoverHidden: false,
                resizeGripHoverVisible: false,
                resizeGripFocusVisible: false,
                bodyText: document.body.innerText
              };
            }
            const geometrySnapshot = () => {
              const viewport = { width: window.innerWidth, height: window.innerHeight };
              const badge = rectFor('[data-testid="avatar-overlay-notification-badge"]');
              const tray = rectFor('[data-avatar-overlay-size="notification-tray"]');
              const mascot = rectFor('[data-avatar-mascot="true"]');
              const badgeInsideViewport = Boolean(badge) &&
                badge.left >= -tolerance &&
                badge.top >= -tolerance &&
                badge.right <= viewport.width + tolerance &&
                badge.bottom <= viewport.height + tolerance;
              const trayAligned = Boolean(tray && mascot) &&
                Math.abs(tray.right - mascot.right) <= 4;
              const noHorizontalOverflow = [badge, tray, mascot].filter(Boolean).every((rect) =>
                rect.left >= -tolerance && rect.right <= viewport.width + tolerance
              );
              const noVerticalOverflow = [badge, tray, mascot].filter(Boolean).every((rect) =>
                rect.top >= -tolerance && rect.bottom <= viewport.height + tolerance
              );
              return {
                viewport,
                badge,
                tray,
                mascot,
                badgeFound: Boolean(badge),
                trayFound: Boolean(tray && tray.height > 0),
                mascotFound: Boolean(mascot),
                badgeInsideViewport,
                trayAligned,
                noHorizontalOverflow,
                noVerticalOverflow,
              };
            };
            const revealRowControls = async () => {
              const row = document.querySelector('[data-avatar-overlay-measure="notification-tray-row"]');
              const rowButton = document.querySelector('[data-avatar-overlay-measure="notification-tray-row"] [role="button"]');
              if (row instanceof HTMLElement) {
                const rect = row.getBoundingClientRect();
                const eventInit = {
                  bubbles: true,
                  clientX: rect.left + Math.min(24, rect.width / 2),
                  clientY: rect.top + Math.min(24, rect.height / 2),
                  pointerType: 'mouse'
                };
                row.dispatchEvent(new PointerEvent('pointerover', eventInit));
                row.dispatchEvent(new PointerEvent('pointerenter', { ...eventInit, bubbles: false }));
                row.dispatchEvent(new MouseEvent('mouseover', eventInit));
                row.dispatchEvent(new MouseEvent('mouseenter', { ...eventInit, bubbles: false }));
                row.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: null }));
              }
              if (rowButton instanceof HTMLElement) {
                rowButton.focus({ preventScroll: true });
                rowButton.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: null }));
              }
              await sleep(120);
              const dismiss = document.querySelector('[data-avatar-overlay-control="dismiss"]');
              const expand = document.querySelector('[data-avatar-overlay-control="expand"]');
              const activeRow = document.querySelector('[data-avatar-overlay-row-active="true"]');
              return {
                rowControlsReveal: Boolean(activeRow && dismiss),
                rowExpandControlVisible: Boolean(activeRow && expand)
              };
            };
            const clickExpand = async () => {
              const body = document.querySelector('[data-avatar-overlay-measure-body="true"]');
              const before = body?.getBoundingClientRect().height ?? 0;
              const button = document.querySelector('[data-avatar-overlay-control="expand"] button');
              if (button instanceof HTMLElement) button.click();
              await sleep(180);
              const after = document.querySelector('[data-avatar-overlay-measure-body="true"]')?.getBoundingClientRect().height ?? 0;
              return { rowExpanded: after > before + 8, rowBodyBeforeHeight: before, rowBodyAfterHeight: after };
            };
            const toggleTray = async () => {
              const badge = document.querySelector('[data-testid="avatar-overlay-notification-badge"]');
              if (badge instanceof HTMLElement) badge.click();
              await sleep(220);
              const tray = document.querySelector('[data-avatar-overlay-size="notification-tray"]');
              const trayCollapsed = !document.querySelector('[data-avatar-overlay-measure="notification-tray-row"]') &&
                Boolean(document.querySelector('[data-testid="avatar-overlay-notification-badge"]')) &&
                (tray?.getBoundingClientRect().height ?? 0) === 0;
              const collapsedBadge = document.querySelector('[data-testid="avatar-overlay-notification-badge"]');
              if (collapsedBadge instanceof HTMLElement) collapsedBadge.click();
              await sleep(220);
              const trayReopened = Boolean(document.querySelector('[data-avatar-overlay-measure="notification-tray-row"]'));
              return { trayCollapsed, trayReopened };
            };
            const revealResizeAffordance = async () => {
              const mascot = document.querySelector('[data-avatar-mascot="true"]');
              const handle = document.querySelector('[data-testid="avatar-overlay-resize-handle"]');
              const grip = document.querySelector('[data-testid="avatar-overlay-resize-grip"]');
              const root = document.body.firstElementChild;
              if (mascot instanceof HTMLElement) {
                const rect = mascot.getBoundingClientRect();
                const eventInit = {
                  bubbles: true,
                  clientX: rect.left + 10,
                  clientY: rect.top + 10,
                  pointerType: 'mouse'
                };
                mascot.dispatchEvent(new PointerEvent('pointerover', eventInit));
                mascot.dispatchEvent(new PointerEvent('pointerenter', { ...eventInit, bubbles: false }));
                mascot.dispatchEvent(new MouseEvent('mouseover', eventInit));
                mascot.dispatchEvent(new MouseEvent('mouseenter', { ...eventInit, bubbles: false }));
              }
              await sleep(160);
              const mascotHoverOpacity = grip ? Number.parseFloat(getComputedStyle(grip).opacity || '0') : 0;
              if (handle instanceof HTMLElement) {
                const rect = handle.getBoundingClientRect();
                const eventInit = {
                  bubbles: true,
                  clientX: rect.left + Math.max(1, rect.width / 2),
                  clientY: rect.top + Math.max(1, rect.height / 2),
                  pointerType: 'mouse'
                };
                handle.dispatchEvent(new PointerEvent('pointerover', eventInit));
                handle.dispatchEvent(new PointerEvent('pointerenter', { ...eventInit, bubbles: false }));
                handle.dispatchEvent(new MouseEvent('mouseover', eventInit));
                handle.dispatchEvent(new MouseEvent('mouseenter', { ...eventInit, bubbles: false }));
              }
              await sleep(160);
              const hoverOpacity = grip ? Number.parseFloat(getComputedStyle(grip).opacity || '0') : 0;
              if (handle instanceof HTMLElement) handle.focus({ preventScroll: true });
              await sleep(140);
              const focusOpacity = grip ? Number.parseFloat(getComputedStyle(grip).opacity || '0') : 0;
              const handleRect = handle instanceof HTMLElement ? handle.getBoundingClientRect() : null;
              return {
                resizeHandleFound: handle instanceof HTMLElement,
                resizeHandleCompact: Boolean(handleRect && handleRect.width <= 28 && handleRect.height <= 28),
                overlayRootCursorDefault: root instanceof HTMLElement && getComputedStyle(root).cursor !== 'nwse-resize',
                resizeGripMascotHoverHidden: mascotHoverOpacity < 0.2,
                resizeGripHoverVisible: hoverOpacity > 0.5,
                resizeGripFocusVisible: focusOpacity > 0.5
              };
            };
            const measureAtWidth = async (width) => {
              window.petApi.pet.setMascotWidth(width);
              for (let index = 0; index < 80; index += 1) {
                const mascot = rectFor('[data-avatar-mascot="true"]');
                if (mascot && Math.abs(mascot.width - width) <= 8) break;
                await sleep(50);
              }
              await sleep(120);
              return geometrySnapshot();
            };
            const baseGeometry = geometrySnapshot();
            const controlResult = await revealRowControls();
            const expandResult = await clickExpand();
            const trayToggleResult = await toggleTray();
            const resizeAffordanceResult = await revealResizeAffordance();
            const maxGeometry = await measureAtWidth(224);
            const minGeometry = await measureAtWidth(80);
            const resizeMaxInside = maxGeometry.badgeInsideViewport && maxGeometry.noHorizontalOverflow && maxGeometry.noVerticalOverflow;
            const resizeMinInside = minGeometry.badgeInsideViewport && minGeometry.noHorizontalOverflow && minGeometry.noVerticalOverflow;
            return {
              overlayFound: true,
              ...baseGeometry,
              resizeMaxInside,
              resizeMinInside,
              ...controlResult,
              ...expandResult,
              ...trayToggleResult,
              ...resizeAffordanceResult,
              maxGeometry,
              minGeometry,
              configPetCount: config.pets?.length ?? null,
              configSelectedPetId: config.selectedPetId ?? null,
              configSessions: (config.sessions ?? []).map((session) => ({ id: session.id, name: session.name, provider: session.provider, status: session.status, messages: session.messages?.length ?? 0 })),
              readyState: document.readyState,
              rootHtmlLength: document.getElementById('root')?.innerHTML.length ?? null,
              scripts: [...document.scripts].map((script) => script.src || script.getAttribute('src') || ''),
              bodyText: document.body.innerText
            };
          })()
        `)

        let replyResult: Record<string, unknown> = {
          replyFormOpened: false,
          replyInputFocused: false,
          replyFormClosedWithEscape: false
        }
        if (session) {
          sessionManager.updateStatus(session.id, 'waiting_for_user')
          await new Promise((resolve) => setTimeout(resolve, 450))
          replyResult = await overlayWindow.webContents.executeJavaScript(`
            (async () => {
              const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
              for (let index = 0; index < 160; index += 1) {
                if (document.body.innerText.includes('Waiting for your response') || document.body.innerText.includes('Answer Required')) break;
                await sleep(50);
              }
              const rowButton = document.querySelector('[data-avatar-overlay-measure="notification-tray-row"] [role="button"]');
              if (rowButton instanceof HTMLElement) {
                rowButton.focus({ preventScroll: true });
                rowButton.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: null }));
              }
              await sleep(120);
              const replyButton = document.querySelector('[data-avatar-overlay-control="reply"] button');
              if (replyButton instanceof HTMLElement) replyButton.click();
              await sleep(160);
              const input = document.querySelector('[data-avatar-overlay-reply-input]');
              const replyFormOpened = input instanceof HTMLInputElement;
              const replyInputFocused = replyFormOpened && document.activeElement === input;
              if (input instanceof HTMLInputElement) {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              }
              await sleep(120);
              return {
                replyFormOpened,
                replyInputFocused,
                replyFormClosedWithEscape: !document.querySelector('[data-avatar-overlay-reply-input]')
              };
            })()
          `)
        }

        let statusResult: Record<string, unknown> = {
          permissionActionsVisible: false,
          runningStatusMapped: false,
          reviewStatusMapped: false,
          failedStatusMapped: false,
          customProviderStatusMapped: false
        }
        if (session) {
          sessionManager.updateStatus(session.id, 'waiting_for_permission')
          sessionManager.applyRunEvents(session.id, [{
            type: 'permission.requested',
            content: 'Allow this command to inspect the workspace?',
            denials: [{
              tool_name: 'Bash',
              tool_use_id: 'pet-overlay-smoke-permission',
              tool_input: { command: 'ls -la' }
            }]
          }])
          await new Promise((resolve) => setTimeout(resolve, 420))
          const permissionResult = await overlayWindow.webContents.executeJavaScript(`
            (() => {
              const bodyText = document.body.innerText;
              return {
                permissionActionsVisible: bodyText.includes('Allow') && bodyText.includes('Deny'),
                permissionTitleMapped: bodyText.includes('Command Approval') || bodyText.includes('Approval Required'),
                permissionStatusMapped: document.querySelector('[data-avatar-overlay-notification-status="waiting"]') !== null
              };
            })()
          `)

          sessionManager.updateStatus(session.id, 'running')
          sessionManager.applyRunEvents(session.id, [{
            type: 'tool.started',
            id: 'pet-overlay-smoke-tool',
            toolName: 'Bash',
            toolInput: { command: 'npm run smoke:ui:auto -- --pet-overlay' }
          }])
          await new Promise((resolve) => setTimeout(resolve, 420))
          const runningResult = await overlayWindow.webContents.executeJavaScript(`
            (() => {
              const bodyText = document.body.innerText;
              return {
                runningStatusMapped: document.querySelector('[data-avatar-overlay-notification-status="running"]') !== null &&
                  (bodyText.includes('Running') || bodyText.includes('Running npm run smoke:ui:auto')),
                runningDismissHidden: !document.querySelector('[data-avatar-overlay-control="dismiss"]')
              };
            })()
          `)

          sessionManager.updateStatus(session.id, 'idle')
          sessionManager.appendMessage(session.id, [{
            id: 'pet-overlay-review-smoke',
            role: 'assistant',
            type: 'text',
            content: 'Ready to review: pet overlay custom provider state mapped correctly.',
            timestamp: Date.now()
          }])
          await new Promise((resolve) => setTimeout(resolve, 420))
          const reviewResult = await overlayWindow.webContents.executeJavaScript(`
            (() => {
              const bodyText = document.body.innerText;
              return {
                reviewStatusMapped: document.querySelector('[data-avatar-overlay-notification-status="review"]') !== null &&
                  (bodyText.includes('Ready to review') || bodyText.includes('Ready'))
              };
            })()
          `)

          sessionManager.updateStatus(session.id, 'model_error')
          await new Promise((resolve) => setTimeout(resolve, 420))
          const failedResult = await overlayWindow.webContents.executeJavaScript(`
            (() => {
              const bodyText = document.body.innerText;
              return {
                failedStatusMapped: document.querySelector('[data-avatar-overlay-notification-status="failed"]') !== null &&
                  (bodyText.includes('Run blocked') || bodyText.includes('Blocked') || bodyText.includes('Ready to review'))
              };
            })()
          `)

          const customConfig = await overlayWindow.webContents.executeJavaScript(`
            window.petApi.pet.getConfig().then((config) => ({
              customProviderStatusMapped: (config.sessions ?? []).some((session) => session.provider === 'custom-smoke' && session.status === 'model_error')
            }))
          `)

          statusResult = {
            ...permissionResult,
            ...runningResult,
            ...reviewResult,
            ...failedResult,
            ...customConfig
          }
        }

        if (screenshotPath) {
          const image = await overlayWindow.webContents.capturePage()
          writeFileSync(screenshotPath, image.toPNG())
        }
        writeFileSync(outputPath, JSON.stringify({ ok: true, result: { profile, ...geometryResult, ...replyResult, ...statusResult }, screenshotPath }, null, 2))
        app.quit()
      } catch (error) {
        writeFileSync(outputPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
        app.quit()
      }
    }, 700)
  })
}

function runAutomatedReducedMotionSmoke(win: BrowserWindow, outputPath: string, screenshotPath?: string): void {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const profile = getAppProfile()
        const session = sessionManager.list()[0] ?? null

        const mainResult = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
            const root = document.documentElement;
            const rootStyles = getComputedStyle(root);
            const duration = rootStyles.getPropertyValue('--motion-duration-panel').trim();
            const animatedView = document.querySelector('.motion-view-animated');
            const motionButton = document.querySelector('.motion-button, .motion-icon-button, .motion-edge-button');
            const transitionDurations = motionButton ? getComputedStyle(motionButton).transitionDuration.split(',').map((value) => value.trim()) : [];
            const animationDurations = animatedView ? getComputedStyle(animatedView).animationDuration.split(',').map((value) => value.trim()) : [];
            const isZeroDuration = (value) => {
              if (value === '0s' || value === '0ms' || value === '0.001ms') return true;
              const numeric = Number.parseFloat(value);
              if (!Number.isFinite(numeric)) return false;
              return value.endsWith('ms') ? numeric <= 0.001 : numeric <= 0.000001;
            };
            const allZero = (values) => values.length === 0 || values.every(isZeroDuration);

            const sidebarButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Toggle sidebar');
            sidebarButton?.click();
            await sleep(120);
            const rightPanel = document.querySelector('[data-motion-panel="right"]');
            const rightPanelDurations = rightPanel ? getComputedStyle(rightPanel).transitionDuration.split(',').map((value) => value.trim()) : [];

            const terminalButton = [...document.querySelectorAll('button')]
              .find((button) => button.getAttribute('title') === 'Toggle terminal');
            terminalButton?.click();
            await sleep(120);
            const bottomPanel = document.querySelector('[data-motion-panel="bottom"]');
            const bottomPanelDurations = bottomPanel ? getComputedStyle(bottomPanel).transitionDuration.split(',').map((value) => value.trim()) : [];

            const popover = document.createElement('div');
            popover.className = 'motion-popover-surface';
            document.body.appendChild(popover);
            const popoverDurations = getComputedStyle(popover).animationDuration.split(',').map((value) => value.trim());
            popover.remove();

            const sheet = document.createElement('section');
            sheet.className = 'motion-sheet';
            document.body.appendChild(sheet);
            const sheetDurations = getComputedStyle(sheet).animationDuration.split(',').map((value) => value.trim());
            sheet.remove();
            return {
              mainReducedDataset: root.dataset.reducedMotion === 'true',
              mainMotionDurationPanel: duration,
              mainPanelDurationZero: duration === '0ms',
              mainTransitionsZero: allZero(transitionDurations),
              mainAnimationsZero: allZero(animationDurations),
              mainRightPanelReduced: rightPanel?.getAttribute('data-open') === 'true' && allZero(rightPanelDurations),
              mainBottomPanelReduced: bottomPanel?.getAttribute('data-open') === 'true' && allZero(bottomPanelDurations),
              mainPopoverReduced: allZero(popoverDurations),
              mainSheetReduced: allZero(sheetDurations)
            };
          })()
        `)

        let overlayWindow: BrowserWindow | null = null
        for (let attempt = 0; attempt < 30; attempt += 1) {
          overlayWindow = BrowserWindow.getAllWindows().find((candidate) =>
            candidate !== win && !candidate.isDestroyed() && candidate.webContents.getURL().includes('pet-overlay')
          ) ?? null
          if (overlayWindow) break
          await new Promise((resolve) => setTimeout(resolve, 150))
        }

        let overlayResult: Record<string, unknown> = { overlayFound: false }
        if (overlayWindow) {
          overlayWindow.showInactive()
          overlayWindow.moveTop()
          if (session) {
            sessionManager.updateName(session.id, 'Reduced motion smoke')
            sessionManager.updateStatus(session.id, 'provider_error')
          }
          await new Promise((resolve) => setTimeout(resolve, 900))
          overlayResult = await overlayWindow.webContents.executeJavaScript(`
            (async () => {
              const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
              for (let index = 0; index < 240; index += 1) {
                if (document.querySelector('[data-testid="avatar-overlay-notification-badge"]') && document.querySelector('[data-avatar-overlay-measure="notification-tray-row"] > div')) break;
                await sleep(50);
              }
              const badge = document.querySelector('[data-testid="avatar-overlay-notification-badge"]');
              const row = document.querySelector('[data-avatar-overlay-measure="notification-tray-row"] > div');
              const resizeGrip = document.querySelector('[data-testid="avatar-overlay-resize-grip"]');
              if (badge instanceof HTMLElement) badge.click();
              await sleep(120);
              const trayCollapsedReduced = !document.querySelector('[data-avatar-overlay-measure="notification-tray-row"]');
              return {
                overlayFound: true,
                overlayReducedDataset: document.documentElement.dataset.reducedMotion === 'true',
                overlayBadgeTransition: badge ? badge.style.transition : null,
                overlayRowTransition: row ? row.style.transition : null,
                overlayResizeGripTransition: resizeGrip ? resizeGrip.style.transition : null,
                overlayBadgeTransitionDisabled: badge ? badge.style.transition === 'none' : false,
                overlayRowTransitionDisabled: row ? row.style.transition === 'none' : false,
                overlayResizeGripTransitionDisabled: resizeGrip ? resizeGrip.style.transition === 'none' : false,
                trayCollapsedReduced
              };
            })()
          `)
          if (session) {
            sessionManager.updateStatus(session.id, 'waiting_for_user')
            await new Promise((resolve) => setTimeout(resolve, 300))
            const replyReducedResult = await overlayWindow.webContents.executeJavaScript(`
              (async () => {
                const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                const badge = document.querySelector('[data-testid="avatar-overlay-notification-badge"]');
                if (badge instanceof HTMLElement && !document.querySelector('[data-avatar-overlay-measure="notification-tray-row"]')) badge.click();
                await sleep(120);
                const rowButton = document.querySelector('[data-avatar-overlay-measure="notification-tray-row"] [role="button"]');
                if (rowButton instanceof HTMLElement) rowButton.focus({ preventScroll: true });
                await sleep(40);
                const replyButton = document.querySelector('[data-avatar-overlay-control="reply"] button');
                if (replyButton instanceof HTMLElement) replyButton.click();
                await sleep(80);
                return {
                  replyFormReduced: Boolean(document.querySelector('[data-avatar-overlay-reply-input]')),
                  replyInputReducedTransitionDisabled: document.querySelector('[data-avatar-overlay-reply-input]') instanceof HTMLElement
                    ? getComputedStyle(document.querySelector('[data-avatar-overlay-reply-input]')).transitionDuration.split(',').every((value) => value.trim() === '0s' || value.trim() === '0ms')
                    : false
                };
              })()
            `)
            overlayResult = { ...overlayResult, ...replyReducedResult }
          }
          if (screenshotPath) {
            const image = await overlayWindow.webContents.capturePage()
            writeFileSync(screenshotPath, image.toPNG())
          }
        } else if (screenshotPath) {
          const image = await win.webContents.capturePage()
          writeFileSync(screenshotPath, image.toPNG())
        }

        writeFileSync(outputPath, JSON.stringify({ ok: true, result: { profile, ...mainResult, ...overlayResult }, screenshotPath }, null, 2))
        app.quit()
      } catch (error) {
        writeFileSync(outputPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
        app.quit()
      }
    }, 700)
  })
}

function runAutomatedScrollSmoke(win: BrowserWindow, outputPath: string, screenshotPath?: string): void {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const seededSession = sessionManager.list().find((candidate) =>
          candidate.messages.some((message) => message.id === 'scroll-smoke-stream')
        )
        const seededSessionId = seededSession?.id ?? null
        if (seededSessionId) win.webContents.send('pet:navigate', seededSessionId)
        await new Promise((resolve) => setTimeout(resolve, 300))

        const before = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const profile = await window.api.app.getProfile();
            await sleep(900);
            const scroller = document.querySelector('[data-testid="transcript-scroll"]');
            if (!scroller) return { profile, transcriptFound: false, seededSessionId: ${JSON.stringify(seededSessionId)}, bodyText: document.body.innerText };
            scroller.scrollTop = scroller.scrollHeight;
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            await sleep(40);
            scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -360, bubbles: true, cancelable: true }));
            scroller.scrollTop = Math.max(0, scroller.scrollTop - 360);
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            await sleep(120);
            return {
              profile,
              transcriptFound: true,
              beforeScrollTop: scroller.scrollTop,
              beforeScrollHeight: scroller.scrollHeight,
              beforeClientHeight: scroller.clientHeight,
              jumpVisibleBeforeUpdate: Boolean(document.querySelector('[data-testid="jump-to-latest"]'))
            };
          })()
        `)

        const session = sessionManager.list().find((candidate) =>
          candidate.messages.some((message) => message.id === 'scroll-smoke-stream')
        )
        const existing = session?.messages.find((message) => message.id === 'scroll-smoke-stream')
        if (session && existing?.type === 'text') {
          sessionManager.upsertMessage(session.id, {
            ...existing,
            content: `${existing.content}\n\n${Array.from({ length: 24 }, (_, index) => `streaming update line ${index + 1}`).join('\n')}`,
            isStreaming: true
          })
        }

        await new Promise((resolve) => setTimeout(resolve, 250))

        const after = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const scroller = document.querySelector('[data-testid="transcript-scroll"]');
            if (!scroller) return { transcriptFound: false };
            const afterScrollTop = scroller.scrollTop;
            const afterScrollHeight = scroller.scrollHeight;
            const afterClientHeight = scroller.clientHeight;
            const afterBottomDistance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
            const jump = document.querySelector('[data-testid="jump-to-latest"]');
            const jumpVisibleAfterUpdate = Boolean(jump);
            const streamingCursorVisibleDuringUpdate = Boolean(document.querySelector('[data-testid="streaming-cursor"]'));
            jump?.click();
            await sleep(180);
            const finalBottomDistance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
            return {
              transcriptFound: true,
              afterScrollTop,
              afterScrollHeight,
              afterClientHeight,
              afterBottomDistance,
              jumpVisibleAfterUpdate,
              streamingCursorVisibleDuringUpdate,
              finalScrollTop: scroller.scrollTop,
              finalBottomDistance,
              jumpVisibleAfterClick: Boolean(document.querySelector('[data-testid="jump-to-latest"]'))
            };
          })()
        `)

        const completedSession = sessionManager.list().find((candidate) =>
          candidate.messages.some((message) => message.id === 'scroll-smoke-stream')
        )
        const completedMessage = completedSession?.messages.find((message) => message.id === 'scroll-smoke-stream')
        if (completedSession && completedMessage?.type === 'text') {
          sessionManager.upsertMessage(completedSession.id, {
            ...completedMessage,
            isStreaming: false
          })
        }

        await new Promise((resolve) => setTimeout(resolve, 180))

        const complete = await win.webContents.executeJavaScript(`
          (() => {
            const scroller = document.querySelector('[data-testid="transcript-scroll"]');
            if (!(scroller instanceof HTMLElement)) return { transcriptFoundAfterComplete: false };
            const text = scroller.innerText;
            const finalLineMatches = text.match(/streaming update line 24/g) ?? [];
            return {
              transcriptFoundAfterComplete: true,
              streamingCursorHiddenAfterComplete: !document.querySelector('[data-testid="streaming-cursor"]'),
              finalStreamingTextDeduped: finalLineMatches.length === 1
            };
          })()
        `)

        const result = {
          ...before,
          ...after,
          ...complete,
          scrollStayedPut: Boolean(before?.transcriptFound && after?.transcriptFound) &&
            Math.abs((after.afterScrollTop ?? 0) - (before.beforeScrollTop ?? 0)) <= 8,
          streamingDidNotAutoFollow: Boolean(after?.transcriptFound) &&
            (after.afterBottomDistance ?? 0) > 80,
          jumpToLatestReached: Boolean(after?.transcriptFound) && (after.finalBottomDistance ?? Number.POSITIVE_INFINITY) <= 80
        }

        if (screenshotPath) {
          const image = await win.webContents.capturePage()
          writeFileSync(screenshotPath, image.toPNG())
        }
        writeFileSync(outputPath, JSON.stringify({ ok: true, result, screenshotPath }, null, 2))
        app.quit()
      } catch (error) {
        writeFileSync(outputPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
        app.quit()
      }
    }, 700)
  })
}

function runAutomatedTranscriptStressSmoke(win: BrowserWindow, outputPath: string, screenshotPath?: string): void {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const stressSession = sessionManager.list().find((candidate) =>
          candidate.messages.some((message) => message.type === 'text' && message.content.includes('TRANSCRIPT_STRESS_LATEST'))
        )
        const stressSessionId = stressSession?.id ?? null
        if (stressSessionId) win.webContents.send('pet:navigate', stressSessionId)

        const result = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const profile = await window.api.app.getProfile();
            const startedAt = performance.now();
            for (let index = 0; index < 160; index += 1) {
              const text = document.querySelector('[data-testid="transcript-scroll"]')?.innerText ?? '';
              if (text.includes('TRANSCRIPT_STRESS_LATEST')) break;
              await sleep(10);
            }
            const scroller = document.querySelector('[data-testid="transcript-scroll"]');
            if (!(scroller instanceof HTMLElement)) {
              return { profile, stressTranscriptFound: false, stressSessionId: ${JSON.stringify(stressSessionId)}, bodyText: document.body.innerText };
            }
            const readyElapsedMs = performance.now() - startedAt;
            const text = scroller.innerText;
            const hiddenCount = () => Number((document.querySelector('[data-testid="load-earlier-messages"]')?.textContent ?? '').match(/Show\\s+([\\d,]+)/)?.[1]?.replace(/,/g, '') ?? 0);
            const mountedRows = () => document.querySelectorAll('[data-testid="virtual-transcript-row"]').length;
            const messageCount = window.__orchestratorSessionSwitchLastPerf?.messageCount ?? null;
            const initialHidden = hiddenCount();
            const initialMountedRows = mountedRows();

            scroller.scrollTop = Math.min(240, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
            scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
            let afterLazyHidden = initialHidden;
            for (let index = 0; index < 100; index += 1) {
              afterLazyHidden = hiddenCount();
              if (afterLazyHidden > 0 && afterLazyHidden < initialHidden) break;
              await sleep(20);
            }
            await sleep(80);
            const lazyMountedRows = mountedRows();

            window.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'f',
              code: 'KeyF',
              metaKey: true,
              bubbles: true,
              cancelable: true
            }));
            await sleep(80);
            const search = document.querySelector('[data-testid="transcript-search"]');
            let searchJumpFound = false;
            if (search instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(search.constructor.prototype, 'value')?.set;
              setter?.call(search, 'TRANSCRIPT_STRESS_EARLY_0007');
              search.dispatchEvent(new Event('input', { bubbles: true }));
              for (let index = 0; index < 120; index += 1) {
                const resultButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('TRANSCRIPT_STRESS_EARLY_0007'));
                if (resultButton instanceof HTMLButtonElement) {
                  resultButton.click();
                  break;
                }
                await sleep(20);
              }
              for (let index = 0; index < 120; index += 1) {
                if ((document.querySelector('[data-testid="transcript-scroll"]')?.innerText ?? '').includes('TRANSCRIPT_STRESS_EARLY_0007')) {
                  searchJumpFound = true;
                  break;
                }
                await sleep(20);
              }
            }
            const searchMountedRows = mountedRows();

            return {
              profile,
              stressTranscriptFound: text.includes('TRANSCRIPT_STRESS_LATEST'),
              readyElapsedMs,
              messageCount,
              initialHidden,
              afterLazyHidden,
              initialMountedRows,
              lazyMountedRows,
              searchMountedRows,
              lazyLoadedOlderChunk: initialHidden > 0 && afterLazyHidden < initialHidden,
              searchJumpFound
            };
          })()
        `)

        if (screenshotPath) {
          const image = await win.webContents.capturePage()
          writeFileSync(screenshotPath, image.toPNG())
        }
        writeFileSync(outputPath, JSON.stringify({ ok: true, result, screenshotPath }, null, 2))
        app.quit()
      } catch (error) {
        writeFileSync(outputPath, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
        app.quit()
      }
    }, 700)
  })
}

app.whenReady().then(async () => {
  ;({ registerIpcHandlers } = await import('./ipc'))
  ;({ createPetOverlayWindow, destroyPetOverlayWindow, setCreateMainWindowCallback } = await import('./petOverlay'))
  ;({ projectStore } = await import('./projects'))
  ;({ sessionManager } = await import('./sessions'))

  electronApp.setAppUserModelId('com.orchestrator.app')

  registerIpcHandlers(ipcMain)
  installApplicationMenu()
  setCreateMainWindowCallback(createWindow)
  await bootstrapAutomatedUiSmokeState()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  destroyPetOverlayWindow?.()
})

async function bootstrapAutomatedUiSmokeState(): Promise<void> {
  if (!process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT) return
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'empty-state') return
  const workspace = process.env.ORCHESTRATOR_SMOKE_WORKSPACE_DIR ?? process.cwd()
  const existing = projectStore.list()
  const project = existing[0] ?? projectStore.add('Automated UI Smoke', workspace)
  const existingSessions = sessionManager.list()
  let session = existingSessions.find((candidate) => candidate.projectId === project.id)
  if (!session) {
    session = await sessionManager.create({
      projectId: project.id,
      workDir: project.rootPath,
      useWorktree: false,
      repoRoot: project.rootPath
    })
    projectStore.addSession(project.id, session.id)
  }
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'scroll') {
    seedAutomatedScrollSmokeSession(session.id)
  } else if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'sidebar') {
    await seedAutomatedSidebarSmokeSessions(project.id, project.rootPath)
  } else if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'transcript-layout') {
    seedAutomatedTranscriptLayoutSmokeSession(session.id)
  } else if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'session-switch') {
    await seedAutomatedSessionSwitchSmokeSessions(project.id, project.rootPath)
  } else if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'transcript-stress') {
    await seedAutomatedTranscriptStressSmokeSession(project.id, project.rootPath)
  } else if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'settings') {
    seedAutomatedSettingsSmokeSession(session.id)
  } else if (
    process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'pet-overlay' ||
    process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'motion-reduced'
  ) {
    const fixtureMessage: ChatMessage = {
      id: `${process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW}-pet-fixture`,
      role: 'assistant',
      type: 'text',
      content: [
        'Pet overlay smoke fixture state.',
        'This line exercises the hidden expand control.',
        'This line verifies row-height measurement after expansion.',
        'This line keeps tray resizing independent from a live provider run.'
      ].join('\n'),
      timestamp: Date.now()
    }
    sessionManager.save({
      ...session,
      name: process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'pet-overlay'
        ? 'Overlay geometry smoke'
        : 'Reduced motion smoke',
      provider: 'custom-smoke',
      status: 'provider_error',
      messages: [
        ...session.messages.filter((message) => message.id !== fixtureMessage.id),
        fixtureMessage
      ]
    })
  }
}

function seedAutomatedSettingsSmokeSession(sessionId: string): void {
  const session = sessionManager.get(sessionId)
  if (!session) return
  sessionManager.save({
    ...session,
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    usageSummary: {
      inputTokens: 1200,
      outputTokens: 340,
      cacheCreationInputTokens: 80,
      cacheReadInputTokens: 420,
      totalTokens: 2040,
      totalCostUsd: 0.0123,
      durationMs: 4200,
      apiDurationMs: 3100,
      turns: 2,
      serviceTier: 'standard',
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 1200,
          outputTokens: 340,
          cacheReadInputTokens: 420,
          cacheCreationInputTokens: 80,
          costUSD: 0.0123,
          contextWindow: 200000,
          maxOutputTokens: 32000
        }
      }
    }
  })
}

function seedAutomatedScrollSmokeSession(sessionId: string): void {
  const messages: ChatMessage[] = Array.from({ length: 28 }, (_, index) => ({
    id: `scroll-smoke-${index + 1}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    type: 'text',
    content: `${index % 2 === 0 ? 'User' : 'Assistant'} scroll fixture ${index + 1}\n\n${Array.from({ length: 4 }, (_line, lineIndex) =>
      `This transcript line ${lineIndex + 1} creates enough vertical content to verify manual scrolling while output is still changing.`
    ).join('\n')}`,
    timestamp: Date.now() + index
  }))
  messages.push({
    id: 'scroll-smoke-stream',
    role: 'assistant',
    type: 'text',
    content: 'Final assistant response before simulated streaming update.\n\nThe smoke test scrolls up, then updates this message.',
    timestamp: Date.now() + messages.length
  })
  sessionManager.appendMessage(sessionId, messages)
}

function seedAutomatedTranscriptLayoutSmokeSession(sessionId: string): void {
  const session = sessionManager.get(sessionId)
  if (!session) return

  const baseTime = Date.now()
  const longToken = `TRANSCRIPT_LAYOUT_SMOKE_${'A'.repeat(220)}`
  const longPath = `${process.env.ORCHESTRATOR_SMOKE_WORKSPACE_DIR ?? '/tmp/orchestrator-automated-ui-workspace'}/src/${'deeply-nested-layout-fixture-segment/'.repeat(5)}transcript-layout-fixture.ts`
  const explicitMissingPath = `${process.env.ORCHESTRATOR_SMOKE_WORKSPACE_DIR ?? '/tmp/orchestrator-automated-ui-workspace'}/explicit-missing-file.ts`
  const messages: ChatMessage[] = [
    {
      id: 'transcript-layout-user',
      role: 'user',
      type: 'text',
      content: `Please inspect this intentionally long input without stretching the transcript.\n\n${'input-fragment-'.repeat(80)}`,
      timestamp: baseTime
    },
    {
      id: 'transcript-layout-assistant',
      role: 'assistant',
      type: 'text',
      content: [
        'TRANSCRIPT_LAYOUT_SMOKE',
        '',
        'This fixture keeps markdown, code, tables, and file references inside the transcript bounds.',
        '',
        '```ts',
        `export const longLayoutToken = "${longToken}";`,
        '```',
        '',
        '| Surface | Stress value |',
        '| --- | --- |',
        `| code | ${longToken} |`,
        `| path | ${longPath} |`,
        '',
        `Referenced fixture: \`${longPath}\``,
        '',
        `Explicit missing fixture: \`${explicitMissingPath}\``,
        'Review prose should not create a card for `DefinitelyMissingRelativeReviewFile.java`.'
      ].join('\n'),
      timestamp: baseTime + 1
    },
    ...Array.from({ length: 14 }, (_, index): ChatMessage => ({
      id: `transcript-layout-tool-${index + 1}`,
      role: 'assistant',
      type: 'tool_use',
      toolName: 'Bash',
      toolInput: {
        command: `printf '${longToken}-${index + 1}'`,
        cwd: longPath,
        description: `Layout fixture tool call ${index + 1}`
      },
      timestamp: baseTime + 2 + index
    }))
  ]

  sessionManager.save({
    ...session,
    name: 'Transcript layout smoke',
    status: 'idle',
    messages,
    createdAt: baseTime,
    latestMessageAt: baseTime + messages.length
  })
}

async function seedAutomatedSidebarSmokeSessions(projectId: string, workDir: string): Promise<void> {
  const baseTime = Date.now()
  if (!projectStore.list().some((project) => project.name === 'Sidebar secondary project')) {
    projectStore.add('Sidebar secondary project', workDir)
  }
  const fixtures: Array<{
    name: string
    pinned: boolean
    status: ReturnType<typeof sessionManager.list>[number]['status']
    offset: number
    pinOrder?: number
  }> = [
    { name: 'Sidebar pinned older', pinned: true, status: 'idle', offset: 1, pinOrder: 1 },
    { name: 'Sidebar pinned recent', pinned: true, status: 'idle', offset: 5, pinOrder: 2 },
    { name: 'Sidebar normal idle', pinned: false, status: 'idle', offset: 3 },
    { name: 'Sidebar unread idle', pinned: false, status: 'idle', offset: 4 },
    { name: 'Sidebar error', pinned: false, status: 'provider_error', offset: 2 },
    { name: 'Sidebar running', pinned: false, status: 'running', offset: 6 },
  ]

  for (const fixture of fixtures) {
    const existing = sessionManager.list().find((session) => session.name === fixture.name)
    const session = existing ?? await sessionManager.create({
      projectId,
      workDir,
      useWorktree: false,
      repoRoot: workDir
    })
    const timestamp = baseTime + fixture.offset
    sessionManager.save({
      ...session,
      name: fixture.name,
      pinned: fixture.pinned,
      pinOrder: fixture.pinned ? fixture.pinOrder : undefined,
      status: fixture.status,
      messages: [{
        id: `sidebar-smoke-${fixture.name.toLowerCase().replace(/\s+/g, '-')}`,
        role: 'assistant',
        type: 'text',
        content: `${fixture.name} fixture message.`,
        timestamp
      }],
      createdAt: timestamp,
      latestMessageAt: timestamp
    })
    projectStore.addSession(projectId, session.id)
  }
}

async function seedAutomatedSessionSwitchSmokeSessions(projectId: string, workDir: string): Promise<void> {
  const existing = sessionManager.list()
  const one = existing.find((session) =>
    session.messages.some((message) => message.type === 'text' && message.content.includes('SESSION_SWITCH_SMOKE_ONE'))
  ) ?? await createSessionSwitchFixture(projectId, workDir, 'Session switch one', 'SESSION_SWITCH_SMOKE_ONE')
  const two = existing.find((session) =>
    session.messages.some((message) => message.type === 'text' && message.content.includes('SESSION_SWITCH_SMOKE_TWO'))
  ) ?? await createSessionSwitchFixture(projectId, workDir, 'Session switch two', 'SESSION_SWITCH_SMOKE_TWO')
  projectStore.addSession(projectId, one.id)
  projectStore.addSession(projectId, two.id)
}

async function seedAutomatedTranscriptStressSmokeSession(projectId: string, workDir: string): Promise<void> {
  const existing = sessionManager.list().find((session) =>
    session.messages.some((message) => message.type === 'text' && message.content.includes('TRANSCRIPT_STRESS_LATEST'))
  )
  const session = existing ?? await sessionManager.create({
    projectId,
    workDir,
    useWorktree: false,
    repoRoot: workDir
  })
  const baseTime = Date.now()
  const messages: ChatMessage[] = Array.from({ length: 2500 }, (_, index) => {
    const number = String(index + 1).padStart(4, '0')
    const marker = index === 6 ? 'TRANSCRIPT_STRESS_EARLY_0007' : `TRANSCRIPT_STRESS_${number}`
    return {
      id: `transcript-stress-${number}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      type: 'text',
      content: [
        `${marker}: large transcript fixture message ${number}.`,
        `This message verifies measured virtualization on a long thread without mounting thousands of rows.`,
        index % 10 === 0
          ? Array.from({ length: 8 }, (_line, lineIndex) => `Extra markdown-ish paragraph ${lineIndex + 1} for variable row height.`).join('\n')
          : 'Short row variant for estimator coverage.'
      ].join('\n\n'),
      timestamp: baseTime + index
    }
  })
  messages.push({
    id: 'transcript-stress-latest',
    role: 'assistant',
    type: 'text',
    content: [
      'TRANSCRIPT_STRESS_LATEST: latest message should appear immediately after switching to the large transcript.',
      '',
      '```ts',
      'export const transcriptStressLatest = true',
      '```'
    ].join('\n'),
    timestamp: baseTime + messages.length
  })

  sessionManager.save({
    ...session,
    name: 'Transcript stress smoke',
    status: 'idle',
    messages,
    createdAt: baseTime,
    latestMessageAt: baseTime + messages.length,
    messageCount: messages.length,
    messagesLoaded: true
  })
  projectStore.addSession(projectId, session.id)
}

async function createSessionSwitchFixture(
  projectId: string,
  workDir: string,
  name: string,
  marker: string
): Promise<ReturnType<typeof sessionManager.list>[number]> {
  const session = await sessionManager.create({
    projectId,
    workDir,
    useWorktree: false,
    repoRoot: workDir
  })
  sessionManager.updateName(session.id, name)
  const baseTime = Date.now()
  const messages: ChatMessage[] = Array.from({ length: 420 }, (_, index) => ({
    id: `${marker.toLowerCase()}-${index + 1}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    type: 'text',
    content: `Long history ${marker} message ${index + 1}\n\n${Array.from({ length: 3 }, (_line, lineIndex) =>
      `This seeded line ${lineIndex + 1} makes session switching exercise realistic transcript volume without depending on user data.`
    ).join('\n')}`,
    timestamp: baseTime + index
  }))
  messages.push({
    id: `${marker.toLowerCase()}-assistant`,
    role: 'assistant',
    type: 'text',
    content: [
      `${marker}: seeded transcript content for immediate chat switching.`,
      '',
      '```ts',
      'export const largeChatFixture = true',
      '```',
      '',
      '| Surface | Purpose |',
      '| --- | --- |',
      '| transcript | validates markdown render cost |',
      '| sidebar | validates metadata-first loading |',
      '',
      Array.from({ length: 24 }, (_, line) => `Detailed fixture paragraph ${line + 1} keeps the active message realistic without relying on private user data.`).join('\n')
    ].join('\n'),
    timestamp: baseTime + messages.length
  })
  sessionManager.appendMessage(session.id, messages)
  return sessionManager.get(session.id) ?? session
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
