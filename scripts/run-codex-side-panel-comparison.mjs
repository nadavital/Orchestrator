#!/usr/bin/env node
import * as asar from '@electron/asar'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative, resolve } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outDir = resolve(readArg('--out') ?? join(root, 'tmp', 'codex-side-panel-comparison'))
const defaultSmokeDir = join(root, 'tmp', 'side-panel-visual-inventory-current')
const smokeOutDir = resolve(readArg('--smoke-out') ?? defaultSmokeDir)
const runSmoke = process.argv.includes('--run-smoke')
const fullSmoke = process.argv.includes('--full') || process.argv.includes('--full-smoke')
const noFail = process.argv.includes('--no-fail')
const manifestPath = resolve(readArg('--manifest') ?? join(smokeOutDir, 'manifest.json'))
const codexAsarPath = resolve(readArg('--codex-asar') ?? '/Applications/Codex.app/Contents/Resources/app.asar')

function main() {
mkdirSync(outDir, { recursive: true })

let smokeRun = null
if (runSmoke) {
  const args = ['run', 'smoke:visual:side-panels', '--', '--out', smokeOutDir]
  if (fullSmoke) args.push('--full')
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
  smokeRun,
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
  smokeManifestPath: manifestPath,
  statusCounts: summary.statusCounts,
  mismatchCount: summary.statusCounts.mismatch ?? 0,
  blockedCount: summary.statusCounts.blocked ?? 0,
  needsSmokeCount: summary.statusCounts['needs-smoke'] ?? 0,
  needsProofCount: summary.statusCounts['needs-proof'] ?? 0,
  exitCode,
  noFail
}, null, 2))

process.exit(noFail ? 0 : exitCode)
}

