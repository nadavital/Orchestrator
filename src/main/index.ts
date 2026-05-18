import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { electronApp, is } from '@electron-toolkit/utils'
import { configureAppProfile, getAppProfile } from './appProfile'
import type { ChatMessage } from '../types'

const appProfile = configureAppProfile()

let registerIpcHandlers: typeof import('./ipc').registerIpcHandlers
let createPetOverlayWindow: typeof import('./petOverlay').createPetOverlayWindow
let destroyPetOverlayWindow: typeof import('./petOverlay').destroyPetOverlayWindow
let setCreateMainWindowCallback: typeof import('./petOverlay').setCreateMainWindowCallback
let projectStore: typeof import('./projects').projectStore
let sessionManager: typeof import('./sessions').sessionManager

let mainWindow: BrowserWindow | null = null

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
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'motion-reduced') {
    runAutomatedReducedMotionSmoke(win, outputPath, screenshotPath)
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
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'settings' || ${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'pets') {
            const settingsButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.trim() === 'Settings' || button.getAttribute('title') === 'Settings');
            settingsButton?.click();
            await sleep(450);
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
            hasInspectorTabs: bodyText.includes('Changes') && !bodyText.includes('Usage') && !bodyText.includes('Plan') && !bodyText.includes('Agents'),
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
              if (loadEarlierText.includes('381 earlier')) {
                fullHydratedAfterSwitch = true;
                break;
              }
              await sleep(10);
            }
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
            return {
              secondTranscriptFound: transcriptText.includes('SESSION_SWITCH_SMOKE_TWO'),
              secondTitleFound: document.querySelector('[data-testid="active-session-title"]')?.textContent?.includes(${JSON.stringify(second.name)}) ?? false,
              longHistoryDeferred: Boolean(document.querySelector('[data-testid="load-earlier-messages"]')),
              fullHydratedAfterSwitch,
              transcriptSearchFound,
              renderedMessages: window.__orchestratorSessionSwitchLastPerf?.renderedMessages ?? null,
              messageCount: window.__orchestratorSessionSwitchLastPerf?.messageCount ?? null,
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
            const recentIndex = bodyText.indexOf('Sidebar pinned recent');
            const olderIndex = bodyText.indexOf('Sidebar pinned older');
            const pinnedAboveProjects = pinnedIndex >= 0 && projectsIndex >= 0 && pinnedIndex < projectsIndex;
            const pinnedRecentFirst = recentIndex >= 0 && olderIndex >= 0 && recentIndex < olderIndex && recentIndex < projectsIndex;
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
            await sleep(160);
            const hoverPinVisible = normalPin instanceof HTMLElement &&
              Number.parseFloat(getComputedStyle(normalPin).opacity || '0') > 0.5;

            let doubleClickRenameWorks = false;
            if (normalRow instanceof HTMLElement) {
              normalRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
              await sleep(120);
              const input = document.querySelector('input');
              if (input instanceof HTMLInputElement) {
                const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')?.set;
                setter?.call(input, 'Sidebar renamed by smoke');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                doubleClickRenameWorks = Boolean(await waitForRow('Sidebar renamed by smoke'));
              }
            }

            const unreadRow = await waitForRow('Sidebar unread idle');
            const errorRow = await waitForRow('Sidebar error');
            const runningRow = await waitForRow('Sidebar running');
            const allDots = [...document.querySelectorAll('[data-testid="session-status-dot"]')];
            return {
              pinnedAboveProjects,
              pinnedRecentFirst,
              pinnedRowsHiddenFromProjects,
              pinnedRowUnpinned,
              hoverPinVisible,
              doubleClickRenameWorks,
              runningSpinnerVisible: Boolean(runningRow?.querySelector('[data-testid="session-status-spinner"]')),
              normalIdleDotHidden: !normalRow?.querySelector('[data-testid="session-status-dot"]'),
              unreadIdleDotVisible: Boolean(unreadRow?.querySelector('[data-testid="session-status-dot"]')),
              errorDotVisible: Boolean(errorRow?.querySelector('[data-testid="session-status-dot"]')),
              grayIdleDotsAbsent: allDots.length === 2,
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
        win.setSize(860, 720)
        const profile = getAppProfile()
        const session = sessionManager.list().find((candidate) => candidate.name === 'Transcript layout smoke')
        if (session) {
          win.webContents.send('pet:navigate', session.id)
          await new Promise((resolve) => setTimeout(resolve, 180))
        }
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
              key: 'f',
              code: 'KeyF',
              metaKey: true,
              bubbles: true,
              cancelable: true
            }));
            await sleep(80);
            const search = document.querySelector('[data-testid="transcript-search"]');
            const searchShortcutOpens = search instanceof HTMLInputElement && document.activeElement === search;

            const scroller = document.querySelector('[data-testid="transcript-scroll"]');
            if (!scroller) {
              return { transcriptFound: false, layoutFixtureVisible, bodyText: document.body.innerText };
            }

            const viewportWidth = document.documentElement.clientWidth;
            const docScrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
            const documentNoHorizontalOverflow = docScrollWidth <= viewportWidth + 2;
            const transcriptNoHorizontalOverflow = scroller.scrollWidth <= scroller.clientWidth + 2;
            const scrollerRect = scroller.getBoundingClientRect();
            const isInsideScroller = (element) => {
              const rect = element.getBoundingClientRect();
              return rect.left >= scrollerRect.left - 2 && rect.right <= scrollerRect.right + 2;
            };

            const messageRows = [...document.querySelectorAll('[data-message-id]')];
            const pre = document.querySelector('pre');
            const table = document.querySelector('table');
            const fileCards = [...document.querySelectorAll('[data-testid="file-reference-card"]')];
            const toolSummary = document.querySelector('[data-testid="tool-activity-summary"]');
            const toolButton = toolSummary?.querySelector('.motion-disclosure-trigger');
            if (toolButton instanceof HTMLElement && toolButton.getAttribute('aria-expanded') !== 'true') {
              toolButton.click();
            }
            await sleep(160);
            const toolBody = document.querySelector('[data-testid="tool-activity-body"]');
            const expandedDocScrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);

            return {
              transcriptFound: true,
              layoutFixtureVisible,
              searchHiddenInitially,
              searchShortcutOpens,
              documentNoHorizontalOverflow,
              transcriptNoHorizontalOverflow,
              messageRowsBounded: messageRows.length > 0 && messageRows.every(isInsideScroller),
              codeBlockBounded: pre instanceof HTMLElement && isInsideScroller(pre),
              codeBlockInternallyScrollable: pre instanceof HTMLElement && pre.scrollWidth > pre.clientWidth + 24,
              tableBounded: table instanceof HTMLElement && isInsideScroller(table),
              fileCardsBounded: fileCards.length > 0 && fileCards.every(isInsideScroller),
              toolSummaryExpanded: toolButton instanceof HTMLElement && toolButton.getAttribute('aria-expanded') === 'true' && Boolean(toolBody),
              toolSummaryBounded: toolBody instanceof HTMLElement && isInsideScroller(toolBody) && toolBody.clientHeight <= 240,
              toolSummaryScrollable: toolBody instanceof HTMLElement && toolBody.scrollHeight > toolBody.clientHeight + 24,
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
              if (mascot instanceof HTMLElement) {
                const rect = mascot.getBoundingClientRect();
                const eventInit = {
                  bubbles: true,
                  clientX: rect.right - 10,
                  clientY: rect.bottom - 10,
                  pointerType: 'mouse'
                };
                mascot.dispatchEvent(new PointerEvent('pointerover', eventInit));
                mascot.dispatchEvent(new PointerEvent('pointerenter', { ...eventInit, bubbles: false }));
                mascot.dispatchEvent(new MouseEvent('mouseover', eventInit));
                mascot.dispatchEvent(new MouseEvent('mouseenter', { ...eventInit, bubbles: false }));
              }
              await sleep(140);
              const hoverOpacity = grip ? Number.parseFloat(getComputedStyle(grip).opacity || '0') : 0;
              if (handle instanceof HTMLElement) handle.focus({ preventScroll: true });
              await sleep(80);
              const focusOpacity = grip ? Number.parseFloat(getComputedStyle(grip).opacity || '0') : 0;
              return {
                resizeHandleFound: handle instanceof HTMLElement,
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
            scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 360);
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
            const jump = document.querySelector('[data-testid="jump-to-latest"]');
            const jumpVisibleAfterUpdate = Boolean(jump);
            jump?.click();
            await sleep(180);
            const finalBottomDistance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
            return {
              transcriptFound: true,
              afterScrollTop,
              afterScrollHeight,
              afterClientHeight,
              jumpVisibleAfterUpdate,
              finalScrollTop: scroller.scrollTop,
              finalBottomDistance,
              jumpVisibleAfterClick: Boolean(document.querySelector('[data-testid="jump-to-latest"]'))
            };
          })()
        `)

        const result = {
          ...before,
          ...after,
          scrollStayedPut: Boolean(before?.transcriptFound && after?.transcriptFound) &&
            Math.abs((after.afterScrollTop ?? 0) - (before.beforeScrollTop ?? 0)) <= 8,
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

app.whenReady().then(async () => {
  ;({ registerIpcHandlers } = await import('./ipc'))
  ;({ createPetOverlayWindow, destroyPetOverlayWindow, setCreateMainWindowCallback } = await import('./petOverlay'))
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

app.on('before-quit', () => {
  destroyPetOverlayWindow?.()
})

async function bootstrapAutomatedUiSmokeState(): Promise<void> {
  if (!process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT) return
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
        `Referenced fixture: \`${longPath}\``
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
  const fixtures: Array<{
    name: string
    pinned: boolean
    status: ReturnType<typeof sessionManager.list>[number]['status']
    offset: number
  }> = [
    { name: 'Sidebar pinned older', pinned: true, status: 'idle', offset: 1 },
    { name: 'Sidebar pinned recent', pinned: true, status: 'idle', offset: 5 },
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
