#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

const targetRules = [
  { flag: '--composer', label: 'Composer', patterns: [/^src\/renderer\/src\/components\/Session\/InputBar\.tsx$/, /^src\/renderer\/src\/components\/Session\/Composer/, /^src\/renderer\/src\/components\/Session\/ChatComposer/, /^src\/renderer\/src\/components\/Session\/ComposerToolbar/, /^src\/renderer\/src\/store\/.*composer/i, /^src\/renderer\/src\/stores\/.*composer/i] },
  { flag: '--transcript-layout', label: 'Transcript', patterns: [/^src\/renderer\/src\/components\/Session\/(Transcript|ChatMessage|MessageActions)/, /^src\/renderer\/src\/components\/Session\/Tool/, /^src\/renderer\/src\/stores\/.*message/i] },
  { flag: '--transcript-file-reference', label: 'Transcript file references', patterns: [/^src\/renderer\/src\/components\/Session\/FileReference/, /^src\/renderer\/src\/components\/Session\/.*Reference/] },
  { flag: '--transcript-permission', label: 'Transcript permissions', patterns: [/^src\/renderer\/src\/components\/Session\/.*Permission/, /^src\/main\/.*permission/i, /^src\/main\/providers\/.*permission/i] },
  { flag: '--side-chat', label: 'Side chat', patterns: [/^src\/renderer\/src\/components\/Session\/SideChat/] },
  { flag: '--right-panel', label: 'Right Workbench shell', patterns: [/^src\/renderer\/src\/components\/Session\/(WorkbenchPanel|RightPanel|ContextSidebar)/, /^src\/renderer\/src\/components\/Session\/.*Workbench/, /^src\/renderer\/src\/components\/ui\/ToolbarButton/] },
  { flag: '--workbench-launcher', label: 'Workbench launcher', patterns: [/^src\/renderer\/src\/components\/Session\/ContextSidebar/, /^src\/renderer\/src\/components\/Session\/WorkbenchNewTab/] },
  { flag: '--workbench-new-tab', label: 'Workbench New Tab full workflow', patterns: [/^src\/renderer\/src\/components\/Session\/(WorkbenchNewTab|GitPanel|AgentsPanel|EnvironmentPanel)/, /^src\/main\/git/] },
  { flag: '--environment', label: 'Environment panel', patterns: [/^src\/renderer\/src\/components\/Session\/Environment/] },
  { flag: '--browser', label: 'Browser panel', patterns: [/^src\/renderer\/src\/components\/Session\/Browser/, /^src\/main\/browser/, /^src\/renderer\/src\/.*browser/i] },
  { flag: '--terminal', label: 'Terminal', patterns: [/^src\/renderer\/src\/components\/Session\/Terminal/, /^src\/main\/terminal/, /^src\/preload\/.*terminal/i] },
  { flag: '--cross-panel-keyboard', label: 'Right/bottom panel keyboard', patterns: [/^src\/types\/panelTabs\.ts$/] },
  { flag: '--files', label: 'Files and source tabs', patterns: [/^src\/renderer\/src\/components\/Session\/Files/, /^src\/renderer\/src\/components\/Session\/File/, /^src\/main\/fs/, /^src\/main\/workspace/] },
  { flag: '--diff-core', label: 'Review local diff', patterns: [/^src\/renderer\/src\/components\/Session\/(Diff|Review)/, /^src\/main\/diff/, /^src\/main\/gitChanges/] },
  { flag: '--diff-source', label: 'Review sources', patterns: [/^src\/renderer\/src\/components\/Session\/.*Source/, /^src\/main\/providers\/.*review/i, /^scripts\/codex-review/] },
  { flag: '--settings-providers', label: 'Provider Settings', patterns: [/^src\/renderer\/src\/components\/Settings\/Providers/, /^src\/main\/providers/, /^src\/main\/provider/] },
  { flag: '--settings', label: 'Settings', patterns: [/^src\/renderer\/src\/components\/Settings\//, /^src\/renderer\/src\/components\/Settings/, /^src\/main\/settings/, /^src\/main\/appSettings/] },
  { flag: '--pets', label: 'Pet settings', patterns: [/^src\/renderer\/src\/components\/Settings\/Pets/, /^resources\/pets/] },
  { flag: '--pet-overlay', label: 'Pet overlay', patterns: [/^src\/renderer\/src\/components\/Pet/, /^src\/main\/pet/i] },
  { flag: '--sidebar', label: 'Sidebar', patterns: [/^src\/renderer\/src\/components\/Sidebar/, /^src\/renderer\/src\/components\/SessionList/] },
  { flag: '--header', label: 'Header shell', patterns: [/^src\/renderer\/src\/components\/Session\/SessionHeader/, /^src\/renderer\/src\/components\/Titlebar/, /^src\/renderer\/src\/components\/AppShell/] },
  { flag: '--session-switch', label: 'Session lifecycle', patterns: [/^src\/renderer\/src\/stores\/sessions/, /^src\/main\/session/, /^src\/shared\/session/] },
  { flag: '--extensions', label: 'Extensions', patterns: [/^src\/renderer\/src\/components\/Extensions/, /^src\/main\/extensions?/, /^src\/main\/capabilitySync/] },
  { flag: '--capabilities', label: 'Capabilities', patterns: [/^src\/renderer\/src\/components\/Capabilities/, /^src\/main\/capability/] },
  { flag: '--resources', label: 'Resources', patterns: [/^src\/renderer\/src\/components\/Resources/, /^src\/main\/resources/] },
  { flag: '--plan', label: 'Plan and goal surfaces', patterns: [/^src\/renderer\/src\/components\/Session\/(Plan|Goal|AgentProgress)/, /^src\/main\/goal/, /^src\/main\/plan/] },
  { flag: '--design-system', label: 'Design system', patterns: [/^src\/renderer\/src\/index\.css$/, /^src\/renderer\/src\/styles/, /^tailwind\.config/] }
]

const sharedRules = [
  { flag: '--header', label: 'Header shell', patterns: [/^src\/renderer\/src\/App/, /^src\/renderer\/src\/main/, /^src\/renderer\/src\/routes/] },
  { flag: '--right-panel', label: 'Right Workbench shell', patterns: [/^src\/renderer\/src\/components\/Session\/ContextSidebar/] },
  { flag: '--design-system', label: 'Design system', patterns: [/^src\/renderer\/src\/index\.css$/] }
]

const diffRules = [
  {
    flag: '--terminal',
    label: 'Terminal',
    filePatterns: [/^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/Terminal/, /terminal[A-Z]/, /bottomPanel/, /bottom-panel/]
  },
  {
    flag: '--composer',
    label: 'Composer',
    filePatterns: [/^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/composer[A-Z]/, /Composer/, /orchestrator:add-composer-text/, /composer-/]
  },
  {
    flag: '--right-panel',
    label: 'Right Workbench shell',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/ContextSidebar\.tsx$/],
    diffPatterns: [/tabMenu/, /context-menu/, /workbench-tab-context-menu/, /panel-tab-transfer/, /resolvePanelTabTransferAvailability/]
  },
  {
    flag: '--right-panel',
    label: 'Right Workbench shell',
    filePatterns: [/^src\/renderer\/src\/components\/shared\/designSystem\.tsx$/, /^src\/renderer\/src\/components\/Session\/ContextSidebar\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/PanelTabStrip/, /TabButton/, /panelTabContextMenu/, /rightPanelTabKeyboardContextMenu/]
  },
  {
    flag: '--files',
    label: 'Files and source tabs',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/WorkbenchTree\.tsx$/, /^src\/renderer\/src\/components\/Session\/FilesPanel\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/WorkbenchTreeContextMenu/, /onContextMenu/, /filesRowKeyboardContextMenu/, /filesTreeKeyboardNavigation/, /fileSourceLineKeyboardNavigation/, /data-keyboard-navigation/, /files-row-context-menu/]
  },
  {
    flag: '--diff-core',
    label: 'Review local diff',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/DiffPanel\.tsx$/, /^src\/renderer\/src\/components\/Session\/WorkbenchTree\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/reviewRowKeyboardContextMenu/, /reviewTreeKeyboardNavigation/, /data-keyboard-navigation/, /review-row-context-menu/, /review-row-copy-path/]
  },
  {
    flag: '--terminal',
    label: 'Terminal',
    filePatterns: [/^src\/renderer\/src\/components\/shared\/designSystem\.tsx$/, /^src\/renderer\/src\/components\/Session\/TerminalPanel\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/PanelTabStrip/, /TabButton/, /panelTabContextMenu/, /terminalTabKeyboardContextMenu/]
  },
  {
    flag: '--right-panel',
    label: 'Right Workbench shell',
    filePatterns: [/^src\/renderer\/src\/App\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/closeActivePanelTab/, /restoreRightPanelToggleFocus/, /rightPanelLastTabShortcutFocusRestored/, /rightPanelClose[A-Z]/]
  },
  {
    flag: '--workbench-launcher',
    label: 'Workbench launcher',
    filePatterns: [/^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/workbenchLauncher/, /workbench-launcher/, /Workbench launcher/]
  }
]

