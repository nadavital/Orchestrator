#!/usr/bin/env node
import * as asar from '@electron/asar'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative, resolve } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import { inflateSync } from 'zlib'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outDir = resolve(readArg('--out') ?? join(root, 'tmp', 'codex-side-panel-comparison'))
const defaultSmokeDir = join(root, 'tmp', 'side-panel-visual-inventory-current')
const smokeOutDir = resolve(readArg('--smoke-out') ?? defaultSmokeDir)
const runSmoke = process.argv.includes('--run-smoke')
const fullSmoke = process.argv.includes('--full') || process.argv.includes('--full-smoke')
const smokeAppMode = process.argv.includes('--installed') ? 'installed' : process.argv.includes('--packaged') ? 'packaged' : 'dev'
if (process.argv.includes('--installed') && process.argv.includes('--packaged')) {
  console.error('Use either --packaged or --installed, not both.')
  process.exit(1)
}
const noFail = process.argv.includes('--no-fail')
const captureLiveCodex = process.argv.includes('--capture-live-codex')
const manifestPath = resolve(readArg('--manifest') ?? join(smokeOutDir, 'manifest.json'))
const codexAsarPath = resolve(readArg('--codex-asar') ?? '/Applications/Codex.app/Contents/Resources/app.asar')
const liveCodexScreenshotPath = '/private/tmp/codex-current-screen.png'

function main() {
mkdirSync(outDir, { recursive: true })

const liveCaptureAttempt = captureLiveCodex ? captureLiveCodexScreenshot(liveCodexScreenshotPath) : null
let smokeRun = null
if (runSmoke) {
  const args = ['run', 'smoke:visual:side-panels', '--', '--out', smokeOutDir]
  if (fullSmoke) args.push('--full')
  if (smokeAppMode === 'packaged') args.push('--packaged')
  if (smokeAppMode === 'installed') args.push('--installed')
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  smokeRun = {
    command: `npm ${args.join(' ')}`,
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  }
}

const manifest = readJsonFile(manifestPath)
const packageJson = readJsonFile(join(root, 'package.json'))
const codexAssets = new CodexAssetReader(codexAsarPath)
const sourceCache = new Map()
const artifactCache = new Map()
const fileCache = new Map()

const contracts = buildContracts()
const rows = contracts.map((contract) => evaluateContract(contract, manifest, codexAssets, sourceCache, artifactCache, fileCache))
const summary = summarizeRows(rows, manifest)
const report = {
  createdAt: new Date().toISOString(),
  scope: 'Right-side Workbench panel, plus adjacent bottom Terminal and left Chat Sidebar surfaces covered by the side-panel parity goal.',
  codexAsarPath,
  codexAsarAvailable: existsSync(codexAsarPath),
  smokeManifestPath: manifestPath,
  smokeManifestAvailable: manifest !== null,
  smokeAppMode: manifest?.appMode ?? smokeAppMode,
  smokeRun,
  liveCaptureAttempt,
  summary,
  rows,
  captures: (manifest?.captures ?? []).map((capture) => ({
    id: capture.id,
    surface: capture.surface,
    state: capture.state,
    ok: capture.ok === true,
    flag: capture.flag,
    screenshotPath: capture.screenshotPath ?? null,
    failureKind: capture.failureKind ?? null,
    failureSummary: capture.failureSummary ?? null,
    failedChecks: failedChecks(capture.checks)
  }))
}

report.artifacts = {
  headerPanelContactSheetPath: writeHeaderPanelContactSheet(report)
}

const jsonPath = join(outDir, 'comparison-report.json')
const markdownPath = join(outDir, 'comparison-report.md')
writeFileSync(jsonPath, JSON.stringify(report, null, 2))
writeFileSync(markdownPath, renderMarkdown(report))

const failedRows = rows.filter((row) => row.status === 'mismatch' || row.status === 'blocked')
const incompleteRows = rows.filter((row) => row.status === 'needs-smoke' || row.status === 'needs-proof')
const exitCode = failedRows.length > 0 ? 2 : (incompleteRows.length > 0 || (smokeRun != null && smokeRun.exitCode !== 0) ? 1 : 0)

console.log(JSON.stringify({
  markdownPath,
  jsonPath,
  headerPanelContactSheetPath: report.artifacts.headerPanelContactSheetPath,
  liveCaptureAttempt,
  smokeManifestPath: manifestPath,
  statusCounts: summary.statusCounts,
  optionalFileEvidenceFailureCount: summary.optionalFileEvidenceFailures.length,
  optionalFileEvidenceFailures: summary.optionalFileEvidenceFailures,
  remainingParityGapCount: summary.remainingParityGaps.length,
  remainingParityGapCounts: summary.remainingParityGapCounts,
  mismatchCount: summary.statusCounts.mismatch ?? 0,
  blockedCount: summary.statusCounts.blocked ?? 0,
  needsSmokeCount: summary.statusCounts['needs-smoke'] ?? 0,
  needsProofCount: summary.statusCounts['needs-proof'] ?? 0,
  exitCode,
  noFail
}, null, 2))

process.exit(noFail ? 0 : exitCode)
}

function captureLiveCodexScreenshot(outputPath) {
  if (process.platform !== 'darwin') {
    return {
      attempted: true,
      command: `screencapture -x ${outputPath}`,
      exitCode: null,
      skipped: true,
      reason: 'screencapture is only available on macOS'
    }
  }
  const windows = discoverLiveCodexWindows()
  const attempts = []
  const primaryWindow = windows.windows?.[0] ?? null
  if (primaryWindow?.id) {
    attempts.push(runCodexScreenshotAttempt({
      method: 'window',
      commandArgs: ['-x', `-l${primaryWindow.id}`],
      outputPath: outputPath.replace(/\.png$/i, '-window.png'),
      window: primaryWindow
    }))
  }
  if (primaryWindow?.bounds) {
    const bounds = primaryWindow.bounds
    attempts.push(runCodexScreenshotAttempt({
      method: 'region',
      commandArgs: ['-x', `-R${bounds.x},${bounds.y},${bounds.width},${bounds.height}`],
      outputPath: outputPath.replace(/\.png$/i, '-region.png'),
      window: primaryWindow
    }))
  }
  attempts.push(runCodexScreenshotAttempt({
    method: 'screen',
    commandArgs: ['-x'],
    outputPath
  }))

  const selected = attempts.find((attempt) => attempt.image?.nonBlank === true) ??
    attempts.find((attempt) => attempt.available === true) ??
    attempts[attempts.length - 1]
  if (selected?.available && selected.outputPath !== outputPath) {
    copyFileSync(selected.outputPath, outputPath)
  }
  const image = existsSync(outputPath) ? inspectImageEvidence(outputPath) : null
  return {
    attempted: true,
    command: selected?.command ?? `screencapture -x ${outputPath}`,
    selectedMethod: selected?.method ?? 'screen',
    windows,
    attempts,
    outputPath,
    exitCode: selected?.exitCode ?? null,
    error: selected?.error ?? null,
    stdout: selected?.stdout ?? '',
    stderr: selected?.stderr ?? '',
    available: existsSync(outputPath),
    image
  }
}

