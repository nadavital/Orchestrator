#!/usr/bin/env node
import { spawn, spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { prepareMacSmokeBundle } from './lib/packaged-smoke-bundle.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const captureView = process.argv.includes('--settings-providers')
  ? 'settings-providers'
  : process.argv.includes('--settings')
  ? 'settings'
  : process.argv.includes('--capabilities')
    ? 'capabilities'
    : process.argv.includes('--resources')
    ? 'resources'
      : process.argv.includes('--composer')
        ? 'composer'
      : process.argv.includes('--pets')
        ? 'pets'
      : process.argv.includes('--header')
        ? 'header'
      : process.argv.includes('--right-panel')
        ? 'right-panel'
      : process.argv.includes('--diff')
        ? 'diff'
      : process.argv.includes('--files')
        ? 'files'
      : process.argv.includes('--side-chat')
        ? 'side-chat'
      : process.argv.includes('--motion-reduced')
          ? 'motion-reduced'
        : process.argv.includes('--empty-state')
          ? 'empty-state'
        : process.argv.includes('--pet-overlay')
          ? 'pet-overlay'
          : process.argv.includes('--sidebar')
            ? 'sidebar'
            : process.argv.includes('--transcript-layout')
              ? 'transcript-layout'
              : process.argv.includes('--transcript-stress')
                ? 'transcript-stress'
                : process.argv.includes('--session-switch')
                  ? 'session-switch'
                  : process.argv.includes('--extensions')
                    ? 'extensions'
                    : process.argv.includes('--design-system')
                      ? 'design-system'
                      : process.argv.includes('--scroll')
                        ? 'scroll'
                        : process.argv.includes('--browser')
                          ? 'browser'
                          : process.argv.includes('--plan')
                            ? 'plan'
                          : process.argv.includes('--inspector')
                            ? 'inspector'
                            : process.argv.includes('--terminal')
                              ? 'terminal'
                              : 'main'
const runPackaged = process.argv.includes('--packaged')
const foregroundSmoke = process.argv.includes('--foreground') ||
  process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_FOREGROUND === '1'
const profile = 'automated-ui-smoke'
const userDataDir = join(tmpdir(), 'orchestrator-profiles', `${profile}-${captureView}`)
const workspaceDir = join(tmpdir(), 'orchestrator-automated-ui-workspace')
const outputPath = join(tmpdir(), `orchestrator-automated-ui-smoke-${captureView}-${Date.now()}.json`)
const screenshotPath = join(tmpdir(), `orchestrator-automated-ui-smoke-${captureView}-${Date.now()}.png`)
let browserSmokeServer = null
let browserSmokeUrl = ''

rmSync(userDataDir, { recursive: true, force: true })
mkdirSync(userDataDir, { recursive: true })
mkdirSync(workspaceDir, { recursive: true })

if (captureView === 'capabilities') {
  const smokeSkillDir = join(workspaceDir, '.claude', 'skills', 'orchestrator-smoke-skill')
  const smokeCommandDir = join(workspaceDir, '.claude', 'commands')
  mkdirSync(smokeSkillDir, { recursive: true })
  mkdirSync(smokeCommandDir, { recursive: true })
  writeFileSync(join(workspaceDir, 'AGENTS.md'), '# Automated UI smoke\n\nProject instruction fixture.\n')
  writeFileSync(join(smokeSkillDir, 'SKILL.md'), '# Orchestrator Smoke Skill\n\nA deterministic fixture used by UI smoke tests.\n')
  writeFileSync(join(smokeCommandDir, 'orchestrator-smoke.md'), '# Orchestrator smoke command\n\nRun the smoke fixture.\n')
}

function createDocxFixture(paragraphs) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.map((paragraph) => `<w:p><w:r><w:t>${escapeXml(paragraph)}</w:t></w:r></w:p>`).join('\n    ')}
  </w:body>
