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
    focusable: shouldForegroundWindow,
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
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'browser') {
    runAutomatedBrowserSmoke(win, outputPath, screenshotPath)
    return
  }

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      win.webContents.executeJavaScript(`
        (async () => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const buttonLabel = (button) =>
            button.getAttribute('aria-label') ??
            button.getAttribute('data-tooltip-label') ??
            button.getAttribute('title') ??
            button.textContent?.trim() ??
            '';
          const findButton = (label) =>
            [...document.querySelectorAll('button')]
              .find((button) => buttonLabel(button) === label);
          const findButtonStartingWith = (labelPrefix) =>
            [...document.querySelectorAll('button')]
              .find((button) => buttonLabel(button).startsWith(labelPrefix));
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
            sessions = [session];
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'inspector' && sessions[0]) {
            await window.api.sessions.updatePinned(sessions[0].id, true);
          }
          await sleep(900);
          const chatEmptyState = document.querySelector('[data-testid="chat-empty-state"]');
          const textarea = document.querySelector('textarea');
          const composerPlaceholder = textarea instanceof HTMLTextAreaElement
            ? textarea.getAttribute('placeholder') ?? ''
            : '';
          var chatEmptyStateWorks =
            chatEmptyState instanceof HTMLElement &&
            chatEmptyState.innerText.trim().length === 0 &&
            composerPlaceholder === 'What do you want to build?';
          var chatEmptyStateQuietWorks =
            chatEmptyState instanceof HTMLElement &&
            chatEmptyState.querySelector('h1, h2, h3, [role="heading"]') === null &&
            chatEmptyState.innerText.trim().length === 0;
          const primaryContent = document.querySelector('[data-testid="session-primary-content"]');
          const activeProjectName = projects[0]?.name ?? '';
          const activeProjectMentionsInPrimary = activeProjectName && primaryContent instanceof HTMLElement
            ? primaryContent.innerText.split(activeProjectName).length - 1
            : 0;
          var chatEmptyStateProjectLabelClean =
            chatEmptyState instanceof HTMLElement &&
            Boolean(activeProjectName) &&
            chatEmptyState.innerText.includes(activeProjectName) === false &&
            activeProjectMentionsInPrimary === 0;
          textarea?.focus();
          if (textarea && !['composer', 'extensions'].includes(${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)})) {
            textarea.value = '/btw smoke check';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await sleep(100);
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'inspector') {
            const chatActionsButton = document.querySelector('[data-testid="titlebar-chat-actions"]');
            const titlebarToggleSidebar = document.querySelector('[data-testid="titlebar-toggle-sidebar"]');
            const headerActions = document.querySelector('[data-testid="titlebar-actions"]')?.getAttribute('data-header-actions') ?? '';
            var headerActionMenuWorks =
              headerActions.includes('folder') &&
              headerActions.includes('project') &&
              headerActions.includes('session') &&
              headerActions.includes('provider-session');
            var titlebarSidebarToggleWorks =
              titlebarToggleSidebar instanceof HTMLButtonElement &&
              titlebarToggleSidebar.getAttribute('aria-label') === 'Toggle sidebar' &&
              titlebarToggleSidebar.dataset.icon === 'panelRight';
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
          if (
            ${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'settings' ||
            ${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'settings-providers' ||
            ${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'pets'
          ) {
            const settingsButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.trim() === 'Settings' || buttonLabel(button) === 'Settings');
            settingsButton?.click();
            await sleep(450);
            if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'settings-providers') {
              const providersNavButton = [...document.querySelectorAll('button')]
                .find((button) => button.textContent?.includes('Providers'));
              providersNavButton?.click();
              await sleep(450);
              const diagnosticsButton = document.querySelector('[data-testid="provider-diagnostics-toggle"]');
              if (diagnosticsButton instanceof HTMLElement) diagnosticsButton.click();
              await sleep(450);
              const diagnosticsSection = document.querySelector('[data-testid="provider-settings-section"]');
              const configEditor = document.querySelector('[data-testid="provider-config-editor"]');
              const providerModelList = document.querySelector('[data-testid="provider-model-list"]');
              const customModelToggle = document.querySelector('[data-testid="provider-custom-model-toggle"]');
              const customModelInput = document.querySelector('[data-testid="provider-custom-model-input"]');
              const providerSelects = diagnosticsSection instanceof HTMLElement
                ? [...diagnosticsSection.querySelectorAll('select')]
                : [];
              const providerSelectorCard = document.querySelector('[data-testid="provider-selector-card"]');
              const providerSelectorSummary = document.querySelector('[data-testid="provider-selector-summary"]');
              const providerDetailsGrid = document.querySelector('[data-testid="provider-details-grid"]');
              const providerSetupCard = document.querySelector('[data-testid="provider-setup-card"]');
              const providerStatusCard = document.querySelector('[data-testid="provider-status-card"]');
              const usageStatusStrip = document.querySelector('[data-testid="provider-usage-status-strip"]');
              const usageDiagnosticsCard = document.querySelector('[data-testid="provider-usage-diagnostics-card"]');
              const providerControlPanels = diagnosticsSection instanceof HTMLElement
                ? [...diagnosticsSection.querySelectorAll('.provider-settings-stack .settings-panel')]
                : [];
              const providerControlPanelText = providerControlPanels[0] instanceof HTMLElement
                ? providerControlPanels[0].innerText
                : '';
              const usageDiagnosticsText = usageDiagnosticsCard instanceof HTMLElement
                ? usageDiagnosticsCard.innerText.replace(/\\s+/g, ' ')
                : '';
              const hasUsageEmptyState = Boolean(document.querySelector('[data-testid="provider-usage-empty"]'));
              const hasUsageMetrics = usageDiagnosticsText.includes('Tokens') &&
                usageDiagnosticsText.includes('Cost') &&
                usageDiagnosticsText.includes('Time');
              const providerCapabilitySummary = document.querySelector('[data-testid="provider-capability-summary"]');
              const providerCapabilitySelect = document.querySelector('[data-testid="provider-capability-select"]');
              const providerCapabilityOutput = document.querySelector('[data-testid="provider-capability-output"]');
              const providerButtonLabels = diagnosticsSection instanceof HTMLElement
                ? [...diagnosticsSection.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '')
                : [];
              var settingsProviderDropdownWorks =
                diagnosticsSection instanceof HTMLElement &&
                providerSelectorCard instanceof HTMLElement &&
                providerSelectorSummary instanceof HTMLElement &&
                providerSelectorSummary.textContent?.includes('Ready') &&
                providerSelectorCard.getBoundingClientRect().height <= 38 &&
                providerSelects.some((select) => [...select.options].some((option) => option.textContent?.includes('Codex CLI'))) &&
                !providerButtonLabels.some((label) => ['Claude Code', 'GitHub Copilot', 'Codex CLI', 'Cursor'].includes(label));
              var settingsDiagnosticsSectionWorks =
                diagnosticsSection instanceof HTMLElement &&
                diagnosticsSection.innerText.includes('Capabilities') &&
                diagnosticsSection.innerText.includes('Config') &&
                diagnosticsSection.innerText.includes('Setup') &&
                diagnosticsSection.innerText.includes('Status') &&
                providerDetailsGrid instanceof HTMLElement &&
                providerDetailsGrid.getBoundingClientRect().height <= 360 &&
                providerSetupCard instanceof HTMLElement &&
                providerSetupCard.scrollWidth <= providerSetupCard.clientWidth + 2 &&
                providerCapabilitySummary instanceof HTMLElement &&
                providerCapabilitySummary.innerText.includes('Checks') &&
                providerCapabilitySummary.querySelector('strong') === null &&
                providerCapabilitySummary.getBoundingClientRect().height <= 24 &&
                providerCapabilitySelect instanceof HTMLSelectElement &&
                providerCapabilitySelect.value === '' &&
                providerCapabilityOutput === null &&
                !diagnosticsSection.innerText.includes('auth status');
              var settingsProviderStatusUnifiedWorks =
                providerStatusCard instanceof HTMLElement &&
                providerStatusCard.innerText.includes('Status') &&
                providerStatusCard.innerText.includes('Usage') &&
                providerStatusCard.querySelector('[data-testid="provider-usage-diagnostics-card"]') instanceof HTMLElement &&
                !providerStatusCard.innerText.includes('Health') &&
                providerStatusCard.getBoundingClientRect().height <= 180 &&
                providerStatusCard.scrollWidth <= providerStatusCard.clientWidth + 2;
              var settingsUsageDiagnosticsWorks =
                diagnosticsSection instanceof HTMLElement &&
                diagnosticsSection.innerText.includes('Usage') &&
                usageDiagnosticsText.includes('Runs') &&
                usageDiagnosticsText.includes('Budget') &&
                usageDiagnosticsCard instanceof HTMLElement &&
                (hasUsageEmptyState ? usageDiagnosticsText.includes('No usage yet') : hasUsageMetrics) &&
                usageStatusStrip instanceof HTMLElement &&
                usageStatusStrip.getBoundingClientRect().height <= 76 &&
                !usageDiagnosticsText.includes('Tokens Unknown') &&
                !usageDiagnosticsText.includes('Cost Unknown') &&
                !usageDiagnosticsText.includes('Time Unknown') &&
                !usageDiagnosticsText.includes('Quota Unknown') &&
                !diagnosticsSection.innerText.includes('No cache') &&
                !diagnosticsSection.innerText.includes('No turns');
              var settingsProviderModelsCollapsedWorks =
                diagnosticsSection instanceof HTMLElement &&
                diagnosticsSection.innerText.includes('Default') &&
                diagnosticsSection.innerText.includes('Models') &&
                customModelToggle instanceof HTMLElement &&
                customModelInput === null &&
                diagnosticsSection.innerText.includes('Edit model list') &&
                !diagnosticsSection.innerText.includes('Catalog') &&
                diagnosticsSection.innerText.indexOf('Default') < diagnosticsSection.innerText.indexOf('Models') &&
                diagnosticsSection.innerText.indexOf('Models') < diagnosticsSection.innerText.indexOf('Details') &&
                providerModelList instanceof HTMLElement &&
                providerModelList.dataset.expanded === 'false' &&
                providerModelList.getBoundingClientRect().height <= 76 &&
                configEditor instanceof HTMLElement &&
                configEditor.dataset.expanded === 'false' &&
                configEditor.querySelector('textarea') === null;
              var settingsProviderControlSurfaceUnifiedWorks =
                providerControlPanels.length === 1 &&
                providerControlPanelText.includes('Default') &&
                providerControlPanelText.includes('Models') &&
                providerControlPanelText.includes('Capabilities') &&
                providerControlPanelText.indexOf('Default') < providerControlPanelText.indexOf('Models') &&
                providerControlPanelText.indexOf('Models') < providerControlPanelText.indexOf('Capabilities');
              const diagnosticsToggle = document.querySelector('[data-testid="provider-diagnostics-toggle"]');
              var settingsDiagnosticsDisclosureCompactWorks =
                diagnosticsToggle instanceof HTMLElement &&
                diagnosticsToggle.getBoundingClientRect().height <= 32 &&
                diagnosticsToggle.getAttribute('aria-expanded') === 'true' &&
                diagnosticsToggle.textContent?.includes('Details') &&
                !diagnosticsToggle.textContent?.includes('Advanced') &&
                !diagnosticsToggle.textContent?.includes('Shown') &&
                !diagnosticsToggle.textContent?.includes('Hidden');
              const editModelListButton = [...document.querySelectorAll('button')]
                .find((button) => button.textContent?.includes('Edit model list'));
              editModelListButton?.scrollIntoView({ block: 'center' });
              var settingsProviderCatalogLabelCalm = false;
              if (editModelListButton instanceof HTMLButtonElement) {
                editModelListButton.click();
                await sleep(160);
                const catalogLabel = document.querySelector('[data-testid="provider-model-catalog-label"]');
                const catalogText = catalogLabel?.textContent?.trim() ?? '';
                settingsProviderCatalogLabelCalm =
                  catalogLabel instanceof HTMLElement &&
                  catalogText === 'Catalog' &&
                  catalogText !== catalogText.toUpperCase() &&
                  getComputedStyle(catalogLabel).textTransform !== 'uppercase';
                const doneModelListButton = [...document.querySelectorAll('button')]
                  .find((button) => button.textContent?.trim() === 'Done');
                if (doneModelListButton instanceof HTMLButtonElement) {
                  doneModelListButton.click();
                  await sleep(100);
                }
              }
            }
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
              const diagnosticsPanelButton = document.querySelector('[data-testid="provider-diagnostics-toggle"]');
              if (diagnosticsPanelButton instanceof HTMLElement) diagnosticsPanelButton.click();
              await sleep(450);
              const diagnosticsSection = document.querySelector('[data-testid="provider-settings-section"]');
              const configEditor = document.querySelector('[data-testid="provider-config-editor"]');
              const providerModelList = document.querySelector('[data-testid="provider-model-list"]');
              const customModelToggle = document.querySelector('[data-testid="provider-custom-model-toggle"]');
              const customModelInput = document.querySelector('[data-testid="provider-custom-model-input"]');
              const usageStatusStrip = document.querySelector('[data-testid="provider-usage-status-strip"]');
              const providerDetailsGrid = document.querySelector('[data-testid="provider-details-grid"]');
              const providerSetupCard = document.querySelector('[data-testid="provider-setup-card"]');
              const providerStatusCard = document.querySelector('[data-testid="provider-status-card"]');
              const usageDiagnosticsCard = document.querySelector('[data-testid="provider-usage-diagnostics-card"]');
              const usageDiagnosticsText = usageDiagnosticsCard instanceof HTMLElement
                ? usageDiagnosticsCard.innerText.replace(/\\s+/g, ' ')
                : '';
              const hasUsageEmptyState = Boolean(document.querySelector('[data-testid="provider-usage-empty"]'));
              const hasUsageMetrics = usageDiagnosticsText.includes('Tokens') &&
                usageDiagnosticsText.includes('Cost') &&
                usageDiagnosticsText.includes('Time');
              const providerCapabilitySummary = document.querySelector('[data-testid="provider-capability-summary"]');
              const providerCapabilitySelect = document.querySelector('[data-testid="provider-capability-select"]');
              const providerCapabilityOutput = document.querySelector('[data-testid="provider-capability-output"]');
              var settingsDiagnosticsSectionWorks =
                diagnosticsSection instanceof HTMLElement &&
                diagnosticsSection.innerText.includes('Capabilities') &&
                diagnosticsSection.innerText.includes('Config') &&
                diagnosticsSection.innerText.includes('Setup') &&
                diagnosticsSection.innerText.includes('Status') &&
                providerDetailsGrid instanceof HTMLElement &&
                providerDetailsGrid.getBoundingClientRect().height <= 360 &&
                providerSetupCard instanceof HTMLElement &&
                providerSetupCard.scrollWidth <= providerSetupCard.clientWidth + 2 &&
                providerCapabilitySummary instanceof HTMLElement &&
                providerCapabilitySummary.innerText.includes('Checks') &&
                providerCapabilitySummary.querySelector('strong') === null &&
                providerCapabilitySummary.getBoundingClientRect().height <= 24 &&
                providerCapabilitySelect instanceof HTMLSelectElement &&
                providerCapabilitySelect.value === '' &&
                providerCapabilityOutput === null &&
                !diagnosticsSection.innerText.includes('auth status');
              var settingsProviderStatusUnifiedWorks =
                providerStatusCard instanceof HTMLElement &&
                providerStatusCard.innerText.includes('Status') &&
                providerStatusCard.innerText.includes('Usage') &&
                providerStatusCard.querySelector('[data-testid="provider-usage-diagnostics-card"]') instanceof HTMLElement &&
                !providerStatusCard.innerText.includes('Health') &&
                providerStatusCard.getBoundingClientRect().height <= 180 &&
                providerStatusCard.scrollWidth <= providerStatusCard.clientWidth + 2;
              var settingsUsageDiagnosticsWorks =
                diagnosticsSection instanceof HTMLElement &&
                diagnosticsSection.innerText.includes('Usage') &&
                usageDiagnosticsText.includes('Runs') &&
                usageDiagnosticsText.includes('Budget') &&
                usageDiagnosticsCard instanceof HTMLElement &&
                (hasUsageEmptyState ? usageDiagnosticsText.includes('No usage yet') : hasUsageMetrics) &&
                usageStatusStrip instanceof HTMLElement &&
                usageStatusStrip.getBoundingClientRect().height <= 76 &&
                !usageDiagnosticsText.includes('Tokens Unknown') &&
                !usageDiagnosticsText.includes('Cost Unknown') &&
                !usageDiagnosticsText.includes('Time Unknown') &&
                !usageDiagnosticsText.includes('Quota Unknown') &&
                !diagnosticsSection.innerText.includes('No cache') &&
                !diagnosticsSection.innerText.includes('No turns');
              var settingsProviderModelsCollapsedWorks =
                diagnosticsSection instanceof HTMLElement &&
                diagnosticsSection.innerText.includes('Default') &&
                diagnosticsSection.innerText.includes('Models') &&
                customModelToggle instanceof HTMLElement &&
                customModelInput === null &&
                diagnosticsSection.innerText.includes('Edit model list') &&
                !diagnosticsSection.innerText.includes('Catalog') &&
                diagnosticsSection.innerText.indexOf('Default') < diagnosticsSection.innerText.indexOf('Models') &&
                diagnosticsSection.innerText.indexOf('Models') < diagnosticsSection.innerText.indexOf('Details') &&
                providerModelList instanceof HTMLElement &&
                providerModelList.dataset.expanded === 'false' &&
                providerModelList.getBoundingClientRect().height <= 76 &&
                configEditor instanceof HTMLElement &&
                configEditor.dataset.expanded === 'false' &&
                configEditor.querySelector('textarea') === null;
              const providerDiagnosticsToggle = document.querySelector('[data-testid="provider-diagnostics-toggle"]');
              var settingsDiagnosticsDisclosureCompactWorks =
                providerDiagnosticsToggle instanceof HTMLElement &&
                providerDiagnosticsToggle.getBoundingClientRect().height <= 32 &&
                providerDiagnosticsToggle.getAttribute('aria-expanded') === 'true' &&
                providerDiagnosticsToggle.textContent?.includes('Details') &&
                !providerDiagnosticsToggle.textContent?.includes('Advanced') &&
                !providerDiagnosticsToggle.textContent?.includes('Shown') &&
                !providerDiagnosticsToggle.textContent?.includes('Hidden');
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
              const shortcutsButton = [...document.querySelectorAll('button')]
                .find((button) => button.textContent?.includes('Shortcuts'));
              shortcutsButton?.click();
              await sleep(220);
              const shortcutsSection = document.querySelector('[data-testid="shortcuts-settings-section"]');
              const shortcutKeys = [...document.querySelectorAll('[data-testid="settings-shortcut-key"]')];
              const shortcutSequences = [...document.querySelectorAll('[data-testid="settings-shortcut-sequence"]')];
              const shortcutSearch = document.querySelector('#settings-shortcut-search');
              if (shortcutSearch instanceof HTMLInputElement) {
                const setter = Object.getOwnPropertyDescriptor(shortcutSearch.constructor.prototype, 'value')?.set;
                setter?.call(shortcutSearch, 'terminal');
                shortcutSearch.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(120);
              }
              const shortcutSearchClear = document.querySelector('[data-testid="settings-shortcut-search-clear"]');
              if (shortcutSearchClear instanceof HTMLButtonElement) {
                shortcutSearchClear.click();
                await sleep(120);
              }
              const shortcutText = shortcutsSection instanceof HTMLElement ? shortcutsSection.innerText : '';
              const shortcutHeader = shortcutsSection instanceof HTMLElement
                ? shortcutsSection.querySelector('.settings-shortcuts-head')
                : null;
              const shortcutRows = [...document.querySelectorAll('[data-testid="shortcuts-settings-section"] .settings-shortcut-row')]
                .filter((row) => row instanceof HTMLElement);
              const shortcutRowRects = shortcutRows.map((row) => row.getBoundingClientRect());
              const shortcutKeyRects = shortcutKeys
                .filter((key) => key instanceof HTMLElement)
                .map((key) => key.getBoundingClientRect());
              const settingsNavItems = [...document.querySelectorAll('[data-testid="sidebar-nav-item"]')]
                .filter((row) => row instanceof HTMLElement);
              const settingsNavItemRects = settingsNavItems.map((row) => row.getBoundingClientRect());
              const settingsFooterAction = document.querySelector('[data-testid="sidebar-footer-action"]');
              const settingsFooterRect = settingsFooterAction instanceof HTMLElement
                ? settingsFooterAction.getBoundingClientRect()
                : null;
              var settingsSidebarNavCompactWorks =
                settingsNavItems.length >= 6 &&
                settingsNavItemRects.every((rect) => rect.height <= 34) &&
                settingsNavItems.every((row) => row.scrollWidth <= row.clientWidth + 2) &&
                settingsFooterRect !== null &&
                settingsFooterRect.height <= 36 &&
                settingsFooterAction instanceof HTMLElement &&
                settingsFooterAction.scrollWidth <= settingsFooterAction.clientWidth + 2;
              var settingsShortcutsCompactWorks =
                shortcutsSection instanceof HTMLElement &&
                shortcutsSection.innerText.includes('Command Palette') &&
                shortcutsSection.innerText.includes('Shortcut') &&
                shortcutSearch instanceof HTMLInputElement &&
                shortcutSearch.value === '' &&
                Boolean(shortcutsSection.querySelector('.inspector-search-field')) &&
                shortcutHeader instanceof HTMLElement &&
                getComputedStyle(shortcutHeader).textTransform !== 'uppercase' &&
                !document.querySelector('[data-testid="settings-shortcut-search-clear"]') &&
                !shortcutText.toLowerCase().includes('keybinding') &&
                shortcutKeys.length >= 8 &&
                shortcutSequences.length >= 8 &&
                shortcutRows.length >= 8 &&
                shortcutRowRects.every((rect) => rect.height <= 38) &&
                shortcutKeyRects.every((rect) => rect.height <= 24 && rect.width <= 74) &&
                !shortcutText.includes('Navigation') &&
                !shortcutText.includes('Panels') &&
                !shortcutText.includes('Toggle Inspector') &&
                !shortcutText.includes('Toggle Terminal') &&
                !shortcutText.includes('Pin or Unpin Chat') &&
                !shortcutText.includes('Search Transcript') &&
                shortcutKeys.every((key) => {
                  const text = key.textContent?.trim() ?? '';
                  return text.length > 0 && !text.includes(' ');
                });
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
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'plan') {
            const planSessionRow = [...document.querySelectorAll('[data-testid="session-row"]')]
              .find((node) => node.textContent?.includes('Plan panel smoke'));
            if (planSessionRow instanceof HTMLElement) {
              planSessionRow.click();
              await sleep(320);
            }
            const planTab = document.querySelector('[data-tab-id="plan"]')?.closest('[role="tab"]');
            if (planTab instanceof HTMLElement) {
              planTab.click();
              await sleep(240);
            }
            const planPanel = document.querySelector('[data-testid="plan-panel"]');
            const statusCardLabel = document.querySelector('[data-testid="status-card-label"]');
            const compactGoal = document.querySelector('[data-testid="plan-goal-compact-objective"]');
            const goalLabel = document.querySelector('[data-testid="plan-goal-label"]');
            const goalToggle = document.querySelector('[data-testid="plan-goal-toggle"]');
            const taskList = document.querySelector('[data-testid="plan-task-list"]');
            const hiddenSentence = 'This hidden sentence should only appear after expanding the full objective.';
            const compactPanelText = planPanel instanceof HTMLElement ? planPanel.innerText : '';
            const taskListText = taskList instanceof HTMLElement ? taskList.innerText : '';
            const transcriptText = document.querySelector('[data-testid="transcript-scroll"]')?.textContent ?? '';
            const compactGoalWorks =
              planPanel instanceof HTMLElement &&
              statusCardLabel instanceof HTMLElement &&
              getComputedStyle(statusCardLabel).textTransform !== 'uppercase' &&
              compactGoal instanceof HTMLElement &&
              goalLabel instanceof HTMLElement &&
              getComputedStyle(goalLabel).textTransform !== 'uppercase' &&
              compactGoal.textContent?.includes('Keep the right sidebar calm and useful') === true &&
              !compactPanelText.includes(hiddenSentence) &&
              !transcriptText.includes(hiddenSentence) &&
              compactGoal.textContent.length < 140;
            var compactTaskRowsWork =
              taskList instanceof HTMLElement &&
              taskListText.includes('Reduce Plan panel verbosity') &&
              !taskListText.includes('Completed') &&
              !taskListText.includes('In progress') &&
              !taskListText.includes('Pending');
            const planGoalToggleCompactWorks =
              goalToggle instanceof HTMLButtonElement &&
              goalToggle.dataset.icon === 'chevronRight' &&
              goalToggle.getAttribute('aria-label') === 'Show full objective' &&
              !compactPanelText.includes('Details') &&
              !compactPanelText.includes('Hide');
            if (goalToggle instanceof HTMLButtonElement) {
              goalToggle.click();
              await sleep(120);
            }
            var planPanelWorks =
              compactGoalWorks &&
              compactTaskRowsWork &&
              planGoalToggleCompactWorks &&
              document.querySelector('[data-testid="session-right-panel"]')?.getAttribute('data-right-panel-active-tab') === 'plan' &&
              document.body.innerText.includes('Reduce Plan panel verbosity') &&
              document.body.innerText.includes(hiddenSentence) &&
              Boolean(document.querySelector('[data-testid="plan-goal-full-objective"]'));
            const agentsTab = document.querySelector('[data-tab-id="agents"]')?.closest('[role="tab"]');
            var planAgentStatLabelsCalm = false;
            if (agentsTab instanceof HTMLElement) {
              agentsTab.click();
              await sleep(180);
              const statLabels = [...document.querySelectorAll('[data-testid="agent-stat-label"]')]
                .filter((label) => label instanceof HTMLElement);
              planAgentStatLabelsCalm =
                statLabels.length === 4 &&
                statLabels.every((label) => {
                  const text = label.textContent?.trim() ?? '';
                  return text.length === 0 ||
                    (text !== text.toUpperCase() && getComputedStyle(label).textTransform !== 'uppercase');
                });
              planTab?.click();
              await sleep(120);
            }
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'pets') {
            const petsButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('Pets'));
            petsButton?.click();
            await sleep(450);
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'terminal') {
            const terminalButton = findButton('Toggle terminal');
            terminalButton?.click();
            await sleep(700);
            const newTerminalButton = findButton('New terminal');
            if (newTerminalButton instanceof HTMLButtonElement) {
              newTerminalButton.click();
              await sleep(260);
            }
            const bottomPanelWithTabs = document.querySelector('[data-testid="session-bottom-panel"]');
            var terminalTabsPersistState =
              bottomPanelWithTabs instanceof HTMLElement &&
              bottomPanelWithTabs.dataset.bottomPanelTabs?.includes(',') === true &&
              bottomPanelWithTabs.dataset.bottomPanelActiveTab !== '0';
            const hideTerminalButton = findButton('Hide terminal');
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
            const sidebarButton = findButton('Toggle sidebar');
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
            const expandButton = findButton('Expand panel');
            const expandButtonLabelBefore = expandButton instanceof HTMLButtonElement
              ? expandButton.getAttribute('aria-label')
              : null;
            const expandButtonIconBefore = expandButton instanceof HTMLButtonElement
              ? expandButton.dataset.icon
              : null;
            if (expandButton instanceof HTMLButtonElement) {
              expandButton.click();
              await sleep(180);
            }
            const rightPanelExpanded = document.querySelector('[data-testid="session-right-panel"]');
            const rightPanelExpandedContainer = rightPanelExpanded instanceof HTMLElement
              ? rightPanelExpanded.closest('[data-motion-panel="right"]')
              : null;
            const mainRowAfterExpand = document.querySelector('[data-testid="session-main-row"]');
            const primaryAfterExpand = document.querySelector('[data-testid="session-primary-content"]');
            const primaryWidthAfterExpand = primaryAfterExpand instanceof HTMLElement ? primaryAfterExpand.getBoundingClientRect().width : 0;
            const mainRowWidthAfterExpand = mainRowAfterExpand instanceof HTMLElement ? mainRowAfterExpand.getBoundingClientRect().width : 0;
            const expandedContentWidth = rightPanelExpanded instanceof HTMLElement ? rightPanelExpanded.getBoundingClientRect().width : 0;
            const expandedWidth = rightPanelExpandedContainer instanceof HTMLElement
              ? rightPanelExpandedContainer.getBoundingClientRect().width
              : expandedContentWidth;
            const restoreButton = findButton('Restore panel width');
            const restoreButtonLabelAfterExpand = restoreButton instanceof HTMLButtonElement
              ? restoreButton.getAttribute('aria-label')
              : null;
            const restoreButtonIconAfterExpand = restoreButton instanceof HTMLButtonElement
              ? restoreButton.dataset.icon
              : null;
            var rightPanelExpandDebug = {
              widthBefore,
              dataWidthAfterExpand: Number(rightPanelExpanded?.getAttribute('data-right-panel-width') ?? '0'),
              actualWidthAfterExpand: expandedContentWidth,
              containerWidthAfterExpand: expandedWidth,
              fullWidthAfterExpand: rightPanelExpanded instanceof HTMLElement ? rightPanelExpanded.dataset.rightPanelFullWidth : null,
              mainRowWidthAfterExpand,
              primaryWidthBefore,
              primaryWidthAfterExpand,
              expandButtonLabelBefore,
              expandButtonIconBefore,
              restoreButtonLabelAfterExpand,
              restoreButtonIconAfterExpand
            };
            var rightPanelExpandWorks =
              rightPanelExpanded instanceof HTMLElement &&
              rightPanelExpanded.dataset.rightPanelFullWidth === 'true' &&
              expandedWidth > widthBefore + 40 &&
              Math.abs(expandedWidth - mainRowWidthAfterExpand) <= 4 &&
              primaryWidthAfterExpand >= primaryWidthBefore - 8 &&
              expandButton instanceof HTMLButtonElement &&
              expandButtonLabelBefore === 'Expand panel' &&
              expandButtonIconBefore === 'maximize' &&
              restoreButton instanceof HTMLButtonElement &&
              restoreButtonLabelAfterExpand === 'Restore panel width' &&
              restoreButtonIconAfterExpand === 'minimize';
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
              setter?.call(diffSearch, 'data-preview-smoke');
              diffSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            const jsonReviewButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('data-preview-smoke.json'));
            if (jsonReviewButton instanceof HTMLButtonElement) {
              jsonReviewButton.click();
              await sleep(220);
            }
            const reviewJsonState = document.querySelector('[data-testid="review-json-state"]');
            var reviewJsonPreviewWorks =
              reviewJsonState instanceof HTMLElement &&
              reviewJsonState.innerText.includes('JSON') &&
              reviewJsonState.innerText.includes('updated') &&
              reviewJsonState.querySelector('.file-preview-code') instanceof HTMLElement &&
              !document.querySelector('[data-testid="review-source-preview"]');
            if (diffSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(diffSearch.constructor.prototype, 'value')?.set;
              setter?.call(diffSearch, 'table-preview-smoke');
              diffSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            const csvReviewButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('table-preview-smoke.csv'));
            if (csvReviewButton instanceof HTMLButtonElement) {
              csvReviewButton.click();
              await sleep(220);
            }
            const reviewCsvState = document.querySelector('[data-testid="review-csv-state"]');
            var reviewCsvPreviewWorks =
              reviewCsvState instanceof HTMLElement &&
              reviewCsvState.innerText.includes('CSV') &&
              reviewCsvState.innerText.includes('2 rows') &&
              Boolean(reviewCsvState.querySelector('.file-preview-table')) &&
              !document.querySelector('[data-testid="review-source-preview"]');
            if (diffSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(diffSearch.constructor.prototype, 'value')?.set;
              setter?.call(diffSearch, 'document-preview-smoke');
              diffSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            const documentReviewButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('document-preview-smoke.docx'));
            if (documentReviewButton instanceof HTMLButtonElement) {
              documentReviewButton.click();
              await sleep(220);
            }
            const reviewDocumentState = document.querySelector('[data-testid="review-document-state"]');
            var reviewDocumentPreviewWorks =
              reviewDocumentState instanceof HTMLElement &&
              reviewDocumentState.innerText.includes('DOCX') &&
              reviewDocumentState.innerText.includes('Document smoke updated') &&
              Boolean(reviewDocumentState.querySelector('.document-preview-body')) &&
              !document.querySelector('[data-testid="review-source-preview"]');
            if (diffSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(diffSearch.constructor.prototype, 'value')?.set;
              setter?.call(diffSearch, 'notebook-preview-smoke');
              diffSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            const notebookReviewButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('notebook-preview-smoke.ipynb'));
            if (notebookReviewButton instanceof HTMLButtonElement) {
              notebookReviewButton.click();
              await sleep(220);
            }
            const reviewNotebookState = document.querySelector('[data-testid="review-notebook-state"]');
            var reviewNotebookPreviewWorks =
              reviewNotebookState instanceof HTMLElement &&
              reviewNotebookState.innerText.includes('Notebook') &&
              reviewNotebookState.innerText.includes('3 cells') &&
              reviewNotebookState.innerText.includes('Updated') &&
              Boolean(reviewNotebookState.querySelector('.notebook-preview-cell')) &&
              !document.querySelector('[data-testid="review-source-preview"]');
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
            const reviewBinaryStateElement = document.querySelector('[data-testid="review-binary-state"]');
            const reviewBinaryStateActions = reviewBinaryStateElement instanceof HTMLElement
              ? [...reviewBinaryStateElement.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '')
              : [];
            const reviewPreview = document.querySelector('[data-testid="review-preview"]');
            const reviewBinaryStateRect = reviewBinaryStateElement instanceof HTMLElement ? reviewBinaryStateElement.getBoundingClientRect() : null;
            const reviewPreviewRect = reviewPreview instanceof HTMLElement ? reviewPreview.getBoundingClientRect() : null;
            const reviewBinaryStateCompact = reviewBinaryStateRect !== null && reviewPreviewRect !== null &&
              reviewBinaryStateRect.top <= reviewPreviewRect.top + 24 &&
              reviewBinaryStateRect.height <= 126;
            var reviewBinaryStateWorks =
              reviewBinaryStateElement instanceof HTMLElement &&
              reviewBinaryStateRect !== null &&
              reviewPreviewRect !== null &&
              reviewBinaryStateCompact &&
              reviewBinaryStateElement.innerText.includes('Binary') &&
              document.body.innerText.includes('Binary file not shown.');
            var reviewBinaryActionsWork =
              reviewBinaryStateActions.includes('Open') &&
              reviewBinaryStateActions.includes('Reveal');
            const diffSearchClear = document.querySelector('[data-testid="diff-file-search-clear"]');
            if (diffSearchClear instanceof HTMLButtonElement) {
              diffSearchClear.click();
              await sleep(120);
            }
            var reviewSearchClearWorks =
              diffSearch instanceof HTMLInputElement &&
              diffSearch.value === '' &&
              !document.querySelector('[data-testid="diff-file-search-clear"]') &&
              Boolean([...document.querySelectorAll('button')]
                .find((button) => button.textContent?.includes('binary-preview-smoke.bin')));
            const filesTabButton = document.querySelector('[data-tab-id="files"]')?.closest('[role="tab"]');
            if (filesTabButton instanceof HTMLElement) {
              filesTabButton.click();
            } else {
              const inspectorToolsButton = findButton('Add panel tab');
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
            const filesToolbar = document.querySelector('[data-testid="files-panel-toolbar"]');
            const filesToolbarActions = document.querySelector('[data-testid="files-panel-toolbar"] .files-panel-actions');
            const filesToolbarActionButtons = filesToolbarActions instanceof HTMLElement
              ? [...filesToolbarActions.querySelectorAll('.motion-icon-button')]
              : [];
            const filesEntryCount = document.querySelector('[data-testid="files-panel-toolbar"] .files-entry-count');
            var filesToolbarCompactWorks =
              filesToolbar instanceof HTMLElement &&
              fileSearch instanceof HTMLInputElement &&
              filesToolbarActions instanceof HTMLElement &&
              filesEntryCount instanceof HTMLElement &&
              filesToolbar.getBoundingClientRect().height <= 38 &&
              filesToolbar.scrollWidth <= filesToolbar.clientWidth + 2 &&
              fileSearch.getBoundingClientRect().height <= 28 &&
              filesToolbarActions.getBoundingClientRect().height <= 26 &&
              filesToolbarActionButtons.length === 1 &&
              !findButton('Add file to chat') &&
              filesEntryCount.textContent?.trim().length > 0;
            const filesPanelBody = document.querySelector('[data-testid="files-panel-body"]');
            const filesPanelList = document.querySelector('[data-testid="files-panel-list"]');
            const filesPanelPreview = document.querySelector('[data-testid="files-panel-preview"]');
            const filesPanelBodyRect = filesPanelBody instanceof HTMLElement ? filesPanelBody.getBoundingClientRect() : null;
            const filesPanelListRect = filesPanelList instanceof HTMLElement ? filesPanelList.getBoundingClientRect() : null;
            const filesPanelPreviewRect = filesPanelPreview instanceof HTMLElement ? filesPanelPreview.getBoundingClientRect() : null;
            var filesPanelStackedWorks =
              filesPanelBody instanceof HTMLElement &&
              filesPanelList instanceof HTMLElement &&
              filesPanelPreview instanceof HTMLElement &&
              filesPanelBodyRect !== null &&
              filesPanelListRect !== null &&
              filesPanelPreviewRect !== null &&
              filesPanelListRect.top >= filesPanelBodyRect.top - 2 &&
              filesPanelPreviewRect.top >= filesPanelListRect.bottom - 2 &&
              filesPanelPreviewRect.width >= filesPanelListRect.width - 2 &&
              filesPanelPreviewRect.width >= 300 &&
              filesPanelBody.scrollWidth <= filesPanelBody.clientWidth + 2;
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
            var filesActionMenuCompactWorks = false;
            const fileActionMenuButton = findButton('File actions');
            if (fileActionMenuButton instanceof HTMLButtonElement) {
              fileActionMenuButton.click();
              await sleep(120);
              const menuItems = [...document.querySelectorAll('[role="menuitem"]')];
              const menuItemLabels = menuItems.map((item) => item.textContent?.trim() ?? '');
              const addToChatMenuItem = menuItems.find((item) => item.textContent?.includes('Add to chat'));
              filesActionMenuCompactWorks =
                menuItemLabels.includes('Add to chat') &&
                menuItemLabels.includes('Copy path') &&
                menuItemLabels.includes('Reveal file') &&
                menuItemLabels.includes('Open file');
              if (addToChatMenuItem instanceof HTMLElement) {
                addToChatMenuItem.click();
                await sleep(180);
              }
            }
            var filesTabSearchWorks =
              document.body.innerText.includes('nested note.md') &&
              document.body.innerText.includes('Nested file smoke preview') &&
              document.body.innerText.includes('Nested Folder') &&
              Boolean(document.querySelector('[data-testid="workspace-markdown-preview"]')) &&
              !document.querySelector('[data-testid="workspace-text-preview"]');
            var filesTabAttachWorks =
              [...document.querySelectorAll('.attachment-pill')]
                .some((attachment) => attachment.textContent?.includes('nested note.md'));
            if (fileSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(fileSearch.constructor.prototype, 'value')?.set;
              setter?.call(fileSearch, 'preview-page');
              fileSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            const htmlFileButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('preview-page.html'));
            if (htmlFileButton instanceof HTMLButtonElement) {
              htmlFileButton.click();
              await sleep(160);
            }
            var filesHtmlPreviewWorks =
              Boolean(document.querySelector('[data-testid="workspace-html-preview"]')) &&
              !document.querySelector('[data-testid="workspace-text-preview"]');
            if (fileSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(fileSearch.constructor.prototype, 'value')?.set;
              setter?.call(fileSearch, 'data-preview-smoke');
              fileSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            const jsonFileButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('data-preview-smoke.json'));
            if (jsonFileButton instanceof HTMLButtonElement) {
              jsonFileButton.click();
              await sleep(180);
            }
            const workspaceJsonPreview = document.querySelector('[data-testid="workspace-json-preview"]');
            var filesJsonPreviewWorks =
              workspaceJsonPreview instanceof HTMLElement &&
              workspaceJsonPreview.innerText.includes('JSON') &&
              workspaceJsonPreview.innerText.includes('updated') &&
              Boolean(workspaceJsonPreview.querySelector('.file-preview-code')) &&
              !document.querySelector('[data-testid="workspace-text-preview"]');
            if (fileSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(fileSearch.constructor.prototype, 'value')?.set;
              setter?.call(fileSearch, 'table-preview-smoke');
              fileSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            const csvFileButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('table-preview-smoke.csv'));
            if (csvFileButton instanceof HTMLButtonElement) {
              csvFileButton.click();
              await sleep(180);
            }
            const workspaceCsvPreview = document.querySelector('[data-testid="workspace-csv-preview"]');
            var filesCsvPreviewWorks =
              workspaceCsvPreview instanceof HTMLElement &&
              workspaceCsvPreview.innerText.includes('CSV') &&
              workspaceCsvPreview.innerText.includes('2 rows') &&
              Boolean(workspaceCsvPreview.querySelector('.file-preview-table')) &&
              !document.querySelector('[data-testid="workspace-text-preview"]');
            if (fileSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(fileSearch.constructor.prototype, 'value')?.set;
              setter?.call(fileSearch, 'document-preview-smoke');
              fileSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            const documentFileButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('document-preview-smoke.docx'));
            if (documentFileButton instanceof HTMLButtonElement) {
              documentFileButton.click();
              await sleep(180);
            }
            const workspaceDocumentPreview = document.querySelector('[data-testid="workspace-document-preview"]');
            var filesDocumentPreviewWorks =
              workspaceDocumentPreview instanceof HTMLElement &&
              workspaceDocumentPreview.innerText.includes('DOCX') &&
              workspaceDocumentPreview.innerText.includes('Document smoke updated') &&
              Boolean(workspaceDocumentPreview.querySelector('.document-preview-body')) &&
              !document.querySelector('[data-testid="workspace-text-preview"]');
            if (fileSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(fileSearch.constructor.prototype, 'value')?.set;
              setter?.call(fileSearch, 'notebook-preview-smoke');
              fileSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(160);
            }
            const notebookFileButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('notebook-preview-smoke.ipynb'));
            if (notebookFileButton instanceof HTMLButtonElement) {
              notebookFileButton.click();
              await sleep(180);
            }
            const workspaceNotebookPreview = document.querySelector('[data-testid="workspace-notebook-preview"]');
            var filesNotebookPreviewWorks =
              workspaceNotebookPreview instanceof HTMLElement &&
              workspaceNotebookPreview.innerText.includes('Notebook') &&
              workspaceNotebookPreview.innerText.includes('3 cells') &&
              workspaceNotebookPreview.innerText.includes('Updated') &&
              Boolean(workspaceNotebookPreview.querySelector('.notebook-preview-cell')) &&
              !document.querySelector('[data-testid="workspace-text-preview"]');
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
            const binaryState = document.querySelector('[data-testid="workspace-binary-state"]');
            const binaryStateButtons = binaryState instanceof HTMLElement
              ? [...binaryState.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '')
              : [];
            const binaryStateRect = binaryState instanceof HTMLElement ? binaryState.getBoundingClientRect() : null;
            const binaryPreviewRect = filesPanelPreview instanceof HTMLElement ? filesPanelPreview.getBoundingClientRect() : null;
            const filesBinaryStateCompact = binaryStateRect !== null && binaryPreviewRect !== null &&
              binaryStateRect.top <= binaryPreviewRect.top + 24 &&
              binaryStateRect.height <= 126;
            var filesBinaryPreviewWorks =
              binaryState instanceof HTMLElement &&
              binaryStateRect !== null &&
              binaryPreviewRect !== null &&
              filesBinaryStateCompact &&
              document.body.innerText.includes('Binary file not shown.') &&
              binaryState.innerText.includes('Binary') &&
              binaryStateButtons.includes('Open') &&
              binaryStateButtons.includes('Reveal') &&
              !document.querySelector('[data-testid="workspace-text-preview"]');
            if (fileSearch instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(fileSearch.constructor.prototype, 'value')?.set;
              setter?.call(fileSearch, 'does-not-exist-smoke');
              fileSearch.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(120);
            }
            var filesNoResultsWorks =
              (() => {
                const fileActionButtonAfterNoResults = findButton('File actions');
                const emptyListState = document.querySelector('[data-testid="workspace-file-empty-list"]');
                const emptyListStateRect = emptyListState instanceof HTMLElement ? emptyListState.getBoundingClientRect() : null;
                return emptyListState instanceof HTMLElement &&
                  emptyListStateRect !== null &&
                  emptyListState.innerText.includes('No matching files') &&
                  emptyListState.querySelector('svg') !== null &&
                  emptyListStateRect.height <= 48 &&
                  emptyListState.scrollWidth <= emptyListState.clientWidth + 2 &&
                  !document.querySelector('[data-testid="workspace-text-preview"]') &&
                  (fileActionButtonAfterNoResults instanceof HTMLButtonElement ? fileActionButtonAfterNoResults.disabled : true);
              })();
            const fileSearchClear = document.querySelector('[data-testid="workspace-file-search-clear"]');
            if (fileSearchClear instanceof HTMLButtonElement) {
              fileSearchClear.click();
              await sleep(120);
            }
            var filesSearchClearWorks =
              fileSearch instanceof HTMLInputElement &&
              fileSearch.value === '' &&
              !document.querySelector('[data-testid="workspace-file-search-clear"]') &&
              !document.querySelector('[data-testid="workspace-file-empty-list"]') &&
              Boolean([...document.querySelectorAll('button')]
                .find((button) => button.textContent?.includes('nested note.md')));
            const browserPanelTabButton = document.querySelector('[data-tab-id="browser"]')?.closest('[role="tab"]');
            if (browserPanelTabButton instanceof HTMLElement) {
              browserPanelTabButton.click();
            } else {
              const inspectorToolsButton = findButton('Add panel tab');
              if (inspectorToolsButton instanceof HTMLButtonElement) {
                inspectorToolsButton.click();
                await sleep(120);
                const browserMenuItem = [...document.querySelectorAll('[role="menuitem"]')]
                  .find((item) => item.textContent?.includes('Browser'));
                if (browserMenuItem instanceof HTMLElement) browserMenuItem.click();
              }
            }
            for (let index = 0; index < 20; index += 1) {
              if (document.querySelector('[data-testid="browser-url-input"]')) break;
              const browserTabMarker = document.querySelector('[data-tab-id="browser"]');
              const browserTab = browserTabMarker?.closest('[role="tab"]') ?? browserTabMarker;
              if (browserTab instanceof HTMLElement) browserTab.click();
              await sleep(100);
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
            var browserActionsNativeTitlesAbsent =
              document.querySelectorAll('.browser-actions-menu [title]').length === 0;
            const browserWebview = document.querySelector('[data-testid="browser-webview"]');
            const captureBrowserButton = findButton('Capture screenshot');
            if (captureBrowserButton instanceof HTMLButtonElement) {
              captureBrowserButton.click();
              await sleep(500);
            }
            var browserTabWorks =
              browserWebview instanceof HTMLElement &&
              typeof browserWebview.getAttribute === 'function' &&
              (document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-current-url') ?? '')
                .startsWith(${JSON.stringify(process.env.ORCHESTRATOR_BROWSER_SMOKE_URL ?? 'http://127.0.0.1:9')});
            var browserScreenshotWorks = Boolean(document.querySelector('[data-testid="browser-screenshot-preview"]'));
            const addBrowserScreenshotButton = findButton('Add screenshot');
            if (addBrowserScreenshotButton instanceof HTMLButtonElement) {
              addBrowserScreenshotButton.click();
              await sleep(160);
            }
            var browserScreenshotAttachmentWorks =
              [...document.querySelectorAll('.attachment-pill')]
                .some((attachment) => attachment.textContent?.includes('browser-'));
            const browserPanel = document.querySelector('[data-testid="browser-panel"]');
            const findInPageButton = findButton('Find in page');
            var browserFindWorks = false;
            var browserFindNavigationWorks = false;
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
                const nextFindButton = findButton('Next result');
                if (nextFindButton instanceof HTMLButtonElement) {
                  const beforeActiveMatch = Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-active-match') ?? '0');
                  nextFindButton.click();
                  for (let index = 0; index < 20; index += 1) {
                    const activeMatch = Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-active-match') ?? '0');
                    if (activeMatch > 0 && activeMatch !== beforeActiveMatch) break;
                    await sleep(100);
                  }
                  browserFindNavigationWorks =
                    Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-matches') ?? '0') > 1 &&
                    Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-active-match') ?? '0') > 0 &&
                    Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-active-match') ?? '0') !== beforeActiveMatch;
                }
              }
            }
            const browserActionsButtonAfterFind = document.querySelector('[data-testid="browser-actions-menu"]');
            if (browserActionsButtonAfterFind instanceof HTMLButtonElement) {
              browserActionsButtonAfterFind.click();
              await sleep(120);
            }
            const zoomInButton = findButton('Zoom in');
            if (zoomInButton instanceof HTMLButtonElement) {
              zoomInButton.click();
              await sleep(120);
            }
            var browserZoomWorks =
              Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-zoom') ?? '1') > 1;
            const mobilePreviewButton = findButton('Mobile preview');
            if (mobilePreviewButton instanceof HTMLButtonElement) {
              mobilePreviewButton.click();
              await sleep(120);
            }
            const browserViewportFrame = document.querySelector('[data-testid="browser-viewport-frame"]');
            const browserPanelAfterMobilePreview = document.querySelector('[data-testid="browser-panel"]');
            const viewportWidthBeforeRotate = Number(browserPanelAfterMobilePreview?.getAttribute('data-browser-viewport-width') ?? '0');
            const viewportHeightBeforeRotate = Number(browserPanelAfterMobilePreview?.getAttribute('data-browser-viewport-height') ?? '0');
            const rotateViewportButton = findButton('Rotate viewport');
            if (rotateViewportButton instanceof HTMLButtonElement) {
              rotateViewportButton.click();
              await sleep(120);
            }
            const browserPanelAfterRotate = document.querySelector('[data-testid="browser-panel"]');
            var browserViewportRotateWorks =
              rotateViewportButton instanceof HTMLButtonElement &&
              Number(browserPanelAfterRotate?.getAttribute('data-browser-viewport-width') ?? '0') === viewportHeightBeforeRotate &&
              Number(browserPanelAfterRotate?.getAttribute('data-browser-viewport-height') ?? '0') === viewportWidthBeforeRotate;
            var browserDeviceModeWorks =
              document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-device-mode') === 'mobile' &&
              browserViewportFrame instanceof HTMLElement &&
              viewportWidthBeforeRotate <= 410 &&
              browserViewportRotateWorks;
            const noCacheButton = findButton('Reload without cache');
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
            const browserTabCloseButtons = [...document.querySelectorAll('[data-testid="browser-tab-close"]')];
            const browserTabClosesHiddenAtRest =
              browserTabCloseButtons.length >= 1 &&
              browserTabCloseButtons.every((button) => Number.parseFloat(getComputedStyle(button).opacity || '0') < 0.25);
            const firstBrowserClose = browserTabs[0]?.querySelector('[data-testid="browser-tab-close"]');
            if (firstBrowserClose instanceof HTMLElement) {
              firstBrowserClose.focus({ preventScroll: true });
              await sleep(100);
            }
            var browserTabCloseChromeWorks =
              browserTabClosesHiddenAtRest &&
              firstBrowserClose instanceof HTMLElement &&
              Number.parseFloat(getComputedStyle(firstBrowserClose).opacity || '0') > 0.75;
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
            const domInspectorButton = document.querySelector('[data-testid="browser-inspector-dom"]');
            if (domInspectorButton instanceof HTMLButtonElement) {
              domInspectorButton.click();
              await sleep(120);
            }
            const browserDomPane = document.querySelector('[data-testid="browser-dom-pane"]');
            var browserDomPaneCompactWorks =
              browserDomPane instanceof HTMLElement &&
              browserDomPane.textContent?.includes('Snapshot') &&
              browserDomPane.textContent?.includes('lines') &&
              !browserDomPane.querySelector('button') &&
              browserDomPane.scrollWidth <= browserDomPane.clientWidth + 2;
            const targetsInspectorButton = document.querySelector('[data-testid="browser-inspector-targets"]');
            if (targetsInspectorButton instanceof HTMLButtonElement) {
              targetsInspectorButton.click();
              await sleep(120);
            }
            const targetsPane = document.querySelector('.browser-targets-pane');
            const targetActionControls = document.querySelector('.browser-target-action-controls');
            const targetActionSelect = document.querySelector('[data-testid="browser-target-action-select"]');
            const targetPointerPanel = document.querySelector('[data-testid="browser-target-pointer-panel"]');
            const targetClipboardPanel = document.querySelector('[data-testid="browser-target-clipboard-panel"]');
            var browserTargetsPaneWorks =
              document.querySelector('[data-testid="browser-target-select"]') instanceof HTMLSelectElement &&
              targetsPane instanceof HTMLElement &&
              targetActionControls instanceof HTMLElement &&
              targetActionControls.scrollWidth <= targetActionControls.clientWidth + 2 &&
              targetActionSelect instanceof HTMLSelectElement &&
              targetPointerPanel instanceof HTMLDetailsElement &&
              targetPointerPanel.open === false &&
              targetClipboardPanel instanceof HTMLDetailsElement &&
              targetClipboardPanel.open === false;
            const setBrowserTargetAction = async (action) => {
              const actionSelect = document.querySelector('[data-testid="browser-target-action-select"]');
              if (!(actionSelect instanceof HTMLSelectElement)) return false;
              const actionSetter = Object.getOwnPropertyDescriptor(actionSelect.constructor.prototype, 'value')?.set;
              actionSetter?.call(actionSelect, action);
              actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
              await sleep(100);
              return true;
            };
            const clickBrowserTargetRun = () => {
              const runButton = document.querySelector('[data-testid="browser-target-run-action"]');
              if (!(runButton instanceof HTMLButtonElement) || runButton.disabled) return false;
              runButton.click();
              return true;
            };
            const browserTargetSelect = document.querySelector('[data-testid="browser-target-select"]');
            const browserTargetActionInput = document.querySelector('.browser-targets-pane input[placeholder="Text or key"]');
            let browserTargetKeyWorks = false;
            if (browserTargetSelect instanceof HTMLSelectElement && browserTargetActionInput instanceof HTMLInputElement) {
              const smokeInputOption = [...browserTargetSelect.options]
                .find((option) => option.textContent?.includes('Smoke input'));
              if (smokeInputOption) {
                const selectSetter = Object.getOwnPropertyDescriptor(browserTargetSelect.constructor.prototype, 'value')?.set;
                selectSetter?.call(browserTargetSelect, smokeInputOption.value);
                browserTargetSelect.dispatchEvent(new Event('change', { bubbles: true }));
                const inputSetter = Object.getOwnPropertyDescriptor(browserTargetActionInput.constructor.prototype, 'value')?.set;
                inputSetter?.call(browserTargetActionInput, 'Enter');
                browserTargetActionInput.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(120);
                if (await setBrowserTargetAction('key') && clickBrowserTargetRun()) {
                  const browserWebview = document.querySelector('[data-testid="browser-webview"]');
                  for (let index = 0; index < 30; index += 1) {
                    const pressed = browserWebview && 'executeJavaScript' in browserWebview
                      ? await browserWebview.executeJavaScript('document.body.dataset.keyPressed || ""')
                      : '';
                    if (pressed === 'Enter') {
                      browserTargetKeyWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
              }
            }
            let browserTargetFillWorks = false;
            let browserTargetTypeWorks = false;
            let browserTargetStateWorks = false;
            const browserTargetSelectForText = document.querySelector('[data-testid="browser-target-select"]');
            const browserTargetActionInputForText = document.querySelector('.browser-targets-pane input[placeholder="Text or key"]');
            if (browserTargetSelectForText instanceof HTMLSelectElement && browserTargetActionInputForText instanceof HTMLInputElement) {
              const smokeInputOption = [...browserTargetSelectForText.options]
                .find((option) => option.textContent?.includes('Smoke input'));
              if (smokeInputOption) {
                const selectSetter = Object.getOwnPropertyDescriptor(browserTargetSelectForText.constructor.prototype, 'value')?.set;
                const inputSetter = Object.getOwnPropertyDescriptor(browserTargetActionInputForText.constructor.prototype, 'value')?.set;
                selectSetter?.call(browserTargetSelectForText, smokeInputOption.value);
                browserTargetSelectForText.dispatchEvent(new Event('change', { bubbles: true }));
                inputSetter?.call(browserTargetActionInputForText, 'filled');
                browserTargetActionInputForText.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(120);
                const browserWebview = document.querySelector('[data-testid="browser-webview"]');
                if (await setBrowserTargetAction('fill') && clickBrowserTargetRun()) {
                  for (let index = 0; index < 30; index += 1) {
                    const value = browserWebview && 'executeJavaScript' in browserWebview
                      ? await browserWebview.executeJavaScript('document.body.dataset.inputValue || ""')
                      : '';
                    if (value === 'filled') {
                      browserTargetFillWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
                inputSetter?.call(browserTargetActionInputForText, ' plus');
                browserTargetActionInputForText.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(120);
                if (await setBrowserTargetAction('type') && clickBrowserTargetRun()) {
                  for (let index = 0; index < 30; index += 1) {
                    const value = browserWebview && 'executeJavaScript' in browserWebview
                      ? await browserWebview.executeJavaScript('document.body.dataset.inputValue || ""')
                      : '';
                    if (value === 'filled plus') {
                      browserTargetTypeWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
                if (await setBrowserTargetAction('read') && clickBrowserTargetRun()) {
                  for (let index = 0; index < 30; index += 1) {
                    const output = document.querySelector('[data-testid="browser-target-read-output"]');
                    const text = output instanceof HTMLElement ? output.innerText : '';
                    const rect = output instanceof HTMLElement ? output.getBoundingClientRect() : null;
                    if (
                      output instanceof HTMLElement &&
                      rect !== null &&
                      text.includes('input') &&
                      text.includes('enabled') &&
                      text.includes('visible') &&
                      text.includes('filled plus') &&
                      output.scrollWidth <= output.clientWidth + 2 &&
                      rect.height <= 48
                    ) {
                      browserTargetStateWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
              }
            }
            let browserTargetSelectWorks = false;
            const browserTargetSelectForSelect = document.querySelector('[data-testid="browser-target-select"]');
            const browserTargetActionInputForSelect = document.querySelector('.browser-targets-pane input[placeholder="Text or key"]');
            if (browserTargetSelectForSelect instanceof HTMLSelectElement && browserTargetActionInputForSelect instanceof HTMLInputElement) {
              const smokeSelectOption = [...browserTargetSelectForSelect.options]
                .find((option) => option.textContent?.includes('Smoke select'));
              if (smokeSelectOption) {
                const selectSetter = Object.getOwnPropertyDescriptor(browserTargetSelectForSelect.constructor.prototype, 'value')?.set;
                selectSetter?.call(browserTargetSelectForSelect, smokeSelectOption.value);
                browserTargetSelectForSelect.dispatchEvent(new Event('change', { bubbles: true }));
                const inputSetter = Object.getOwnPropertyDescriptor(browserTargetActionInputForSelect.constructor.prototype, 'value')?.set;
                inputSetter?.call(browserTargetActionInputForSelect, 'beta');
                browserTargetActionInputForSelect.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(120);
                if (await setBrowserTargetAction('select') && clickBrowserTargetRun()) {
                  const browserWebview = document.querySelector('[data-testid="browser-webview"]');
                  for (let index = 0; index < 30; index += 1) {
                    const selected = browserWebview && 'executeJavaScript' in browserWebview
                      ? await browserWebview.executeJavaScript('document.body.dataset.selectedOption || ""')
                      : '';
                    if (selected === 'beta') {
                      browserTargetSelectWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
              }
            }
            let browserTargetCheckWorks = false;
            const browserTargetSelectForCheck = document.querySelector('[data-testid="browser-target-select"]');
            const browserTargetActionInputForCheck = document.querySelector('.browser-targets-pane input[placeholder="Text or key"]');
            if (browserTargetSelectForCheck instanceof HTMLSelectElement && browserTargetActionInputForCheck instanceof HTMLInputElement) {
              const smokeCheckboxOption = [...browserTargetSelectForCheck.options]
                .find((option) => option.textContent?.includes('Smoke checkbox'));
              if (smokeCheckboxOption) {
                const selectSetter = Object.getOwnPropertyDescriptor(browserTargetSelectForCheck.constructor.prototype, 'value')?.set;
                selectSetter?.call(browserTargetSelectForCheck, smokeCheckboxOption.value);
                browserTargetSelectForCheck.dispatchEvent(new Event('change', { bubbles: true }));
                const inputSetter = Object.getOwnPropertyDescriptor(browserTargetActionInputForCheck.constructor.prototype, 'value')?.set;
                inputSetter?.call(browserTargetActionInputForCheck, 'true');
                browserTargetActionInputForCheck.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(120);
                if (await setBrowserTargetAction('check') && clickBrowserTargetRun()) {
                  const browserWebview = document.querySelector('[data-testid="browser-webview"]');
                  for (let index = 0; index < 30; index += 1) {
                    const checked = browserWebview && 'executeJavaScript' in browserWebview
                      ? await browserWebview.executeJavaScript('document.body.dataset.checkedState || ""')
                      : '';
                    if (checked === 'true') {
                      browserTargetCheckWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
              }
            }
            var browserTargetsPaneNoHorizontalOverflowWorks = (() => {
              const pane = document.querySelector('.browser-targets-pane');
              return pane instanceof HTMLElement &&
                pane.scrollWidth <= pane.clientWidth + 2;
            })();
            const assetsInspectorButton = document.querySelector('[data-testid="browser-inspector-assets"]');
            if (assetsInspectorButton instanceof HTMLButtonElement) {
              assetsInspectorButton.click();
              await sleep(120);
            }
            const browserAssetsPane = document.querySelector('[data-testid="browser-assets-pane"]');
            const browserAssetsKindGrid = document.querySelector('[data-testid="browser-assets-kind-grid"]');
            const browserAssetRows = [...document.querySelectorAll('[data-testid="browser-assets-row"]')];
            const browserInlineSvgList = document.querySelector('[data-testid="browser-inline-svg-list"]');
            const browserInlineSvgRows = [...document.querySelectorAll('[data-testid="browser-inline-svg-row"]')];
            const bundleAssetsButton = document.querySelector('[data-testid="browser-assets-bundle"]');
            if (bundleAssetsButton instanceof HTMLButtonElement) {
              bundleAssetsButton.click();
              for (let index = 0; index < 30; index += 1) {
                if ((document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-asset-bundle-path') ?? '').length > 0) break;
                await sleep(100);
              }
            }
            const browserAssetsBundlePath = document.querySelector('[data-testid="browser-assets-bundle-path"]');
            var browserAssetBundleWorks =
              browserAssetsPane instanceof HTMLElement &&
              browserAssetsKindGrid instanceof HTMLElement &&
              browserAssetRows.length > 0 &&
              browserAssetRows.every((row) => row instanceof HTMLElement && row.scrollWidth <= row.clientWidth + 2) &&
              bundleAssetsButton instanceof HTMLButtonElement &&
              browserAssetsBundlePath instanceof HTMLElement &&
              browserAssetsBundlePath.scrollWidth <= browserAssetsBundlePath.clientWidth + 2 &&
              (document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-asset-bundle-path') ?? '').includes('manifest.json');
            var browserInlineSvgInventoryWorks =
              Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-inline-svg-count') ?? '0') > 0 &&
              browserInlineSvgList instanceof HTMLElement &&
              browserInlineSvgRows.length > 0 &&
              browserInlineSvgRows.every((row) => row instanceof HTMLElement && row.scrollWidth <= row.clientWidth + 2) &&
              browserInlineSvgRows.some((row) => row.textContent?.includes('Inline smoke icon'));
            const securityInspectorButton = document.querySelector('[data-testid="browser-inspector-security"]');
            if (securityInspectorButton instanceof HTMLButtonElement) {
              securityInspectorButton.click();
              for (let index = 0; index < 20; index += 1) {
                if (document.querySelector('[data-testid="browser-security-pane"]')) break;
                await sleep(100);
              }
            }
            const browserSecurityPane = document.querySelector('[data-testid="browser-security-pane"]');
            const browserSecurityOrigin = document.querySelector('[data-testid="browser-security-origin"]');
            const browserSecurityRows = [...document.querySelectorAll('[data-testid="browser-security-policy-row"]')];
            const browserSecurityText = browserSecurityPane instanceof HTMLElement
              ? browserSecurityPane.textContent?.toLowerCase() ?? ''
              : '';
            var browserSecurityPaneWorks =
              browserSecurityPane instanceof HTMLElement &&
              browserSecurityOrigin instanceof HTMLElement &&
              browserSecurityRows.length === 4 &&
              browserSecurityText.includes('current origin') &&
              browserSecurityText.includes('approval') &&
              browserSecurityText.includes('allowed') &&
              browserSecurityText.includes('blocked') &&
              browserSecurityText.includes('downloads') &&
              browserSecurityText.includes('uploads');
            var browserSecurityPaneNoHorizontalOverflowWorks = (() => {
              const drawer = document.querySelector('.browser-inspector-drawer');
              const output = document.querySelector('[data-testid="browser-inspector-output"]');
              const securityPane = document.querySelector('.browser-security-pane');
              return drawer instanceof HTMLElement &&
                output instanceof HTMLElement &&
                securityPane instanceof HTMLElement &&
                drawer.scrollWidth <= drawer.clientWidth + 2 &&
                output.scrollWidth <= output.clientWidth + 2 &&
                securityPane.scrollWidth <= securityPane.clientWidth + 2;
            })();
            var browserInspectorChromeCompactWorks = (() => {
              const toolbar = document.querySelector('[data-testid="browser-inspector-toolbar"]');
              const refresh = document.querySelector('[data-testid="browser-refresh-inspection"]');
              const hide = document.querySelector('[data-testid="browser-hide-inspection"]');
              const activeTabs = document.querySelectorAll('.browser-inspector-tab[data-active="true"]');
              const activeLabel = document.querySelector('.browser-inspector-tab[data-active="true"] span');
              const inactiveLabels = [...document.querySelectorAll('.browser-inspector-tab:not([data-active="true"]) span')]
                .filter((label) => label instanceof HTMLElement);
              return toolbar instanceof HTMLElement &&
                refresh instanceof HTMLButtonElement &&
                hide instanceof HTMLButtonElement &&
                activeLabel instanceof HTMLElement &&
                refresh.getAttribute('aria-label') === 'Refresh browser inspector' &&
                hide.getAttribute('aria-label') === 'Hide browser inspector' &&
                refresh.textContent?.trim() === '' &&
                hide.textContent?.trim() === '' &&
                activeTabs.length === 1 &&
                getComputedStyle(activeLabel).display !== 'none' &&
                inactiveLabels.length >= 3 &&
                inactiveLabels.every((label) => getComputedStyle(label).display === 'none') &&
                toolbar.getBoundingClientRect().height <= 34 &&
                toolbar.scrollWidth <= toolbar.clientWidth + 2;
            })();
            const hideBrowserButton = findButton('Hide browser surface');
            if (hideBrowserButton instanceof HTMLButtonElement) {
              hideBrowserButton.click();
              await sleep(120);
            }
            var browserVisibilityControlWorks =
              document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-visible') === 'false';
            const browserHiddenStateWorks =
              document.querySelector('[data-testid="browser-hidden-state"]') instanceof HTMLElement &&
              document.querySelector('[data-testid="browser-hidden-show"]') instanceof HTMLButtonElement;
            const showBrowserButton = findButton('Show browser surface');
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
            const openSideChat = async (question = '') => {
              const activeTextarea = document.querySelector('textarea');
              if (!(activeTextarea instanceof HTMLTextAreaElement)) return;
              const setter = Object.getOwnPropertyDescriptor(activeTextarea.constructor.prototype, 'value')?.set;
              setter?.call(activeTextarea, question ? '/btw ' + question : '/btw');
              activeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(80);
              const sendButton = findButtonStartingWith('Send');
              if (sendButton instanceof HTMLButtonElement) sendButton.click();
              await sleep(question ? 640 : 220);
            };
            await openSideChat();
            await openSideChat();
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
            var sideChatComposerCompactWorks = false;
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
              const sideChatComposer = document.querySelector('[data-testid="side-chat-composer"]');
              const sideChatSend = document.querySelector('[data-testid="side-chat-send"]');
              const sideChatEmptyState = document.querySelector('[data-testid="side-chat-empty-state"]');
              sideChatDraftPersistenceWorks =
                secondDraftRestored &&
                firstDraftRestored &&
                document.querySelector('[data-testid="side-chat-panel"]')?.getAttribute('data-side-chat-message-count') === '0';
              sideChatComposerCompactWorks =
                sideChatComposer instanceof HTMLElement &&
                sideChatSend instanceof HTMLElement &&
                firstInput instanceof HTMLInputElement &&
                sideChatEmptyState instanceof HTMLElement &&
                sideChatComposer.getBoundingClientRect().height <= 38 &&
                sideChatComposer.scrollWidth <= sideChatComposer.clientWidth + 2 &&
                sideChatSend.textContent?.trim() === '' &&
                !findButton('Ask') &&
                sideChatEmptyState.textContent?.trim() === 'No side chat yet.';
            }
            await openSideChat('smoke label check');
            var sideChatMessageLabelsCalm = false;
            for (let index = 0; index < 12; index += 1) {
              const sideChatPanel = document.querySelector('[data-testid="side-chat-panel"]');
              if (sideChatPanel?.getAttribute('data-side-chat-message-count') === '2') break;
              await sleep(120);
            }
            const sideChatMessageLabels = [...document.querySelectorAll('[data-testid="side-chat-message-label"]')]
              .filter((label) => label instanceof HTMLElement);
            sideChatMessageLabelsCalm =
              sideChatMessageLabels.length >= 2 &&
              sideChatMessageLabels.every((label) => {
                const text = label.textContent?.trim() ?? '';
                return text.length > 0 &&
                  text !== text.toUpperCase() &&
                  getComputedStyle(label).textTransform !== 'uppercase';
              });
            const sideChatTabsBeforeCloseForClose = document.querySelectorAll('[data-tab-id^="sidechat:"]').length;
            const closeSideChatButton = [...document.querySelectorAll('[data-tab-id^="sidechat:"]')]
              .at(-1)
              ?.closest('[role="tab"]')
              ?.querySelector('[aria-label^="Close "]');
            if (closeSideChatButton instanceof HTMLElement) {
              closeSideChatButton.click();
              await sleep(160);
            }
            var sideChatCloseWorks =
              sideChatTabsWork &&
              document.querySelectorAll('[data-tab-id^="sidechat:"]').length === sideChatTabsBeforeCloseForClose - 1;
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
            const capabilitiesScopeLabel = document.querySelector('.capabilities-scope-select span');
            const capabilityStatusLabels = [...document.querySelectorAll('.capability-row-status')]
              .filter((label) => label instanceof HTMLElement);
            var capabilityPageLabelsCalm =
              capabilitiesScopeLabel instanceof HTMLElement &&
              getComputedStyle(capabilitiesScopeLabel).textTransform !== 'uppercase' &&
              capabilityStatusLabels.length > 0 &&
              capabilityStatusLabels.every((label) => getComputedStyle(label).textTransform !== 'uppercase');

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
            const permissionMenu = document.querySelector('.motion-popover-surface');
            var composerPermissionMenuOpened = Boolean(permissionMenu);
            var composerPermissionNativeTooltipsWork = permissionMenu instanceof HTMLElement &&
              [...permissionMenu.querySelectorAll('button')]
                .filter((button) => button.getAttribute('data-tooltip-label'))
                .every((button) => button.getAttribute('title') === null && button.getAttribute('data-native-title-free') === 'true');
            const advancedPermissionsButton = permissionMenu instanceof HTMLElement
              ? [...permissionMenu.querySelectorAll('button')]
                  .find((button) => button.textContent?.includes('Advanced permissions'))
              : null;
            if (advancedPermissionsButton instanceof HTMLButtonElement) {
              advancedPermissionsButton.click();
              await sleep(100);
            }
            const permissionDangerLabel = document.querySelector('[data-testid="composer-permission-danger-label"]');
            var composerPermissionLabelsCalm =
              !(permissionDangerLabel instanceof HTMLElement) ||
              (
                permissionDangerLabel.textContent?.trim() === 'Isolated only' &&
                getComputedStyle(permissionDangerLabel).textTransform !== 'uppercase'
              );
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(140);
            var composerPermissionMenuClosedWithEscape = !document.querySelector('.motion-popover-surface');
            var composerPermissionFocusReturned = document.activeElement === permissionButton;

            const agentButton = document.querySelector('[data-testid="composer-agent-menu"]');
            agentButton?.click();
            await sleep(140);
            var composerAgentMenuOpened = Boolean(document.querySelector('.motion-popover-surface'));
            const agentRowLabels = [...document.querySelectorAll('[data-testid="composer-agent-row-label"]')]
              .filter((label) => label instanceof HTMLElement);
            var composerAgentRowLabelsCalm =
              agentRowLabels.length >= 2 &&
              agentRowLabels.every((label) => {
                const text = label.textContent?.trim() ?? '';
                return text.length > 0 &&
                  text !== text.toUpperCase() &&
                  getComputedStyle(label).textTransform !== 'uppercase';
              });
            document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 1, clientY: 1 }));
            await sleep(140);
            var composerAgentMenuClosedWithOutsideClick = !document.querySelector('.motion-popover-surface');
            var composerAgentFocusReturned = document.activeElement === agentButton;

            const composerShell = document.querySelector('[data-testid="composer-shell"]');
            const composerToolbar = document.querySelector('[data-testid="composer-toolbar"]');
            const previousComposerWidth = composerShell instanceof HTMLElement ? composerShell.style.width : '';
            const previousComposerMaxWidth = composerShell instanceof HTMLElement ? composerShell.style.maxWidth : '';
            if (composerShell instanceof HTMLElement) {
              composerShell.style.width = '420px';
              composerShell.style.maxWidth = '420px';
            }
            await sleep(180);
            var composerToolbarResponsiveWorks =
              composerToolbar instanceof HTMLElement &&
              composerToolbar.scrollWidth <= composerToolbar.clientWidth + 2 &&
              (!(agentButton instanceof HTMLElement) ||
                (
                  agentButton instanceof HTMLElement &&
                  getComputedStyle(agentButton.querySelector('.composer-control-label') ?? agentButton).display === 'none'
                ));
            if (composerShell instanceof HTMLElement) {
              composerShell.style.width = previousComposerWidth;
              composerShell.style.maxWidth = previousComposerMaxWidth;
            }
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'inspector') {
            const reviewTabButton = document.querySelector('[data-tab-id="diff"]')?.closest('[role="tab"]');
            if (reviewTabButton instanceof HTMLElement) {
              reviewTabButton.click();
              await sleep(180);
            }
            const diffSearchForCapture = document.querySelector('[data-testid="diff-file-search"]');
            if (diffSearchForCapture instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(diffSearchForCapture.constructor.prototype, 'value')?.set;
              setter?.call(diffSearchForCapture, 'binary-preview-smoke');
              diffSearchForCapture.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(180);
            }
            const binaryReviewButtonForCapture = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.includes('binary-preview-smoke.bin'));
            if (binaryReviewButtonForCapture instanceof HTMLButtonElement) {
              binaryReviewButtonForCapture.click();
              await sleep(260);
            }
          }
          const bodyText = document.body.innerText;
          const rightPanel = document.querySelector('[data-testid="session-right-panel"]');
          const rightSidebarTabbar = document.querySelector('[data-testid="right-sidebar-tabbar"]');
          const rightSidebarTabRow = document.querySelector('[data-testid="right-sidebar-tab-row"]');
          const rightSidebarTabActions = document.querySelector('[data-testid="right-sidebar-tab-actions"]');
          const rightSidebarAddTabButton = document.querySelector('[data-testid="right-panel-add-tab"]');
          const rightSidebarActiveTab = document.querySelector('[data-testid="right-sidebar-tabbar"] .motion-tab-button[data-active="true"]');
          const rightSidebarActiveTabStyle = rightSidebarActiveTab instanceof HTMLElement
            ? getComputedStyle(rightSidebarActiveTab)
            : null;
          const rightSidebarInactiveTabs = [...document.querySelectorAll('[data-testid="right-sidebar-tabbar"] .motion-tab-button:not([data-active="true"])')]
            .filter((tab) => tab instanceof HTMLElement);
          const rightSidebarActiveLabel = rightSidebarActiveTab instanceof HTMLElement
            ? rightSidebarActiveTab.querySelector('.right-sidebar-tab-label')
            : null;
          const rightSidebarInactiveLabels = rightSidebarInactiveTabs
            .map((tab) => tab.querySelector('.right-sidebar-tab-label'))
            .filter((label) => label instanceof HTMLElement);
          const rightSidebarChromeCompactWorks =
            rightSidebarTabbar instanceof HTMLElement &&
            rightSidebarTabRow instanceof HTMLElement &&
            rightSidebarTabActions instanceof HTMLElement &&
            rightSidebarActiveTab instanceof HTMLElement &&
            rightSidebarTabbar.getBoundingClientRect().height <= 38 &&
            rightSidebarTabRow.scrollWidth <= rightSidebarTabRow.clientWidth + 2 &&
            rightSidebarTabActions.getBoundingClientRect().height <= 26 &&
            (rightSidebarActiveTabStyle?.boxShadow === 'none' || rightSidebarActiveTabStyle?.boxShadow === '');
          const rightSidebarTrailingFadeStyle = rightSidebarTabActions instanceof HTMLElement
            ? getComputedStyle(rightSidebarTabActions, '::before')
            : null;
          const rightSidebarTrailingFadeWorks =
            rightSidebarTrailingFadeStyle !== null &&
            rightSidebarTrailingFadeStyle.content !== 'none' &&
            rightSidebarTrailingFadeStyle.backgroundImage.includes('linear-gradient') &&
            Number.parseFloat(rightSidebarTrailingFadeStyle.width || '0') >= 16 &&
            rightSidebarTrailingFadeStyle.pointerEvents === 'none';
          const rightSidebarAddControlStableWorks =
            rightSidebarAddTabButton instanceof HTMLButtonElement &&
            rightSidebarAddTabButton.getAttribute('aria-label') === 'Add panel tab' &&
            rightSidebarAddTabButton.getAttribute('data-icon') === 'plus' &&
            rightSidebarTabActions instanceof HTMLElement &&
            rightSidebarTabActions.querySelectorAll('.motion-icon-button').length === 2;
          let rightSidebarAddMenuStableWorks = false;
          if (rightSidebarAddTabButton instanceof HTMLButtonElement) {
            rightSidebarAddTabButton.click();
            await sleep(120);
            const toolMenuItems = [...document.querySelectorAll('[role="menuitem"]')]
              .filter((item) => item.textContent?.includes('Browser') || item.textContent?.includes('Files'));
            rightSidebarAddMenuStableWorks =
              toolMenuItems.length === 2 &&
              toolMenuItems.every((item) => item instanceof HTMLButtonElement && item.disabled);
            rightSidebarAddTabButton.click();
            await sleep(80);
          }
          const rightSidebarInactiveTabsCompactWorks =
            rightSidebarActiveTab instanceof HTMLElement &&
            rightSidebarActiveLabel instanceof HTMLElement &&
            getComputedStyle(rightSidebarActiveLabel).display !== 'none' &&
            rightSidebarInactiveTabs.length >= 2 &&
            rightSidebarInactiveLabels.length === rightSidebarInactiveTabs.length &&
            rightSidebarInactiveLabels.every((label) => getComputedStyle(label).display === 'none') &&
            rightSidebarInactiveTabs.every((tab) => (tab.getAttribute('aria-label') ?? '').trim().length > 0) &&
            rightSidebarInactiveTabs.every((tab) => tab.getBoundingClientRect().width <= 30);
          let rightSidebarInactiveTabTooltipWorks = false;
          const inactiveBrowserTab = rightSidebarInactiveTabs.find((tab) => tab.getAttribute('aria-label') === 'Browser') ?? rightSidebarInactiveTabs[0];
          if (inactiveBrowserTab instanceof HTMLElement) {
            const expectedTooltip = inactiveBrowserTab.getAttribute('aria-label') ?? '';
            const inactiveTabRect = inactiveBrowserTab.getBoundingClientRect();
            inactiveBrowserTab.dispatchEvent(new MouseEvent('mouseover', {
              bubbles: true,
              clientX: inactiveTabRect.left + inactiveTabRect.width / 2,
              clientY: inactiveTabRect.top + inactiveTabRect.height / 2
            }));
            inactiveBrowserTab.focus({ preventScroll: true });
            await sleep(360);
            const visibleTooltips = [...document.querySelectorAll('.orchestrator-tooltip[data-visible="true"]')];
            const visibleTooltip = visibleTooltips
              .find((tooltip) => tooltip.textContent?.trim() === expectedTooltip);
            const tooltipColorAlpha = (color) => {
              const match = color.match(/rgba?\\(([^)]+)\\)/);
              if (!match) return 1;
              const parts = match[1].split(',').map((part) => part.trim());
              return parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;
            };
            const tooltipRect = visibleTooltip instanceof HTMLElement ? visibleTooltip.getBoundingClientRect() : null;
            const tooltipStyle = visibleTooltip instanceof HTMLElement ? getComputedStyle(visibleTooltip) : null;
            const tooltipReadable =
              tooltipRect !== null &&
              tooltipStyle !== null &&
              tooltipRect.width >= 20 &&
              tooltipRect.height >= 10 &&
              tooltipColorAlpha(tooltipStyle.backgroundColor) >= 0.98 &&
              tooltipColorAlpha(tooltipStyle.color) >= 0.98 &&
              Number.parseFloat(tooltipStyle.opacity || '1') >= 0.95 &&
              tooltipStyle.visibility !== 'hidden';
            rightSidebarInactiveTabTooltipWorks =
              expectedTooltip.length > 0 &&
              visibleTooltips.length === 1 &&
              visibleTooltip instanceof HTMLElement &&
              visibleTooltip.parentElement === document.body &&
              tooltipReadable;
            inactiveBrowserTab.blur();
            inactiveBrowserTab.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            await sleep(80);
          }
          const diffToolbar = document.querySelector('[data-testid="diff-panel-toolbar"]');
          const diffToolbarSearch = document.querySelector('[data-testid="diff-panel-toolbar"] .diff-panel-search');
          const diffToolbarSearchInput = document.querySelector('[data-testid="diff-file-search"]');
          const diffToolbarActions = document.querySelector('[data-testid="diff-panel-toolbar"] .diff-panel-actions');
          const diffToolbarActionButtons = diffToolbarActions instanceof HTMLElement
            ? [...diffToolbarActions.querySelectorAll('.motion-icon-button')]
            : [];
          const diffFileCount = document.querySelector('[data-testid="diff-panel-toolbar"] .diff-file-count');
          const diffSearchClearForCapture = document.querySelector('[data-testid="diff-file-search-clear"]');
          const diffPanelList = document.querySelector('.diff-panel-root[data-embedded="true"] .diff-panel-list');
          const diffPanelRows = [...document.querySelectorAll('.diff-panel-root[data-embedded="true"] .diff-file-row')]
            .filter((row) => row instanceof HTMLElement);
          const diffPanelDirLabels = [...document.querySelectorAll('.diff-panel-root[data-embedded="true"] .diff-file-dir')]
            .filter((label) => label instanceof HTMLElement);
          const diffPanelStats = [...document.querySelectorAll('.diff-panel-root[data-embedded="true"] .diff-file-stats')]
            .filter((label) => label instanceof HTMLElement);
          const diffToolbarRect = diffToolbar instanceof HTMLElement ? diffToolbar.getBoundingClientRect() : null;
          const diffSearchRect = diffToolbarSearch instanceof HTMLElement ? diffToolbarSearch.getBoundingClientRect() : null;
          const diffToolbarSearchDominant =
            diffToolbarRect !== null &&
            diffSearchRect !== null &&
            diffSearchRect.width >= Math.min(180, diffToolbarRect.width * 0.52);
          const diffToolbarCompactWorks =
            diffToolbar instanceof HTMLElement &&
            diffToolbarSearch instanceof HTMLElement &&
            diffToolbarSearchInput instanceof HTMLInputElement &&
            diffToolbarActions instanceof HTMLElement &&
            diffFileCount instanceof HTMLElement &&
            diffSearchClearForCapture instanceof HTMLButtonElement &&
            diffToolbar.getBoundingClientRect().height <= 38 &&
            diffToolbar.scrollWidth <= diffToolbar.clientWidth + 2 &&
            diffToolbarSearch.getBoundingClientRect().height <= 28 &&
            diffToolbarActions.getBoundingClientRect().height <= 26 &&
            diffToolbarActionButtons.length === 1 &&
            !diffToolbar.querySelector('.toolbar-button') &&
            diffToolbarSearchDominant &&
            diffFileCount.textContent?.includes('file') === true;
          const diffListCompactWorks =
            diffPanelList instanceof HTMLElement &&
            diffPanelList.getBoundingClientRect().height <= 136 &&
            diffPanelList.scrollWidth <= diffPanelList.clientWidth + 2 &&
            diffPanelRows.length > 0 &&
            diffPanelRows.every((row) => row.getBoundingClientRect().height <= 30) &&
            diffPanelDirLabels.every((label) => getComputedStyle(label).display === 'none') &&
            diffPanelStats.every((label) => getComputedStyle(label).display === 'none');
          let diffActionMenuCompactWorks = false;
          const diffActionMenuButton = [...document.querySelectorAll('button')]
            .find((button) => button.getAttribute('aria-label') === 'Change actions');
          if (diffActionMenuButton instanceof HTMLButtonElement) {
            diffActionMenuButton.click();
            await sleep(100);
            const menuItems = [...document.querySelectorAll('[role="menuitem"]')]
              .map((item) => item.textContent?.trim() ?? '');
            diffActionMenuCompactWorks =
              menuItems.includes('Refresh changes') &&
              menuItems.some((label) => label.includes('line wrap')) &&
              menuItems.includes('Open file') &&
              menuItems.includes('Reveal file') &&
              menuItems.includes('Copy path');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(80);
          }
          const headerMetadataText = document.querySelector('[data-testid="session-header-metadata"]')?.textContent ?? '';
          const headerIdentityWorks =
            Boolean(document.querySelector('[data-testid="session-header-environment"]')) &&
            headerMetadataText.includes('Automated UI Smoke') &&
            headerMetadataText.includes('Claude') &&
            headerMetadataText.length > 'Automated UI Smoke'.length;
          const headerTooltipIds = ['session-header-environment', 'active-session-title', 'session-header-metadata', 'profile-badge'];
          if (document.querySelector('[data-testid="session-header-pinned"]')) headerTooltipIds.push('session-header-pinned');
          const headerNativeTooltipsWork =
            headerTooltipIds.every((testId) => {
              const element = document.querySelector('[data-testid="' + testId + '"]');
              return element instanceof HTMLElement &&
                element.getAttribute('title') === null &&
                element.getAttribute('data-native-title-free') === 'true' &&
                (element.getAttribute('data-tooltip-label') ?? '').trim().length > 0;
            });
          let headerLongTooltipBoundedWorks = false;
          const profileBadge = document.querySelector('[data-testid="profile-badge"]');
          if (profileBadge instanceof HTMLElement) {
            const badgeRect = profileBadge.getBoundingClientRect();
            profileBadge.dispatchEvent(new MouseEvent('mouseover', {
              bubbles: true,
              clientX: badgeRect.left + badgeRect.width / 2,
              clientY: badgeRect.top + badgeRect.height / 2
            }));
            profileBadge.focus({ preventScroll: true });
            await sleep(360);
            const visibleTooltips = [...document.querySelectorAll('.orchestrator-tooltip[data-visible="true"]')];
            const visibleTooltip = visibleTooltips
              .find((tooltip) => tooltip.textContent?.trim().startsWith('User data:'));
            const tooltipRect = visibleTooltip instanceof HTMLElement ? visibleTooltip.getBoundingClientRect() : null;
            headerLongTooltipBoundedWorks =
              visibleTooltips.length === 1 &&
              visibleTooltip instanceof HTMLElement &&
              visibleTooltip.parentElement === document.body &&
              tooltipRect !== null &&
              tooltipRect.left >= 7 &&
              tooltipRect.top >= 7 &&
              tooltipRect.right <= window.innerWidth - 7 &&
              tooltipRect.bottom <= window.innerHeight - 7 &&
              visibleTooltip.scrollWidth <= visibleTooltip.clientWidth + 2;
            profileBadge.blur();
            profileBadge.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
            await sleep(80);
          }
          const buttons = [...document.querySelectorAll('button')].map((button) => ({
            text: button.textContent?.trim() ?? '',
            title: button.getAttribute('title') ?? '',
            label: button.getAttribute('aria-label') ?? ''
          }));
          const customTooltipNativeTitleLeaks =
            [...document.querySelectorAll('button[data-tooltip-label][title]')]
              .map((button) => (button.getAttribute('data-tooltip-label') ?? '') + ':' + (button.getAttribute('title') ?? ''));
          const customTooltipNativeTitlesAbsent = customTooltipNativeTitleLeaks.length === 0;
          const nativeTitleFreeControlLeaks =
            [...document.querySelectorAll('button[data-native-title-free][title]')]
              .map((button) => (button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '') + ':' + (button.getAttribute('title') ?? ''));
          const nativeTitleFreeControlsWork = nativeTitleFreeControlLeaks.length === 0;
          const composerNativeTooltipsWork =
            ['Attach files', 'Send (↵)'].every((label) => {
              const button = findButton(label);
              return button instanceof HTMLButtonElement &&
                button.getAttribute('title') === null &&
                button.getAttribute('data-tooltip-label') === label &&
                button.getAttribute('data-native-title-free') === 'true';
            });
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
            headerNativeTooltipsWork,
            headerLongTooltipBoundedWorks,
            titlebarSidebarToggleWorks: typeof titlebarSidebarToggleWorks === 'boolean' ? titlebarSidebarToggleWorks : null,
            customTooltipNativeTitlesAbsent,
            customTooltipNativeTitleLeaks,
            nativeTitleFreeControlsWork,
            nativeTitleFreeControlLeaks,
            composerNativeTooltipsWork,
            headerActionMenuWorks: typeof headerActionMenuWorks === 'boolean' ? headerActionMenuWorks : null,
            chatEmptyStateWorks: typeof chatEmptyStateWorks === 'boolean' ? chatEmptyStateWorks : null,
            chatEmptyStateQuietWorks: typeof chatEmptyStateQuietWorks === 'boolean' ? chatEmptyStateQuietWorks : null,
            chatEmptyStateProjectLabelClean: typeof chatEmptyStateProjectLabelClean === 'boolean' ? chatEmptyStateProjectLabelClean : null,
            hasInspectorTabs: bodyText.includes('Review') && !bodyText.includes('Usage') && !bodyText.includes('Plan') && !bodyText.includes('Agents'),
            hasRightPanelState: rightPanel instanceof HTMLElement &&
              rightPanel.dataset.rightPanelActiveTab === 'diff' &&
              rightPanel.dataset.rightPanelTabs?.includes('diff') === true &&
              Number(rightPanel.dataset.rightPanelWidth ?? '0') >= 360,
            rightSidebarChromeCompactWorks,
            rightSidebarTrailingFadeWorks,
            rightSidebarInactiveTabsCompactWorks,
            rightSidebarInactiveTabTooltipWorks,
            diffToolbarCompactWorks,
            diffListCompactWorks,
            diffActionMenuCompactWorks,
            rightPanelExpandWorks: typeof rightPanelExpandWorks === 'boolean' ? rightPanelExpandWorks : null,
            rightPanelExpandDebug: typeof rightPanelExpandDebug === 'object' ? rightPanelExpandDebug : null,
            rightSidebarAddControlStableWorks,
            rightSidebarAddMenuStableWorks,
            reviewSearchWorks: typeof reviewSearchWorks === 'boolean' ? reviewSearchWorks : null,
            reviewSearchClearWorks: typeof reviewSearchClearWorks === 'boolean' ? reviewSearchClearWorks : null,
            reviewJsonPreviewWorks: typeof reviewJsonPreviewWorks === 'boolean' ? reviewJsonPreviewWorks : null,
            reviewCsvPreviewWorks: typeof reviewCsvPreviewWorks === 'boolean' ? reviewCsvPreviewWorks : null,
            reviewDocumentPreviewWorks: typeof reviewDocumentPreviewWorks === 'boolean' ? reviewDocumentPreviewWorks : null,
            reviewNotebookPreviewWorks: typeof reviewNotebookPreviewWorks === 'boolean' ? reviewNotebookPreviewWorks : null,
            reviewBinaryStateWorks: typeof reviewBinaryStateWorks === 'boolean' ? reviewBinaryStateWorks : null,
            reviewBinaryActionsWork: typeof reviewBinaryActionsWork === 'boolean' ? reviewBinaryActionsWork : null,
            filesTabSearchWorks: typeof filesTabSearchWorks === 'boolean' ? filesTabSearchWorks : null,
            filesToolbarCompactWorks: typeof filesToolbarCompactWorks === 'boolean' ? filesToolbarCompactWorks : null,
            filesActionMenuCompactWorks: typeof filesActionMenuCompactWorks === 'boolean' ? filesActionMenuCompactWorks : null,
            filesPanelStackedWorks: typeof filesPanelStackedWorks === 'boolean' ? filesPanelStackedWorks : null,
            filesTabAttachWorks: typeof filesTabAttachWorks === 'boolean' ? filesTabAttachWorks : null,
            filesHtmlPreviewWorks: typeof filesHtmlPreviewWorks === 'boolean' ? filesHtmlPreviewWorks : null,
            filesJsonPreviewWorks: typeof filesJsonPreviewWorks === 'boolean' ? filesJsonPreviewWorks : null,
            filesCsvPreviewWorks: typeof filesCsvPreviewWorks === 'boolean' ? filesCsvPreviewWorks : null,
            filesDocumentPreviewWorks: typeof filesDocumentPreviewWorks === 'boolean' ? filesDocumentPreviewWorks : null,
            filesNotebookPreviewWorks: typeof filesNotebookPreviewWorks === 'boolean' ? filesNotebookPreviewWorks : null,
            filesBinaryPreviewWorks: typeof filesBinaryPreviewWorks === 'boolean' ? filesBinaryPreviewWorks : null,
            filesNoResultsWorks: typeof filesNoResultsWorks === 'boolean' ? filesNoResultsWorks : null,
            filesSearchClearWorks: typeof filesSearchClearWorks === 'boolean' ? filesSearchClearWorks : null,
            browserTabWorks: typeof browserTabWorks === 'boolean' ? browserTabWorks : null,
            browserScreenshotWorks: typeof browserScreenshotWorks === 'boolean' ? browserScreenshotWorks : null,
            browserScreenshotAttachmentWorks: typeof browserScreenshotAttachmentWorks === 'boolean' ? browserScreenshotAttachmentWorks : null,
            browserFindWorks: typeof browserFindWorks === 'boolean' ? browserFindWorks : null,
            browserFindNavigationWorks: typeof browserFindNavigationWorks === 'boolean' ? browserFindNavigationWorks : null,
            browserZoomWorks: typeof browserZoomWorks === 'boolean' ? browserZoomWorks : null,
            browserDeviceModeWorks: typeof browserDeviceModeWorks === 'boolean' ? browserDeviceModeWorks : null,
            browserCacheReloadWorks: typeof browserCacheReloadWorks === 'boolean' ? browserCacheReloadWorks : null,
            browserMultiTabWorks: typeof browserMultiTabWorks === 'boolean' ? browserMultiTabWorks : null,
            browserTabCloseChromeWorks: typeof browserTabCloseChromeWorks === 'boolean' ? browserTabCloseChromeWorks : null,
            browserActionsNativeTitlesAbsent: typeof browserActionsNativeTitlesAbsent === 'boolean' ? browserActionsNativeTitlesAbsent : null,
            browserInspectionWorks: typeof browserInspectionWorks === 'boolean' ? browserInspectionWorks : null,
            browserDomPaneCompactWorks: typeof browserDomPaneCompactWorks === 'boolean' ? browserDomPaneCompactWorks : null,
            browserTargetsPaneWorks: typeof browserTargetsPaneWorks === 'boolean' ? browserTargetsPaneWorks : null,
            browserTargetKeyWorks: typeof browserTargetKeyWorks === 'boolean' ? browserTargetKeyWorks : null,
            browserTargetFillWorks: typeof browserTargetFillWorks === 'boolean' ? browserTargetFillWorks : null,
            browserTargetTypeWorks: typeof browserTargetTypeWorks === 'boolean' ? browserTargetTypeWorks : null,
            browserTargetStateWorks: typeof browserTargetStateWorks === 'boolean' ? browserTargetStateWorks : null,
            browserTargetSelectWorks: typeof browserTargetSelectWorks === 'boolean' ? browserTargetSelectWorks : null,
            browserTargetCheckWorks: typeof browserTargetCheckWorks === 'boolean' ? browserTargetCheckWorks : null,
            browserTargetsPaneNoHorizontalOverflowWorks: typeof browserTargetsPaneNoHorizontalOverflowWorks === 'boolean' ? browserTargetsPaneNoHorizontalOverflowWorks : null,
            browserAssetBundleWorks: typeof browserAssetBundleWorks === 'boolean' ? browserAssetBundleWorks : null,
            browserInlineSvgInventoryWorks: typeof browserInlineSvgInventoryWorks === 'boolean' ? browserInlineSvgInventoryWorks : null,
            browserSecurityPaneWorks: typeof browserSecurityPaneWorks === 'boolean' ? browserSecurityPaneWorks : null,
            browserSecurityPaneNoHorizontalOverflowWorks: typeof browserSecurityPaneNoHorizontalOverflowWorks === 'boolean' ? browserSecurityPaneNoHorizontalOverflowWorks : null,
            browserInspectorChromeCompactWorks: typeof browserInspectorChromeCompactWorks === 'boolean' ? browserInspectorChromeCompactWorks : null,
            browserVisibilityControlWorks: typeof browserVisibilityControlWorks === 'boolean' ? browserVisibilityControlWorks : null,
            browserHiddenStateWorks: typeof browserHiddenStateWorks === 'boolean' ? browserHiddenStateWorks : null,
            rightPanelContextMenuWorks: typeof rightPanelContextMenuWorks === 'boolean' ? rightPanelContextMenuWorks : null,
            rightPanelTabReorderWorks: typeof rightPanelTabReorderWorks === 'boolean' ? rightPanelTabReorderWorks : null,
            planPanelWorks: typeof planPanelWorks === 'boolean' ? planPanelWorks : null,
            compactTaskRowsWork: typeof compactTaskRowsWork === 'boolean' ? compactTaskRowsWork : null,
            planAgentStatLabelsCalm: typeof planAgentStatLabelsCalm === 'boolean' ? planAgentStatLabelsCalm : null,
            sideChatTabsWork: typeof sideChatTabsWork === 'boolean' ? sideChatTabsWork : null,
            sideChatComposerCompactWorks: typeof sideChatComposerCompactWorks === 'boolean' ? sideChatComposerCompactWorks : null,
            sideChatDraftPersistenceWorks: typeof sideChatDraftPersistenceWorks === 'boolean' ? sideChatDraftPersistenceWorks : null,
            sideChatMessageLabelsCalm: typeof sideChatMessageLabelsCalm === 'boolean' ? sideChatMessageLabelsCalm : null,
            sideChatCloseWorks: typeof sideChatCloseWorks === 'boolean' ? sideChatCloseWorks : null,
            terminalTabsPersistState: typeof terminalTabsPersistState === 'boolean' ? terminalTabsPersistState : null,
            terminalRestoreWorks: typeof terminalRestoreWorks === 'boolean' ? terminalRestoreWorks : null,
            terminalTabMenuWorks: typeof terminalTabMenuWorks === 'boolean' ? terminalTabMenuWorks : null,
            terminalTabReorderWorks: typeof terminalTabReorderWorks === 'boolean' ? terminalTabReorderWorks : null,
            themeImportWorks: typeof themeImportWorks === 'boolean' ? themeImportWorks : null,
            themeSharingControls: typeof themeSharingControls === 'boolean' ? themeSharingControls : null,
            settingsTaxonomyWorks: typeof settingsTaxonomyWorks === 'boolean' ? settingsTaxonomyWorks : null,
            settingsSidebarNavCompactWorks: typeof settingsSidebarNavCompactWorks === 'boolean' ? settingsSidebarNavCompactWorks : null,
            settingsProviderDropdownWorks: typeof settingsProviderDropdownWorks === 'boolean' ? settingsProviderDropdownWorks : null,
            settingsDiagnosticsSectionWorks: typeof settingsDiagnosticsSectionWorks === 'boolean' ? settingsDiagnosticsSectionWorks : null,
            settingsProviderStatusUnifiedWorks: typeof settingsProviderStatusUnifiedWorks === 'boolean' ? settingsProviderStatusUnifiedWorks : null,
            settingsUsageDiagnosticsWorks: typeof settingsUsageDiagnosticsWorks === 'boolean' ? settingsUsageDiagnosticsWorks : null,
            settingsProviderModelsCollapsedWorks: typeof settingsProviderModelsCollapsedWorks === 'boolean' ? settingsProviderModelsCollapsedWorks : null,
            settingsProviderControlSurfaceUnifiedWorks: typeof settingsProviderControlSurfaceUnifiedWorks === 'boolean' ? settingsProviderControlSurfaceUnifiedWorks : null,
            settingsProviderCatalogLabelCalm: typeof settingsProviderCatalogLabelCalm === 'boolean' ? settingsProviderCatalogLabelCalm : null,
            settingsDiagnosticsDisclosureCompactWorks: typeof settingsDiagnosticsDisclosureCompactWorks === 'boolean' ? settingsDiagnosticsDisclosureCompactWorks : null,
            settingsDataControlsWorks: typeof settingsDataControlsWorks === 'boolean' ? settingsDataControlsWorks : null,
            settingsShortcutsCompactWorks: typeof settingsShortcutsCompactWorks === 'boolean' ? settingsShortcutsCompactWorks : null,
            hasExtensionsPanel: bodyText.includes('Extensions') && bodyText.includes('Instructions'),
            hasExtensionsPanelTabs: bodyText.includes('Claude Code Extensions') || bodyText.includes('Codex CLI Extensions') || bodyText.includes('Extensions'),
            extensionsEmbeddedCopyCompact: ${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} !== 'extensions' ||
              (bodyText.includes('Instructions') && !bodyText.includes('Local Instructions')),
            extensionsPanelCalmWorks: ${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} !== 'extensions' ||
              (() => {
                const extensionPanel = document.querySelector('[data-testid="session-right-panel"]');
                if (!(extensionPanel instanceof HTMLElement)) return false;
                const extensionTextareas = [...extensionPanel.querySelectorAll('textarea')];
                const summary = extensionPanel.querySelector('[data-testid="extensions-panel-summary"]');
                const embeddedRows = [...extensionPanel.querySelectorAll('[data-testid="extensions-embedded-entry"]')];
                const openDisclosures = [...extensionPanel.querySelectorAll('.motion-disclosure-trigger[aria-expanded="true"]')];
                return bodyText.includes('Instructions') &&
                  !bodyText.includes('Local Instructions') &&
                  !bodyText.includes('~/.claude/settings.json') &&
                  extensionTextareas.length === 0 &&
                  embeddedRows.length >= 4 &&
                  embeddedRows.every((row) => row instanceof HTMLElement && row.getBoundingClientRect().height <= 34) &&
                  openDisclosures.length <= 1 &&
                  extensionPanel.scrollWidth <= extensionPanel.clientWidth + 2 &&
                  (!(summary instanceof HTMLElement) || summary.getBoundingClientRect().height <= 24);
              })(),
            hasSideQuestionCommandText: bodyText.includes('/btw') || Boolean(textarea && textarea.value.includes('/btw')),
            capabilityMenuOpened: typeof capabilityMenuOpened === 'boolean' ? capabilityMenuOpened : null,
            capabilityMenuArrowFocus: typeof capabilityMenuArrowFocus === 'boolean' ? capabilityMenuArrowFocus : null,
            capabilityMenuClosedWithEscape: typeof capabilityMenuClosedWithEscape === 'boolean' ? capabilityMenuClosedWithEscape : null,
            capabilityMenuFocusReturned: typeof capabilityMenuFocusReturned === 'boolean' ? capabilityMenuFocusReturned : null,
            capabilityPageLabelsCalm: typeof capabilityPageLabelsCalm === 'boolean' ? capabilityPageLabelsCalm : null,
            capabilitySheetOpened: typeof capabilitySheetOpened === 'boolean' ? capabilitySheetOpened : null,
            capabilitySheetFocused: typeof capabilitySheetFocused === 'boolean' ? capabilitySheetFocused : null,
            capabilitySheetFocusStayedInside: typeof capabilitySheetFocusStayedInside === 'boolean' ? capabilitySheetFocusStayedInside : null,
            capabilitySheetClosedWithEscape: typeof capabilitySheetClosedWithEscape === 'boolean' ? capabilitySheetClosedWithEscape : null,
            capabilityEditActionClicked: typeof capabilityEditActionClicked === 'boolean' ? capabilityEditActionClicked : null,
            capabilityEditSheetOpened: typeof capabilityEditSheetOpened === 'boolean' ? capabilityEditSheetOpened : null,
            capabilitySyncActionClicked: typeof capabilitySyncActionClicked === 'boolean' ? capabilitySyncActionClicked : null,
            capabilitySyncSheetOpened: typeof capabilitySyncSheetOpened === 'boolean' ? capabilitySyncSheetOpened : null,
            composerPermissionMenuOpened: typeof composerPermissionMenuOpened === 'boolean' ? composerPermissionMenuOpened : null,
            composerPermissionNativeTooltipsWork: typeof composerPermissionNativeTooltipsWork === 'boolean' ? composerPermissionNativeTooltipsWork : null,
            composerPermissionLabelsCalm: typeof composerPermissionLabelsCalm === 'boolean' ? composerPermissionLabelsCalm : null,
            composerPermissionMenuClosedWithEscape: typeof composerPermissionMenuClosedWithEscape === 'boolean' ? composerPermissionMenuClosedWithEscape : null,
            composerPermissionFocusReturned: typeof composerPermissionFocusReturned === 'boolean' ? composerPermissionFocusReturned : null,
            composerAgentMenuOpened: typeof composerAgentMenuOpened === 'boolean' ? composerAgentMenuOpened : null,
            composerAgentRowLabelsCalm: typeof composerAgentRowLabelsCalm === 'boolean' ? composerAgentRowLabelsCalm : null,
            composerAgentMenuClosedWithOutsideClick: typeof composerAgentMenuClosedWithOutsideClick === 'boolean' ? composerAgentMenuClosedWithOutsideClick : null,
            composerAgentFocusReturned: typeof composerAgentFocusReturned === 'boolean' ? composerAgentFocusReturned : null,
            composerToolbarResponsiveWorks: typeof composerToolbarResponsiveWorks === 'boolean' ? composerToolbarResponsiveWorks : null,
            buttonCount: buttons.length,
            buttons: buttons.slice(0, 30)
          };
        })()
      `).then(async (result) => {
        result.smokeWindow = {
          foregroundAllowed: process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_FOREGROUND === '1',
          focused: win.isFocused(),
          visible: win.isVisible()
        }
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

function runAutomatedBrowserSmoke(win: BrowserWindow, outputPath: string, screenshotPath?: string): void {
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const buttonLabel = (button) =>
              button.getAttribute('aria-label') ??
              button.getAttribute('data-tooltip-label') ??
              button.getAttribute('title') ??
              button.textContent?.trim() ??
              '';
            const findButton = (label) =>
              [...document.querySelectorAll('button')]
                .find((button) => buttonLabel(button) === label);
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
            const browserPanelTabButton = document.querySelector('[data-tab-id="browser"]')?.closest('[role="tab"]');
            if (browserPanelTabButton instanceof HTMLElement) {
              browserPanelTabButton.click();
            } else {
              const inspectorToolsButton = findButton('Add panel tab');
              if (inspectorToolsButton instanceof HTMLButtonElement) {
                inspectorToolsButton.click();
                await sleep(120);
                const browserMenuItem = [...document.querySelectorAll('[role="menuitem"]')]
                  .find((item) => item.textContent?.includes('Browser'));
                if (browserMenuItem instanceof HTMLElement) browserMenuItem.click();
              }
            }
            await sleep(260);
            const browserEmptyState = document.querySelector('[data-testid="browser-empty-state"]');
            var browserEmptyStateWorks =
              browserEmptyState instanceof HTMLElement &&
              browserEmptyState.innerText.includes('Open a local app') &&
              browserEmptyState.innerText.includes('Choose a running server or enter any URL.') &&
              document.querySelector('[data-testid="browser-local-targets"]') instanceof HTMLElement;
            for (let index = 0; index < 20; index += 1) {
              if (document.querySelectorAll('[data-testid="browser-local-target"]').length > 0) break;
              await sleep(100);
            }
            const browserLocalTargets = [...document.querySelectorAll('[data-testid="browser-local-target"]')];
            const browserLocalTargetsHeader = document.querySelector('.browser-local-targets-header');
            const browserLocalTargetSort = document.querySelector('[data-testid="browser-local-target-sort"]');
            const browserLocalTargetSortBefore = browserLocalTargetSort instanceof HTMLElement
              ? browserLocalTargetSort.getAttribute('data-local-target-sort')
              : null;
            if (browserLocalTargetSort instanceof HTMLButtonElement) {
              browserLocalTargetSort.click();
              await sleep(80);
            }
            const browserLocalTargetSortAfter = browserLocalTargetSort instanceof HTMLElement
              ? browserLocalTargetSort.getAttribute('data-local-target-sort')
              : null;
            var browserLocalTargetsWorks =
              document.querySelector('[data-testid="browser-local-targets"]') instanceof HTMLElement &&
              browserLocalTargetsHeader instanceof HTMLElement &&
              getComputedStyle(browserLocalTargetsHeader).textTransform !== 'uppercase' &&
              browserLocalTargets.length > 0 &&
              browserLocalTargets.some((target) => target.textContent?.includes('127.0.0.1')) &&
              browserLocalTargets.some((target) => target instanceof HTMLElement && target.dataset.localTargetStatus === 'running') &&
              browserLocalTargets.some((target) => target instanceof HTMLElement && Boolean(target.dataset.localTargetSource)) &&
              browserLocalTargetSortBefore === 'recent' &&
              browserLocalTargetSortAfter === 'port' &&
              browserLocalTargets.every((target) => target instanceof HTMLElement && target.getBoundingClientRect().height <= 30) &&
              browserLocalTargets.every((target) => !target.textContent?.includes('Running')) &&
              browserLocalTargets.every((target) => target instanceof HTMLElement && target.scrollWidth <= target.clientWidth + 2);
            const browserInput = document.querySelector('[data-testid="browser-url-input"]');
            var browserAddressSearchWorks = false;
            if (browserInput instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(browserInput.constructor.prototype, 'value')?.set;
              const searchQuery = 'orchestrator browser search';
              const expectedSearchUrl = 'https://duckduckgo.com/?q=' + encodeURIComponent(searchQuery);
              setter?.call(browserInput, searchQuery);
              browserInput.dispatchEvent(new Event('input', { bubbles: true }));
              browserInput.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              for (let index = 0; index < 10; index += 1) {
                const panel = document.querySelector('[data-testid="browser-panel"]');
                const current = panel?.getAttribute('data-browser-current-url') ?? '';
                if (current.startsWith(expectedSearchUrl) || browserInput.value.startsWith(expectedSearchUrl)) break;
                await sleep(80);
              }
              const searchPanel = document.querySelector('[data-testid="browser-panel"]');
              const normalizedSearchUrl = searchPanel?.getAttribute('data-browser-current-url') ?? browserInput.value;
              browserAddressSearchWorks = normalizedSearchUrl.startsWith(expectedSearchUrl);
              setter?.call(browserInput, ${JSON.stringify(process.env.ORCHESTRATOR_BROWSER_SMOKE_URL ?? 'http://127.0.0.1:9')});
              browserInput.dispatchEvent(new Event('input', { bubbles: true }));
              browserInput.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              for (let index = 0; index < 30; index += 1) {
                const panel = document.querySelector('[data-testid="browser-panel"]');
                const url = panel?.getAttribute('data-browser-current-url') ?? '';
                const loading = panel?.getAttribute('data-browser-loading') === 'true';
                if (url.startsWith(${JSON.stringify(process.env.ORCHESTRATOR_BROWSER_SMOKE_URL ?? 'http://127.0.0.1:9')}) && !loading) break;
                await sleep(100);
              }
            }
            const findInPageButton = findButton('Find in page');
            const browserAddressBadge = document.querySelector('[data-testid="browser-address-badge"]');
            var browserAddressBadgeWorks =
              browserAddressBadge instanceof HTMLElement &&
              browserAddressBadge.getAttribute('data-browser-address-kind') === 'local' &&
              browserAddressBadge.textContent?.trim() === 'Local' &&
              browserAddressBadge.scrollWidth <= browserAddressBadge.clientWidth + 2;
            var browserFindWorks = false;
            var browserFindNavigationWorks = false;
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
                  if (matches > 1) break;
                  await sleep(100);
                }
                browserFindWorks =
                  findInput.value === 'Browser' &&
                  Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-matches') ?? '0') > 1;
                const nextFindButton = findButton('Next result');
                if (nextFindButton instanceof HTMLButtonElement) {
                  const beforeActiveMatch = Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-active-match') ?? '0');
                  nextFindButton.click();
                  for (let index = 0; index < 20; index += 1) {
                    const activeMatch = Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-active-match') ?? '0');
                    if (activeMatch > 0 && activeMatch !== beforeActiveMatch) break;
                    await sleep(100);
                  }
                  browserFindNavigationWorks =
                    Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-active-match') ?? '0') > 0 &&
                    Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-find-active-match') ?? '0') !== beforeActiveMatch;
                }
              }
            }
            const openBrowserActionsMenu = async () => {
              const actionsButton = findButton('Browser actions');
              if (!(actionsButton instanceof HTMLButtonElement)) return null;
              if (!document.querySelector('.browser-actions-menu')) {
                actionsButton.click();
                await sleep(120);
              }
              return actionsButton;
            };
            const closeBrowserActionsMenu = async () => {
              const actionsButton = findButton('Browser actions');
              if (actionsButton instanceof HTMLButtonElement && document.querySelector('.browser-actions-menu')) {
                actionsButton.click();
                await sleep(80);
              }
            };
            await openBrowserActionsMenu();
            const zoomInButton = findButton('Zoom in');
            if (zoomInButton instanceof HTMLButtonElement) {
              zoomInButton.click();
              await sleep(120);
            }
            var browserZoomWorks =
              Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-zoom') ?? '1') > 1;
            const mobilePreviewButton = findButton('Mobile preview');
            if (mobilePreviewButton instanceof HTMLButtonElement) {
              mobilePreviewButton.click();
              await sleep(120);
            }
            const browserViewportFrame = document.querySelector('[data-testid="browser-viewport-frame"]');
            const browserPanelAfterMobilePreview = document.querySelector('[data-testid="browser-panel"]');
            const viewportWidthBeforeRotate = Number(browserPanelAfterMobilePreview?.getAttribute('data-browser-viewport-width') ?? '0');
            const viewportHeightBeforeRotate = Number(browserPanelAfterMobilePreview?.getAttribute('data-browser-viewport-height') ?? '0');
            const rotateViewportButton = findButton('Rotate viewport');
            if (rotateViewportButton instanceof HTMLButtonElement) {
              rotateViewportButton.click();
              await sleep(120);
            }
            const browserPanelAfterRotate = document.querySelector('[data-testid="browser-panel"]');
            var browserViewportRotateWorks =
              rotateViewportButton instanceof HTMLButtonElement &&
              Number(browserPanelAfterRotate?.getAttribute('data-browser-viewport-width') ?? '0') === viewportHeightBeforeRotate &&
              Number(browserPanelAfterRotate?.getAttribute('data-browser-viewport-height') ?? '0') === viewportWidthBeforeRotate;
            var browserDeviceModeWorks =
              document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-device-mode') === 'mobile' &&
              browserViewportFrame instanceof HTMLElement &&
              viewportWidthBeforeRotate <= 410 &&
              browserViewportRotateWorks;
            const resetViewportButton = findButton('Reset viewport');
            if (resetViewportButton instanceof HTMLButtonElement) {
              resetViewportButton.click();
              await sleep(120);
            }
            const browserPanelAfterReset = document.querySelector('[data-testid="browser-panel"]');
            var browserViewportResetWorks =
              resetViewportButton instanceof HTMLButtonElement &&
              browserPanelAfterReset?.getAttribute('data-browser-device-mode') === 'desktop' &&
              Number(browserPanelAfterReset?.getAttribute('data-browser-viewport-width') ?? '0') === 1280 &&
              Number(browserPanelAfterReset?.getAttribute('data-browser-viewport-height') ?? '0') === 720;
            const noCacheButton = findButton('Reload without cache');
            if (noCacheButton instanceof HTMLButtonElement) {
              noCacheButton.click();
              for (let index = 0; index < 30; index += 1) {
                if (Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-cache-reloads') ?? '0') > 0) break;
                await sleep(100);
              }
            }
            var browserCacheReloadWorks =
              Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-cache-reloads') ?? '0') > 0;
            await openBrowserActionsMenu();
            const hideBrowserButton = findButton('Hide browser surface');
            if (hideBrowserButton instanceof HTMLButtonElement) {
              hideBrowserButton.click();
              await sleep(120);
            }
            var browserVisibilityControlWorks =
              document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-visible') === 'false';
            const browserHiddenStateWorks =
              document.querySelector('[data-testid="browser-hidden-state"]') instanceof HTMLElement &&
              document.querySelector('[data-testid="browser-hidden-show"]') instanceof HTMLButtonElement;
            const showBrowserButton = findButton('Show browser surface');
            if (showBrowserButton instanceof HTMLButtonElement) {
              showBrowserButton.click();
              await sleep(120);
            }
            await closeBrowserActionsMenu();
            const toolbarScreenshotButton = document.querySelector('.browser-toolbar [data-testid="browser-capture-screenshot"]');
            const toolbarOpenExternalButton = document.querySelector('.browser-toolbar [data-testid="browser-open-external"]');
            await openBrowserActionsMenu();
            const menuScreenshotButton = document.querySelector('[data-testid="browser-menu-capture-screenshot"]');
            const menuOpenExternalButton = document.querySelector('[data-testid="browser-menu-open-external"]');
            var browserToolbarExternalWorks =
              !(toolbarOpenExternalButton instanceof HTMLButtonElement) &&
              menuOpenExternalButton instanceof HTMLButtonElement &&
              menuOpenExternalButton.getAttribute('aria-label') === 'Open external browser' &&
              !menuOpenExternalButton.disabled;
            var browserToolbarScreenshotWorks = false;
            if (menuScreenshotButton instanceof HTMLButtonElement) {
              for (let index = 0; index < 20; index += 1) {
                if (!menuScreenshotButton.disabled) break;
                await sleep(100);
              }
              const screenshotButtonEnabled = !menuScreenshotButton.disabled;
              menuScreenshotButton.click();
              for (let index = 0; index < 30; index += 1) {
                if (document.querySelector('[data-testid="browser-inspector-toolbar"]')) break;
                await sleep(100);
              }
              browserToolbarScreenshotWorks =
                screenshotButtonEnabled &&
                !(toolbarScreenshotButton instanceof HTMLButtonElement) &&
                document.querySelector('[data-testid="browser-inspector-toolbar"]') instanceof HTMLElement;
            }
            const smokeBaseUrl = ${JSON.stringify(process.env.ORCHESTRATOR_BROWSER_SMOKE_URL ?? 'http://127.0.0.1:9')};
            const slowUrl = smokeBaseUrl + '/slow';
            const browserInputForStop = document.querySelector('[data-testid="browser-url-input"]');
            if (browserInputForStop instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(browserInputForStop.constructor.prototype, 'value')?.set;
              setter?.call(browserInputForStop, slowUrl);
              browserInputForStop.dispatchEvent(new Event('input', { bubbles: true }));
              browserInputForStop.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              for (let index = 0; index < 20; index += 1) {
                if (document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-loading') === 'true') break;
                await sleep(50);
              }
            }
            const stopLoadingButton = findButton('Stop loading');
            const stopButtonVisibleWhileLoading =
              stopLoadingButton instanceof HTMLButtonElement &&
              document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-loading') === 'true';
            if (stopLoadingButton instanceof HTMLButtonElement) {
              stopLoadingButton.click();
              await sleep(180);
            }
            var browserStopLoadingWorks =
              stopButtonVisibleWhileLoading &&
              document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-loading') === 'false';
            if (browserInputForStop instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(browserInputForStop.constructor.prototype, 'value')?.set;
              setter?.call(browserInputForStop, smokeBaseUrl);
              browserInputForStop.dispatchEvent(new Event('input', { bubbles: true }));
              browserInputForStop.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              await sleep(700);
            }
            const browserToolbarHistoryButton = findButton('Browser history');
            const browserToolbarHistoryWorks = !(browserToolbarHistoryButton instanceof HTMLButtonElement);
            const browserActionsButton = findButton('Browser actions');
            let browserHistoryMenuWorks = false;
            if (browserActionsButton instanceof HTMLButtonElement) {
              browserActionsButton.click();
              await sleep(160);
              const historyMenu = document.querySelector('[data-testid="browser-history-menu"]');
              const historyItems = [...document.querySelectorAll('[data-testid="browser-history-item"]')];
              const browserActionsMenu = document.querySelector('.browser-actions-menu');
              const browserPageActions = document.querySelector('[data-testid="browser-page-actions"]');
              const browserDataActions = document.querySelector('[data-testid="browser-data-actions"]');
              const browserPageActionRows = browserPageActions instanceof HTMLElement
                ? [...browserPageActions.querySelectorAll('.browser-action-row')]
                : [];
              const browserDataActionRows = browserDataActions instanceof HTMLElement
                ? [...browserDataActions.querySelectorAll('.browser-action-row')]
                : [];
              const copyUrlItem = [...document.querySelectorAll('[role="menuitem"]')]
                .find((item) => item.textContent?.includes('Copy URL'));
              const clearDataItem = document.querySelector('[data-testid="browser-clear-data"]');
              const clearCacheItem = document.querySelector('[data-testid="browser-clear-cache"]');
              const clearCookiesItem = document.querySelector('[data-testid="browser-clear-cookies"]');
              const clearSiteDataItem = document.querySelector('[data-testid="browser-clear-site-data"]');
              const browserActionLabels = [...document.querySelectorAll('.browser-action-label')]
                .filter((label) => label instanceof HTMLElement);
              var browserActionLabelsCalm =
                browserActionLabels.length >= 3 &&
                browserActionLabels.every((label) => {
                  const text = label.textContent?.trim() ?? '';
                  return text.length === 0 ||
                    (text !== text.toUpperCase() && getComputedStyle(label).textTransform !== 'uppercase');
                });
              browserHistoryMenuWorks =
                historyMenu instanceof HTMLElement &&
                historyItems.length > 0 &&
                historyItems.some((item) => item.textContent?.includes('127.0.0.1')) &&
                copyUrlItem instanceof HTMLElement &&
                clearDataItem instanceof HTMLElement &&
                clearCacheItem instanceof HTMLElement &&
                clearCookiesItem instanceof HTMLElement &&
                clearSiteDataItem instanceof HTMLElement;
              var browserActionsMenuCompactWorks =
                browserActionsMenu instanceof HTMLElement &&
                browserPageActions instanceof HTMLElement &&
                browserDataActions instanceof HTMLElement &&
                browserPageActionRows.length === 4 &&
                browserDataActionRows.length === 4 &&
                browserPageActions.scrollWidth <= browserPageActions.clientWidth + 2 &&
                browserDataActions.scrollWidth <= browserDataActions.clientWidth + 2 &&
                browserActionsMenu.scrollWidth <= browserActionsMenu.clientWidth + 2 &&
                browserPageActionRows.every((row) => row instanceof HTMLElement && row.getBoundingClientRect().height <= 30) &&
                browserDataActionRows.every((row) => row instanceof HTMLElement && row.getBoundingClientRect().height <= 30) &&
                browserPageActionRows.every((row, index) => {
                  if (!(row instanceof HTMLElement) || index === 0) return row instanceof HTMLElement;
                  const previous = browserPageActionRows[index - 1];
                  return previous instanceof HTMLElement &&
                    row.getBoundingClientRect().top > previous.getBoundingClientRect().top;
                }) &&
                browserDataActionRows.every((row, index) => {
                  if (!(row instanceof HTMLElement) || index === 0) return row instanceof HTMLElement;
                  const previous = browserDataActionRows[index - 1];
                  return previous instanceof HTMLElement &&
                    row.getBoundingClientRect().top > previous.getBoundingClientRect().top;
                });
              var browserClearDataWorks = false;
              const clearDataTargets = [
                { testId: 'browser-clear-cache', kind: 'cache' },
                { testId: 'browser-clear-cookies', kind: 'cookies' },
                { testId: 'browser-clear-site-data', kind: 'siteData' },
                { testId: 'browser-clear-data', kind: 'all' }
              ];
              let clearDataTargetIndex = 0;
              for (const target of clearDataTargets) {
                if (!document.querySelector('.browser-actions-menu')) {
                  browserActionsButton.click();
                  await sleep(120);
                }
                const clearDataTarget = document.querySelector('[data-testid="' + target.testId + '"]');
                if (!(clearDataTarget instanceof HTMLButtonElement)) break;
                const browserPanelBeforeClear = document.querySelector('[data-testid="browser-panel"]');
                const beforeCount = Number(browserPanelBeforeClear?.getAttribute('data-browser-clear-data') ?? '0');
                clearDataTarget.click();
                let targetWorked = false;
                for (let index = 0; index < 30; index += 1) {
                  const browserPanelAfterClear = document.querySelector('[data-testid="browser-panel"]');
                  const nextCount = Number(browserPanelAfterClear?.getAttribute('data-browser-clear-data') ?? '0');
                  const nextKind = browserPanelAfterClear?.getAttribute('data-browser-clear-data-kind');
                  if (nextCount > beforeCount && nextKind === target.kind) {
                    targetWorked = true;
                    break;
                  }
                  await sleep(100);
                }
                if (!targetWorked) break;
                clearDataTargetIndex += 1;
              }
              browserClearDataWorks = clearDataTargetIndex === clearDataTargets.length;
              if (document.querySelector('.browser-actions-menu')) {
                browserActionsButton.click();
              }
              await sleep(80);
            }
            var browserContextMenuWorks = false;
            var browserContextComposerWorks = false;
            const browserContextViewportFrame = document.querySelector('[data-testid="browser-viewport-frame"]');
            if (browserContextViewportFrame instanceof HTMLElement) {
              const frameBounds = browserContextViewportFrame.getBoundingClientRect();
              browserContextViewportFrame.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: frameBounds.left + Math.min(80, frameBounds.width / 2),
                clientY: frameBounds.top + Math.min(80, frameBounds.height / 2)
              }));
              await sleep(160);
              const browserContextMenu = document.querySelector('.browser-page-context-menu');
              const contextBack = document.querySelector('[data-testid="browser-context-back"]');
              const contextForward = document.querySelector('[data-testid="browser-context-forward"]');
              const contextReload = document.querySelector('[data-testid="browser-context-reload"]');
              const contextInspect = document.querySelector('[data-testid="browser-context-inspect"]');
              const contextAddPage = document.querySelector('[data-testid="browser-context-add-page"]');
              const contextRows = browserContextMenu instanceof HTMLElement
                ? [...browserContextMenu.querySelectorAll('.browser-action-row')]
                : [];
              browserContextMenuWorks =
                browserContextMenu instanceof HTMLElement &&
                contextBack instanceof HTMLButtonElement &&
                contextForward instanceof HTMLButtonElement &&
                contextReload instanceof HTMLButtonElement &&
                contextInspect instanceof HTMLButtonElement &&
                contextAddPage instanceof HTMLButtonElement &&
                contextRows.length === 5 &&
                browserContextMenu.scrollWidth <= browserContextMenu.clientWidth + 2 &&
                browserContextMenu.getBoundingClientRect().right <= window.innerWidth;
              if (contextAddPage instanceof HTMLButtonElement) {
                contextAddPage.click();
                await sleep(220);
                const composerTextarea = document.querySelector('textarea');
                browserContextComposerWorks =
                  composerTextarea instanceof HTMLTextAreaElement &&
                  composerTextarea.value.includes('Review this browser page:') &&
                  composerTextarea.value.includes(smokeBaseUrl) &&
                  composerTextarea.value.includes('Visible page structure:');
              }
              document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
              await sleep(80);
            }
            const badBrowserUrl = 'http://127.0.0.1:1/orchestrator-error-smoke';
            if (browserInputForStop instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(browserInputForStop.constructor.prototype, 'value')?.set;
              setter?.call(browserInputForStop, badBrowserUrl);
              browserInputForStop.dispatchEvent(new Event('input', { bubbles: true }));
              browserInputForStop.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              for (let index = 0; index < 30; index += 1) {
                if ((document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-error') ?? '').length > 0) break;
                await sleep(100);
              }
            }
            const browserErrorStatusRow = document.querySelector('[data-testid="browser-status-row"]');
            const browserErrorRetry = document.querySelector('[data-testid="browser-error-retry"]');
            const browserErrorCopyUrl = document.querySelector('[data-testid="browser-error-copy-url"]');
            const browserLoadError = document.querySelector('[data-testid="browser-load-error"]');
            const browserLoadErrorRetry = document.querySelector('[data-testid="browser-load-error-retry"]');
            const browserLoadErrorHardReload = document.querySelector('[data-testid="browser-load-error-hard-reload"]');
            const browserLoadErrorCopyUrl = document.querySelector('[data-testid="browser-load-error-copy-url"]');
            const browserLoadErrorOpenExternal = document.querySelector('[data-testid="browser-load-error-open-external"]');
            var browserErrorRecoveryWorks =
              (document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-error') ?? '').length > 0 &&
              !(browserErrorStatusRow instanceof HTMLElement) &&
              !(browserErrorRetry instanceof HTMLButtonElement) &&
              !(browserErrorCopyUrl instanceof HTMLButtonElement) &&
              browserLoadErrorRetry instanceof HTMLButtonElement &&
              browserLoadErrorHardReload instanceof HTMLButtonElement &&
              browserLoadErrorCopyUrl instanceof HTMLButtonElement &&
              browserLoadErrorOpenExternal instanceof HTMLButtonElement;
            var browserLoadErrorPanelWorks =
              browserLoadError instanceof HTMLElement &&
              browserLoadError.textContent?.includes('Page unavailable') &&
              browserLoadError.textContent?.includes('Try') &&
              browserLoadErrorRetry instanceof HTMLButtonElement &&
              browserLoadErrorHardReload instanceof HTMLButtonElement &&
              browserLoadErrorCopyUrl instanceof HTMLButtonElement &&
              browserLoadErrorOpenExternal instanceof HTMLButtonElement &&
              browserLoadError.querySelectorAll('button').length === 4 &&
              browserLoadError.scrollWidth <= browserLoadError.clientWidth + 2;
            if (browserInputForStop instanceof HTMLInputElement) {
              const setter = Object.getOwnPropertyDescriptor(browserInputForStop.constructor.prototype, 'value')?.set;
              setter?.call(browserInputForStop, smokeBaseUrl);
              browserInputForStop.dispatchEvent(new Event('input', { bubbles: true }));
              browserInputForStop.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              for (let index = 0; index < 30; index += 1) {
                const panel = document.querySelector('[data-testid="browser-panel"]');
                const url = panel?.getAttribute('data-browser-current-url') ?? '';
                const error = panel?.getAttribute('data-browser-error') ?? '';
                const loading = panel?.getAttribute('data-browser-loading') === 'true';
                if (url.startsWith(smokeBaseUrl) && !error && !loading) break;
                await sleep(100);
              }
            }
            const browserInspectButton = document.querySelector('[data-testid="browser-run-inspection"]');
            if (browserInspectButton instanceof HTMLButtonElement) {
              browserInspectButton.click();
              for (let index = 0; index < 30; index += 1) {
                if (Number(document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-dom-targets') ?? '0') > 0) break;
                await sleep(100);
              }
            }
            const domInspectorButton = document.querySelector('[data-testid="browser-inspector-dom"]');
            if (domInspectorButton instanceof HTMLButtonElement) {
              domInspectorButton.click();
              await sleep(120);
            }
            const browserDomPane = document.querySelector('[data-testid="browser-dom-pane"]');
            const browserDomPaneCompactWorks =
              browserDomPane instanceof HTMLElement &&
              browserDomPane.textContent?.includes('Snapshot') &&
              browserDomPane.textContent?.includes('lines') &&
              !browserDomPane.querySelector('button') &&
              browserDomPane.scrollWidth <= browserDomPane.clientWidth + 2;
            const browserTargetsButton = document.querySelector('[data-testid="browser-inspector-targets"]');
            if (browserTargetsButton instanceof HTMLButtonElement) {
              browserTargetsButton.click();
              await sleep(120);
            }
            const browserTargetsPane = document.querySelector('.browser-targets-pane');
            const browserTargetActionControls = document.querySelector('.browser-target-action-controls');
            const browserTargetActionSelect = document.querySelector('[data-testid="browser-target-action-select"]');
            const browserTargetPointerPanel = document.querySelector('[data-testid="browser-target-pointer-panel"]');
            const browserTargetClipboardPanel = document.querySelector('[data-testid="browser-target-clipboard-panel"]');
            var browserTargetsPaneWorks =
              document.querySelector('[data-testid="browser-target-select"]') instanceof HTMLSelectElement &&
              browserTargetsPane instanceof HTMLElement &&
              browserTargetActionControls instanceof HTMLElement &&
              browserTargetActionControls.scrollWidth <= browserTargetActionControls.clientWidth + 2 &&
              browserTargetActionSelect instanceof HTMLSelectElement &&
              browserTargetPointerPanel instanceof HTMLDetailsElement &&
              browserTargetPointerPanel.open === false &&
              browserTargetClipboardPanel instanceof HTMLDetailsElement &&
              browserTargetClipboardPanel.open === false;
            const setBrowserTargetAction = async (action) => {
              const actionSelect = document.querySelector('[data-testid="browser-target-action-select"]');
              if (!(actionSelect instanceof HTMLSelectElement)) return false;
              const actionSetter = Object.getOwnPropertyDescriptor(actionSelect.constructor.prototype, 'value')?.set;
              actionSetter?.call(actionSelect, action);
              actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
              await sleep(100);
              return true;
            };
            const clickBrowserTargetRun = () => {
              const runButton = document.querySelector('[data-testid="browser-target-run-action"]');
              if (!(runButton instanceof HTMLButtonElement) || runButton.disabled) return false;
              runButton.click();
              return true;
            };
            const browserTargetSelect = document.querySelector('[data-testid="browser-target-select"]');
            const browserTargetActionInput = document.querySelector('.browser-targets-pane input[placeholder="Text or key"]');
            let browserTargetKeyWorks = false;
            if (browserTargetSelect instanceof HTMLSelectElement && browserTargetActionInput instanceof HTMLInputElement) {
              const smokeInputOption = [...browserTargetSelect.options]
                .find((option) => option.textContent?.includes('Smoke input'));
              if (smokeInputOption) {
                const selectSetter = Object.getOwnPropertyDescriptor(browserTargetSelect.constructor.prototype, 'value')?.set;
                selectSetter?.call(browserTargetSelect, smokeInputOption.value);
                browserTargetSelect.dispatchEvent(new Event('change', { bubbles: true }));
                const inputSetter = Object.getOwnPropertyDescriptor(browserTargetActionInput.constructor.prototype, 'value')?.set;
                inputSetter?.call(browserTargetActionInput, 'Enter');
                browserTargetActionInput.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(120);
                if (await setBrowserTargetAction('key') && clickBrowserTargetRun()) {
                  const browserWebview = document.querySelector('[data-testid="browser-webview"]');
                  for (let index = 0; index < 30; index += 1) {
                    const pressed = browserWebview && 'executeJavaScript' in browserWebview
                      ? await browserWebview.executeJavaScript('document.body.dataset.keyPressed || ""')
                      : '';
                    if (pressed === 'Enter') {
                      browserTargetKeyWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
              }
            }
            let browserTargetSelectWorks = false;
            const browserTargetSelectForSelect = document.querySelector('[data-testid="browser-target-select"]');
            const browserTargetActionInputForSelect = document.querySelector('.browser-targets-pane input[placeholder="Text or key"]');
            if (browserTargetSelectForSelect instanceof HTMLSelectElement && browserTargetActionInputForSelect instanceof HTMLInputElement) {
              const smokeSelectOption = [...browserTargetSelectForSelect.options]
                .find((option) => option.textContent?.includes('Smoke select'));
              if (smokeSelectOption) {
                const selectSetter = Object.getOwnPropertyDescriptor(browserTargetSelectForSelect.constructor.prototype, 'value')?.set;
                selectSetter?.call(browserTargetSelectForSelect, smokeSelectOption.value);
                browserTargetSelectForSelect.dispatchEvent(new Event('change', { bubbles: true }));
                const inputSetter = Object.getOwnPropertyDescriptor(browserTargetActionInputForSelect.constructor.prototype, 'value')?.set;
                inputSetter?.call(browserTargetActionInputForSelect, 'beta');
                browserTargetActionInputForSelect.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(120);
                if (await setBrowserTargetAction('select') && clickBrowserTargetRun()) {
                  const browserWebview = document.querySelector('[data-testid="browser-webview"]');
                  for (let index = 0; index < 30; index += 1) {
                    const selected = browserWebview && 'executeJavaScript' in browserWebview
                      ? await browserWebview.executeJavaScript('document.body.dataset.selectedOption || ""')
                      : '';
                    if (selected === 'beta') {
                      browserTargetSelectWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
              }
            }
            let browserTargetCheckWorks = false;
            const browserTargetSelectForCheck = document.querySelector('[data-testid="browser-target-select"]');
            const browserTargetActionInputForCheck = document.querySelector('.browser-targets-pane input[placeholder="Text or key"]');
            if (browserTargetSelectForCheck instanceof HTMLSelectElement && browserTargetActionInputForCheck instanceof HTMLInputElement) {
              const smokeCheckboxOption = [...browserTargetSelectForCheck.options]
                .find((option) => option.textContent?.includes('Smoke checkbox'));
              if (smokeCheckboxOption) {
                const selectSetter = Object.getOwnPropertyDescriptor(browserTargetSelectForCheck.constructor.prototype, 'value')?.set;
                selectSetter?.call(browserTargetSelectForCheck, smokeCheckboxOption.value);
                browserTargetSelectForCheck.dispatchEvent(new Event('change', { bubbles: true }));
                const inputSetter = Object.getOwnPropertyDescriptor(browserTargetActionInputForCheck.constructor.prototype, 'value')?.set;
                inputSetter?.call(browserTargetActionInputForCheck, 'true');
                browserTargetActionInputForCheck.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(120);
                if (await setBrowserTargetAction('check') && clickBrowserTargetRun()) {
                  const browserWebview = document.querySelector('[data-testid="browser-webview"]');
                  for (let index = 0; index < 30; index += 1) {
                    const checked = browserWebview && 'executeJavaScript' in browserWebview
                      ? await browserWebview.executeJavaScript('document.body.dataset.checkedState || ""')
                      : '';
                    if (checked === 'true') {
                      browserTargetCheckWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
              }
            }
            let browserTargetFillWorks = false;
            let browserTargetTypeWorks = false;
            let browserTargetStateWorks = false;
            const browserTargetSelectForText = document.querySelector('[data-testid="browser-target-select"]');
            const browserTargetActionInputForText = document.querySelector('.browser-targets-pane input[placeholder="Text or key"]');
            if (browserTargetSelectForText instanceof HTMLSelectElement && browserTargetActionInputForText instanceof HTMLInputElement) {
              const smokeInputOption = [...browserTargetSelectForText.options]
                .find((option) => option.textContent?.includes('Smoke input'));
              if (smokeInputOption) {
                const selectSetter = Object.getOwnPropertyDescriptor(browserTargetSelectForText.constructor.prototype, 'value')?.set;
                const inputSetter = Object.getOwnPropertyDescriptor(browserTargetActionInputForText.constructor.prototype, 'value')?.set;
                selectSetter?.call(browserTargetSelectForText, smokeInputOption.value);
                browserTargetSelectForText.dispatchEvent(new Event('change', { bubbles: true }));
                inputSetter?.call(browserTargetActionInputForText, 'filled');
                browserTargetActionInputForText.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(120);
                const browserWebview = document.querySelector('[data-testid="browser-webview"]');
                if (await setBrowserTargetAction('fill') && clickBrowserTargetRun()) {
                  for (let index = 0; index < 30; index += 1) {
                    const value = browserWebview && 'executeJavaScript' in browserWebview
                      ? await browserWebview.executeJavaScript('document.body.dataset.inputValue || ""')
                      : '';
                    if (value === 'filled') {
                      browserTargetFillWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
                inputSetter?.call(browserTargetActionInputForText, ' plus');
                browserTargetActionInputForText.dispatchEvent(new Event('input', { bubbles: true }));
                await sleep(120);
                if (await setBrowserTargetAction('type') && clickBrowserTargetRun()) {
                  for (let index = 0; index < 30; index += 1) {
                    const value = browserWebview && 'executeJavaScript' in browserWebview
                      ? await browserWebview.executeJavaScript('document.body.dataset.inputValue || ""')
                      : '';
                    if (value === 'filled plus') {
                      browserTargetTypeWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
                if (await setBrowserTargetAction('read') && clickBrowserTargetRun()) {
                  for (let index = 0; index < 30; index += 1) {
                    const output = document.querySelector('[data-testid="browser-target-read-output"]');
                    const text = output instanceof HTMLElement ? output.innerText : '';
                    const rect = output instanceof HTMLElement ? output.getBoundingClientRect() : null;
                    if (
                      output instanceof HTMLElement &&
                      rect !== null &&
                      text.includes('input') &&
                      text.includes('enabled') &&
                      text.includes('visible') &&
                      text.includes('filled plus') &&
                      output.scrollWidth <= output.clientWidth + 2 &&
                      rect.height <= 64
                    ) {
                      browserTargetStateWorks = true;
                      break;
                    }
                    await sleep(100);
                  }
                }
              }
            }
            var browserTargetsPaneNoHorizontalOverflowWorks = (() => {
              const pane = document.querySelector('.browser-targets-pane');
              return pane instanceof HTMLElement &&
                pane.scrollWidth <= pane.clientWidth + 2;
            })();
            const browserPanel = document.querySelector('[data-testid="browser-panel"]');
            const expectedUrl = ${JSON.stringify(process.env.ORCHESTRATOR_BROWSER_SMOKE_URL ?? 'http://127.0.0.1:9')};
            const browserCurrentUrl = browserPanel?.getAttribute('data-browser-current-url') ?? '';
            const rightPanel = document.querySelector('[data-testid="session-right-panel"]');
            const browserSingleTabStripHidden =
              Number(browserPanel?.getAttribute('data-browser-tab-count') ?? '0') === 1 &&
              !document.querySelector('[data-testid="browser-tab-strip"]');
            const browserNoHorizontalOverflow = browserPanel instanceof HTMLElement &&
              browserPanel.scrollWidth <= browserPanel.clientWidth + 2;
            const browserToolbar = document.querySelector('.browser-toolbar');
            const browserFindRow = document.querySelector('[data-testid="browser-find-input"]')?.closest('.flex.shrink-0');
            const browserToolbarCompact =
              browserToolbar instanceof HTMLElement &&
              !(document.querySelector('.browser-toolbar [data-testid="browser-capture-screenshot"]') instanceof HTMLButtonElement) &&
              !(document.querySelector('.browser-toolbar [data-testid="browser-open-external"]') instanceof HTMLButtonElement) &&
              !(findButton('Browser history') instanceof HTMLButtonElement) &&
              browserToolbar.getBoundingClientRect().height <= 38 &&
              (!(browserFindRow instanceof HTMLElement) || browserFindRow.getBoundingClientRect().height <= 34);
            const browserStatusRowQuiet =
              document.querySelector('[data-testid="browser-panel"]')?.getAttribute('data-browser-device-mode') === 'desktop' &&
              !document.querySelector('[data-testid="browser-status-row"]');
            const browserInspectorChromeCompactWorks = (() => {
              const toolbar = document.querySelector('[data-testid="browser-inspector-toolbar"]');
              const activeLabel = document.querySelector('.browser-inspector-tab[data-active="true"] span');
              const inactiveLabels = [...document.querySelectorAll('.browser-inspector-tab:not([data-active="true"]) span')]
                .filter((label) => label instanceof HTMLElement);
              return toolbar instanceof HTMLElement &&
                activeLabel instanceof HTMLElement &&
                getComputedStyle(activeLabel).display !== 'none' &&
                inactiveLabels.length >= 3 &&
                inactiveLabels.every((label) => getComputedStyle(label).display === 'none') &&
                toolbar.getBoundingClientRect().height <= 34 &&
                toolbar.scrollWidth <= toolbar.clientWidth + 2;
            })();
            const browserInspectorLabelsCalm = [
              ...document.querySelectorAll('.browser-target-section-title'),
              ...document.querySelectorAll('.browser-target-read-output span:nth-child(odd)')
            ].every((label) => {
              const text = label.textContent?.trim() ?? '';
              return text.length === 0 || text !== text.toUpperCase();
            });
            return {
              profile,
              browserActive: rightPanel instanceof HTMLElement &&
                rightPanel.dataset.rightPanelActiveTab === 'browser',
              browserEmptyStateWorks,
              browserLocalTargetsWorks,
              browserAddressSearchWorks,
              browserAddressBadgeWorks,
              browserToolbarExternalWorks,
              browserToolbarScreenshotWorks,
              browserLoaded: Boolean(document.querySelector('[data-testid="browser-webview"]')) &&
                browserCurrentUrl.startsWith(expectedUrl),
              browserFindWorks,
              browserFindNavigationWorks,
              browserZoomWorks,
              browserDeviceModeWorks,
              browserViewportResetWorks,
              browserCacheReloadWorks,
              browserStopLoadingWorks,
              browserToolbarHistoryWorks,
              browserHistoryMenuWorks,
              browserActionsMenuCompactWorks: typeof browserActionsMenuCompactWorks === 'boolean' ? browserActionsMenuCompactWorks : null,
              browserActionLabelsCalm: typeof browserActionLabelsCalm === 'boolean' ? browserActionLabelsCalm : null,
              browserClearDataWorks: typeof browserClearDataWorks === 'boolean' ? browserClearDataWorks : null,
              browserContextMenuWorks,
              browserContextComposerWorks,
              browserDomPaneCompactWorks,
              browserTargetsPaneWorks,
              browserTargetKeyWorks,
              browserTargetFillWorks,
              browserTargetTypeWorks,
              browserTargetStateWorks,
              browserTargetSelectWorks,
              browserTargetCheckWorks,
              browserTargetsPaneNoHorizontalOverflowWorks,
              browserErrorRecoveryWorks,
              browserLoadErrorPanelWorks,
              browserSingleTabStripHidden,
              browserNoHorizontalOverflow,
              browserToolbarCompact,
              browserInspectorChromeCompactWorks,
              browserInspectorLabelsCalm,
              browserVisibilityControlWorks,
              browserHiddenStateWorks,
              browserStatusRowQuiet
            };
          })()
        `)
        result.smokeWindow = {
          foregroundAllowed: process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_FOREGROUND === '1',
          focused: win.isFocused(),
          visible: win.isVisible()
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
            const emptyState = document.querySelector('[data-testid="project-empty-state"]');
            const sidebar = document.querySelector('[data-testid="app-sidebar"]');
            const sidebarEmptyState = document.querySelector('[data-testid="sidebar-project-empty-state"]');
            const addProjectButton = document.querySelector('[data-testid="project-empty-state-add"]');
            const importCodexButton = document.querySelector('[data-testid="project-empty-state-import-codex"]');
            const sidebarAddProjectButton = sidebarEmptyState instanceof HTMLElement
              ? [...sidebarEmptyState.querySelectorAll('button')]
                  .find((button) => button.textContent?.includes('Add project'))
              : null;
            const emptyRect = emptyState?.getBoundingClientRect();
            const actionRect = addProjectButton?.getBoundingClientRect();
            const heading = emptyState instanceof HTMLElement ? emptyState.querySelector('div:nth-child(2)') : null;
            const headingStyle = heading instanceof HTMLElement ? getComputedStyle(heading) : null;
            return {
              profile,
              projectCount: projects.length,
              sessionCount: sessions.length,
              emptyStateVisible: Boolean(emptyState) &&
                bodyText.includes('Open a project') &&
                bodyText.includes('Choose a local folder to start chatting in that workspace.'),
              emptyStateCalm: Boolean(emptyRect) &&
                (emptyRect?.width ?? 0) >= 280 &&
                (emptyRect?.width ?? 0) <= 380 &&
                (emptyRect?.height ?? 0) <= 180 &&
                headingStyle !== null &&
                Number.parseFloat(headingStyle.fontSize || '0') <= 20,
              addProjectActionVisible: addProjectButton instanceof HTMLButtonElement,
              addProjectActionCompact: addProjectButton instanceof HTMLButtonElement &&
                (actionRect?.width ?? 0) >= 96 &&
                (actionRect?.width ?? 0) <= 150 &&
                (actionRect?.height ?? 0) <= 34,
              importCodexActionVisible: importCodexButton instanceof HTMLButtonElement &&
                importCodexButton.textContent?.includes('Import Codex'),
              sidebarEmptyStateVisible: sidebarAddProjectButton instanceof HTMLButtonElement,
              sidebarNoHorizontalOverflow: sidebar instanceof HTMLElement &&
                getComputedStyle(sidebar).overflowX === 'hidden' &&
                sidebar.scrollWidth <= sidebar.clientWidth + 2,
              noStaticSuggestionCards: !bodyText.includes('Try asking')
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
            const buttonLabel = (button) =>
              button.getAttribute('aria-label') ??
              button.getAttribute('data-tooltip-label') ??
              button.getAttribute('title') ??
              button.textContent?.trim() ??
              '';
            const colorAlpha = (color) => {
              const match = color.match(/rgba?\\(([^)]+)\\)/);
              if (!match) return 1;
              const parts = match[1].split(',').map((part) => part.trim());
              return parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;
            };
            const hoverSurfaceReadable = (element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return (
                rect.width >= 20 &&
                rect.height >= 10 &&
                colorAlpha(style.backgroundColor) >= 0.98 &&
                colorAlpha(style.color) >= 0.98 &&
                Number.parseFloat(style.opacity || '1') >= 0.95 &&
                style.visibility !== 'hidden'
              );
            };
            const findButton = (label) =>
              [...document.querySelectorAll('button')]
                .find((button) => buttonLabel(button) === label);
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
            const hoverCardSurfaceReadable = hoverCard instanceof HTMLElement && hoverSurfaceReadable(hoverCard);
            let singleHoverSurfaceWorks = false;
            let tooltipSurfaceReadable = false;
            let tooltipDismissesOnViewportChange = false;
            const normalActionsButton = normalRow?.querySelector('[aria-label="Chat actions"], [title="Chat actions"]');
            if (normalActionsButton instanceof HTMLElement) {
              const actionRect = normalActionsButton.getBoundingClientRect();
              normalActionsButton.dispatchEvent(new MouseEvent('mouseover', {
                bubbles: true,
                clientX: actionRect.left + 8,
                clientY: actionRect.top + 8
              }));
              normalActionsButton.focus({ preventScroll: true });
              await sleep(360);
              const visibleTooltips = [...document.querySelectorAll('.orchestrator-tooltip[data-visible="true"]')];
              const visibleHoverCards = [...document.querySelectorAll('[data-testid="session-hover-card"]')];
              const visibleTooltip = visibleTooltips[0];
              tooltipSurfaceReadable = visibleTooltip instanceof HTMLElement && hoverSurfaceReadable(visibleTooltip);
              const tooltipPortalWorks =
                visibleTooltip instanceof HTMLElement &&
                visibleTooltip.parentElement === document.body;
              singleHoverSurfaceWorks =
                visibleTooltips.length === 1 &&
                visibleHoverCards.length === 0 &&
                tooltipPortalWorks;
              window.dispatchEvent(new Event('resize'));
              await sleep(80);
              tooltipDismissesOnViewportChange =
                document.querySelectorAll('.orchestrator-tooltip[data-visible="true"]').length === 0;
              normalActionsButton.blur();
              normalActionsButton.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
              await sleep(80);
            }
            const sidebar = document.querySelector('[data-testid="app-sidebar"]');
            const sidebarScrollContainers = sidebar instanceof HTMLElement
              ? [...sidebar.querySelectorAll('.overflow-y-auto')]
              : [];
            const sidebarNoHorizontalOverflow = sidebar instanceof HTMLElement &&
              getComputedStyle(sidebar).overflowX === 'hidden' &&
              sidebar.scrollWidth <= sidebar.clientWidth + 2 &&
              sidebarScrollContainers.every((element) => (
                element instanceof HTMLElement &&
                getComputedStyle(element).overflowX === 'hidden' &&
                element.scrollWidth <= element.clientWidth + 2
              ));
            const sidebarOverflowDebug = sidebar instanceof HTMLElement
              ? {
                  sidebarClientWidth: sidebar.clientWidth,
                  sidebarScrollWidth: sidebar.scrollWidth,
                  scrollContainers: sidebarScrollContainers.map((element) => ({
                    clientWidth: element instanceof HTMLElement ? element.clientWidth : 0,
                    scrollWidth: element instanceof HTMLElement ? element.scrollWidth : 0,
                    overflowX: element instanceof HTMLElement ? getComputedStyle(element).overflowX : null
                  }))
                }
              : null;
            const sessionRowsCompact = [...document.querySelectorAll('[data-testid="session-row"]')]
              .filter((row) => row instanceof HTMLElement)
              .every((row) => row.getBoundingClientRect().height <= 28);
            const projectHeadersCompact = [...document.querySelectorAll('[data-testid="project-section-header"]')]
              .filter((header) => header instanceof HTMLElement)
              .every((header) => header.getBoundingClientRect().height <= 24);
            const emptyProjectNewChatRows = [...document.querySelectorAll('[data-testid="project-empty-new-chat"]')]
              .filter((row) => row instanceof HTMLElement);
            const emptyProjectNewChatCompact =
              emptyProjectNewChatRows.length > 0 &&
              emptyProjectNewChatRows.every((row) => (
                row.getBoundingClientRect().height <= 28 &&
                row.textContent?.trim() === 'New Chat' &&
                row.querySelector('svg') instanceof SVGElement
              ));
            const sidebarProjectsHeader = document.querySelector('[data-testid="sidebar-projects-header"]');
            const sidebarProjectActionButtons = sidebarProjectsHeader instanceof HTMLElement
              ? [...sidebarProjectsHeader.querySelectorAll('.motion-icon-button')]
              : [];
            const sidebarSectionChromeCompact =
              sidebarProjectsHeader instanceof HTMLElement &&
              sidebarProjectsHeader.getBoundingClientRect().height <= 30 &&
              sidebarProjectActionButtons.length === 2 &&
              sidebarProjectActionButtons.every((button) => (
                button instanceof HTMLElement &&
                button.getBoundingClientRect().width <= 26 &&
                button.getBoundingClientRect().height <= 26
              ));
            const idleRowRecencyHidden =
              normalRow instanceof HTMLElement &&
              !normalRow.innerText.includes('now') &&
              !normalRow.innerText.includes('m ago');
            const runningRowForMeta = rowFor('Sidebar running');
            const errorRowForMeta = rowFor('Sidebar error');
            const errorRowStatusDot = errorRowForMeta instanceof HTMLElement
              ? errorRowForMeta.querySelector('[data-testid="session-status-dot"]')
              : null;
            const importantRowStatusIconOnly =
              Boolean(runningRowForMeta instanceof HTMLElement && runningRowForMeta.querySelector('[data-testid="session-status-spinner"]')) &&
              Boolean(errorRowStatusDot instanceof HTMLElement && (errorRowStatusDot.getAttribute('aria-label') ?? '').trim()) &&
              ![runningRowForMeta, errorRowForMeta].some((row) => row instanceof HTMLElement && row.querySelector('.session-row-right-meta'));
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
                .find((button) => buttonLabel(button) === 'Project actions') : null;
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
            const organizeButton = findButton('Organize sidebar');
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
            const customTooltipNativeTitleLeaks =
              [...document.querySelectorAll('button[data-tooltip-label][title]')]
                .map((button) => (button.getAttribute('data-tooltip-label') ?? '') + ':' + (button.getAttribute('title') ?? ''));
            const nativeTitleFreeControlLeaks =
              [...document.querySelectorAll('[data-native-title-free][title]')]
                .map((element) => (element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName) + ':' + (element.getAttribute('title') ?? ''));
            return {
              pinnedAboveProjects,
              pinnedOrderStable,
              pinnedRowsHiddenFromProjects,
              pinnedRowUnpinned,
              newPinAppended,
              hoverPinVisible,
              hoverCardVisible,
              hoverCardSurfaceReadable,
              tooltipSurfaceReadable,
              singleHoverSurfaceWorks,
              tooltipDismissesOnViewportChange,
              customTooltipNativeTitlesAbsent: customTooltipNativeTitleLeaks.length === 0,
              customTooltipNativeTitleLeaks,
              nativeTitleFreeControlsWork: nativeTitleFreeControlLeaks.length === 0,
              nativeTitleFreeControlLeaks,
              sidebarNoHorizontalOverflow,
              sidebarOverflowDebug,
              sessionRowsCompact,
              projectHeadersCompact,
              emptyProjectNewChatCompact,
              sidebarSectionChromeCompact,
              idleRowRecencyHidden,
              importantRowStatusIconOnly,
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
            const buttonLabel = (button) =>
              button.getAttribute('aria-label') ??
              button.getAttribute('data-tooltip-label') ??
              button.getAttribute('title') ??
              button.textContent?.trim() ??
              '';
            const findButton = (label) =>
              [...document.querySelectorAll('button')]
                .find((button) => buttonLabel(button) === label);
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

            const sidebarButton = findButton('Toggle sidebar');
            sidebarButton?.click();
            await sleep(120);
            const rightPanel = document.querySelector('[data-motion-panel="right"]');
            const rightPanelDurations = rightPanel ? getComputedStyle(rightPanel).transitionDuration.split(',').map((value) => value.trim()) : [];

            const terminalButton = findButton('Toggle terminal');
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
  } else if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'plan') {
    seedAutomatedPlanSmokeSession(session.id)
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

function seedAutomatedPlanSmokeSession(sessionId: string): void {
  const session = sessionManager.get(sessionId)
  if (!session) return
  const now = Date.now()
  const longGoal = [
    'Goal: Keep the right sidebar calm and useful.',
    'This hidden sentence should only appear after expanding the full objective.',
    'Continue reducing clutter while preserving provider-neutral behavior and strong verification.'
  ].join(' ')
  const messages: ChatMessage[] = [
    {
      id: 'plan-smoke-goal',
      role: 'system',
      type: 'result',
      content: `${longGoal} (active) · 12,345 tokens · 3m`,
      subtype: 'status',
      timestamp: now
    },
    {
      id: 'plan-smoke-todos',
      role: 'assistant',
      type: 'tool_use',
      toolName: 'TodoWrite',
      toolInput: {
        todos: [
          { id: '1', content: 'Inspect Codex sidebar behavior', status: 'completed' },
          { id: '2', content: 'Reduce Plan panel verbosity', status: 'in_progress' },
          { id: '3', content: 'Verify non-foreground smoke coverage', status: 'pending' }
        ]
      },
      timestamp: now + 1
    },
    {
      id: 'plan-smoke-agent',
      role: 'assistant',
      type: 'tool_use',
      toolName: 'Task',
      toolInput: {
        description: 'Inspect right sidebar polish',
        prompt: 'Compare the right sidebar against Codex density and label treatment.'
      },
      timestamp: now + 2
    }
  ]
  sessionManager.save({
    ...session,
    name: 'Plan panel smoke',
    messages: [
      ...session.messages.filter((message) => !message.id.startsWith('plan-smoke-')),
      ...messages
    ]
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
