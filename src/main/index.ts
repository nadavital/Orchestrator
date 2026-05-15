import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { electronApp, is } from '@electron-toolkit/utils'
import { configureAppProfile, getAppProfile } from './appProfile'
import type { ChatMessage } from '../types'

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
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'pet-overlay') {
    runAutomatedPetOverlaySmoke(win, outputPath, screenshotPath)
    return
  }
  if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'session-switch') {
    runAutomatedSessionSwitchSmoke(win, outputPath, screenshotPath)
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
          if (textarea && ${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} !== 'composer') {
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
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'capabilities') {
            const createButton = [...document.querySelectorAll('button')]
              .find((button) => button.textContent?.trim() === 'Create');
            createButton?.click();
            await sleep(120);
            var capabilityMenuOpened = Boolean(document.querySelector('.cap-create-menu [role="menu"]'));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(120);
            var capabilityMenuClosedWithEscape = !document.querySelector('.cap-create-menu [role="menu"]');
            createButton?.click();
            await sleep(120);
            const skillMenuItem = [...document.querySelectorAll('[role="menuitem"]')]
              .find((button) => button.textContent?.includes('Skill'));
            skillMenuItem?.click();
            await sleep(180);
            var capabilitySheetOpened = Boolean(document.querySelector('.motion-sheet'));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(120);
            var capabilitySheetClosedWithEscape = !document.querySelector('.motion-sheet');
          }
          if (${JSON.stringify(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW)} === 'composer') {
            const permissionButton = document.querySelector('[data-testid="composer-permission-menu"]');
            permissionButton?.click();
            await sleep(140);
            var composerPermissionMenuOpened = Boolean(document.querySelector('.motion-popover-surface'));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await sleep(140);
            var composerPermissionMenuClosedWithEscape = !document.querySelector('.motion-popover-surface');

            const agentButton = document.querySelector('[data-testid="composer-agent-menu"]');
            agentButton?.click();
            await sleep(140);
            var composerAgentMenuOpened = Boolean(document.querySelector('.motion-popover-surface'));
            document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 1, clientY: 1 }));
            await sleep(140);
            var composerAgentMenuClosedWithOutsideClick = !document.querySelector('.motion-popover-surface');
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
            hasSideQuestionCommandText: bodyText.includes('/btw') || Boolean(textarea && textarea.value.includes('/btw')),
            capabilityMenuOpened: typeof capabilityMenuOpened === 'boolean' ? capabilityMenuOpened : null,
            capabilityMenuClosedWithEscape: typeof capabilityMenuClosedWithEscape === 'boolean' ? capabilityMenuClosedWithEscape : null,
            capabilitySheetOpened: typeof capabilitySheetOpened === 'boolean' ? capabilitySheetOpened : null,
            capabilitySheetClosedWithEscape: typeof capabilitySheetClosedWithEscape === 'boolean' ? capabilitySheetClosedWithEscape : null,
            composerPermissionMenuOpened: typeof composerPermissionMenuOpened === 'boolean' ? composerPermissionMenuOpened : null,
            composerPermissionMenuClosedWithEscape: typeof composerPermissionMenuClosedWithEscape === 'boolean' ? composerPermissionMenuClosedWithEscape : null,
            composerAgentMenuOpened: typeof composerAgentMenuOpened === 'boolean' ? composerAgentMenuOpened : null,
            composerAgentMenuClosedWithOutsideClick: typeof composerAgentMenuClosedWithOutsideClick === 'boolean' ? composerAgentMenuClosedWithOutsideClick : null,
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

        win.webContents.send('pet:navigate', first.id)
        await new Promise((resolve) => setTimeout(resolve, 250))
        const before = await win.webContents.executeJavaScript(`
          (() => ({
            firstTranscriptFound: document.body.innerText.includes('SESSION_SWITCH_SMOKE_ONE'),
            sessionViewAnimated: document.querySelector('[data-motion-view="session"]')?.classList.contains('motion-view-animated') ?? null
          }))()
        `)

        await win.webContents.executeJavaScript('window.__orchestratorSessionSwitchStart = performance.now()')
        win.webContents.send('pet:navigate', second.id)
        const after = await win.webContents.executeJavaScript(`
          (async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            for (let index = 0; index < 30; index += 1) {
              if (document.body.innerText.includes('SESSION_SWITCH_SMOKE_TWO')) break;
              await sleep(10);
            }
            return {
              secondTranscriptFound: document.body.innerText.includes('SESSION_SWITCH_SMOKE_TWO'),
              switchElapsedMs: performance.now() - window.__orchestratorSessionSwitchStart,
              sessionViewAnimated: document.querySelector('[data-motion-view="session"]')?.classList.contains('motion-view-animated') ?? null
            };
          })()
        `)

        if (screenshotPath) {
          const image = await win.webContents.capturePage()
          writeFileSync(screenshotPath, image.toPNG())
        }
        writeFileSync(outputPath, JSON.stringify({ ok: true, result: { profile, ...before, ...after }, screenshotPath }, null, 2))
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
        if (session) sessionManager.updateStatus(session.id, 'waiting_for_user')
        await new Promise((resolve) => setTimeout(resolve, 900))

        const result = await overlayWindow.webContents.executeJavaScript(`
          (() => {
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
            const viewport = { width: window.innerWidth, height: window.innerHeight };
            const badge = rectFor('[data-testid="avatar-overlay-notification-badge"]');
            const tray = rectFor('[data-avatar-overlay-size="notification-tray"]');
            const mascot = rectFor('[data-avatar-mascot="true"]');
            const tolerance = 3;
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
              overlayFound: true,
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
              bodyText: document.body.innerText
            };
          })()
        `)

        if (screenshotPath) {
          const image = await overlayWindow.webContents.capturePage()
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
  } else if (process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW === 'session-switch') {
    await seedAutomatedSessionSwitchSmokeSessions(project.id, project.rootPath)
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
  sessionManager.appendMessage(session.id, [{
    id: `${marker.toLowerCase()}-assistant`,
    role: 'assistant',
    type: 'text',
    content: `${marker}: seeded transcript content for immediate chat switching.`,
    timestamp: Date.now()
  }])
  return sessionManager.get(session.id) ?? session
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
