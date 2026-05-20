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

if (captureView === 'inspector' || captureView === 'browser') {
  mkdirSync(join(workspaceDir, 'Nested Folder'), { recursive: true })
  writeFileSync(join(workspaceDir, 'review-base.txt'), 'before review\n')
  writeFileSync(join(workspaceDir, 'review-delete.txt'), 'delete me\n')
  writeFileSync(join(workspaceDir, 'Nested Folder', 'nested note.md'), '# Nested file smoke preview\n\nThis verifies spaces in paths.\n')
  writeFileSync(join(workspaceDir, 'preview-page.html'), '<!doctype html><main><h1>HTML preview smoke</h1><p>Rendered in the file inspector.</p></main>\n')
  writeFileSync(join(workspaceDir, 'binary-preview-smoke.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 255]))
  spawnSync('git', ['init'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'orchestrator-smoke@example.test'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'Orchestrator Smoke'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['add', '.'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['commit', '-m', 'baseline'], { cwd: workspaceDir, stdio: 'ignore' })
  writeFileSync(join(workspaceDir, 'review-base.txt'), 'before review\nafter review\n')
  writeFileSync(join(workspaceDir, 'review-new.txt'), 'new review file\n')
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
        <input aria-label="Smoke input" placeholder="Type here">
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
  const checks = captureView === 'empty-state'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        noProjects: result.projectCount === 0,
        noSessions: result.sessionCount === 0,
        emptyStateVisible: result.emptyStateVisible === true,
        emptyStateProminent: result.emptyStateProminent === true,
        addProjectActionVisible: result.addProjectActionVisible === true,
        addProjectActionProminent: result.addProjectActionProminent === true,
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
        hoverCardVisible: result.hoverCardVisible === true,
        hoverCardSurfaceReadable: result.hoverCardSurfaceReadable === true,
        tooltipSurfaceReadable: result.tooltipSurfaceReadable === true,
        singleHoverSurface: result.singleHoverSurfaceWorks === true,
        customTooltipNativeTitlesAbsent: result.customTooltipNativeTitlesAbsent === true,
        nativeTitleFreeControls: result.nativeTitleFreeControlsWork === true,
        sidebarNoHorizontalOverflow: result.sidebarNoHorizontalOverflow === true,
        sessionRowsCompact: result.sessionRowsCompact === true,
        projectHeadersCompact: result.projectHeadersCompact === true,
        environmentIconVisible: result.environmentIconVisible === true,
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
          browserLoaded: result.browserLoaded === true,
          browserFind: result.browserFindWorks === true,
          browserFindNavigation: result.browserFindNavigationWorks === true,
          browserStopLoading: result.browserStopLoadingWorks === true,
          browserHistoryMenu: result.browserHistoryMenuWorks === true,
          browserActionsMenuCompact: result.browserActionsMenuCompactWorks === true,
          browserErrorRecovery: result.browserErrorRecoveryWorks === true,
          browserSingleTabChrome: result.browserSingleTabStripHidden === true,
          browserToolbarCompact: result.browserToolbarCompact === true,
          browserStatusRowQuiet: result.browserStatusRowQuiet === true,
          browserNoHorizontalOverflow: result.browserNoHorizontalOverflow === true
        }
    : {
        isolatedProfile: result.profile?.isIsolated === true,
        profileBadge: ['settings', 'settings-providers', 'resources', 'capabilities', 'pets'].includes(captureView) || result.hasProfileBadge === true,
        composer: result.hasComposer === true,
        sidebarNavigation: ['settings', 'settings-providers', 'capabilities', 'pets'].includes(captureView) || result.hasSidebarNavigation === true,
        headerIdentity: ['settings', 'settings-providers', 'resources', 'capabilities', 'pets'].includes(captureView) || result.headerIdentityWorks === true,
        customTooltipNativeTitlesAbsent: result.customTooltipNativeTitlesAbsent === true,
        nativeTitleFreeControls: result.nativeTitleFreeControlsWork === true,
        headerActionMenu: captureView !== 'inspector' || result.headerActionMenuWorks === true,
        chatEmptyState: captureView !== 'inspector' || result.chatEmptyStateWorks === true,
        inspectorTabs: captureView !== 'inspector' || result.hasInspectorTabs === true,
        rightPanelState: captureView !== 'inspector' || result.hasRightPanelState === true,
        rightSidebarChromeCompact: captureView !== 'inspector' || result.rightSidebarChromeCompactWorks === true,
        rightSidebarInactiveTabsCompact: captureView !== 'inspector' || result.rightSidebarInactiveTabsCompactWorks === true,
        rightSidebarInactiveTabTooltip: captureView !== 'inspector' || result.rightSidebarInactiveTabTooltipWorks === true,
        diffToolbarCompact: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        diffActionMenuCompact: captureView !== 'inspector' || result.diffActionMenuCompactWorks === true,
        rightPanelExpand: captureView !== 'inspector' || result.rightPanelExpandWorks === true,
        reviewSearch: captureView !== 'inspector' || result.reviewSearchWorks === true,
        reviewSearchClear: captureView !== 'inspector' || result.reviewSearchClearWorks === true,
        reviewBinaryState: captureView !== 'inspector' || result.reviewBinaryStateWorks === true,
        reviewBinaryActions: captureView !== 'inspector' || result.reviewBinaryActionsWork === true,
        filesTabSearch: captureView !== 'inspector' || result.filesTabSearchWorks === true,
        filesToolbarCompact: captureView !== 'inspector' || result.filesToolbarCompactWorks === true,
        filesActionMenuCompact: captureView !== 'inspector' || result.filesActionMenuCompactWorks === true,
        filesPanelStacked: captureView !== 'inspector' || result.filesPanelStackedWorks === true,
        filesTabAttach: captureView !== 'inspector' || result.filesTabAttachWorks === true,
        filesHtmlPreview: captureView !== 'inspector' || result.filesHtmlPreviewWorks === true,
        filesBinaryPreview: captureView !== 'inspector' || result.filesBinaryPreviewWorks === true,
        filesNoResults: captureView !== 'inspector' || result.filesNoResultsWorks === true,
        filesSearchClear: captureView !== 'inspector' || result.filesSearchClearWorks === true,
        browserTab: captureView !== 'inspector' || result.browserTabWorks === true,
        browserScreenshot: captureView !== 'inspector' || result.browserScreenshotWorks === true,
        browserFind: captureView !== 'inspector' || result.browserFindWorks === true,
        browserFindNavigation: captureView !== 'inspector' || result.browserFindNavigationWorks === true,
        browserZoom: captureView !== 'inspector' || result.browserZoomWorks === true,
        browserDeviceMode: captureView !== 'inspector' || result.browserDeviceModeWorks === true,
        browserCacheReload: captureView !== 'inspector' || result.browserCacheReloadWorks === true,
        browserMultiTab: captureView !== 'inspector' || result.browserMultiTabWorks === true,
        browserTabCloseChrome: captureView !== 'inspector' || result.browserTabCloseChromeWorks === true,
        browserActionsNativeTitlesAbsent: captureView !== 'inspector' || result.browserActionsNativeTitlesAbsent === true,
        browserInspection: captureView !== 'inspector' || result.browserInspectionWorks === true,
        browserTargetsPane: captureView !== 'inspector' || result.browserTargetsPaneWorks === true,
        browserTargetsPaneNoHorizontalOverflow: captureView !== 'inspector' || result.browserTargetsPaneNoHorizontalOverflowWorks === true,
        browserAssetBundle: captureView !== 'inspector' || result.browserAssetBundleWorks === true,
        browserSecurityPane: captureView !== 'inspector' || result.browserSecurityPaneWorks === true,
        browserSecurityPaneNoHorizontalOverflow: captureView !== 'inspector' || result.browserSecurityPaneNoHorizontalOverflowWorks === true,
        browserInspectorChromeCompact: captureView !== 'inspector' || result.browserInspectorChromeCompactWorks === true,
        browserVisibilityControl: captureView !== 'inspector' || result.browserVisibilityControlWorks === true,
        rightPanelContextMenuWorks: captureView !== 'inspector' || result.rightPanelContextMenuWorks === true,
        rightPanelTabReorderWorks: captureView !== 'inspector' || result.rightPanelTabReorderWorks === true,
        planPanel: captureView !== 'plan' || result.planPanelWorks === true,
        planCompactRows: captureView !== 'plan' || result.compactTaskRowsWork === true,
        sideChatTabs: captureView !== 'inspector' || result.sideChatTabsWork === true,
        sideChatDraftPersistence: captureView !== 'inspector' || result.sideChatDraftPersistenceWorks === true,
        sideChatClose: captureView !== 'inspector' || result.sideChatCloseWorks === true,
        terminalTabsPersist: captureView !== 'terminal' || result.terminalTabsPersistState === true,
        terminalRestore: captureView !== 'terminal' || result.terminalRestoreWorks === true,
        terminalTabMenu: captureView !== 'terminal' || result.terminalTabMenuWorks === true,
        terminalTabReorder: captureView !== 'terminal' || result.terminalTabReorderWorks === true,
        themeImport: captureView !== 'settings' || result.themeImportWorks === true,
        themeSharingControls: captureView !== 'settings' || result.themeSharingControls === true,
        settingsTaxonomy: captureView !== 'settings' || result.settingsTaxonomyWorks === true,
        settingsProviderDropdown: captureView !== 'settings-providers' || result.settingsProviderDropdownWorks === true,
        settingsDiagnosticsSection: !['settings', 'settings-providers'].includes(captureView) || result.settingsDiagnosticsSectionWorks === true,
        settingsUsageDiagnostics: !['settings', 'settings-providers'].includes(captureView) || result.settingsUsageDiagnosticsWorks === true,
        settingsProviderModelsCollapsed: !['settings', 'settings-providers'].includes(captureView) || result.settingsProviderModelsCollapsedWorks === true,
        settingsDataControls: captureView !== 'settings' || result.settingsDataControlsWorks === true,
        settingsShortcutsCompact: captureView !== 'settings' || result.settingsShortcutsCompactWorks === true,
        extensionsPanel: captureView !== 'extensions' || result.hasExtensionsPanel === true,
        extensionsPanelTabs: captureView !== 'extensions' || result.hasExtensionsPanelTabs === true,
        extensionsEmbeddedCopyCompact: captureView !== 'extensions' || result.extensionsEmbeddedCopyCompact === true,
        sideQuestionCommand: ['terminal', 'settings', 'settings-providers', 'resources', 'capabilities', 'pets', 'inspector', 'composer', 'extensions', 'plan'].includes(captureView) || result.hasSideQuestionCommandText === true,
        capabilityCreateMenu: captureView !== 'capabilities' || result.capabilityMenuOpened === true,
        capabilityMenuArrowFocus: captureView !== 'capabilities' || result.capabilityMenuArrowFocus === true,
        capabilityMenuEscape: captureView !== 'capabilities' || result.capabilityMenuClosedWithEscape === true,
        capabilityMenuFocusReturned: captureView !== 'capabilities' || result.capabilityMenuFocusReturned === true,
        capabilityCreateSheet: captureView !== 'capabilities' || result.capabilitySheetOpened === true,
        capabilitySheetFocus: captureView !== 'capabilities' || result.capabilitySheetFocused === true,
        capabilitySheetFocusTrap: captureView !== 'capabilities' || result.capabilitySheetFocusStayedInside === true,
        capabilitySheetEscape: captureView !== 'capabilities' || result.capabilitySheetClosedWithEscape === true,
        capabilityEditSheet: captureView !== 'capabilities' || result.capabilityEditSheetOpened === true,
        capabilitySyncSheet: captureView !== 'capabilities' || result.capabilitySyncSheetOpened === true,
        composerPermissionMenu: captureView !== 'composer' || result.composerPermissionMenuOpened === true,
        composerPermissionEscape: captureView !== 'composer' || result.composerPermissionMenuClosedWithEscape === true,
        composerPermissionFocusReturned: captureView !== 'composer' || result.composerPermissionFocusReturned === true,
        composerAgentMenu: captureView !== 'composer' || result.composerAgentMenuOpened === true,
        composerAgentOutsideClick: captureView !== 'composer' || result.composerAgentMenuClosedWithOutsideClick === true,
        composerAgentFocusReturned: captureView !== 'composer' || result.composerAgentFocusReturned === true,
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