function runCodexScreenshotAttempt({ method, commandArgs, outputPath, window = null }) {
  const result = spawnSync('screencapture', [...commandArgs, outputPath], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const image = existsSync(outputPath) ? inspectImageEvidence(outputPath) : null
  return {
    method,
    command: `screencapture ${[...commandArgs, outputPath].join(' ')}`,
    outputPath,
    window,
    exitCode: result.status,
    error: result.error ? result.error.message : null,
    stdout: result.stdout,
    stderr: result.stderr,
    available: existsSync(outputPath),
    image
  }
}

function discoverLiveCodexWindows() {
  const swiftScript = `
import CoreGraphics
import Foundation

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
var rows: [[String: Any]] = []
for window in list {
  let owner = window[kCGWindowOwnerName as String] as? String ?? ""
  if !owner.localizedCaseInsensitiveContains("Codex") { continue }
  let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
  rows.append([
    "id": window[kCGWindowNumber as String] as? Int ?? 0,
    "owner": owner,
    "name": window[kCGWindowName as String] as? String ?? "",
    "pid": window[kCGWindowOwnerPID as String] as? Int ?? 0,
    "layer": window[kCGWindowLayer as String] as? Int ?? 0,
    "alpha": window[kCGWindowAlpha as String] as? Double ?? 0,
    "bounds": [
      "x": bounds["X"] as? Int ?? 0,
      "y": bounds["Y"] as? Int ?? 0,
      "width": bounds["Width"] as? Int ?? 0,
      "height": bounds["Height"] as? Int ?? 0
    ]
  ])
}
let data = try JSONSerialization.data(withJSONObject: rows, options: [])
print(String(data: data, encoding: .utf8) ?? "[]")
`
  const cacheDir = join(root, 'tmp', 'swift-module-cache')
  mkdirSync(cacheDir, { recursive: true })
  const result = spawnSync('swift', ['-e', swiftScript], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: cacheDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let windows = []
  try {
    windows = JSON.parse(result.stdout || '[]')
      .filter((window) => window?.id && window?.bounds?.width > 0 && window?.bounds?.height > 0)
      .sort((left, right) => {
        const leftLayer = Number(left.layer ?? 0)
        const rightLayer = Number(right.layer ?? 0)
        if (leftLayer !== rightLayer) return leftLayer - rightLayer
        const leftArea = Number(left.bounds.width ?? 0) * Number(left.bounds.height ?? 0)
        const rightArea = Number(right.bounds.width ?? 0) * Number(right.bounds.height ?? 0)
        return rightArea - leftArea
      })
  } catch {
    windows = []
  }
  return {
    command: 'swift -e <CoreGraphics window list>',
    exitCode: result.status,
    error: result.error ? result.error.message : null,
    stdout: result.stdout,
    stderr: result.stderr,
    windows
  }
}

function buildContracts() {
  return [
    {
      id: 'app-shell-header-panel-interaction',
      area: 'Header and panel interaction',
      scope: 'Left sidebar, main header, right Files/Browser/Review/Workbench side panel, bottom panel',
      captureIds: ['chat-sidebar', 'header', 'transcript-narrow', 'workbench-right-panel', 'files', 'browser', 'review-last-turn', 'review-core', 'terminal-bottom-panel', 'multi-window-focus'],
      codexAssets: [
        { basename: 'app-shell-state-HP0T5lEX.js', terms: ['app-shell:right-panel-width:v2', 'app-shell-bottom-panel-launcher-visible'] },
        { basename: 'app-shell-BJK30dyj.css', terms: ['app-shell-main-content-viewport', 'app-shell-main-content-frame'] },
        { basename: 'app-shell-Bh-lgoQk.js', terms: ['h-7', 'rounded-lg', 'px-2 py-1', 'text-sm', 'bg-token-main-surface-primary'] },
        { basename: 'thread-page-bottom-panel-state-D1Lz0U4Y.js', terms: ['terminal-panel'] }
      ],
      fileEvidence: [
        {
          path: liveCodexScreenshotPath,
          label: 'live Codex shell screenshot',
          minBytes: 100000,
          maxAgeHours: 72,
          imageNonBlank: true
        }
      ],
      smokeChecks: ['sidebarTopInsetCodexLike', 'sessionHeaderInPrimaryColumn', 'rightPanelHeaderSeam', 'headerPanelSharedBand', 'mainContentFrameContinuous', 'filesHeaderPanelSeam', 'browserHeaderPanelSeam', 'headerMetadataTooltipOnly', 'profileBadgeCompact', 'headerActionChromeCompact', 'rightPanelMaterialSolid', 'workbenchPanelTabCodexMetrics', 'workbenchPanelTabReadableSeparation', 'workbenchPanelActiveTabVisibleAfterResize', 'terminalPanelMaterialSolid', 'terminalBottomPanelSizeDecomposition', 'terminalPanelTabCodexMetrics', 'terminalVisualHealthyContent', 'secondWindowCreated', 'secondWindowNavigated', 'pendingNavigationConsumedOnce', 'pendingNavigationWindowScoped', 'loadedDeepLinkDoesNotLeavePendingNavigation', 'firstWindowBrowserFocusArea', 'firstWindowBrowserMenuEnabled', 'secondWindowBrowserMenuDisabled', 'backgroundWindowMenuDoesNotClobberFocusedWindow', 'activeWindowAfterRefocus', 'focusSwitchRestoresFirstWindowMenu', 'menuCommandRoutedToFocusedWindow'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Smoke covers Orchestrator panel/header geometry, primary-column header ownership, a shared header band across sidebar/main/right-panel chrome, a continuous non-card main content frame, focused Files/Browser/Review panel placement in that band, compact profile/debug badge behavior, compact titlebar toolbar actions, solid panel material, bottom-panel target size, shell attachment, window-scoped pending navigation, loaded-window deep-link handoff, and app-owned multi-window menu command routing; exact live Codex pixel spacing, OS focus behavior, and animation timing still need live screenshots.',
      next: 'Keep header/panel interaction as a first-class contract whenever moving sidebar, Files, Browser, Review, Workbench, or bottom-panel shell layout.',
      openIssues: [
        {
          category: 'live-codex-ui',
          issue: 'Exact Codex header/sidebar/right-panel/bottom-panel pixel spacing, OS focus behavior, and animation timing are not proven by current black live screenshots.',
          requiredEvidence: 'Nonblank live Codex screenshot or side-by-side UI capture with this row still green.'
        }
      ]
    },
    {
      id: 'right-side-workbench-shell',
      area: 'Right-side Workbench shell',
      scope: 'Right side panel',
      captureIds: ['workbench-right-panel', 'workbench-new-tab'],
      codexAssets: [
        { basename: 'thread-side-panel-tabs-CVr2AbYP.js', terms: ['app-shell-tab-controller', 'right-panel-composer-overlay', 'browser-sidebar-command'] },
        { basename: 'app-shell-tab-controller-B2eCi4Le.js', terms: ['activeTab$', 'tabs$'] },
        { basename: 'app-shell-Bh-lgoQk.js', terms: ['h-7', 'rounded-lg', 'px-2 py-1', 'text-sm', 'start-0', 'codex.tabs.closeNamed'] }
      ],
      fileEvidence: [
        {
          path: liveCodexScreenshotPath,
          label: 'live Codex right-panel/header screenshot',
          minBytes: 100000,
          maxAgeHours: 72,
          imageNonBlank: true
        }
      ],
      smokeChecks: ['rightPanelSharedAnimationController', 'rightPanelSharedLayoutController', 'rightPanelHeaderSeam', 'rightPanelMaterialSolid', 'rightPanelContextMenuSharedSections', 'rightPanelTransferUnsupportedBoundary', 'rightPanelPanelOpenCloseTelemetry', 'workbenchPanelTabOverflowController', 'workbenchPanelTabCodexWidthCap', 'workbenchPanelTabCodexMetrics', 'workbenchPanelTabReadableSeparation', 'workbenchPanelActiveTabVisibleAfterResize', 'workbenchPanelTabCloseStartEdge', 'workbenchPanelNewTabPage', 'workbenchNewTabSingleAddAffordance'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Smoke covers Orchestrator shell behavior, tab overflow/no-collapse behavior, start-edge tab close chrome, shared context-menu sections, explicit unsupported transfer boundaries for Review/Files/Browser, and app-shell tab controller structure; exact live Codex spacing and animation timing still need live UI evidence.',
      next: 'Use focused right-panel smoke for regressions; do not call exact timing complete without live Codex comparison.',
      openIssues: [
        {
          category: 'live-codex-ui',
          issue: 'Exact Workbench/right-panel spacing and open/close animation timing are fixture-covered but not live-proven.',
          requiredEvidence: 'Nonblank live Codex right-panel/header capture or timing trace.'
        }
      ]
    },
    {
      id: 'global-thread-find',
      area: 'Global find / Review search',
      scope: 'Right side panel plus transcript',
      captureIds: ['workbench-right-panel', 'review-core', 'review-source', 'transcript-narrow'],
      codexAssets: [
        { basename: 'review-runtime-bridge-CZUIqW4U.js', terms: ['find-in-thread', 'content-search-input', 'codex.threadFindBar.chatFilter', 'codex.threadFindBar.diffFilter', 'open-find'] }
      ],
      sourceEvidence: [
        { path: 'src/renderer/src/App.tsx', terms: ['content-search-input', 'orchestrator:thread-find-query', 'Search chat', 'Search diffs', 'orchestrator:focus-browser-find'] },
        { path: 'src/renderer/src/components/Session/DiffPanel.tsx', terms: ['orchestrator:thread-find-query', "domain: 'diff'", 'orchestrator:thread-find-status'] },
        { path: 'src/renderer/src/components/Session/ChatView.tsx', terms: ['orchestrator:thread-find-query', "domain: 'conversation'", 'orchestrator:thread-find-status'] },
        { path: 'src/types/panelTabs.ts', terms: ['review-files', 'workspace-files', 'browser-page', 'source-file'] }
      ],
      smokeChecks: ['rightPanelFindShortcutRouting', 'reviewSearchContent'],
      statusWhenCovered: 'aligned',
      caveat: 'Smoke now proves the shared content-search-input, chat/diff scope toggle, Review diff-domain search integration, and Browser find routing. Exact live Codex keyboard/focus timing still needs side-by-side UI comparison.',
      next: 'Keep this as a regression contract and use live Codex comparison only for spacing, animation, and focus timing polish.',
      openIssues: [
        {
          category: 'live-codex-ui',
          issue: 'Global find keyboard focus and animation timing are behavior-smoke-covered but not live side-by-side-proven.',
          requiredEvidence: 'Live Codex keyboard/focus comparison while opening and switching chat/diff find scopes.'
        }
      ]
    },
    {
      id: 'review-provider-metadata',
      area: 'Review provider metadata',
      scope: 'Right side panel Review',
      captureIds: ['review-entry', 'review-last-turn', 'review-source'],
      codexAssets: [
        { basename: 'review-runtime-bridge-CZUIqW4U.js', terms: ['set-review-pane-snapshot-metrics-for-host', 'reviewDiffFilesTotal'] },
        { basename: 'review-header-toolbar-6CN1dM2m.js', terms: ['checks', 'reviewer'] }
      ],
      smokeChecks: ['reviewMetadataToolbar', 'reviewMetadataFlyoutShared', 'reviewTranscriptCardLastTurn', 'reviewFileHeaderPathFirst', 'reviewLastTurnVisualState', 'reviewProviderSourceUnavailableReasons', 'reviewWorktreeProviderSource', 'reviewFullSourceBlame', 'reviewLineComments'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Fixture and local/GitHub-backed paths pass, including a direct Last turn transcript-card Review screenshot with the changed-files rail hidden, general PR and inline/threaded review comment summaries, provider comment line rendering, GitHub review-comment commit/blame metadata, and explicit unsupported-provider source reasons for unavailable Last turn/cloud/worktree rows. Live commented-PR proof, provider-native hosted/cloud sources, and checkpoint Undo are not live-proven.',
      next: 'Add one real provider-backed Review source when an adapter exists.',
      openIssues: [
        {
          category: 'provider-adapter',
          issue: 'Provider-native hosted/cloud Review sources are unavailable beyond explicit unsupported rows.',
          requiredEvidence: 'A provider event or API that supplies hosted/cloud Review source data.'
        },
        {
          category: 'provider-proof',
          issue: 'Live commented-PR Review proof is not present in the current installed comparison.',
          requiredEvidence: 'Live provider-backed PR/comment session fixture or authenticated adapter proof.'
        },
        {
          category: 'provider-adapter',
          issue: 'Checkpoint Undo is not workspace-restoring through the current provider path.',
          requiredEvidence: 'Provider checkpoint id plus workspace/git restore semantics, not only thread rollback.'
        }
      ]
    },
    {
      id: 'browser-webview-lifecycle',
      area: 'Browser webview lifecycle',
      scope: 'Right side panel Browser',
      captureIds: ['browser'],
      codexAssets: [
        { basename: 'browser-sidebar-manager-ivre5jEI.js', terms: ['data-browser-sidebar-conversation-id', 'transferWebview', 'browser-sidebar-browser-use-state', 'browser-sidebar-local-servers'] }
      ],
      sourceEvidence: [
        { path: 'src/main/codexAppServerRuntime.ts', terms: ['clientDynamicToolBridge', 'dynamicTools', 'answerClientDynamicTool'] },
        { path: 'src/main/browserClientToolSpecs.ts', terms: ['browser_open', 'browser_read', 'browser_click', 'browser_type', 'browser_screenshot', 'includeImage', 'browser_fill', 'browser_key', 'browser_select', 'browser_check', 'browser_scroll', 'browserClientDynamicTools'] },
        { path: 'src/main/browserClientTools.ts', terms: ['browser:clientToolCall', 'browser:runClientToolSmoke'] },
        { path: 'src/renderer/src/components/Session/BrowserPanel.tsx', terms: ['onClientToolCall', 'browserClientToolSnapshot', 'waitForWebviewSettled'] },
        { path: 'src/main/__tests__/codexAppServerRuntime.test.ts', terms: ['advertises and answers supported Browser dynamic tools', 'browser_read'] },
        { path: 'scripts/codex-browser-appserver-live-proof.mjs', terms: ['CODEX_BROWSER_PROOF_DYNAMIC_TOOL', 'CODEX_BROWSER_PROOF_REAL_BROWSER_TOOLS', 'browser_bridge_status'] },
        { path: 'package.json', terms: ['live:codex-browser-tools'] }
      ],
      artifactEvidence: [
        {
          path: 'tmp/codex-dynamic-tools-live-proof/result.json',
          checks: [
            { path: 'ok', equals: true },
            { path: 'advertisedDynamicTools', includes: 'orchestrator.browser_bridge_status' },
            { serverToolCall: 'orchestrator.browser_bridge_status' },
            { path: 'assistantText', includes: 'CODEX_BROWSER_LIVE_OK' }
          ]
        },
        {
          path: 'tmp/codex-browser-tools-live-proof/result.json',
          checks: [
            { path: 'ok', equals: true },
            { path: 'advertisedDynamicTools', includes: 'orchestrator.browser_open' },
            { path: 'advertisedDynamicTools', includes: 'orchestrator.browser_read' },
            { path: 'advertisedDynamicTools', includes: 'orchestrator.browser_click' },
            { path: 'advertisedDynamicTools', includes: 'orchestrator.browser_type' },
            { path: 'advertisedDynamicTools', includes: 'orchestrator.browser_screenshot' },
            { path: 'advertisedDynamicTools', includes: 'orchestrator.browser_fill' },
            { path: 'advertisedDynamicTools', includes: 'orchestrator.browser_key' },
            { path: 'advertisedDynamicTools', includes: 'orchestrator.browser_select' },
            { path: 'advertisedDynamicTools', includes: 'orchestrator.browser_check' },
            { path: 'advertisedDynamicTools', includes: 'orchestrator.browser_scroll' },
            { serverToolCall: 'orchestrator.browser_open' },
            { serverToolCall: 'orchestrator.browser_read' },
            { serverToolCall: 'orchestrator.browser_click' },
            { serverToolCall: 'orchestrator.browser_type' },
            { serverToolCall: 'orchestrator.browser_screenshot' },
            { path: 'browserToolResponseSummaries.browser_screenshot.includeImage', equals: true },
            { path: 'browserToolResponseSummaries.browser_screenshot.screenshotHasInlineImage', equals: true },
            { serverToolCall: 'orchestrator.browser_fill' },
            { serverToolCall: 'orchestrator.browser_key' },
            { serverToolCall: 'orchestrator.browser_select' },
            { serverToolCall: 'orchestrator.browser_check' },
            { serverToolCall: 'orchestrator.browser_scroll' },
            { path: 'assistantText', includes: 'CODEX_BROWSER_LIVE_OK' }
          ]
        }
      ],
      smokeChecks: ['browserWebviewManagerBoundary', 'browserHiddenWebviewContainment', 'browserForkDomTransfer', 'browserUseNoMutation', 'browserManagerStateBridge', 'browserClientToolBridge', 'browserClientToolActions', 'browserClientToolScreenshot', 'browserClientToolScreenshotImage', 'browserClientToolAdvancedActions', 'browserPersistedPolicyDefaults'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Synthetic manager events, UI boundaries, Browser renderer loopback, persisted Browser Use policy defaults in the right Browser panel, installed-app smoke proof, and live Codex app-server real browser_open/browser_read/browser_click/browser_type/browser_screenshot(includeImage)/browser_fill/browser_key/browser_select/browser_check/browser_scroll tool requests pass; native browser-use event streaming is still separate.',
      next: 'Keep unavailable runtime boundaries explicit; expand only when native browser-use events, provider design-change application, or live pixel/timing evidence becomes available.',
      openIssues: [
        {
          category: 'runtime-signal',
          issue: 'Native browser-use event streaming is not exposed by the tested live Codex app-server path.',
          requiredEvidence: 'Live runtime events for browser-use state, viewport, capture surface, cursor, or route capture.'
        },
        {
          category: 'provider-adapter',
          issue: 'Provider design-change application through Browser remains unimplemented.',
          requiredEvidence: 'Provider event/API describing design-change application targets and expected side effects.'
        },
        {
          category: 'live-codex-ui',
          issue: 'Exact Browser panel pixel spacing and timing remain unverified without live UI evidence.',
          requiredEvidence: 'Nonblank live Codex Browser panel capture.'
        }
      ]
    },
    {
      id: 'browser-device-presets',
      area: 'Browser device presets',
      scope: 'Right side panel Browser',
      captureIds: ['browser'],
      codexAssets: [
        { basename: 'browser-sidebar-manager-ivre5jEI.js', terms: ['iphone-15-pro-max', 'pixel-8', 'surface-pro-7', 'iphone-se', '4096'] }
      ],
      sourceEvidence: [
        { path: 'src/renderer/src/components/Session/BrowserPanel.tsx', terms: ['Responsive', '4K', 'Laptop L', 'Surface Pro 7', 'Samsung Galaxy S24 Ultra', 'iPhone SE', 'desktop4k'] }
      ],
      smokeChecks: ['browserDevicePresetCatalog', 'browserCaptureGeometry', 'browserVisibleGeometry'],
      statusWhenCovered: 'aligned',
      caveat: 'Bundle/code preset order, labels, dimensions, and visible geometry match the extracted Codex browser sidebar/device-toolbar chunks; live menu styling and timing can still catch presentation differences.',
      next: 'Keep lower priority unless live UI comparison shows styling or interaction timing drift.',
      openIssues: [
        {
          category: 'live-codex-ui',
          issue: 'Browser preset menu styling and interaction timing have not been live screenshot-compared.',
          requiredEvidence: 'Live Codex Browser preset menu screenshot or interaction capture.'
        }
      ]
    },
    {
      id: 'terminal-bottom-panel',
      area: 'Terminal bottom panel',
      scope: 'Bottom panel',
      captureIds: ['terminal-bottom-panel', 'terminal-behavior'],
      codexAssets: [
        { basename: 'thread-page-bottom-panel-state-D1Lz0U4Y.js', terms: ['Terminal {index}', 'terminal-panel', 'terminal.tabs.title'] },
        { basename: 'app-shell-Bh-lgoQk.js', terms: ['h-7', 'rounded-lg', 'px-2 py-1', 'text-sm'] },
        { basename: 'terminal-service-BsiZiRKt.js', terms: ['conversationSessions', 'sessionSnapshots', 'terminal-create'] }
      ],
      smokeChecks: ['terminalPanelMaterialSolid', 'terminalBottomPanelSizeDecomposition', 'terminalPanelTabCodexMetrics', 'terminalVisualHealthyContent', 'terminalSharedTransferModel', 'terminalMoveToRightPanel', 'terminalMoveBackToBottom'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Terminal behavior, solid bottom-panel material, Codex-bundle-aligned 280 px default shell size, right/bottom shared transfer model, move to right panel, move back to bottom panel, and screenshot are covered; exact Codex open-close timing is not live-proven.',
      next: 'Compare live panel animation timing when app UI access is available.',
      openIssues: [
        {
          category: 'live-codex-ui',
          issue: 'Terminal bottom-panel open/close animation timing is not live-proven.',
          requiredEvidence: 'Live Codex terminal bottom-panel open/close timing capture at comparable window sizes.'
        }
      ]
    },
    {
      id: 'files-file-source-tabs',
      area: 'Files and file source tabs',
      scope: 'Right side panel Files',
      captureIds: ['files', 'review-source'],
      codexAssets: [
        { basename: 'review-file-source-tab-CjS7Xe_W.js', terms: ['Open file', 'Open in editor', 'Copy path', 'Show git blame', 'Enable rich view'] },
        { basename: 'notebook-preview-panel-CAO-aRhM.js', terms: ['Read only', 'Run all', 'Restart kernel', 'Raw output', 'Notebook output', 'details', 'summary', 'descriptionMarkdown', 'cellTitle', 'outputSummaries', 'summaryMarkdown', 'Python', 'max-w-3xl', 'gap-4', 'px-4 py-4', 'px-4 py-3', 'border-t', 'rounded-md bg-token-main-surface-primary/40 p-3', 'border-token-charts-red/30 bg-token-charts-red/5 p-3', 'IPYNB'] },
        { basename: 'docx-preview-panel-BjyRJuYA.js', terms: ['artifactType:`DOC`', 'title:P', 'replace(/\\.docx$/i', 'docx-preview-panel', 'docx-preview-zoom-trigger', 'codex-docx-preview'] },
        { basename: 'PopcornElectronDocumentPanel-BnYPHweX.js', terms: ['tables.add', 'images.add', 'shapes.add', 'footnotes', 'comments', 'commentReferences', 'reviewMarks', 'hyperlink', 'linkRects', 'textStyle', 'textStyles', 'numberingDefinitions', 'paragraphNumberings', 'bulletCharacter', 'Popcorn Document', 'SECTION_BREAK_TYPE', 'pageSetup', 'columns', 'header.text', 'footer.text'] },
        { basename: 'pdf-preview-panel-CkrOHSbs.js', terms: ['artifactType:`PDF`', 'title:ht', 'replace(/\\.pdf$/i'] },
        { basename: 'artifact-preview-status-D5kFRFQE.js', terms: ['artifactTab.preview.previousPage', 'artifactTab.preview.nextPage', 'artifactTab.preview.zoomPercent'] },
        { basename: 'pdf-preview-panel-CkrOHSbs.js', terms: ['artifactPdfPreview.invertColors', 'artifactPdfPreview.originalColors'] },
        { basename: 'pdf-preview-panel-CkrOHSbs.js', terms: ['artifactPdfPreview.annotate', 'artifactPdfPreview.annotating', 'artifactPdfPreview.commentInput', 'commentLayer', 'isCommentMode', 'localPdfContext'] },
        { basename: 'pdf-preview-panel-CkrOHSbs.js', terms: ['artifact-pdf-presentation', 'artifactTab.preview.exitPresentation'] },
        { basename: 'artifact-tab-file-kind-fsu6JKhI.js', terms: ['xlsm`,`xlsx', 'pptx`,`pptx', 'artifactType:`spreadsheet`', 'artifactType:`slides`'] },
        { basename: 'artifact-tab-content.electron-DayvYBGS.js', terms: ['ExtractXlsxProto', 'ExtractSlidesProto', 'PopcornElectronWorkbookPanel', 'PopcornElectronPresentationPanel', 'renderHeaderZoomControl'] },
        { basename: 'artifact-preview-status-D5kFRFQE.js', terms: ['artifactTab.preview.zoomPercent', 'artifactTab.preview.zoomToFit'] },
        { basename: 'PopcornElectronWorkbookPanel-TofX9KRG.js', terms: ['popcorn-electron-workbook-panel', 'renderHeaderZoomControl', 'popcorn-formula-bar', 'popcorn-selection', 'recalculate', 'format', 'fill', 'font', 'merge()', 'columnWidthPx', 'rowHeightPx', 'freezePanes', 'popcorn-freeze-column-line', 'popcorn-freeze-row-handle', 'wrapText', 'horizontalAlignment', 'verticalAlignment', 'tables.add', 'TableStyleMedium2', 'showFilterButton', 'conditionalFormats.addColorScale', 'conditionalFormats.add(`cellIs`', 'operator:`greaterThan`', 'conditionalFormats.addCustom', '=$A2="Workbook"', 'dataValidation', 'showInputMessage', 'promptTitle', 'prompt', 'popcorn-data-validation-overlay', 'applyRangeBorders', 'charts.add', 'comments.addThread', 'addReply', 'resolve(', 'sparklines.add', 'shapes.add', 'images.add', 'geometry:`upArrow`', 'anchor:{from'] },
        { basename: 'PopcornElectronPresentationPanel-DNKOkXvp.js', terms: ['popcorn-electron-presentation-panel', 'popcorn-presentation-page-navigation', 'popcorn-presentation-zoom-select', 'popcorn-presentation-thumbnails', 'popcorn-presentation-codex-thumbnail-rail', 'popcorn-presentation-thumbnail-stack', 'popcorn-presentation-add-slide', 'popcorn-presentation-notes-panel', 'popcorn-presentation-notes', 'shapes.add', 'position:{left', 'background', 'fill', 'color', 'image', 'hydrateImageAssets'] },
        { basename: 'PopcornElectronPresentationPanel-pMDpowHW.css', terms: ['popcorn-presentation-codex-thumbnail-rail', 'popcorn-presentation-codex-thumbnail-panel', 'popcorn-presentation-codex-thumbnail-stack'] }
      ],
      smokeChecks: ['filesContentSearch', 'fileSourceSearch', 'filesActionMenuSharedSections', 'workbenchFileTabActionMenuSharedSections', 'workbenchFileTabCodexActionLabels', 'workbenchFileTabCodexActionCluster', 'filesArtifactHeaderTitleType', 'filesArtifactPreviewControls', 'filesArtifactOpenOptions', 'filesPdfPreviewControls', 'filesPdfPresentationMode', 'filesPdfAnnotations', 'filesDocumentPageControls', 'filesDocumentTableRendering', 'filesDocumentImageRendering', 'filesDocumentSectionMetadata', 'filesDocumentColumnLayout', 'filesDocumentShapeRendering', 'filesDocumentFootnotes', 'filesDocumentComments', 'filesDocumentReviewMarks', 'filesDocumentHyperlinks', 'filesDocumentTextStyles', 'filesDocumentListRendering', 'filesDocumentPdfZoomMenu', 'filesSpreadsheetSlidesArtifactBoundary', 'filesSpreadsheetRenderer', 'filesSlidesRenderer', 'filesSlidesShapeLayout', 'filesSlidesColorFills', 'filesSlidesImageShapes', 'filesSpreadsheetControls', 'filesSpreadsheetSheetTabs', 'filesSpreadsheetActiveCell', 'filesSpreadsheetFormulaEvaluation', 'filesSpreadsheetCellStyles', 'filesSpreadsheetMergedCells', 'filesSpreadsheetSizing', 'filesSpreadsheetFreezePanes', 'filesSpreadsheetFreezeHandles', 'filesSpreadsheetAlignment', 'filesSpreadsheetTables', 'filesSpreadsheetConditionalFormatting', 'filesSpreadsheetDataValidation', 'filesSpreadsheetDataValidationMessages', 'filesSpreadsheetDataValidationOverlay', 'filesSpreadsheetDataValidationRange', 'filesSpreadsheetComments', 'filesSpreadsheetBorders', 'filesSpreadsheetCharts', 'filesSpreadsheetChartPlot', 'filesSpreadsheetDrawings', 'filesSpreadsheetSparklines', 'filesSpreadsheetFormulaEditing', 'filesSlidesControls', 'filesSlidesSpeakerNotes', 'filesSlidesThumbnailRail', 'filesOfficeZoomMenu', 'filesNotebookReadOnlyControls', 'filesNotebookOutputRendering', 'filesNotebookCellDisclosure', 'filesNotebookExecutionCount', 'filesNotebookCellMetadata', 'filesNotebookOutputSummaries', 'filesNotebookRawOutputDisclosure', 'filesNotebookCodeSnippet', 'filesNotebookCellSpacing', 'filesNotebookOutputChrome', 'filesNotebookOutputItemChrome', 'filesNotebookRichOutputItemChrome', 'reviewFullSourceRows', 'reviewFullSourceBlame'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Local file/source behavior is covered, including Codex-style Workbench file-source action labels and compact options/open action cluster, shared content-search-input source find, Codex-style artifact header title/type splitting for PDF/DOCX/IPYNB/XLSX/PPTX previews, Codex-style artifact Open/options header controls, local PDF page/zoom/invert-color controls, local PDF annotation-mode comments, and presentation mode, local DOCX page/zoom controls, shared PDF/DOCX preset/fit zoom menu, Codex-named DOCX page surfaces with table/block rendering, embedded raster image rendering, basic section/header/footer metadata rendering, read-only column flow from DOCX section metadata, lightweight DOCX text-box shape rendering, read-only DOCX footnote references/list rendering, read-only DOCX comment references/list rendering, read-only DOCX review mark rendering, read-only DOCX hyperlink metadata/rendering, read-only DOCX paragraph/run text style rendering including color, size, and font-family run metadata, and read-only DOCX list/numbering rendering, lightweight XLSX workbook and PPTX slide outline rendering, local XLSX sheet/zoom controls plus Codex-like workbook sheet tabs, active-cell/formula-bar chrome, scoped local formula editing and recalculation, simple XLSX cell fill/font style rendering, merged-cell rendering, row/column sizing, freeze panes with visible local freeze-line handles, wrap text/alignment rendering, table metadata/style/filter rendering, two/three-color scale plus cellIs and custom expression differential-style conditional-format rendering, list data-validation metadata/dropdown affordances plus a local option overlay/select flow, same-sheet range-backed list extraction, and validation prompt/error metadata rendering, read-only XLSX legacy comments plus threaded/resolved range comment metadata, per-side XLSX border color/style rendering, lightweight chart metadata plus a local chart plot, read-only anchored shape/image drawing cards, read-only x14 workbook sparkline extraction/rendering, and shared XLSX/PPTX preset/fit zoom menu, local PPTX slide/zoom controls plus a Codex-style left thumbnail rail, positioned-shape slide stage rendering with slide background/shape/text color fills and embedded image shapes, read-only add-slide affordance, read-only speaker notes, and shared preset/fit zoom menu, read-only notebook artifact controls, basic notebook output rendering, Codex-style notebook cell disclosure shells, notebook execution-count labels, notebook metadata titles/descriptions, notebook output summary markdown, raw-output disclosures, text/plain-before-JSON notebook MIME precedence, Python-titled notebook code snippets, Codex-like notebook cell spacing/width, Codex-like notebook output/source chrome, Codex-like stream/text output item chrome, and separate markdown/error/image notebook item chrome. Full XLSX/PPTX/PDF/DOCX artifact renderer fidelity, autofit workbook layout, advanced conditional formatting beyond color scale/cellIs/basic expression rules, true drawing canvas positioning/selection/resizing, interactive chart canvas rendering/editing, custom data validation formulas, editable workbook comments, border editing/persisted border changes, true DOCX layout pagination/shape geometry/footnote placement/list continuation/comment threading/revision editing/link hit-rects/style inheritance, persisted workbook editing, PDF canvas rendering, provider-backed annotation metadata, and provider-backed comments/blame/artifact metadata remain incomplete.',
      next: 'Prioritize real artifact renderer controls/rendering or provider metadata, not more local tree styling.',
      openIssues: [
        {
          category: 'renderer-fidelity',
          issue: 'Full XLSX/PPTX/PDF/DOCX artifact renderer fidelity is incomplete beyond lightweight local preview controls.',
          requiredEvidence: 'Renderer fixtures or provider artifacts that exercise Codex-equivalent workbook, slide, PDF canvas/annotation, and DOCX layout behavior.'
        },
        {
          category: 'provider-adapter',
          issue: 'Provider-backed comments, blame, and artifact metadata remain incomplete for Files/source tabs.',
          requiredEvidence: 'Provider metadata adapter or live source event supplying those fields.'
        }
      ]
    },
    {
      id: 'settings-host-scope',
      area: 'Settings host scope',
      scope: 'Settings window/surface',
      captureIds: ['settings', 'settings-providers', 'pets'],
      codexAssetNames: ['settings-', 'appearance-settings-', 'personalization-settings-', 'remote-connections-settings-', 'worktrees-settings-', 'browser-use-settings-'],
      smokeChecks: ['settingsHostContext', 'settingsHostAdapterBoundary', 'settingsPersonalizationHostBoundary', 'settingsContentLayout', 'settingsBrowserPage', 'settingsBrowserSurface', 'settingsBrowserModule', 'settingsBrowserPolicyPersistence'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Host-scoped unavailable states are explicit, and the Browser Settings page exposes real host-scoped in-app Browser data clearing plus persisted Browser Use approval/history/download/upload and domain-policy defaults. Real remote-host adapters, Codex Personalization data, and provider-backed Browser Use adapters remain incomplete.',
      next: 'Add host adapters only where provider data exists; deepen Browser Use settings only when a provider or browser-use runtime exposes more policy state.',
      openIssues: [
        {
          category: 'provider-adapter',
          issue: 'Real remote-host Settings adapters are not implemented.',
          requiredEvidence: 'Remote-host provider data and mutations for settings surfaces.'
        },
        {
          category: 'provider-adapter',
          issue: 'Codex Personalization data is not available in Orchestrator host scope.',
          requiredEvidence: 'Provider-backed personalization data contract.'
        },
        {
          category: 'provider-adapter',
          issue: 'Provider-backed Browser Use settings beyond persisted local defaults are not implemented.',
          requiredEvidence: 'Browser-use runtime or provider policy state beyond approval/history/download/upload/domain defaults.'
        }
      ]
    },
    {
      id: 'chat-sidebar-provider-state',
      area: 'Chat sidebar provider state',
      scope: 'Left sidebar',
      captureIds: ['chat-sidebar'],
      codexAssetNames: ['sidebar-project-group-signals-', 'sidebar-thread-keys-', 'sidebar-thread-list-signals-', 'pinned-threads-query-', 'set-pinned-thread-'],
      sourceEvidence: [
        { path: 'scripts/codex-pinned-threads-live-proof.mjs', terms: ['set-thread-pinned', 'set-pinned-threads-order', 'list-pinned-threads', 'cleanupDisposableThreads'] },
        { path: 'package.json', terms: ['live:codex-pinned-threads'] }
      ],
      artifactEvidence: [
        {
          path: 'tmp/codex-pinned-threads-live-proof/result.json',
          checks: [
            { path: 'ok', equals: false },
            { path: 'unsupportedMethods', includes: 'list-pinned-threads' },
            { path: 'methods', includes: 'list-pinned-threads' }
          ]
        }
      ],
      smokeChecks: ['providerPinnedMetadata', 'sidebarProviderPinBoundary', 'providerWorktreeMetadata', 'sidebarConnectionGrouping', 'sidebarPinnedDragReorder', 'sidebarProviderPinnedOrderPreserved', 'sidebarRowDensityCodexLike', 'sessionRowsTextFirst', 'sidebarPinnedRowsTextFirst', 'chatsHeaderTextFirst', 'sidebarFooterCollapseAffordance'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Provider thread-list projection, local provider-pinned ordering preservation, local pin order, Codex-compact row density, text-first session rows, text-first top-level Chats section header, and the footer collapse affordance are covered. Codex bundle chunks expose list-pinned-threads, set-thread-pinned, and set-pinned-threads-order, but the current live stdio app-server rejects list-pinned-threads as an unknown variant, so Orchestrator keeps provider-projected pin actions read-only instead of exposing a broken mutation path.',
      next: 'Re-enable Codex provider pin mutations only when the live app-server exposes a safe list/set/order boundary, then add non-Codex provider pin adapters when those providers expose comparable state.',
      openIssues: [
        {
          category: 'provider-proof',
          issue: 'Live Codex pinned list/set/order mutation remains unavailable through the current stdio app-server.',
          requiredEvidence: 'Safe reversible live pin/unpin and reorder test against disposable Codex threads, including post-mutation list-pinned-threads state.'
        },
        {
          category: 'provider-adapter',
          issue: 'Non-Codex provider pin adapters remain incomplete.',
          requiredEvidence: 'Comparable provider pin list/set/order contracts for non-Codex providers.'
        },
        {
          category: 'live-codex-ui',
          issue: 'Future sidebar spacing changes still need fresh live Codex screenshots before overriding the compact density contract.',
          requiredEvidence: 'Fresh nonblank Codex sidebar screenshot showing row spacing or order drift.'
        }
      ]
    }
  ]
}

function evaluateContract(contract, manifest, codexAssets, sourceCache, artifactCache, fileCache) {
  const codex = evaluateCodexEvidence(contract, codexAssets)
  const source = evaluateSourceEvidence(contract, sourceCache)
  const artifact = evaluateArtifactEvidence(contract, artifactCache)
  const file = evaluateFileEvidence(contract, fileCache)
  const smoke = evaluateSmokeEvidence(contract, manifest)
  const status = contract.forcedStatus ?? inferStatus(contract, codex, source, artifact, file, smoke)
  return {
    id: contract.id,
    area: contract.area,
    scope: contract.scope,
    status,
    codex,
    source,
    artifact,
    file,
    smoke,
    caveat: contract.caveat,
    next: contract.next,
    openIssues: contract.openIssues ?? []
  }
}

function inferStatus(contract, codex, source, artifact, file, smoke) {
  if (!codex.available) return 'blocked'
  if (source.available && source.passed === false) return 'mismatch'
  if (artifact.available && artifact.passed === false) return 'mismatch'
  if (artifact.required && !artifact.available) return 'needs-proof'
  if (file.required && file.available && file.passed === false) return 'mismatch'
  if (file.required && !file.available) return 'needs-proof'
  if (!smoke.available) return 'needs-smoke'
  if (smoke.infrastructureFailed) return 'needs-smoke'
  if (!smoke.passed) return 'mismatch'
  return contract.statusWhenCovered ?? 'fixture-covered'
}

function evaluateCodexEvidence(contract, codexAssets) {
  const assetResults = []
  for (const spec of contract.codexAssets ?? []) {
    const text = codexAssets.readByBasename(spec.basename)
    assetResults.push({
      asset: spec.basename,
      available: text !== null,
      terms: spec.terms.map((term) => ({ term, found: text?.includes(term) === true }))
    })
  }
  for (const prefix of contract.codexAssetNames ?? []) {
    assetResults.push({
      asset: `${prefix}*`,
      available: codexAssets.hasAssetPrefix(prefix),
      terms: []
    })
  }
  const available = assetResults.length > 0 && assetResults.every((asset) => asset.available && asset.terms.every((term) => term.found))
  return { available, assets: assetResults }
}

function evaluateSourceEvidence(contract, sourceCache) {
  const sourceResults = []
  for (const spec of contract.sourceEvidence ?? []) {
    const path = join(root, spec.path)
    let text = sourceCache.get(path)
    if (text === undefined) {
      text = existsSync(path) ? readFileSync(path, 'utf8') : null
      sourceCache.set(path, text)
    }
    sourceResults.push({
      path: spec.path,
      available: text !== null,
      terms: spec.terms.map((term) => ({ term, found: text?.includes(term) === true }))
    })
  }
  if (sourceResults.length === 0) return { available: false, passed: null, files: [] }
  return {
    available: true,
    passed: sourceResults.every((file) => file.available && file.terms.every((term) => term.found)),
    files: sourceResults
  }
}

function evaluateArtifactEvidence(contract, artifactCache) {
  const artifactResults = []
  for (const spec of contract.artifactEvidence ?? []) {
    const path = join(root, spec.path)
    let parsed = artifactCache.get(path)
    if (parsed === undefined) {
      parsed = readJsonFile(path)
      artifactCache.set(path, parsed)
    }
    const text = parsed == null ? null : JSON.stringify(parsed)
    artifactResults.push({
      path: spec.path,
      available: parsed !== null,
      terms: (spec.terms ?? []).map((term) => ({ term, found: text?.includes(term) === true })),
      checks: (spec.checks ?? []).map((check) => evaluateArtifactCheck(parsed, check))
    })
  }
  if (artifactResults.length === 0) return { required: false, available: false, passed: null, files: [] }
  return {
    required: true,
    available: artifactResults.every((file) => file.available),
    passed: artifactResults.every((file) =>
      file.available &&
      file.terms.every((term) => term.found) &&
      file.checks.every((check) => check.passed)
    ),
    files: artifactResults
  }
}

function evaluateFileEvidence(contract, fileCache) {
  const fileResults = []
  const now = Date.now()
  for (const spec of contract.fileEvidence ?? []) {
    const resolvedPath = spec.path.startsWith('/') ? spec.path : join(root, spec.path)
    let cached = fileCache.get(resolvedPath)
    if (cached === undefined) {
      if (existsSync(resolvedPath)) {
        const stat = statSync(resolvedPath)
        cached = {
          available: true,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          mtimeIso: stat.mtime.toISOString(),
          image: inspectImageEvidence(resolvedPath)
        }
      } else {
        cached = { available: false, size: 0, mtimeMs: null, mtimeIso: null, image: null }
      }
      fileCache.set(resolvedPath, cached)
    }
    const minBytesPassed = cached.available && (spec.minBytes == null || cached.size >= spec.minBytes)
    const ageHours = cached.mtimeMs == null ? null : (now - cached.mtimeMs) / (1000 * 60 * 60)
    const freshnessPassed = cached.available && (spec.maxAgeHours == null || ageHours <= spec.maxAgeHours)
    const imagePassed = !spec.imageNonBlank || (cached.image?.nonBlank === true)
    fileResults.push({
      path: spec.path,
      label: spec.label ?? spec.path,
      required: spec.required === true,
      available: cached.available,
      size: cached.size,
      mtimeIso: cached.mtimeIso,
      maxAgeHours: spec.maxAgeHours ?? null,
      ageHours,
      minBytes: spec.minBytes ?? null,
      imageNonBlank: spec.imageNonBlank === true,
      image: cached.image,
      passed: minBytesPassed && freshnessPassed && imagePassed
    })
  }
  if (fileResults.length === 0) return { required: false, available: false, passed: null, files: [] }
  return {
    required: fileResults.some((file) => file.required),
    available: fileResults.every((file) => file.available),
    passed: fileResults.every((file) => file.passed),
    files: fileResults
  }
}

function inspectImageEvidence(path) {
  if (!path.endsWith('.png')) return null
  try {
    return inspectPngImage(path)
  } catch (error) {
    return {
      inspected: false,
      nonBlank: false,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

function inspectPngImage(path) {
  const bytes = readFileSync(path)
  const signature = bytes.subarray(0, 8)
  if (!signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { inspected: false, nonBlank: false, reason: 'not a png' }
  }

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idatChunks = []
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.length) break
    if (type === 'IHDR') {
      width = bytes.readUInt32BE(dataStart)
      height = bytes.readUInt32BE(dataStart + 4)
      bitDepth = bytes[dataStart + 8]
      colorType = bytes[dataStart + 9]
      interlace = bytes[dataStart + 12]
    } else if (type === 'IDAT') {
      idatChunks.push(bytes.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }

  if (width <= 0 || height <= 0 || idatChunks.length === 0) {
    return { inspected: false, nonBlank: false, reason: 'missing image data' }
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    return {
      inspected: false,
      nonBlank: false,
      reason: `unsupported png format bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`,
      width,
      height
    }
  }

  const channels = colorType === 6 ? 4 : 3
  const rowLength = width * channels
  const inflated = inflateSync(Buffer.concat(idatChunks))
  const expectedLength = (rowLength + 1) * height
  if (inflated.length < expectedLength) {
    return { inspected: false, nonBlank: false, reason: 'truncated image data', width, height }
  }

  const sampleEvery = Math.max(1, Math.floor((width * height) / 50000))
  const previous = Buffer.alloc(rowLength)
  const current = Buffer.alloc(rowLength)
  let sampled = 0
  let nonTransparent = 0
  let nonBlack = 0
  let luminanceSum = 0
  let luminanceSquares = 0
  const colorBuckets = new Set()

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowLength + 1)
    const filter = inflated[rowStart]
    inflated.copy(current, 0, rowStart + 1, rowStart + 1 + rowLength)
    unfilterPngRow(current, previous, channels, filter)

    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x
      if (pixelIndex % sampleEvery !== 0) continue
      const offset = x * channels
      const red = current[offset]
      const green = current[offset + 1]
      const blue = current[offset + 2]
      const alpha = channels === 4 ? current[offset + 3] : 255
      const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
      sampled += 1
      luminanceSum += luminance
      luminanceSquares += luminance * luminance
      if (alpha > 16) nonTransparent += 1
      if (alpha > 16 && (red > 5 || green > 5 || blue > 5)) nonBlack += 1
      if (colorBuckets.size < 256) {
        colorBuckets.add(`${red >> 4}:${green >> 4}:${blue >> 4}:${alpha >> 4}`)
      }
    }

    current.copy(previous)
  }

  const meanLuminance = sampled > 0 ? luminanceSum / sampled : 0
  const luminanceVariance = sampled > 0 ? Math.max(0, (luminanceSquares / sampled) - (meanLuminance * meanLuminance)) : 0
  const luminanceStdDev = Math.sqrt(luminanceVariance)
  const nonTransparentRatio = sampled > 0 ? nonTransparent / sampled : 0
  const nonBlackRatio = sampled > 0 ? nonBlack / sampled : 0
  const nonBlank = nonTransparentRatio >= 0.01 && nonBlackRatio >= 0.005 && luminanceStdDev >= 2 && colorBuckets.size >= 3

  return {
    inspected: true,
    nonBlank,
    width,
    height,
    sampled,
    nonTransparentRatio: Number(nonTransparentRatio.toFixed(4)),
    nonBlackRatio: Number(nonBlackRatio.toFixed(4)),
    luminanceStdDev: Number(luminanceStdDev.toFixed(2)),
    colorBucketCount: colorBuckets.size
  }
}

function unfilterPngRow(row, previous, bytesPerPixel, filter) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0
    const up = previous[index] ?? 0
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0
    switch (filter) {
      case 0:
        break
      case 1:
        row[index] = (row[index] + left) & 0xff
        break
      case 2:
        row[index] = (row[index] + up) & 0xff
        break
      case 3:
        row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff
        break
      case 4:
        row[index] = (row[index] + paethPredictor(left, up, upLeft)) & 0xff
        break
      default:
        throw new Error(`unsupported png filter ${filter}`)
    }
  }
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  if (upDistance <= upLeftDistance) return up
  return upLeft
}

function evaluateArtifactCheck(parsed, check) {
  if (parsed == null) return { ...check, passed: false }
  if (check.serverToolCall) {
    const [namespace, tool] = String(check.serverToolCall).split('.')
    const requests = Array.isArray(parsed.serverRequests) ? parsed.serverRequests : []
    const passed = requests.some((request) => {
      const preview = typeof request?.paramsPreview === 'string' ? request.paramsPreview : ''
      try {
        const params = JSON.parse(preview)
        return params.namespace === namespace && params.tool === tool
      } catch {
        return false
      }
    })
    return { ...check, passed }
  }

  const value = artifactValueAtPath(parsed, check.path)
  if ('equals' in check) return { ...check, passed: value === check.equals }
  if ('includes' in check) {
    const needle = check.includes
    const passed = Array.isArray(value)
      ? value.includes(needle)
      : (typeof value === 'string' && value.includes(needle))
    return { ...check, passed }
  }
  return { ...check, passed: false }
}

function artifactValueAtPath(value, path) {
  if (!path) return value
  return String(path).split('.').reduce((current, key) => {
    if (current == null || typeof current !== 'object') return undefined
    return current[key]
  }, value)
}

function evaluateSmokeEvidence(contract, manifest) {
  if (manifest == null) return { available: false, passed: false, captures: [], checks: [] }
  const captures = (contract.captureIds ?? []).map((id) => manifest.captures?.find((capture) => capture.id === id) ?? null)
  const checks = []
  for (const key of contract.smokeChecks ?? []) {
    const owner = captures.find((capture) => capture?.checks && Object.prototype.hasOwnProperty.call(capture.checks, key))
    checks.push({
      key,
      captureId: owner?.id ?? null,
      passed: owner?.checks?.[key] === true
    })
  }
  const captureSummaries = captures.map((capture, index) => ({
    id: contract.captureIds[index],
    available: capture != null,
    ok: capture?.ok === true,
    flag: capture?.flag ?? null,
    screenshotPath: capture?.screenshotPath ?? null,
    failureKind: capture?.failureKind ?? null,
    failureSummary: capture?.failureSummary ?? null
  }))
  const infrastructureFailures = captureSummaries.filter((capture) => capture.failureKind === 'infrastructure')
  return {
    available: captures.some(Boolean),
    infrastructureFailed: infrastructureFailures.length > 0,
    passed: captureSummaries.every((capture) => capture.available && capture.ok) && checks.every((check) => check.passed),
    captures: captureSummaries,
    infrastructureFailures,
    checks
  }
}

function summarizeRows(rows, manifest) {
  const statusCounts = {}
  for (const row of rows) statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1
  const optionalFileEvidenceFailures = []
  for (const row of rows) {
    for (const file of row.file?.files ?? []) {
      if (file.required === true || file.passed === true) continue
      optionalFileEvidenceFailures.push({
        rowId: row.id,
        area: row.area,
        path: file.path,
        label: file.label,
        available: file.available,
        reason: summarizeFileEvidenceFailure(file)
      })
    }
  }
  const smokeFailureKinds = {}
  for (const capture of manifest?.captures ?? []) {
    if (capture.ok === true) continue
    const kind = capture.failureKind ?? 'unknown'
    smokeFailureKinds[kind] = (smokeFailureKinds[kind] ?? 0) + 1
  }
  const remainingParityGaps = []
  const remainingParityGapCounts = {}
  for (const row of rows) {
    for (const issue of row.openIssues ?? []) {
      const category = issue.category ?? 'uncategorized'
      remainingParityGapCounts[category] = (remainingParityGapCounts[category] ?? 0) + 1
      remainingParityGaps.push({
        rowId: row.id,
        area: row.area,
        category,
        issue: issue.issue,
        requiredEvidence: issue.requiredEvidence
      })
    }
  }
  return {
    statusCounts,
    optionalFileEvidenceFailures,
    remainingParityGaps,
    remainingParityGapCounts,
    smokeCaptures: manifest?.captures?.length ?? 0,
    smokeFailures: manifest?.failed ?? [],
    smokeFailureKinds
  }
}

function summarizeFileEvidenceFailure(file) {
  if (!file.available) return 'missing'
  if (file.minBytes != null && Number(file.size ?? 0) < file.minBytes) return `too small: ${file.size} < ${file.minBytes} bytes`
  if (file.maxAgeHours != null && Number(file.ageHours ?? 0) > file.maxAgeHours) return `stale: ${formatAge(file.ageHours)} old`
  if (file.imageNonBlank === true && file.image?.nonBlank !== true) {
    if (file.image?.reason) return `image not usable: ${file.image.reason}`
    const nonBlack = file.image?.nonBlackRatio
    const luma = file.image?.luminanceStdDev
    if (typeof nonBlack === 'number' || typeof luma === 'number') {
      return `image blank: nonBlack=${formatMetric(nonBlack)}, lumaStdDev=${formatMetric(luma)}`
    }
    return 'image blank'
  }
  return 'failed evidence check'
}

function formatMetric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(Number(value.toFixed(6))) : 'unknown'
}

function writeHeaderPanelContactSheet(report) {
  const row = report.rows.find((entry) => entry.id === 'app-shell-header-panel-interaction')
  const outputPath = join(outDir, 'header-panel-contact-sheet.html')
  const liveScreenshot = row?.file?.files?.find((entry) => entry.path === liveCodexScreenshotPath) ?? null
  const captureIds = ['chat-sidebar', 'header', 'transcript-narrow', 'workbench-right-panel', 'files', 'browser', 'review-last-turn', 'review-core', 'terminal-bottom-panel', 'multi-window-focus']
  const captures = captureIds.map((id) => {
    const capture = report.captures.find((entry) => entry.id === id)
    const smokeCapture = row?.smoke?.captures?.find((entry) => entry.id === id)
    return {
      id,
      surface: capture?.surface ?? id,
      state: capture?.state ?? '',
      ok: capture?.ok === true && smokeCapture?.ok === true,
      screenshotPath: capture?.screenshotPath ?? smokeCapture?.screenshotPath ?? null,
      failedChecks: capture?.failedChecks ?? []
    }
  })
  const checks = row?.smoke?.checks ?? []
  const cards = [
    {
      title: 'Codex live shell evidence',
      subtitle: liveScreenshot?.available
        ? `${liveScreenshot.size} bytes, age ${liveScreenshot.ageHours == null ? 'unknown' : formatAge(liveScreenshot.ageHours)}`
        : 'missing live screenshot',
      status: liveScreenshot?.passed === true ? 'ok' : 'needs fresh proof',
      imagePath: liveScreenshot?.available ? liveScreenshot.path : null
    },
    ...captures.map((capture) => ({
      title: capture.id,
      subtitle: `${capture.surface}${capture.state ? `, ${capture.state}` : ''}`,
      status: capture.ok ? 'ok' : 'failed',
      imagePath: capture.screenshotPath
    }))
  ]
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Header and Panel Interaction Contact Sheet</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f1115;
      color: #f5f7fb;
    }
    body {
      margin: 0;
      padding: 24px;
      background: #0f1115;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      font-weight: 650;
      letter-spacing: 0;
    }
    p {
      margin: 0 0 16px;
      max-width: 960px;
      color: #b8bfcc;
      font-size: 13px;
      line-height: 1.5;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 20px;
    }
    .pill {
      border: 1px solid #303746;
      border-radius: 999px;
      padding: 4px 9px;
      color: #d9deea;
      background: #171b23;
      font-size: 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 14px;
      align-items: start;
    }
    .card {
      overflow: hidden;
      border: 1px solid #303746;
      border-radius: 8px;
      background: #171b23;
    }
    .cardHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid #303746;
    }
    .title {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .title strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    .title span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #a7afbd;
      font-size: 12px;
    }
    .status {
      flex: 0 0 auto;
      border: 1px solid #394252;
      border-radius: 999px;
      padding: 3px 8px;
      color: #d9deea;
      font-size: 11px;
      text-transform: uppercase;
    }
    .status.ok {
      border-color: #2d6a4f;
      color: #b7f7d0;
      background: #10251b;
    }
    .status.warn {
      border-color: #7f5f20;
      color: #ffe0a3;
      background: #2b2110;
    }
    .imageFrame {
      display: grid;
      place-items: center;
      min-height: 220px;
      background: #0b0d12;
    }
    img {
      display: block;
      max-width: 100%;
      height: auto;
    }
    .missing {
      padding: 48px 16px;
      color: #a7afbd;
      font-size: 13px;
      text-align: center;
    }
    table {
      width: 100%;
      margin-top: 18px;
      border-collapse: collapse;
      border: 1px solid #303746;
      background: #171b23;
      font-size: 12px;
    }
    th,
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #303746;
      text-align: left;
    }
    th {
      color: #cfd5e3;
      font-weight: 600;
      background: #1d222c;
    }
  </style>
</head>
<body>
  <h1>Header and Panel Interaction</h1>
  <p>This contact sheet groups the live Codex shell screenshot with Orchestrator's sidebar, focused header, primary-header, Workbench, Files, Browser, Review, and bottom-panel captures. It is a review aid for relationship drift between surfaces; the smoke checks below remain the executable contract.</p>
  <div class="meta">
    <span class="pill">Generated ${escapeHtml(report.createdAt)}</span>
    <span class="pill">Comparison status ${escapeHtml(row?.status ?? 'missing')}</span>
    <span class="pill">Smoke captures ${escapeHtml(String(report.summary.smokeCaptures))}</span>
  </div>
  <section class="grid">
    ${cards.map(renderContactSheetCard).join('\n    ')}
  </section>
  <table>
    <thead>
      <tr><th>Smoke check</th><th>Capture</th><th>Status</th></tr>
    </thead>
    <tbody>
      ${checks.map((check) => `<tr><td>${escapeHtml(check.key)}</td><td>${escapeHtml(check.captureId ?? '')}</td><td>${check.passed ? 'ok' : 'failed'}</td></tr>`).join('\n      ')}
    </tbody>
  </table>
</body>
</html>
`
  writeFileSync(outputPath, html)
  return outputPath
}

function renderContactSheetCard(card) {
  const statusClass = card.status === 'ok' ? 'ok' : 'warn'
  const image = card.imagePath
    ? `<img src="${escapeHtml(pathToFileURL(card.imagePath).href)}" alt="${escapeHtml(card.title)}">`
    : '<div class="missing">No screenshot available</div>'
  return `<article class="card">
      <div class="cardHeader">
        <div class="title">
          <strong>${escapeHtml(card.title)}</strong>
          <span>${escapeHtml(card.subtitle)}</span>
        </div>
        <span class="status ${statusClass}">${escapeHtml(card.status)}</span>
      </div>
      <div class="imageFrame">${image}</div>
    </article>`
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Codex Side Panel Comparison Report')
  lines.push('')
  lines.push(`Generated: ${report.createdAt}`)
  lines.push('')
  lines.push(`Scope: ${report.scope}`)
  lines.push('')
  lines.push('## Runbook')
  lines.push('')
  lines.push('- Reuse latest smoke manifest: `npm run compare:codex-side-panels`')
  lines.push('- Regenerate full side-panel smoke first: `npm run compare:codex-side-panels -- --run-smoke --full`')
  lines.push('- Reproduce one visual capture: `node scripts/run-side-panel-visual-inventory.mjs --full --only terminal-behavior --out tmp/terminal-repro`')
  lines.push('- Regenerate from the packaged temp app: `npm run compare:codex-side-panels -- --run-smoke --full --packaged`')
  lines.push('- Regenerate from `/Applications/Orchestrator.app` with an isolated profile: `npm run compare:codex-side-panels -- --run-smoke --full --installed`')
  lines.push('- Attempt a fresh live Codex screenshot before comparing: `npm run compare:codex-side-panels -- --capture-live-codex --no-fail`')
  lines.push('- Generate the report without failing the shell on known mismatches: `npm run compare:codex-side-panels -- --no-fail`')
  lines.push('- Custom output: `npm run compare:codex-side-panels -- --out tmp/my-comparison --smoke-out tmp/my-smoke --run-smoke --full`')
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- Codex bundle: ${report.codexAsarAvailable ? report.codexAsarPath : `missing at ${report.codexAsarPath}`}`)
  lines.push(`- Smoke manifest: ${report.smokeManifestAvailable ? report.smokeManifestPath : `missing at ${report.smokeManifestPath}`}`)
  lines.push(`- Smoke app mode: ${report.smokeAppMode}`)
  lines.push(`- Smoke captures: ${report.summary.smokeCaptures}`)
  lines.push(`- Smoke failures: ${report.summary.smokeFailures.length === 0 ? 'none' : report.summary.smokeFailures.join(', ')}`)
  lines.push(`- Smoke failure kinds: ${formatStatusCounts(report.summary.smokeFailureKinds)}`)
  lines.push(`- Optional file evidence failures: ${report.summary.optionalFileEvidenceFailures.length === 0 ? 'none' : report.summary.optionalFileEvidenceFailures.length}`)
  for (const failure of report.summary.optionalFileEvidenceFailures) {
    lines.push(`  - ${failure.area}: ${failure.label} (${failure.reason})`)
  }
  lines.push(`- Remaining parity gaps: ${report.summary.remainingParityGaps.length === 0 ? 'none' : report.summary.remainingParityGaps.length}`)
  lines.push(`- Remaining parity gap categories: ${formatStatusCounts(report.summary.remainingParityGapCounts)}`)
  if (report.liveCaptureAttempt) {
    lines.push(`- Live Codex capture: ${summarizeLiveCaptureAttempt(report.liveCaptureAttempt)}`)
  }
  lines.push(`- Status counts: ${Object.entries(report.summary.statusCounts).map(([key, value]) => `${key}=${value}`).join(', ')}`)
  lines.push(`- Header/panel contact sheet: ${relative(root, report.artifacts.headerPanelContactSheetPath)}`)
  lines.push('')
  if (report.summary.remainingParityGaps.length > 0) {
    lines.push('## Remaining Parity Gaps')
    lines.push('')
    lines.push('| Area | Category | Gap | Required evidence |')
    lines.push('| --- | --- | --- | --- |')
    for (const gap of report.summary.remainingParityGaps) {
      lines.push([
        gap.area,
        gap.category,
        gap.issue,
        gap.requiredEvidence
      ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
    }
    lines.push('')
  }
  lines.push('## Comparison Matrix')
  lines.push('')
  lines.push('| Area | Scope | Status | Codex Evidence | Live Evidence | Orchestrator Smoke | Next |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const row of report.rows) {
    lines.push([
      row.area,
      row.scope,
      row.status,
      summarizeCodex(row.codex),
      summarizeLiveEvidence(row.artifact, row.file),
      summarizeSmoke(row.smoke),
      `${row.caveat} ${row.next}`
    ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  }
  lines.push('')
  lines.push('## Smoke Captures')
  lines.push('')
  lines.push('| Capture | Surface | Result | Screenshot | Failure | Failed Checks |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const capture of report.captures) {
    const screenshot = capture.screenshotPath ? relative(root, capture.screenshotPath) : ''
    lines.push([
      capture.id,
      `${capture.surface} (${capture.state})`,
      capture.ok ? 'ok' : 'failed',
      screenshot,
      [capture.failureKind, capture.failureSummary].filter(Boolean).join(': '),
      capture.failedChecks.length === 0 ? '' : capture.failedChecks.join(', ')
    ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function summarizeCodex(codex) {
  if (!codex.available) return 'missing or incomplete'
  return codex.assets.map((asset) => asset.asset).join(', ')
}

function summarizeArtifact(artifact) {
  if (!artifact.required) return ''
  if (!artifact.available) return 'missing'
  const failed = []
  for (const file of artifact.files) {
    const missingTerms = file.terms.filter((term) => !term.found).map((term) => term.term)
    const missingChecks = file.checks.filter((check) => !check.passed).map((check) =>
      check.serverToolCall ? `serverToolCall ${check.serverToolCall}` : check.path
    )
    if (missingTerms.length > 0 || missingChecks.length > 0) {
      failed.push(`${file.path}: ${[...missingTerms, ...missingChecks].join(', ')}`)
    }
  }
  if (failed.length > 0) return `failed: ${failed.join('; ')}`
  return artifact.files.map((file) => file.path).join(', ')
}

function summarizeLiveEvidence(artifact, file) {
  return [summarizeArtifact(artifact), summarizeFileEvidence(file)].filter(Boolean).join('; ')
}

function summarizeFileEvidence(file) {
  if (file.files.length === 0) return ''
  return file.files.map((entry) => {
    if (!entry.available) return `${entry.label}: missing`
    const age = entry.ageHours == null ? '' : `, age ${formatAge(entry.ageHours)}`
    const image = summarizeImageEvidence(entry)
    const status = entry.passed ? 'ok' : 'stale/incomplete'
    return `${entry.label}: ${status} (${entry.path}, ${entry.size} bytes${age}${image})`
  }).join('; ')
}

function summarizeImageEvidence(entry) {
  if (entry.imageNonBlank !== true) return ''
  if (entry.image == null) return ', image not inspected'
  if (entry.image.inspected !== true) return `, image failed: ${entry.image.reason ?? 'not inspected'}`
  return `, nonBlack=${entry.image.nonBlackRatio}, lumaStdDev=${entry.image.luminanceStdDev}, colors=${entry.image.colorBucketCount}`
}

function summarizeLiveCaptureAttempt(attempt) {
  if (attempt.skipped) return `skipped (${attempt.reason})`
  const exit = attempt.exitCode == null ? 'unknown' : String(attempt.exitCode)
  const method = attempt.selectedMethod ? `method=${attempt.selectedMethod}, ` : ''
  const windows = Array.isArray(attempt.windows?.windows) ? `, windows=${attempt.windows.windows.length}` : ''
  const attempts = Array.isArray(attempt.attempts)
    ? `, attempts=${attempt.attempts.map((item) => `${item.method}:${item.exitCode ?? 'unknown'}:${item.image?.nonBlank === true ? 'nonblank' : item.available ? 'image' : 'none'}`).join('/')}`
    : ''
  const image = attempt.image?.inspected === true
    ? `, nonBlank=${attempt.image.nonBlank}, nonBlack=${attempt.image.nonBlackRatio}, lumaStdDev=${attempt.image.luminanceStdDev}, colors=${attempt.image.colorBucketCount}`
    : attempt.image?.reason
      ? `, image=${attempt.image.reason}`
      : ''
  return `${method}exit=${exit}, available=${attempt.available === true}${windows}${attempts}${image}`
}

function formatAge(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  return `${hours.toFixed(1)}h`
}

function summarizeSmoke(smoke) {
  if (!smoke.available) return 'missing'
  const captures = smoke.captures.map((capture) => `${capture.id}:${capture.ok ? 'ok' : 'fail'}`).join(', ')
  if (smoke.infrastructureFailed) {
    const failures = smoke.infrastructureFailures.map((capture) =>
      `${capture.id}${capture.failureSummary ? ` (${capture.failureSummary})` : ''}`
    )
    return `${captures}; smoke infrastructure failed: ${failures.join(', ')}`
  }
  const failed = smoke.checks.filter((check) => !check.passed).map((check) => check.key)
  return failed.length === 0 ? captures : `${captures}; failed checks: ${failed.join(', ')}`
}

function formatStatusCounts(counts) {
  const entries = Object.entries(counts ?? {})
  if (entries.length === 0) return 'none'
  return entries.map(([key, value]) => `${key}=${value}`).join(', ')
}

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function failedChecks(checks) {
  if (checks == null) return []
  return Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key)
}

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function readJsonFile(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function CodexAssetReader(asarPath) {
  this.asarPath = asarPath
  this.list = null
  this.textByBasename = new Map()
}

CodexAssetReader.prototype.assetList = function assetList() {
  if (this.list !== null) return this.list
  if (!existsSync(this.asarPath)) {
    this.list = []
    return this.list
  }
  try {
    this.list = asar.listPackage(this.asarPath)
  } catch {
    this.list = []
  }
  return this.list
}

CodexAssetReader.prototype.hasAssetPrefix = function hasAssetPrefix(prefix) {
  return this.assetList().some((entry) => basename(entry).startsWith(prefix))
}

CodexAssetReader.prototype.readByBasename = function readByBasename(name) {
  if (this.textByBasename.has(name)) return this.textByBasename.get(name)
  const entry = this.assetList().find((entry) => basename(entry) === name)
  if (!entry) {
    this.textByBasename.set(name, null)
    return null
  }
  try {
    const buffer = asar.extractFile(this.asarPath, entry.replace(/^\//, ''))
    const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer)
    this.textByBasename.set(name, text)
    return text
  } catch {
    this.textByBasename.set(name, null)
    return null
  }
}

function basename(path) {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

main()