const broadTriggers = [
  /^scripts\/run-automated-ui-smoke\.mjs$/,
  /^src\/main\/index\.ts$/,
  /^src\/preload\//,
  /^src\/shared\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/
]

const staticValidationRules = [
  {
    label: 'Panel tab unit policy',
    patterns: [/^src\/types\/panelTabs\.ts$/, /^src\/main\/__tests__\/panelTabs\.test\.ts$/],
    checks: [
      {
        kind: 'static',
        label: 'Compile node tests',
        command: 'pnpm',
        args: ['exec', 'tsc', '-p', 'tsconfig.node.json', '--outDir', 'out-test', '--module', 'commonjs']
      },
      {
        kind: 'static',
        label: 'Panel tab unit policy',
        command: 'node',
        args: ['--test', 'out-test/src/main/__tests__/panelTabs.test.js']
      }
    ]
  }
]

const args = process.argv.slice(2)
const shouldRun = args.includes('--run')
const shouldPrintJson = args.includes('--json')
if (shouldRun && shouldPrintJson) {
  console.error('Use --json or --run, not both.')
  process.exit(1)
}
const files = resolveFiles(args)
const suggestions = suggestTargets(files)
const plan = buildValidationPlan(files, suggestions)

if (shouldPrintJson) {
  printJson(files, suggestions, plan)
} else {
  printSuggestions(files, suggestions, plan)
}