function buildContracts() {
  return [
    {
      id: 'app-shell-header-panel-interaction',
      area: 'Header and panel interaction',
      scope: 'Left sidebar, main header, right side panel, bottom panel',
      captureIds: ['chat-sidebar', 'header', 'transcript-narrow', 'workbench-right-panel', 'terminal-bottom-panel'],
      codexAssets: [
        { basename: 'app-shell-state-HP0T5lEX.js', terms: ['app-shell:right-panel-width:v2', 'app-shell-bottom-panel-launcher-visible'] },
        { basename: 'thread-page-bottom-panel-state-D1Lz0U4Y.js', terms: ['terminal-panel'] }
      ],
      fileEvidence: [
        {
          path: '/private/tmp/codex-current-screen.png',
          label: 'live Codex shell screenshot',
          minBytes: 100000,
          maxAgeHours: 72
        }
      ],
      smokeChecks: ['sidebarTopInsetCodexLike', 'sessionHeaderInPrimaryColumn', 'rightPanelHeaderSeam', 'headerPanelSharedBand', 'headerMetadataTooltipOnly', 'profileBadgeCompact', 'rightPanelMaterialSolid', 'terminalPanelMaterialSolid', 'terminalBottomPanelSizeDecomposition', 'terminalVisualHealthyContent'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Smoke covers Orchestrator panel/header geometry, primary-column header ownership, a shared header band across sidebar/main/right-panel chrome, compact profile/debug badge behavior, solid panel material, bottom-panel target size, and shell attachment; exact live Codex pixel spacing and animation timing still need live screenshots.',
      next: 'Keep header/panel interaction as a first-class contract whenever moving sidebar, Workbench, or bottom-panel shell layout.'
    },
    {
      id: 'right-side-workbench-shell',
      area: 'Right-side Workbench shell',
      scope: 'Right side panel',
      captureIds: ['workbench-right-panel', 'workbench-new-tab'],
      codexAssets: [
        { basename: 'thread-side-panel-tabs-CVr2AbYP.js', terms: ['app-shell-tab-controller', 'right-panel-composer-overlay', 'browser-sidebar-command'] },
        { basename: 'app-shell-tab-controller-B2eCi4Le.js', terms: ['activeTab$', 'tabs$'] }
      ],
      fileEvidence: [
        {
          path: '/private/tmp/codex-current-screen.png',
          label: 'live Codex right-panel/header screenshot',
          minBytes: 100000,
          maxAgeHours: 72
        }
      ],
      smokeChecks: ['rightPanelSharedAnimationController', 'rightPanelSharedLayoutController', 'rightPanelHeaderSeam', 'rightPanelMaterialSolid', 'rightPanelContextMenuSharedSections', 'workbenchPanelTabOverflowController', 'workbenchPanelNewTabPage', 'workbenchNewTabSingleAddAffordance'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Smoke covers Orchestrator shell behavior, tab overflow/no-collapse behavior, and app-shell tab controller structure; exact live Codex spacing and animation timing still need live UI evidence.',
      next: 'Use focused right-panel smoke for regressions; do not call exact timing complete without live Codex comparison.'
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
      next: 'Keep this as a regression contract and use live Codex comparison only for spacing, animation, and focus timing polish.'
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
      smokeChecks: ['reviewMetadataToolbar', 'reviewMetadataFlyoutShared', 'reviewTranscriptCardLastTurn', 'reviewLastTurnVisualState', 'reviewWorktreeProviderSource', 'reviewFullSourceBlame', 'reviewLineComments'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Fixture and local/GitHub-backed paths pass, including a direct Last turn transcript-card Review screenshot with the changed-files rail hidden, general PR and inline/threaded review comment summaries, provider comment line rendering, and GitHub review-comment commit/blame metadata. Live commented-PR proof, provider-native hosted/cloud sources, and checkpoint Undo are not live-proven.',
      next: 'Add one real provider-backed Review source or keep the unsupported UI explicit.'
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
        { path: 'src/main/browserClientToolSpecs.ts', terms: ['browser_open', 'browser_read', 'browserClientDynamicTools'] },
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
            { serverToolCall: 'orchestrator.browser_open' },
            { serverToolCall: 'orchestrator.browser_read' },
            { path: 'assistantText', includes: 'CODEX_BROWSER_LIVE_OK' }
          ]
        }
      ],
      smokeChecks: ['browserWebviewManagerBoundary', 'browserHiddenWebviewContainment', 'browserForkDomTransfer', 'browserUseNoMutation', 'browserManagerStateBridge', 'browserClientToolBridge'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Synthetic manager events, UI boundaries, smoke-only Browser renderer loopback, and live Codex app-server real browser_open/browser_read tool requests pass; native browser-use event streaming is still separate.',
      next: 'Expand click/type/screenshot coverage only from real browser-use requests or a full installed-app end-to-end run; keep unavailable runtime boundaries explicit.'
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
        { path: 'src/renderer/src/components/Session/BrowserPanel.tsx', terms: ['iPhone 15 Pro Max', 'Pixel 8', 'Surface Pro 7', 'iPhone SE', 'desktop4k'] }
      ],
      smokeChecks: ['browserCaptureGeometry', 'browserVisibleGeometry'],
      statusWhenCovered: 'aligned',
      caveat: 'Bundle/code dimensions match; live label/order comparison can still catch presentation differences.',
      next: 'Keep lower priority unless live UI comparison shows ordering or label drift.'
    },
    {
      id: 'terminal-bottom-panel',
      area: 'Terminal bottom panel',
      scope: 'Bottom panel',
      captureIds: ['terminal-bottom-panel'],
      codexAssets: [
        { basename: 'thread-page-bottom-panel-state-D1Lz0U4Y.js', terms: ['Terminal {index}', 'terminal-panel', 'terminal.tabs.title'] },
        { basename: 'terminal-service-BsiZiRKt.js', terms: ['conversationSessions', 'sessionSnapshots', 'terminal-create'] }
      ],
      smokeChecks: ['terminalPanelMaterialSolid', 'terminalBottomPanelSizeDecomposition', 'terminalVisualHealthyContent'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Terminal behavior, solid bottom-panel material, Codex-bundle-aligned 400 px default shell size, and screenshot are covered; exact Codex open-close timing is not live-proven.',
      next: 'Compare live panel animation timing when app UI access is available.'
    },
    {
      id: 'files-file-source-tabs',
      area: 'Files and file source tabs',
      scope: 'Right side panel Files',
      captureIds: ['files', 'review-source'],
      codexAssets: [
        { basename: 'review-file-source-tab-CjS7Xe_W.js', terms: ['Open file', 'Open in editor', 'Copy path', 'Show git blame', 'Enable rich view'] },
        { basename: 'notebook-preview-panel-CAO-aRhM.js', terms: ['Read only', 'Run all', 'Restart kernel', 'Raw output', 'Notebook output', 'details', 'summary'] }
      ],
      smokeChecks: ['filesContentSearch', 'filesActionMenuSharedSections', 'workbenchFileTabActionMenuSharedSections', 'filesNotebookReadOnlyControls', 'filesNotebookOutputRendering', 'filesNotebookCellDisclosure', 'reviewFullSourceRows', 'reviewFullSourceBlame'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Local file/source behavior is covered, including read-only notebook artifact controls, basic notebook output rendering, and Codex-style notebook cell disclosure shells. Full artifact renderer parity and provider-backed comments/blame remain incomplete.',
      next: 'Prioritize deeper notebook output styling, other artifact renderer controls, or provider metadata, not more local tree styling.'
    },
    {
      id: 'settings-host-scope',
      area: 'Settings host scope',
      scope: 'Settings window/surface',
      captureIds: ['settings', 'settings-providers', 'pets'],
      codexAssetNames: ['settings-', 'appearance-settings-', 'personalization-settings-', 'remote-connections-settings-', 'worktrees-settings-'],
      smokeChecks: ['settingsHostContext', 'settingsHostAdapterBoundary', 'settingsPersonalizationHostBoundary', 'settingsContentLayout'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Host-scoped unavailable states are explicit; real remote-host adapters and Codex Personalization data are still missing.',
      next: 'Add host adapters only where provider data exists.'
    },
    {
      id: 'chat-sidebar-provider-state',
      area: 'Chat sidebar provider state',
      scope: 'Left sidebar',
      captureIds: ['chat-sidebar'],
      codexAssetNames: ['sidebar-project-group-signals-', 'sidebar-thread-keys-', 'sidebar-thread-list-signals-'],
      smokeChecks: ['providerPinnedMetadata', 'sidebarProviderPinBoundary', 'providerWorktreeMetadata', 'sidebarConnectionGrouping', 'sidebarPinnedDragReorder', 'sidebarRowDensityCodexLike', 'sessionRowsTextFirst', 'sidebarPinnedRowsTextFirst'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Provider thread-list projection, local pin order, Codex-compact row density, and text-first session rows are covered. Provider-projected pinned rows are now read-only at the Sidebar action boundary because live provider pin set/list mutation is still blocked through the current app-server bridge.',
      next: 'Add real provider pin set/list adapters only when a provider exposes a safe mutation API; keep future sidebar spacing changes gated by the density check.'
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
    next: contract.next
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
          mtimeIso: stat.mtime.toISOString()
        }
      } else {
        cached = { available: false, size: 0, mtimeMs: null, mtimeIso: null }
      }
      fileCache.set(resolvedPath, cached)
    }
    const minBytesPassed = cached.available && (spec.minBytes == null || cached.size >= spec.minBytes)
    const ageHours = cached.mtimeMs == null ? null : (now - cached.mtimeMs) / (1000 * 60 * 60)
    const freshnessPassed = cached.available && (spec.maxAgeHours == null || ageHours <= spec.maxAgeHours)
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
      passed: minBytesPassed && freshnessPassed
    })
  }
  if (fileResults.length === 0) return { required: false, available: false, passed: null, files: [] }
  return {
    required: fileResults.some((file) => file.required),
    available: fileResults.every((file) => file.available),
    passed: fileResults.every((file) => !file.required || file.passed) && fileResults.every((file) => file.required || file.available),
    files: fileResults
  }
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
  const smokeFailureKinds = {}
  for (const capture of manifest?.captures ?? []) {
    if (capture.ok === true) continue
    const kind = capture.failureKind ?? 'unknown'
    smokeFailureKinds[kind] = (smokeFailureKinds[kind] ?? 0) + 1
  }
  return {
    statusCounts,
    smokeCaptures: manifest?.captures?.length ?? 0,
    smokeFailures: manifest?.failed ?? [],
    smokeFailureKinds
  }
}

