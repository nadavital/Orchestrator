#!/usr/bin/env node
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const captureView = process.argv.includes('--settings')
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
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW: captureView
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
  const checks = captureView === 'session-switch'
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
        jumpToLatestReached: result.jumpToLatestReached === true,
        jumpHiddenAfterClick: result.jumpVisibleAfterClick === false
      }
    : captureView === 'sidebar'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        pinnedAboveProjects: result.pinnedAboveProjects === true,
        pinnedRecentFirst: result.pinnedRecentFirst === true,
        pinnedRowsHiddenFromProjects: result.pinnedRowsHiddenFromProjects === true,
        pinnedRowUnpinned: result.pinnedRowUnpinned === true,
        hoverPinVisible: result.hoverPinVisible === true,
        doubleClickRenameWorks: result.doubleClickRenameWorks === true,
        runningSpinnerVisible: result.runningSpinnerVisible === true,
        normalIdleDotHidden: result.normalIdleDotHidden === true,
        unreadIdleDotVisible: result.unreadIdleDotVisible === true,
        errorDotVisible: result.errorDotVisible === true,
        grayIdleDotsAbsent: result.grayIdleDotsAbsent === true
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
        fileCardsBounded: result.fileCardsBounded === true,
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
    : {
        isolatedProfile: result.profile?.isIsolated === true,
        profileBadge: ['settings', 'resources', 'capabilities', 'pets'].includes(captureView) || result.hasProfileBadge === true,
        composer: result.hasComposer === true,
        sidebarNavigation: ['settings', 'capabilities', 'pets'].includes(captureView) || result.hasSidebarNavigation === true,
        inspectorTabs: captureView !== 'inspector' || result.hasInspectorTabs === true,
        extensionsPanel: captureView !== 'extensions' || result.hasExtensionsPanel === true,
        extensionsPanelTabs: captureView !== 'extensions' || result.hasExtensionsPanelTabs === true,
        sideQuestionCommand: ['terminal', 'settings', 'resources', 'capabilities', 'pets', 'inspector', 'composer', 'extensions'].includes(captureView) || result.hasSideQuestionCommandText === true,
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
    ? join(root, 'dist', 'mac-arm64', 'Orchestrator.app', 'Contents', 'MacOS', 'Orchestrator')
    : join(root, 'dist', 'Orchestrator')
  if (!existsSync(executable)) {
    console.error(`Packaged app not found at ${executable}`)
    console.error('Run npm run pack:mac before --packaged smoke checks.')
    process.exit(1)
  }
  return { bin: executable, args: [] }
}
