#!/usr/bin/env node
import * as asar from '@electron/asar'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, relative, resolve } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

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

const contracts = buildContracts()
const rows = contracts.map((contract) => evaluateContract(contract, manifest, codexAssets, sourceCache))
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
    failedChecks: failedChecks(capture.checks)
  }))
}

const jsonPath = join(outDir, 'comparison-report.json')
const markdownPath = join(outDir, 'comparison-report.md')
writeFileSync(jsonPath, JSON.stringify(report, null, 2))
writeFileSync(markdownPath, renderMarkdown(report))

const failedRows = rows.filter((row) => row.status === 'mismatch' || row.status === 'blocked')
const exitCode = failedRows.length > 0 ? 2 : (smokeRun != null && smokeRun.exitCode !== 0 ? 1 : 0)

console.log(JSON.stringify({
  markdownPath,
  jsonPath,
  smokeManifestPath: manifestPath,
  statusCounts: summary.statusCounts,
  mismatchCount: summary.statusCounts.mismatch ?? 0,
  blockedCount: summary.statusCounts.blocked ?? 0,
  exitCode,
  noFail
}, null, 2))

process.exit(noFail ? 0 : exitCode)
}

function buildContracts() {
  return [
    {
      id: 'right-side-workbench-shell',
      area: 'Right-side Workbench shell',
      scope: 'Right side panel',
      captureIds: ['workbench-right-panel', 'workbench-new-tab'],
      codexAssets: [
        { basename: 'thread-side-panel-tabs-CVr2AbYP.js', terms: ['app-shell-tab-controller', 'right-panel-composer-overlay', 'browser-sidebar-command'] },
        { basename: 'app-shell-tab-controller-B2eCi4Le.js', terms: ['activeTab$', 'tabs$'] }
      ],
      smokeChecks: ['rightPanelSharedAnimationController', 'rightPanelSharedLayoutController', 'rightPanelContextMenuSharedSections', 'workbenchPanelNewTabPage'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Smoke covers Orchestrator shell behavior; exact live Codex spacing and animation timing still need live UI evidence.',
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
        { path: 'src/renderer/src/App.tsx', terms: ['orchestrator:focus-review-file-search', 'orchestrator:focus-browser-find'] },
        { path: 'src/types/panelTabs.ts', terms: ['review-files', 'workspace-files', 'browser-page', 'source-file'] }
      ],
      smokeChecks: ['rightPanelFindShortcutRouting', 'reviewSearchContent'],
      forcedStatus: 'mismatch',
      caveat: 'Current smoke proves Orchestrator per-panel routing. Codex evidence shows one floating thread find bar with chat/diff scope and Browser webview delegation.',
      next: 'Implement a Codex-style thread find contract and rewrite this smoke to assert that behavior.'
    },
    {
      id: 'review-provider-metadata',
      area: 'Review provider metadata',
      scope: 'Right side panel Review',
      captureIds: ['review-entry', 'review-source'],
      codexAssets: [
        { basename: 'review-runtime-bridge-CZUIqW4U.js', terms: ['set-review-pane-snapshot-metrics-for-host', 'reviewDiffFilesTotal'] },
        { basename: 'review-header-toolbar-6CN1dM2m.js', terms: ['checks', 'reviewer'] }
      ],
      smokeChecks: ['reviewMetadataToolbar', 'reviewMetadataFlyoutShared', 'reviewWorktreeProviderSource', 'reviewFullSourceBlame'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Fixture and local/GitHub-backed paths pass, but provider-native hosted/cloud sources, checkpoint Undo, comments, and blame are not live-proven.',
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
      smokeChecks: ['browserWebviewManagerBoundary', 'browserHiddenWebviewContainment', 'browserForkDomTransfer', 'browserUseNoMutation', 'browserManagerStateBridge'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Synthetic manager events and UI boundaries pass; live provider-emitted Codex/browser-use proof is separate.',
      next: 'Run live provider/browser-use proof before claiming provider parity.'
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
      smokeChecks: ['terminalVisualHealthyContent'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Terminal behavior and screenshot are covered; exact Codex height/open-close timing is not live-proven.',
      next: 'Compare live panel height and animation timing when app UI access is available.'
    },
    {
      id: 'files-file-source-tabs',
      area: 'Files and file source tabs',
      scope: 'Right side panel Files',
      captureIds: ['files', 'review-source'],
      codexAssets: [
        { basename: 'review-file-source-tab-CjS7Xe_W.js', terms: ['Open file', 'Open in editor', 'Copy path', 'Show git blame', 'Enable rich view'] }
      ],
      smokeChecks: ['filesContentSearch', 'filesActionMenuSharedSections', 'workbenchFileTabActionMenuSharedSections', 'reviewFullSourceRows', 'reviewFullSourceBlame'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Local file/source behavior is covered; full artifact renderer parity and provider-backed comments/blame remain incomplete.',
      next: 'Prioritize artifact renderer controls or provider metadata, not more local tree styling.'
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
      smokeChecks: ['providerPinnedMetadata', 'providerWorktreeMetadata', 'sidebarConnectionGrouping', 'sidebarPinnedDragReorder'],
      statusWhenCovered: 'fixture-covered',
      caveat: 'Provider thread-list projection and local pin order are covered. Live provider pin set/list mutation is still blocked through the current app-server bridge.',
      next: 'Find a safe provider pin mutation boundary or keep local pin order clearly scoped.'
    }
  ]
}

function evaluateContract(contract, manifest, codexAssets, sourceCache) {
  const codex = evaluateCodexEvidence(contract, codexAssets)
  const source = evaluateSourceEvidence(contract, sourceCache)
  const smoke = evaluateSmokeEvidence(contract, manifest)
  const status = contract.forcedStatus ?? inferStatus(contract, codex, source, smoke)
  return {
    id: contract.id,
    area: contract.area,
    scope: contract.scope,
    status,
    codex,
    source,
    smoke,
    caveat: contract.caveat,
    next: contract.next
  }
}

function inferStatus(contract, codex, source, smoke) {
  if (!codex.available) return 'blocked'
  if (source.available && source.passed === false) return 'mismatch'
  if (!smoke.available) return 'needs-smoke'
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
    screenshotPath: capture?.screenshotPath ?? null
  }))
  return {
    available: captures.some(Boolean),
    passed: captureSummaries.every((capture) => capture.available && capture.ok) && checks.every((check) => check.passed),
    captures: captureSummaries,
    checks
  }
}

function summarizeRows(rows, manifest) {
  const statusCounts = {}
  for (const row of rows) statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1
  return {
    statusCounts,
    smokeCaptures: manifest?.captures?.length ?? 0,
    smokeFailures: manifest?.failed ?? []
  }
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
  lines.push(`- Status counts: ${Object.entries(report.summary.statusCounts).map(([key, value]) => `${key}=${value}`).join(', ')}`)
  lines.push('')
  lines.push('## Comparison Matrix')
  lines.push('')
  lines.push('| Area | Scope | Status | Codex Evidence | Orchestrator Smoke | Next |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const row of report.rows) {
    lines.push([
      row.area,
      row.scope,
      row.status,
      summarizeCodex(row.codex),
      summarizeSmoke(row.smoke),
      `${row.caveat} ${row.next}`
    ].map(markdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  }
  lines.push('')
  lines.push('## Smoke Captures')
  lines.push('')
  lines.push('| Capture | Surface | Result | Screenshot | Failed Checks |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const capture of report.captures) {
    const screenshot = capture.screenshotPath ? relative(root, capture.screenshotPath) : ''
    lines.push([
      capture.id,
      `${capture.surface} (${capture.state})`,
      capture.ok ? 'ok' : 'failed',
      screenshot,
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

function summarizeSmoke(smoke) {
  if (!smoke.available) return 'missing'
  const captures = smoke.captures.map((capture) => `${capture.id}:${capture.ok ? 'ok' : 'fail'}`).join(', ')
  const failed = smoke.checks.filter((check) => !check.passed).map((check) => check.key)
  return failed.length === 0 ? captures : `${captures}; failed checks: ${failed.join(', ')}`
}

function markdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>')
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