function writeHeaderPanelContactSheet(report) {
  const row = report.rows.find((entry) => entry.id === 'app-shell-header-panel-interaction')
  const outputPath = join(outDir, 'header-panel-contact-sheet.html')
  const liveScreenshot = row?.file?.files?.find((entry) => entry.path === '/private/tmp/codex-current-screen.png') ?? null
  const captureIds = ['chat-sidebar', 'header', 'transcript-narrow', 'workbench-right-panel', 'terminal-bottom-panel']
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
  <p>This contact sheet groups the live Codex shell screenshot with Orchestrator's sidebar, focused header, primary-header, right-panel, and bottom-panel captures. It is a review aid for relationship drift between surfaces; the smoke checks below remain the executable contract.</p>
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
  lines.push('- Generate the report without failing the shell on known mismatches: `npm run compare:codex-side-panels -- --no-fail`')
  lines.push('- Custom output: `npm run compare:codex-side-panels -- --out tmp/my-comparison --smoke-out tmp/my-smoke --run-smoke --full`')
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- Codex bundle: ${report.codexAsarAvailable ? report.codexAsarPath : `missing at ${report.codexAsarPath}`}`)
  lines.push(`- Smoke manifest: ${report.smokeManifestAvailable ? report.smokeManifestPath : `missing at ${report.smokeManifestPath}`}`)
  lines.push(`- Smoke captures: ${report.summary.smokeCaptures}`)
  lines.push(`- Smoke failures: ${report.summary.smokeFailures.length === 0 ? 'none' : report.summary.smokeFailures.join(', ')}`)
  lines.push(`- Smoke failure kinds: ${formatStatusCounts(report.summary.smokeFailureKinds)}`)
  lines.push(`- Status counts: ${Object.entries(report.summary.statusCounts).map(([key, value]) => `${key}=${value}`).join(', ')}`)
  lines.push(`- Header/panel contact sheet: ${relative(root, report.artifacts.headerPanelContactSheetPath)}`)
  lines.push('')
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
    const status = entry.passed ? 'ok' : 'stale/incomplete'
    return `${entry.label}: ${status} (${entry.path}, ${entry.size} bytes${age})`
  }).join('; ')
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