</w:document>`
  return createStoredZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    },
    { name: 'word/document.xml', data: documentXml }
  ])
}

function createStoredZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    const crc = crc32(data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localParts.push(localHeader, name, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)
    offset += localHeader.length + name.length + data.length
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

if (['inspector', 'right-panel', 'diff', 'files', 'side-chat', 'browser'].includes(captureView)) {
  mkdirSync(join(workspaceDir, 'Nested Folder'), { recursive: true })
  writeFileSync(join(workspaceDir, 'review-base.txt'), 'before review\n')
  writeFileSync(join(workspaceDir, 'review-delete.txt'), 'delete me\n')
  writeFileSync(join(workspaceDir, 'Nested Folder', 'nested note.md'), '# Nested file smoke preview\n\nThis verifies spaces in paths.\n')
  writeFileSync(join(workspaceDir, 'preview-page.html'), '<!doctype html><main><h1>HTML preview smoke</h1><p>Rendered in the file inspector.</p></main>\n')
  writeFileSync(join(workspaceDir, 'data-preview-smoke.json'), JSON.stringify({ status: 'baseline', items: [{ name: 'alpha', count: 1 }] }, null, 2))
  writeFileSync(join(workspaceDir, 'table-preview-smoke.csv'), 'name,count,status\nalpha,1,baseline\n')
  writeFileSync(join(workspaceDir, 'document-preview-smoke.docx'), createDocxFixture([
    'Document smoke baseline',
    'This verifies DOCX text preview in the inspector.'
  ]))
  writeFileSync(join(workspaceDir, 'notebook-preview-smoke.ipynb'), JSON.stringify({
    cells: [
      { cell_type: 'markdown', source: ['# Notebook smoke\n', 'Baseline'] },
      { cell_type: 'code', source: ['value = 1\n', 'value'] }
    ],
    metadata: { kernelspec: { display_name: 'Python 3' } },
    nbformat: 4,
    nbformat_minor: 5
  }, null, 2))
  writeFileSync(join(workspaceDir, 'binary-preview-smoke.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 255]))
  spawnSync('git', ['init'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'orchestrator-smoke@example.test'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'Orchestrator Smoke'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['add', '.'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['commit', '-m', 'baseline'], { cwd: workspaceDir, stdio: 'ignore' })
  writeFileSync(join(workspaceDir, 'review-base.txt'), 'before review\nafter review\n')
  writeFileSync(join(workspaceDir, 'review-new.txt'), 'new review file\n')
  writeFileSync(join(workspaceDir, 'data-preview-smoke.json'), JSON.stringify({ status: 'updated', items: [{ name: 'alpha', count: 2 }, { name: 'beta', count: 3 }] }, null, 2))
  writeFileSync(join(workspaceDir, 'table-preview-smoke.csv'), 'name,count,status\nalpha,2,updated\nbeta,3,new\n')
  writeFileSync(join(workspaceDir, 'document-preview-smoke.docx'), createDocxFixture([
    'Document smoke updated',
    'This verifies DOCX text preview in the inspector.'
  ]))
  writeFileSync(join(workspaceDir, 'notebook-preview-smoke.ipynb'), JSON.stringify({
    cells: [
      { cell_type: 'markdown', source: ['# Notebook smoke\n', 'Updated'] },
      { cell_type: 'code', source: ['value = 2\n', 'value'] },
      { cell_type: 'markdown', source: ['Summary cell'] }
    ],
    metadata: { kernelspec: { display_name: 'Python 3' } },
    nbformat: 4,
    nbformat_minor: 5
  }, null, 2))
  writeFileSync(join(workspaceDir, 'binary-preview-smoke.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 255]))
  rmSync(join(workspaceDir, 'review-delete.txt'), { force: true })
  browserSmokeServer = createServer((request, response) => {
    if (request.url === '/smoke.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
      response.end('main{font-family:system-ui;color:#102030}.asset-smoke{background:#f4f8ff}')
      return
    }
    if (request.url === '/slow') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><title>Slow smoke</title><main>Slow browser smoke page</main>')
      }, 2500)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html>
      <title>Orchestrator Browser Smoke</title>
      <link rel="stylesheet" href="/smoke.css">
      <main class="asset-smoke">
        <h1>Browser smoke page</h1>
        <p>Loaded inside the side panel.</p>
        <p>Browser search has a second visible match.</p>
        <button id="target-button" onclick="document.body.dataset.clicked='yes'; console.log('browser smoke clicked')">Target button</button>
        <input aria-label="Smoke input" placeholder="Type here" oninput="document.body.dataset.inputValue=this.value" onkeydown="document.body.dataset.keyPressed=event.key">
        <select aria-label="Smoke select" onchange="document.body.dataset.selectedOption=this.value"><option value="alpha">Alpha</option><option value="beta">Beta</option></select>
        <label><input type="checkbox" aria-label="Smoke checkbox" onchange="document.body.dataset.checkedState=this.checked ? 'true' : 'false'"> Check me</label>
        <svg role="img" aria-label="Inline smoke icon" width="18" height="18"><circle cx="9" cy="9" r="8"></circle></svg>
      </main>`)
  })
  await new Promise((resolveServer) => {
    browserSmokeServer.listen(0, '127.0.0.1', resolveServer)
  })
  const address = browserSmokeServer.address()
  if (address && typeof address === 'object') browserSmokeUrl = `http://127.0.0.1:${address.port}`
}

const launch = runPackaged ? packagedLaunchCommand() : {
  bin: process.platform === 'win32' ? 'npm.cmd' : 'npm',
  args: ['run', 'dev']
}