if (shouldRun) runPlan(plan, suggestions)

function resolveFiles(args) {
  const explicit = args.filter((arg) => !arg.startsWith('-'))
  if (explicit.length > 0) return normalizeFiles(explicit)

  const staged = process.argv.includes('--staged')
  const command = staged
    ? ['diff', '--name-only', '--cached']
    : ['diff', '--name-only', 'HEAD']
  const result = spawnSync('git', command, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    console.error(result.stderr.trim() || 'Failed to read changed files.')
    process.exit(result.status ?? 1)
  }
  return normalizeFiles(result.stdout.split('\n'))
}

function normalizeFiles(paths) {
  return Array.from(new Set(paths.map((file) => file.trim()).filter(Boolean).map((file) => file.replace(/^\.\//, ''))))
}

function suggestTargets(paths) {
  const matched = new Map()
  const unmatched = []
  const broadReasons = []

  for (const file of paths) {
    let fileMatched = false
    for (const rule of [...targetRules, ...sharedRules]) {
      if (rule.patterns.some((pattern) => pattern.test(file))) {
        fileMatched = true
        addMatchedTarget(matched, rule, file)
      }
    }
    for (const rule of diffRules) {
      if (!rule.filePatterns.some((pattern) => pattern.test(file))) continue
      const diff = diffForFile(file)
      if (!rule.diffPatterns.some((pattern) => pattern.test(diff))) continue
      fileMatched = true
      addMatchedTarget(matched, rule, file)
    }
    if (staticValidationRules.some((rule) => rule.patterns.some((pattern) => pattern.test(file)))) {
      fileMatched = true
    }
    if (file.startsWith('scripts/') && file.endsWith('.mjs')) {
      fileMatched = true
    }
    if (broadTriggers.some((pattern) => pattern.test(file))) {
      broadReasons.push(file)
    }
    if (!fileMatched) unmatched.push(file)
  }

  suppressCoveredTarget(matched, '--settings', '--settings-providers')
  suppressCoveredTarget(matched, '--settings', '--pets')
  suppressCoveredTarget(matched, '--right-panel', '--workbench-launcher')
  suppressHeaderForRightPanelCloseDiff(matched, paths)
  suppressHeaderForTerminalCloseDiff(matched, paths)
  restoreDiffTargets(matched, paths)
  suppressWorkbenchLauncherForContextSidebarTabDiff(matched, paths)
  suppressRightPanelForWorkbenchTreeFileDiff(matched)

  return { targets: Array.from(matched.values()), unmatched, broadReasons }
}

function addMatchedTarget(matched, rule, file) {
  const current = matched.get(rule.flag) ?? { flag: rule.flag, label: rule.label, files: [] }
  if (!current.files.includes(file)) current.files.push(file)
  matched.set(rule.flag, current)
}

function diffForFile(file) {
  const result = spawnSync('git', ['diff', '--unified=0', 'HEAD', '--', file], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) return ''
  return result.stdout
}

function buildValidationPlan(paths, suggestions) {
  const checks = []
  if (paths.length === 0) return checks

  checks.push({
    kind: 'static',
    label: 'Diff whitespace',
    command: 'git',
    args: ['diff', '--check']
  })

  if (paths.some((file) => file.startsWith('src/') || file === 'package.json')) {
    checks.push({
      kind: 'static',
      label: 'TypeScript',
      command: 'pnpm',
      args: ['exec', 'tsc', '--noEmit']
    })
  }

  for (const file of paths.filter((candidate) => candidate.startsWith('scripts/') && candidate.endsWith('.mjs'))) {
    checks.push({
      kind: 'static',
      label: `Syntax: ${file}`,
      command: 'node',
      args: ['-c', file]
    })
  }

  for (const rule of staticValidationRules) {
    if (!paths.some((file) => rule.patterns.some((pattern) => pattern.test(file)))) continue
    for (const check of rule.checks) pushUniqueCheck(checks, check)
  }

  for (const target of suggestions.targets) {
    checks.push({
      kind: 'ui-smoke',
      label: target.label,
      command: 'node',
      args: ['scripts/run-automated-ui-smoke.mjs', target.flag],
      flag: target.flag
    })
  }

  return checks
}

function pushUniqueCheck(checks, check) {
  const key = formatCommand(check)
  if (checks.some((candidate) => formatCommand(candidate) === key)) return
  checks.push(check)
}

function suppressCoveredTarget(matched, broadFlag, focusedFlag) {
  const broad = matched.get(broadFlag)
  const focused = matched.get(focusedFlag)
  if (!broad || !focused) return
  const focusedFiles = new Set(focused.files)
  if (broad.files.every((file) => focusedFiles.has(file))) matched.delete(broadFlag)
}

function suppressHeaderForRightPanelCloseDiff(matched, paths) {
  const header = matched.get('--header')
  const rightPanel = matched.get('--right-panel')
  if (!header || !rightPanel) return
  if (!header.files.every((file) => file === 'src/renderer/src/App.tsx')) return
  const appDiff = paths.includes('src/renderer/src/App.tsx') ? diffForFile('src/renderer/src/App.tsx') : ''
  if (!/closeActivePanelTab|restoreRightPanelToggleFocus/.test(appDiff)) return
  matched.delete('--header')
}

function suppressHeaderForTerminalCloseDiff(matched, paths) {
  const header = matched.get('--header')
  const terminal = matched.get('--terminal')
  if (!header || !terminal) return
  if (!header.files.every((file) => file === 'src/renderer/src/App.tsx')) return
  const appDiff = paths.includes('src/renderer/src/App.tsx') ? diffForFile('src/renderer/src/App.tsx') : ''
  if (!/closeActivePanelTab|terminalTabIdFromTabId/.test(appDiff)) return
  matched.delete('--header')
}

function suppressWorkbenchLauncherForContextSidebarTabDiff(matched, paths) {
  const launcher = matched.get('--workbench-launcher')
  if (!launcher) return
  if (!launcher.files.every((file) => file === 'src/renderer/src/components/Session/ContextSidebar.tsx')) return
  const diff = paths.includes('src/renderer/src/components/Session/ContextSidebar.tsx')
    ? diffForFile('src/renderer/src/components/Session/ContextSidebar.tsx')
    : ''
  if (!/tabMenu|context-menu|PanelTabStrip|panelTabContextMenu/.test(diff)) return
  if (/workbenchLauncher|workbench-launcher|Workbench launcher|WorkbenchNewTab/.test(diff)) return
  matched.delete('--workbench-launcher')
}

function suppressRightPanelForWorkbenchTreeFileDiff(matched) {
  const rightPanel = matched.get('--right-panel')
  const files = matched.get('--files')
  if (!rightPanel || !files) return
  if (!rightPanel.files.every((file) => file === 'src/renderer/src/components/Session/WorkbenchTree.tsx')) return
  matched.delete('--right-panel')
}

function restoreDiffTargets(matched, paths) {
  for (const file of paths) {
    for (const rule of diffRules) {
      if (!rule.filePatterns.some((pattern) => pattern.test(file))) continue
      const diff = diffForFile(file)
      if (!rule.diffPatterns.some((pattern) => pattern.test(diff))) continue
      addMatchedTarget(matched, rule, file)
    }
  }
}

function printSuggestions(paths, suggestions, plan) {
  console.log('Focused smoke suggestion')
  console.log('')

  if (paths.length === 0) {
    console.log('No changed files detected against HEAD.')
    console.log('Use `pnpm run smoke:ui:list` to inspect available focused targets.')
    return
  }

  console.log('Changed files:')
  for (const file of paths) console.log(`  - ${file}`)
  console.log('')

  console.log('Targeted validation plan:')
  for (const check of plan.filter((candidate) => candidate.kind === 'static')) {
    console.log(`  - ${formatCommand(check)}`)
  }
  console.log('')

  const smokeChecks = plan.filter((candidate) => candidate.kind === 'ui-smoke')
  if (smokeChecks.length > 0) {
    console.log('Focused UI smoke:')
    for (const check of smokeChecks) console.log(`  - ${formatCommand(check)}  # ${check.label}`)
  } else {
    console.log('Focused UI smoke:')
    console.log('  - none from path rules')
  }

  console.log('')
  console.log('Run this exact plan:')
  console.log('  - pnpm run smoke:ui:changed')

  if (suggestions.broadReasons.length > 0) {
    console.log('')
    console.log('Broad-smoke review needed before running no-flag smoke:')
    for (const file of suggestions.broadReasons) console.log(`  - ${file}`)
  }

  if (suggestions.unmatched.length > 0) {
    console.log('')
    console.log('Unmatched files:')
    for (const file of suggestions.unmatched) console.log(`  - ${file}`)
  }

  if (!existsSync(resolve(root, 'scripts/run-automated-ui-smoke.mjs'))) {
    console.log('')
    console.log('Warning: smoke runner not found at scripts/run-automated-ui-smoke.mjs')
  }
}

function printJson(paths, suggestions, plan) {
  console.log(JSON.stringify({
    changedFiles: paths,
    checks: plan.map((check) => ({
      kind: check.kind,
      label: check.label,
      command: formatCommand(check),
      flag: check.flag ?? null
    })),
    broadReviewNeeded: suggestions.broadReasons,
    unmatchedFiles: suggestions.unmatched
  }, null, 2))
}

function runPlan(plan, suggestions) {
  if (plan.length === 0) return

  console.log('')
  console.log('Running targeted validation plan')
  for (const check of plan) {
    console.log(`\n> ${formatCommand(check)}`)
    const result = spawnSync(check.command, check.args, {
      cwd: root,
      encoding: 'utf8',
      stdio: 'inherit'
    })
    if (result.status !== 0) process.exit(result.status ?? 1)
  }

  if (suggestions.broadReasons.length > 0) {
    console.log('')
    console.log('Broad-smoke review was flagged, but no no-flag smoke was run automatically.')
  }
}

function formatCommand(check) {
  return [check.command, ...check.args].map(shellQuote).join(' ')
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value)
}