const child = spawn(launch.bin, launch.args, {
  cwd: root,
  env: {
    ...process.env,
    ORCHESTRATOR_PROFILE: profile,
    ORCHESTRATOR_USER_DATA_DIR: userDataDir,
    ORCHESTRATOR_SMOKE_WORKSPACE_DIR: workspaceDir,
    ORCHESTRATOR_DISABLE_PET_OVERLAY: ['pet-overlay', 'motion-reduced'].includes(captureView) ? '0' : '1',
    ORCHESTRATOR_FORCE_REDUCED_MOTION: captureView === 'motion-reduced' ? '1' : process.env.ORCHESTRATOR_FORCE_REDUCED_MOTION,
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_FOREGROUND: foregroundSmoke ? '1' : '0',
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT: outputPath,
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_SCREENSHOT: screenshotPath,
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW: captureView,
    ORCHESTRATOR_BROWSER_SMOKE_URL: browserSmokeUrl
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let log = ''
child.stdout.on('data', (chunk) => { log += chunk.toString() })
child.stderr.on('data', (chunk) => { log += chunk.toString() })

const timeout = setTimeout(() => {
  child.kill('SIGTERM')
  console.error('Automated UI smoke timed out.')
  console.error(log.slice(-4000))
  process.exit(1)
}, 45_000)

child.on('exit', (code) => {
  browserSmokeServer?.close()
  clearTimeout(timeout)
  if (!existsSync(outputPath)) {
    console.error('Automated UI smoke did not produce an output file.')
    console.error(log.slice(-4000))
    process.exit(code ?? 1)
  }

  const report = JSON.parse(readFileSync(outputPath, 'utf8'))
  if (!report.ok) {
    console.error(JSON.stringify(report, null, 2))
    process.exit(1)
  }

  const result = report.result ?? {}
  const browserDeepChecksCoveredByBrowserSmoke = captureView === 'inspector'
  const checks = captureView === 'empty-state'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        noProjects: result.projectCount === 0,
        noSessions: result.sessionCount === 0,
        emptyStateVisible: result.emptyStateVisible === true,
        emptyStateCalm: result.emptyStateCalm === true,
        addProjectActionVisible: result.addProjectActionVisible === true,
        addProjectActionCompact: result.addProjectActionCompact === true,
        importCodexActionVisible: result.importCodexActionVisible === true,
        sidebarEmptyStateVisible: result.sidebarEmptyStateVisible === true,
        sidebarNoHorizontalOverflow: result.sidebarNoHorizontalOverflow === true,
        noStaticSuggestionCards: result.noStaticSuggestionCards === true
      }
    : captureView === 'session-switch'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        firstTranscriptFound: result.firstTranscriptFound === true,
        firstTitleFound: result.firstTitleFound === true,
        secondTranscriptFound: result.secondTranscriptFound === true,
        secondTitleFound: result.secondTitleFound === true,
        summaryTailBounded: result.summaryTailBounded === true,
        longHistoryDeferred: result.longHistoryDeferred === true,
        fullHydratedAfterSwitch: result.fullHydratedAfterSwitch === true,
        autoLazyLoadedEarlier: result.autoLazyLoadedEarlier === true,
        autoLazyAnchorPreserved: result.autoLazyAnchorPreserved === true,
        virtualMountedRowsBounded: Number(result.mountedVirtualRows ?? Number.POSITIVE_INFINITY) <= 36,
        transcriptSearchFound: result.transcriptSearchFound === true,
        renderedWindowBounded: Number(result.renderedMessages ?? Number.POSITIVE_INFINITY) <= 40,
        telemetryRecorded: result.telemetryRecorded === true,
        titleWithinBudget: Number(result.titleElapsedMs ?? Number.POSITIVE_INFINITY) <= 150,
        transcriptWithinBudget: Number(result.switchElapsedMs ?? Number.POSITIVE_INFINITY) <= 900,
        sessionViewNotAnimated: result.sessionViewAnimated === false
      }
    : captureView === 'transcript-stress'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        stressTranscriptFound: result.stressTranscriptFound === true,
        stressMessageCount: Number(result.messageCount ?? 0) >= 2500,
        initialMountedRowsBounded: Number(result.initialMountedRows ?? Number.POSITIVE_INFINITY) <= 48,
        lazyMountedRowsBounded: Number(result.lazyMountedRows ?? Number.POSITIVE_INFINITY) <= 56,
        searchMountedRowsBounded: Number(result.searchMountedRows ?? Number.POSITIVE_INFINITY) <= 56,
        lazyLoadedOlderChunk: result.lazyLoadedOlderChunk === true,
        searchJumpFound: result.searchJumpFound === true,
        stressReadyWithinBudget: Number(result.readyElapsedMs ?? Number.POSITIVE_INFINITY) <= 1400
      }
    : captureView === 'motion-reduced'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        profileForced: result.profile?.forceReducedMotion === true,
        mainReducedDataset: result.mainReducedDataset === true,
        mainPanelDurationZero: result.mainPanelDurationZero === true,
        mainTransitionsZero: result.mainTransitionsZero === true,
        mainAnimationsZero: result.mainAnimationsZero === true,
        mainRightPanelReduced: result.mainRightPanelReduced === true,
        mainBottomPanelReduced: result.mainBottomPanelReduced === true,
        mainPopoverReduced: result.mainPopoverReduced === true,
        mainSheetReduced: result.mainSheetReduced === true,
        overlayFound: result.overlayFound === true,
        overlayReducedDataset: result.overlayReducedDataset === true,
        overlayBadgeTransitionDisabled: result.overlayBadgeTransitionDisabled === true,
        overlayRowTransitionDisabled: result.overlayRowTransitionDisabled === true,
        overlayResizeGripTransitionDisabled: result.overlayResizeGripTransitionDisabled === true,
        trayCollapsedReduced: result.trayCollapsedReduced === true,
        replyFormReduced: result.replyFormReduced === true,
        replyInputReducedTransitionDisabled: result.replyInputReducedTransitionDisabled === true
      }
    : captureView === 'pet-overlay'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        overlayFound: result.overlayFound === true,
        badgeFound: result.badgeFound === true,
        trayFound: result.trayFound === true,
        mascotFound: result.mascotFound === true,
        badgeInsideViewport: result.badgeInsideViewport === true,
        trayAligned: result.trayAligned === true,
        noHorizontalOverflow: result.noHorizontalOverflow === true,
        noVerticalOverflow: result.noVerticalOverflow === true,
        resizeMaxInside: result.resizeMaxInside === true,
        resizeMinInside: result.resizeMinInside === true,
        rowControlsReveal: result.rowControlsReveal === true,
        rowExpandControlVisible: result.rowExpandControlVisible === true,
        rowExpanded: result.rowExpanded === true,
        trayCollapsed: result.trayCollapsed === true,
        trayReopened: result.trayReopened === true,
        resizeHandleFound: result.resizeHandleFound === true,
        resizeHandleCompact: result.resizeHandleCompact === true,
        overlayRootCursorDefault: result.overlayRootCursorDefault === true,
        resizeGripMascotHoverHidden: result.resizeGripMascotHoverHidden === true,
        resizeGripHoverVisible: result.resizeGripHoverVisible === true,
        resizeGripFocusVisible: result.resizeGripFocusVisible === true,
        replyFormOpened: result.replyFormOpened === true,
        replyInputFocused: result.replyInputFocused === true,
        replyFormClosedWithEscape: result.replyFormClosedWithEscape === true,
        permissionActionsVisible: result.permissionActionsVisible === true,
        permissionTitleMapped: result.permissionTitleMapped === true,
        permissionStatusMapped: result.permissionStatusMapped === true,
        runningStatusMapped: result.runningStatusMapped === true,
        runningDismissHidden: result.runningDismissHidden === true,
        reviewStatusMapped: result.reviewStatusMapped === true,
        failedStatusMapped: result.failedStatusMapped === true,
        customProviderStatusMapped: result.customProviderStatusMapped === true
      }
    : captureView === 'scroll'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        transcriptFound: result.transcriptFound === true,
        jumpVisibleBeforeUpdate: result.jumpVisibleBeforeUpdate === true,
        scrollStayedPut: result.scrollStayedPut === true,
        streamingDidNotAutoFollow: result.streamingDidNotAutoFollow === true,
        streamingCursorVisibleDuringUpdate: result.streamingCursorVisibleDuringUpdate === true,
        streamingCursorHiddenAfterComplete: result.streamingCursorHiddenAfterComplete === true,
        finalStreamingTextDeduped: result.finalStreamingTextDeduped === true,
        jumpToLatestReached: result.jumpToLatestReached === true,
        jumpHiddenAfterClick: result.jumpVisibleAfterClick === false
      }
    : captureView === 'sidebar'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        pinnedAboveProjects: result.pinnedAboveProjects === true,
        pinnedOrderStable: result.pinnedOrderStable === true,
        pinnedRowsHiddenFromProjects: result.pinnedRowsHiddenFromProjects === true,
        pinnedRowUnpinned: result.pinnedRowUnpinned === true,
        newPinAppended: result.newPinAppended === true,
        hoverPinVisible: result.hoverPinVisible === true,
        hoverCardDelayed: result.hoverCardDelayed === true,
        hoverCardVisible: result.hoverCardVisible === true,
        hoverCardSurfaceReadable: result.hoverCardSurfaceReadable === true,
        doubleClickRenameWorks: result.doubleClickRenameWorks === true,
        renameDialogCancelWorks: result.renameDialogCancelWorks === true,
        renameDialogChromeQuiet: result.renameDialogChromeQuiet === true,
        renameDialogInputFocused: result.renameDialogInputFocused === true,
        tooltipSurfaceReadable: result.tooltipSurfaceReadable === true,
        singleHoverSurface: result.singleHoverSurfaceWorks === true,
        tooltipDismissesOnViewportChange: result.tooltipDismissesOnViewportChange === true,
        customTooltipNativeTitlesAbsent: result.customTooltipNativeTitlesAbsent === true,
        nativeTitleFreeControls: result.nativeTitleFreeControlsWork === true,
        sidebarNoHorizontalOverflow: result.sidebarNoHorizontalOverflow === true,
        sessionRowsCompact: result.sessionRowsCompact === true,
        projectHeadersCompact: result.projectHeadersCompact === true,
        emptyProjectNewChatCompact: result.emptyProjectNewChatCompact === true,
        sidebarSectionChromeCompact: result.sidebarSectionChromeCompact === true,
        idleRowRecencyVisible: result.idleRowRecencyVisible === true,
        importantRowStatusIconOnly: result.importantRowStatusIconOnly === true,
        chatEnvironmentIconAbsent: result.chatEnvironmentIconAbsent === true,
        actionRenameWorks: result.actionRenameWorks === true,
        runningSpinnerVisible: result.runningSpinnerVisible === true,
        normalIdleDotHidden: result.normalIdleDotHidden === true,
        unreadIdleDotVisible: result.unreadIdleDotVisible === true,
        errorDotVisible: result.errorDotVisible === true,
        pinnedLiveRunningSpinner: result.pinnedLiveRunningSpinner === true,
        pinnedLiveUnreadDot: result.pinnedLiveUnreadDot === true,
        pinnedLiveOrderStable: result.pinnedLiveOrderStable === true,
        grayIdleDotsAbsent: result.grayIdleDotsAbsent === true,
        projectActionMenuWorks: result.projectActionMenuWorks === true,
        projectRenameWorks: result.projectRenameWorks === true,
        projectPinWorks: result.projectPinWorks === true,
        organizeMenuWorks: result.organizeMenuWorks === true
      }
    : captureView === 'transcript-layout'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        transcriptFound: result.transcriptFound === true,
        layoutFixtureVisible: result.layoutFixtureVisible === true,
        searchHiddenInitially: result.searchHiddenInitially === true,
        commandPaletteOpens: result.commandPaletteOpens === true,
        commandPaletteShiftPOpens: result.commandPaletteShiftPOpens === true,
        commandPaletteGrouped: result.commandPaletteGrouped === true,
        commandPaletteRecentVisible: result.commandPaletteRecentVisible === true,
        commandPaletteShortcutLabels: result.commandPaletteShortcutLabels === true,
        commandPaletteFuzzyFindsTerminal: result.commandPaletteFuzzyFindsTerminal === true,
        commandPaletteSearchActionWorks: result.commandPaletteSearchActionWorks === true,
        searchShortcutOpens: result.searchShortcutOpens === true,
        keyboardShortcutsShortcutOpens: result.keyboardShortcutsShortcutOpens === true,
        hiddenMessageCopyQuiet: result.hiddenMessageCopyQuiet === true,
        documentNoHorizontalOverflow: result.documentNoHorizontalOverflow === true,
        transcriptNoHorizontalOverflow: result.transcriptNoHorizontalOverflow === true,
        messageRowsBounded: result.messageRowsBounded === true,
        codeBlockBounded: result.codeBlockBounded === true,
        codeBlockInternallyScrollable: result.codeBlockInternallyScrollable === true,
        tableBounded: result.tableBounded === true,
        tableCellsWrap: result.tableCellsWrap === true,
        rawEventsHiddenFromTranscript: result.rawEventsHiddenFromTranscript === true,
        narrowDocumentNoHorizontalOverflow: result.narrowDocumentNoHorizontalOverflow === true,
        narrowTranscriptNoHorizontalOverflow: result.narrowTranscriptNoHorizontalOverflow === true,
        narrowCodeBlockBounded: result.narrowCodeBlockBounded === true,
        narrowCodeBlockInternallyScrollable: result.narrowCodeBlockInternallyScrollable === true,
        narrowTableBounded: result.narrowTableBounded === true,
        narrowTableCellsWrap: result.narrowTableCellsWrap === true,
        narrowRawEventsHiddenFromTranscript: result.narrowRawEventsHiddenFromTranscript === true,
        fileCardsBounded: result.fileCardsBounded === true,
        relativeProseCardSuppressed: result.relativeProseCardSuppressed === true,
        absoluteMissingFileCardDisabled: result.absoluteMissingFileCardDisabled === true,
        toolSummaryExpanded: result.toolSummaryExpanded === true,
        toolSummaryBounded: result.toolSummaryBounded === true,
        toolSummaryScrollable: result.toolSummaryScrollable === true,
        documentNoHorizontalOverflowAfterExpand: result.documentNoHorizontalOverflowAfterExpand === true
      }
    : captureView === 'design-system'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          designPreview: result.hasDesignSystemPreview === true,
          designContract: result.hasDesignSystemContract === true,
          motionRows: Number(result.motionRowCount ?? 0) >= 3,
          surfaceRows: Number(result.surfaceRowCount ?? 0) >= 3,
          buttons: Number(result.buttonCount ?? 0) > 0
        }
    : captureView === 'browser'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          browserActive: result.browserActive === true,
          browserEmptyState: result.browserEmptyStateWorks === true,
          browserLocalTargets: result.browserLocalTargetsWorks === true,
          browserLocalTargetHide: result.browserLocalTargetHideWorks === true,
          browserAddressSearch: result.browserAddressSearchWorks === true,
          browserAddressBadge: result.browserAddressBadgeWorks === true,
          browserToolbarExternal: result.browserToolbarExternalWorks === true,
          browserToolbarScreenshot: result.browserToolbarScreenshotWorks === true,
          browserLoaded: result.browserLoaded === true,
          browserFind: result.browserFindWorks === true,
          browserFindNavigation: result.browserFindNavigationWorks === true,
          browserZoom: result.browserZoomWorks === true,
          browserDeviceMode: result.browserDeviceModeWorks === true,
          browserDevicePresetCatalog: result.browserDevicePresetCatalogWorks === true,
          browserViewportReset: result.browserViewportResetWorks === true,
          browserCacheReload: result.browserCacheReloadWorks === true,
          browserStopLoading: result.browserStopLoadingWorks === true,
          browserToolbarHistory: result.browserToolbarHistoryWorks === true,
          browserHistoryMenu: result.browserHistoryMenuWorks === true,
          browserActionsMenuCompact: result.browserActionsMenuCompactWorks === true,
          browserActionLabelsCalm: result.browserActionLabelsCalm === true,
          browserClearData: result.browserClearDataWorks === true,
          browserContextMenu: result.browserContextMenuWorks === true,
          browserContextComposer: result.browserContextComposerWorks === true,
          browserDomPaneCompact: result.browserDomPaneCompactWorks === true,
          browserTargetsPane: result.browserTargetsPaneWorks === true,
          browserTargetKey: result.browserTargetKeyWorks === true,
          browserTargetFill: result.browserTargetFillWorks === true,
          browserTargetType: result.browserTargetTypeWorks === true,
          browserTargetState: result.browserTargetStateWorks === true,
          browserTargetSelect: result.browserTargetSelectWorks === true,
          browserTargetCheck: result.browserTargetCheckWorks === true,
          browserTargetsPaneNoHorizontalOverflow: result.browserTargetsPaneNoHorizontalOverflowWorks === true,
          browserErrorRecovery: result.browserErrorRecoveryWorks === true,
          browserLoadErrorPanel: result.browserLoadErrorPanelWorks === true,
          browserSingleTabChrome: result.browserSingleTabStripHidden === true,
          browserToolbarCompact: result.browserToolbarCompact === true,
          browserInspectorChromeCompact: result.browserInspectorChromeCompactWorks === true,
          browserInspectorLabelsCalm: result.browserInspectorLabelsCalm === true,
          browserVisibilityControl: result.browserVisibilityControlWorks === true,
          browserHiddenState: result.browserHiddenStateWorks === true,
          browserStatusRowQuiet: result.browserStatusRowQuiet === true,
          browserNoHorizontalOverflow: result.browserNoHorizontalOverflow === true,
          smokeWindowPolicy: foregroundSmoke
            ? result.smokeWindow?.foregroundAllowed === true
            : result.smokeWindow?.foregroundAllowed === false &&
              result.smokeWindow?.focused === false &&
              result.smokeWindow?.visible === true
        }
    : captureView === 'header'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          composer: result.hasComposer === true,
          headerIdentity: result.headerIdentityWorks === true,
          headerNativeTooltips: result.headerNativeTooltipsWork === true,
          titlebarSidebarToggle: result.titlebarSidebarToggleWorks === true,
          headerActionMenu: result.headerActionMenuWorks === true
        }
    : captureView === 'right-panel'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          rightPanelState: result.hasRightPanelState === true,
          rightSidebarChromeCompact: result.rightSidebarChromeCompactWorks === true,
          rightSidebarAddControlStable: result.rightSidebarAddControlStableWorks === true,
          rightPanelExpand: result.rightPanelExpandWorks === true,
          rightPanelNarrowOverlay: result.rightPanelNarrowOverlayWorks === true,
          rightPanelContextMenuWorks: result.rightPanelContextMenuWorks === true,
          rightPanelTabReorderWorks: result.rightPanelTabReorderWorks === true
        }
    : captureView === 'diff'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          diffToolbarCompact: result.diffToolbarCompactWorks === true,
          diffListCompact: result.diffListCompactWorks === true,
          diffActionMenuCompact: result.diffActionMenuCompactWorks === true,
          reviewSearch: result.reviewSearchWorks === true,
          reviewSearchClear: result.reviewSearchClearWorks === true,
          reviewDiffFirst: result.reviewDiffFirstWorks === true,
          reviewJsonPreview: result.reviewJsonPreviewWorks === true,
          reviewBinaryState: result.reviewBinaryStateWorks === true,
          reviewBinaryActions: result.reviewBinaryActionsWork === true
        }
    : captureView === 'files'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          filesToolbarCompact: result.filesToolbarCompactWorks === true,
          filesActionMenuCompact: result.filesActionMenuCompactWorks === true,
          filesPanelStacked: result.filesPanelStackedWorks === true,
          filesTabSearch: result.filesTabSearchWorks === true,
          filesTabAttach: result.filesTabAttachWorks === true,
          filesHtmlPreview: result.filesHtmlPreviewWorks === true,
          filesJsonPreview: result.filesJsonPreviewWorks === true,
          filesCsvPreview: result.filesCsvPreviewWorks === true,
          filesDocumentPreview: result.filesDocumentPreviewWorks === true,
          filesNotebookPreview: result.filesNotebookPreviewWorks === true,
          filesBinaryPreview: result.filesBinaryPreviewWorks === true,
          filesNoResults: result.filesNoResultsWorks === true,
          filesSearchClear: result.filesSearchClearWorks === true
        }
    : captureView === 'side-chat'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          sideChatTabs: result.sideChatTabsWork === true,
          sideChatComposerCompact: result.sideChatComposerCompactWorks === true,
          sideChatDraftPersistence: result.sideChatDraftPersistenceWorks === true,
          sideChatMessageLabelsCalm: result.sideChatMessageLabelsCalm === true,
          sideChatClose: result.sideChatCloseWorks === true
        }
    : {
        isolatedProfile: result.profile?.isIsolated === true,
        profileBadge: ['settings', 'settings-providers', 'resources', 'capabilities', 'pets'].includes(captureView) || result.hasProfileBadge === true,
        composer: result.hasComposer === true,
        sidebarNavigation: ['settings', 'settings-providers', 'capabilities', 'pets'].includes(captureView) || result.hasSidebarNavigation === true,
        headerIdentity: ['settings', 'settings-providers', 'resources', 'capabilities', 'pets'].includes(captureView) || result.headerIdentityWorks === true,
        headerNativeTooltips: ['settings', 'settings-providers', 'resources', 'capabilities', 'pets'].includes(captureView) || result.headerNativeTooltipsWork === true,
        headerLongTooltipBounded: ['settings', 'settings-providers', 'resources', 'capabilities', 'pets'].includes(captureView) || result.headerLongTooltipBoundedWorks === true,
        titlebarSidebarToggle: captureView !== 'inspector' || result.titlebarSidebarToggleWorks === true,
        customTooltipNativeTitlesAbsent: result.customTooltipNativeTitlesAbsent === true,
        nativeTitleFreeControls: result.nativeTitleFreeControlsWork === true,
        composerNativeTooltips: ['settings', 'settings-providers', 'resources', 'capabilities', 'pets'].includes(captureView) || result.composerNativeTooltipsWork === true,
        headerActionMenu: captureView !== 'inspector' || result.headerActionMenuWorks === true,
        chatEmptyState: captureView !== 'inspector' || result.chatEmptyStateWorks === true,
        chatEmptyStateQuiet: captureView !== 'inspector' || result.chatEmptyStateQuietWorks === true,
        chatEmptyStateProjectLabelClean: captureView !== 'inspector' || result.chatEmptyStateProjectLabelClean === true,
        inspectorTabs: captureView !== 'inspector' || result.hasInspectorTabs === true,
        rightPanelState: captureView !== 'inspector' || result.hasRightPanelState === true,
        rightSidebarChromeCompact: captureView !== 'inspector' || result.rightSidebarChromeCompactWorks === true,
        rightSidebarTrailingFade: captureView !== 'inspector' || result.rightSidebarTrailingFadeWorks === true,
        rightSidebarInactiveTabsCompact: captureView !== 'inspector' || result.rightSidebarInactiveTabsCompactWorks === true,
        rightSidebarInactiveTabTooltip: captureView !== 'inspector' || result.rightSidebarInactiveTabTooltipWorks === true,
        rightSidebarAddControlStable: captureView !== 'inspector' || result.rightSidebarAddControlStableWorks === true,
        diffToolbarCompact: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        diffListCompact: captureView !== 'inspector' || result.diffListCompactWorks === true,
        diffActionMenuCompact: captureView !== 'inspector' || result.diffActionMenuCompactWorks === true,
        rightPanelExpand: captureView !== 'inspector' || result.rightPanelExpandWorks === true,
        rightPanelNarrowOverlay: captureView !== 'inspector' || result.rightPanelNarrowOverlayWorks === true,
        reviewSearch: captureView !== 'inspector' || result.reviewSearchWorks === true,
        reviewSearchClear: captureView !== 'inspector' || result.reviewSearchClearWorks === true,
        reviewJsonPreview: captureView !== 'inspector' || result.reviewJsonPreviewWorks === true,
        reviewCsvPreview: captureView !== 'inspector' || result.reviewCsvPreviewWorks === true,
        reviewDocumentPreview: captureView !== 'inspector' || result.reviewDocumentPreviewWorks === true,
        reviewNotebookPreview: captureView !== 'inspector' || result.reviewNotebookPreviewWorks === true,
        reviewBinaryState: captureView !== 'inspector' || result.reviewBinaryStateWorks === true,
        reviewBinaryActions: captureView !== 'inspector' || result.reviewBinaryActionsWork === true,
        filesTabSearch: captureView !== 'inspector' || result.filesTabSearchWorks === true,
        filesToolbarCompact: captureView !== 'inspector' || result.filesToolbarCompactWorks === true,
        filesActionMenuCompact: captureView !== 'inspector' || result.filesActionMenuCompactWorks === true,
        filesPanelStacked: captureView !== 'inspector' || result.filesPanelStackedWorks === true,
        filesTabAttach: captureView !== 'inspector' || result.filesTabAttachWorks === true,
        filesHtmlPreview: captureView !== 'inspector' || result.filesHtmlPreviewWorks === true,
        filesJsonPreview: captureView !== 'inspector' || result.filesJsonPreviewWorks === true,
        filesCsvPreview: captureView !== 'inspector' || result.filesCsvPreviewWorks === true,
        filesDocumentPreview: captureView !== 'inspector' || result.filesDocumentPreviewWorks === true,
        filesNotebookPreview: captureView !== 'inspector' || result.filesNotebookPreviewWorks === true,
        filesBinaryPreview: captureView !== 'inspector' || result.filesBinaryPreviewWorks === true,
        filesNoResults: captureView !== 'inspector' || result.filesNoResultsWorks === true,
        filesSearchClear: captureView !== 'inspector' || result.filesSearchClearWorks === true,
        browserTab: captureView !== 'inspector' || result.browserTabWorks === true,
        browserScreenshot: captureView !== 'inspector' || result.browserScreenshotWorks === true,
        browserScreenshotAttachment: captureView !== 'inspector' || result.browserScreenshotAttachmentWorks === true,
        browserFind: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserFindWorks === true,
        browserFindNavigation: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserFindNavigationWorks === true,
        browserZoom: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserZoomWorks === true,
        browserDeviceMode: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserDeviceModeWorks === true,
        browserCacheReload: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserCacheReloadWorks === true,
        browserMultiTab: captureView !== 'inspector' || result.browserMultiTabWorks === true,
        browserTabCloseChrome: captureView !== 'inspector' || result.browserTabCloseChromeWorks === true,
        browserActionsNativeTitlesAbsent: captureView !== 'inspector' || result.browserActionsNativeTitlesAbsent === true,
        browserInspection: captureView !== 'inspector' || result.browserInspectionWorks === true,
        browserDomPaneCompact: captureView !== 'inspector' || result.browserDomPaneCompactWorks === true,
        browserTargetsPane: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetsPaneWorks === true,
        browserTargetKey: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetKeyWorks === true,
        browserTargetFill: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetFillWorks === true,
        browserTargetType: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetTypeWorks === true,
        browserTargetState: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetStateWorks === true,
        browserTargetSelect: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetSelectWorks === true,
        browserTargetCheck: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetCheckWorks === true,
        browserTargetsPaneNoHorizontalOverflow: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetsPaneNoHorizontalOverflowWorks === true,
        browserAssetBundle: captureView !== 'inspector' || result.browserAssetBundleWorks === true,
        browserInlineSvgInventory: captureView !== 'inspector' || result.browserInlineSvgInventoryWorks === true,
        browserSecurityPane: captureView !== 'inspector' || result.browserSecurityPaneWorks === true,
        browserSecurityPaneNoHorizontalOverflow: captureView !== 'inspector' || result.browserSecurityPaneNoHorizontalOverflowWorks === true,
        browserInspectorChromeCompact: captureView !== 'inspector' || result.browserInspectorChromeCompactWorks === true,
        browserVisibilityControl: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserVisibilityControlWorks === true,
        browserHiddenState: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserHiddenStateWorks === true,
        rightPanelContextMenuWorks: captureView !== 'inspector' || result.rightPanelContextMenuWorks === true,
        rightPanelTabReorderWorks: captureView !== 'inspector' || result.rightPanelTabReorderWorks === true,
        planPanel: captureView !== 'plan' || result.planPanelWorks === true,
        planCompactRows: captureView !== 'plan' || result.compactTaskRowsWork === true,
        planAgentStatLabelsCalm: captureView !== 'plan' || result.planAgentStatLabelsCalm === true,
        sideChatTabs: captureView !== 'inspector' || result.sideChatTabsWork === true,
        sideChatComposerCompact: captureView !== 'inspector' || result.sideChatComposerCompactWorks === true,
        sideChatDraftPersistence: captureView !== 'inspector' || result.sideChatDraftPersistenceWorks === true,
        sideChatMessageLabelsCalm: captureView !== 'inspector' || result.sideChatMessageLabelsCalm === true,
        sideChatClose: captureView !== 'inspector' || result.sideChatCloseWorks === true,
        terminalTabsPersist: captureView !== 'terminal' || result.terminalTabsPersistState === true,
        terminalRestore: captureView !== 'terminal' || result.terminalRestoreWorks === true,
        terminalTabMenu: captureView !== 'terminal' || result.terminalTabMenuWorks === true,
        terminalTabReorder: captureView !== 'terminal' || result.terminalTabReorderWorks === true,
        themeImport: captureView !== 'settings' || result.themeImportWorks === true,
        themeSharingControls: captureView !== 'settings' || result.themeSharingControls === true,
        settingsTaxonomy: captureView !== 'settings' || result.settingsTaxonomyWorks === true,
        settingsSidebarNavCompact: captureView !== 'settings' || result.settingsSidebarNavCompactWorks === true,
        settingsProviderDropdown: captureView !== 'settings-providers' || result.settingsProviderDropdownWorks === true,
        settingsDiagnosticsSection: !['settings', 'settings-providers'].includes(captureView) || result.settingsDiagnosticsSectionWorks === true,
        settingsProviderStatusUnified: !['settings', 'settings-providers'].includes(captureView) || result.settingsProviderStatusUnifiedWorks === true,
        settingsUsageDiagnostics: !['settings', 'settings-providers'].includes(captureView) || result.settingsUsageDiagnosticsWorks === true,
        settingsProviderModelsCollapsed: !['settings', 'settings-providers'].includes(captureView) || result.settingsProviderModelsCollapsedWorks === true,
        settingsProviderControlSurfaceUnified: captureView !== 'settings-providers' || result.settingsProviderControlSurfaceUnifiedWorks === true,
        settingsProviderCatalogLabelCalm: captureView !== 'settings-providers' || result.settingsProviderCatalogLabelCalm === true,
        settingsDiagnosticsDisclosureCompact: !['settings', 'settings-providers'].includes(captureView) || result.settingsDiagnosticsDisclosureCompactWorks === true,
        settingsDataControls: captureView !== 'settings' || result.settingsDataControlsWorks === true,
        settingsShortcutsCompact: captureView !== 'settings' || result.settingsShortcutsCompactWorks === true,
        extensionsPanel: captureView !== 'extensions' || result.hasExtensionsPanel === true,
        extensionsPanelTabs: captureView !== 'extensions' || result.hasExtensionsPanelTabs === true,
        extensionsEmbeddedCopyCompact: captureView !== 'extensions' || result.extensionsEmbeddedCopyCompact === true,
        extensionsPanelCalm: captureView !== 'extensions' || result.extensionsPanelCalmWorks === true,
        sideQuestionCommand: ['terminal', 'settings', 'settings-providers', 'resources', 'capabilities', 'pets', 'inspector', 'composer', 'extensions', 'plan'].includes(captureView) || result.hasSideQuestionCommandText === true,
        capabilityCreateMenu: captureView !== 'capabilities' || result.capabilityMenuOpened === true,
        capabilityMenuArrowFocus: captureView !== 'capabilities' || result.capabilityMenuArrowFocus === true,
        capabilityMenuEscape: captureView !== 'capabilities' || result.capabilityMenuClosedWithEscape === true,
        capabilityMenuFocusReturned: captureView !== 'capabilities' || result.capabilityMenuFocusReturned === true,
        capabilityPageLabelsCalm: captureView !== 'capabilities' || result.capabilityPageLabelsCalm === true,
        capabilityCreateSheet: captureView !== 'capabilities' || result.capabilitySheetOpened === true,
        capabilitySheetFocus: captureView !== 'capabilities' || result.capabilitySheetFocused === true,
        capabilitySheetFocusTrap: captureView !== 'capabilities' || result.capabilitySheetFocusStayedInside === true,
        capabilitySheetEscape: captureView !== 'capabilities' || result.capabilitySheetClosedWithEscape === true,
        capabilityEditSheet: captureView !== 'capabilities' || result.capabilityEditSheetOpened === true,
        capabilitySyncSheet: captureView !== 'capabilities' || result.capabilitySyncSheetOpened === true,
        composerPermissionMenu: captureView !== 'composer' || result.composerPermissionMenuOpened === true,
        composerPermissionNativeTooltips: captureView !== 'composer' || result.composerPermissionNativeTooltipsWork === true,
        composerPermissionLabelsCalm: captureView !== 'composer' || result.composerPermissionLabelsCalm === true,
        composerPermissionEscape: captureView !== 'composer' || result.composerPermissionMenuClosedWithEscape === true,
        composerPermissionFocusReturned: captureView !== 'composer' || result.composerPermissionFocusReturned === true,
        composerAgentMenu: captureView !== 'composer' || result.composerAgentMenuOpened === true,
        composerAgentRowLabelsCalm: captureView !== 'composer' || result.composerAgentRowLabelsCalm === true,
        composerAgentOutsideClick: captureView !== 'composer' || result.composerAgentMenuClosedWithOutsideClick === true,
        composerAgentFocusReturned: captureView !== 'composer' || result.composerAgentFocusReturned === true,
        composerDraftsPerChat: captureView !== 'composer' || result.composerDraftsPerChat === true,
        composerAttachmentsPerChat: captureView !== 'composer' || result.composerAttachmentsPerChat === true,
        composerAttachmentsClearedOnSwitch: captureView !== 'composer' || result.composerAttachmentsClearedOnSwitch === true,
        composerToolbarResponsive: captureView !== 'composer' || result.composerToolbarResponsiveWorks === true,
        buttons: Number(result.buttonCount ?? 0) > 0
      }
  const failed = Object.entries(checks).filter(([, ok]) => !ok)
  if (failed.length > 0) {
    console.error(JSON.stringify({ outputPath, checks, result }, null, 2))
    process.exit(1)
  }

  console.log(JSON.stringify({ outputPath, screenshotPath: report.screenshotPath, view: captureView, checks, profile: result.profile }, null, 2))
})

function packagedLaunchCommand() {
  const executable = process.platform === 'darwin'
    ? prepareMacSmokeBundle({ root, profile: `${profile}-${captureView}-${process.pid}` }).executable
    : join(root, 'dist', 'Orchestrator')
  if (!existsSync(executable)) {
    console.error(`Packaged app not found at ${executable}`)
    console.error('Run npm run pack:mac before --packaged smoke checks.')
    process.exit(1)
  }
  return { bin: executable, args: [] }
}
