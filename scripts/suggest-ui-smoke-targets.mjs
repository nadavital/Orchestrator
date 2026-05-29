#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

const targetRules = [
  { flag: '--composer', label: 'Composer', patterns: [/^src\/renderer\/src\/components\/Session\/InputBar\.tsx$/, /^src\/renderer\/src\/components\/Session\/Composer/, /^src\/renderer\/src\/components\/Session\/ChatComposer/, /^src\/renderer\/src\/components\/Session\/ComposerToolbar/, /^src\/renderer\/src\/store\/.*composer/i, /^src\/renderer\/src\/stores\/.*composer/i] },
  { flag: '--transcript-layout', label: 'Transcript', patterns: [/^src\/renderer\/src\/components\/Session\/(Transcript|ChatView|ChatMessage|MessageActions)/, /^src\/renderer\/src\/components\/Session\/Tool/, /^src\/renderer\/src\/stores\/.*message/i] },
  { flag: '--transcript-file-reference', label: 'Transcript file references', patterns: [/^src\/renderer\/src\/components\/Session\/FileReference/, /^src\/renderer\/src\/components\/Session\/.*Reference/] },
  { flag: '--transcript-permission', label: 'Transcript permissions', patterns: [/^src\/renderer\/src\/components\/Session\/.*Permission/, /^src\/main\/.*permission/i, /^src\/main\/providers\/.*permission/i] },
  { flag: '--side-chat', label: 'Side chat', patterns: [/^src\/renderer\/src\/components\/Session\/(SideChat|SideQuestion)/] },
  { flag: '--right-panel', label: 'Right Workbench shell', patterns: [/^src\/renderer\/src\/components\/Session\/(WorkbenchPanel|RightPanel|ContextSidebar)/, /^src\/renderer\/src\/components\/Session\/.*Workbench/, /^src\/renderer\/src\/components\/ui\/ToolbarButton/] },
  { flag: '--workbench-launcher', label: 'Workbench launcher', patterns: [/^src\/renderer\/src\/components\/Session\/ContextSidebar/, /^src\/renderer\/src\/components\/Session\/WorkbenchNewTab/] },
  { flag: '--workbench-new-tab', label: 'Workbench New Tab full workflow', patterns: [/^src\/renderer\/src\/components\/Session\/(WorkbenchNewTab|GitPanel|EnvironmentPanel)/, /^src\/main\/git/] },
  { flag: '--agent-inspector', label: 'Agent Activity inspector', patterns: [/^src\/renderer\/src\/components\/Session\/EventInspectorPanel\.tsx$/] },
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
  { flag: '--extensions', label: 'Extensions', patterns: [/^src\/renderer\/src\/components\/Extensions/, /^src\/renderer\/src\/components\/Session\/ExtensionsPanel\.tsx$/, /^src\/main\/extensions?/, /^src\/main\/capabilitySync/] },
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
    flag: '--browser',
    label: 'Browser panel',
    filePatterns: [/^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/browser[A-Z]/, /browser-/]
  },
  {
    flag: '--browser',
    label: 'Browser panel',
    filePatterns: [/^src\/renderer\/src\/store\/sessions\.ts$/],
    diffPatterns: [/BrowserWorkbenchState/, /BrowserAnnotationState/, /commentAnnotations/, /browserWorkbench/]
  },
  {
    flag: '--composer',
    label: 'Composer',
    filePatterns: [/^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/composer[A-Z]/, /Composer/, /orchestrator:add-composer-text/, /composer-/]
  },
  {
    flag: '--transcript-layout',
    label: 'Transcript',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/InputBar\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/chatUserMessageEdit/, /message-edit-draft/, /composer-draft-source/, /CodeBlock/, /chat-code-block/, /codeBlockCopy/, /toolActivityCommand/]
  },
  {
    flag: '--transcript-file-reference',
    label: 'Transcript file references',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/ChatView\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/FileReference/, /file-reference/, /fileReference[A-Z]/, /__orchestratorLastFileReference/]
  },
  {
    flag: '--transcript-stress',
    label: 'Transcript stress',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/ChatView\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/LoadEarlierMessages/, /load-earlier-messages/, /longThreadLoadControl/, /TRANSCRIPT_STRESS/]
  },
  {
    flag: '--transcript-permission',
    label: 'Transcript permissions',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/ChatView\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/PermissionCard/, /permissionRequest/, /chat-permission/, /permission[A-Z]/]
  },
  {
    flag: '--transcript-user-input',
    label: 'Transcript user input',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/ChatView\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/UserInputCard|QuestionBlock|chat-user-input|userInput[A-Z]|data-user-input/]
  },
  {
    flag: '--transcript-fork',
    label: 'Transcript fork controls',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/ChatView\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/ForkFromMessage/, /chatMessageFork/, /chat-message-fork/]
  },
  {
    flag: '--worktree-lifecycle',
    label: 'Worktree lifecycle',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/SessionPane\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/WorktreeLifecycleNotice/, /worktree-lifecycle/, /worktreeRetry/]
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
    filePatterns: [/^src\/renderer\/src\/components\/Session\/WorkbenchTree\.tsx$/, /^src\/renderer\/src\/components\/Session\/FilesPanel\.tsx$/, /^src\/renderer\/src\/components\/Session\/FileTabPanel\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/WorkbenchTreeContextMenu/, /onContextMenu/, /filesRowKeyboardContextMenu/, /filesTreeKeyboardNavigation/, /fileSourceLineKeyboardNavigation/, /data-keyboard-navigation/, /files-row-context-menu/, /filesAddToChatStatus/, /filesInsertPathTerminal/, /fileSourcePathTerminal/, /workbench-file-tab-insert-terminal/, /Added .* to chat/, /Path inserted in terminal/]
  },
  {
    flag: '--diff-conflict',
    label: 'Review merge conflicts',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/DiffPanel\.tsx$/, /^src\/renderer\/src\/index\.css$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/review-merge-conflict/, /reviewMergeConflict/]
  },
  {
    flag: '--diff-core',
    label: 'Review local diff',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/DiffPanel\.tsx$/, /^src\/renderer\/src\/components\/Session\/GitPanel\.tsx$/, /^src\/renderer\/src\/components\/Session\/ContextSidebar\.tsx$/, /^src\/renderer\/src\/components\/Session\/WorkbenchTree\.tsx$/, /^src\/renderer\/src\/index\.css$/, /^src\/renderer\/src\/store\/sessions\.ts$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/reviewRowKeyboardContextMenu/, /reviewRowAddToChat/, /reviewRowInsertPathTerminal/, /reviewGitApplyTerminalHandoff/, /reviewTreeKeyboardNavigation/, /data-keyboard-navigation/, /review-row-context-menu/, /review-row-copy-path/, /review-row-add-chat/, /review-row-insert-terminal/, /review-insert-git-apply-terminal/, /review-merge-conflict-mark-resolved/, /reviewMergeConflictMarkResolved/, /Added .* to chat/, /Review path inserted in terminal/, /Git apply command inserted in terminal/, /__orchestratorLastReviewGitApplyTerminal/, /reviewSelectedGitPathActions/, /review-stage-selected-file/, /review-unstage-selected-file/, /reviewGitHandoffSelectedFile/, /gitReviewHandoffSelectedFile/, /gitFocusPath/, /reviewFocusPath/, /git-file-row-focused/, /git-file-open-review/]
  },
  {
    flag: '--terminal',
    label: 'Terminal',
    filePatterns: [/^src\/renderer\/src\/components\/shared\/designSystem\.tsx$/, /^src\/renderer\/src\/components\/Session\/TerminalPanel\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/PanelTabStrip/, /TabButton/, /panelTabContextMenu/, /terminalTabKeyboardContextMenu/]
  },
  {
    flag: '--terminal',
    label: 'Terminal',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/ContextSidebar\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/right-terminal/, /effectiveTerminal/, /terminalRightPanel.*AddToChat/, /Terminal command output/, /selected terminal output/i]
  },
  {
    flag: '--right-panel',
    label: 'Right Workbench shell',
    filePatterns: [/^src\/renderer\/src\/App\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/closeActivePanelTab/, /restoreRightPanelToggleFocus/, /rightPanelLastTabShortcutFocusRestored/, /rightPanelClose[A-Z]/]
  },
  {
    flag: '--settings-providers',
    label: 'Provider Settings',
    filePatterns: [/^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/settingsProvider/, /provider-runtime/, /providerRuntime/, /provider-runtime-events/]
  },
  {
    flag: '--settings',
    label: 'Settings',
    filePatterns: [/^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/settingsSearch/, /settings-search/, /settings[A-Z]/]
  },
  {
    flag: '--workbench-launcher',
    label: 'Workbench launcher',
    filePatterns: [/^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/workbenchLauncher/, /workbench-launcher/, /Workbench launcher/]
  },
  {
    flag: '--workbench-new-tab',
    label: 'Workbench New Tab full workflow',
    filePatterns: [/^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/workbenchNewTabGit/, /git-pr-command/, /Git PR command/]
  },
  {
    flag: '--agent-inspector',
    label: 'Agent Activity inspector',
    filePatterns: [/^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/agent-inspector/, /agentRuntimeEvent/, /agentRuntimeFailureGroup/, /agentTransportLog/, /agentSessionContext/, /agentSelectedTimeline/, /agentSelectedTranscript/, /agent-session-context-add-to-chat/, /agent-runtime-failure-group/, /agent-transport-log/, /agent-selected-timeline/, /agent-selected-add-to-chat/, /agent-selected-copy/, /agent-event-detail/, /focus-waiting-card/, /Open approval in chat/, /Failure group copied/, /Transport log copied/, /Agent transcript copied/]
  },
  {
    flag: '--extensions',
    label: 'Extensions',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/ExtensionsPanel\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/extensionsInstructionsAddToChat/, /extensions-add-instructions-chat/, /Use this extension instruction context/, /Extension instructions added to chat/]
  },
  {
    flag: '--environment',
    label: 'Environment panel',
    filePatterns: [/^src\/renderer\/src\/components\/Session\/EnvironmentPanel\.tsx$/, /^src\/renderer\/src\/components\/Session\/ContextSidebar\.tsx$/, /^src\/renderer\/src\/components\/Session\/GitPanel\.tsx$/, /^src\/renderer\/src\/store\/sessions\.ts$/, /^src\/renderer\/src\/App\.tsx$/, /^scripts\/run-automated-ui-smoke\.mjs$/, /^src\/main\/index\.ts$/],
    diffPatterns: [/environmentCreatePrOpensGit/, /environmentCommitOpensGit/, /environmentBranchOpensGit/, /environmentWorkspacePathActions/, /open-git-pr/, /open-git-commit/, /open-git-branch/, /codex-environment-(?:copy-workspace-path|insert-workspace-terminal)/, /Workspace path (?:copied|inserted in terminal)/, /__orchestratorLastEnvironment/, /Open Git to create a pull request/, /Open Git to commit changes/, /Open Git branch controls/, /gitFocusTarget/, /GitFocusTarget/, /data-git-focus-target/, /data-git-focused-target/, /focusTarget/, /focusRightPanelGitTarget/, /__orchestratorSetSessionReviewMetadataForSmoke/, /onOpenGit/]
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
const shouldRunStaticOnly = args.includes('--static-only')
const shouldRunSmokeOnly = args.includes('--smoke-only')
if (shouldRun && shouldPrintJson) {
  console.error('Use --json or --run, not both.')
  process.exit(1)
}
if (shouldRunStaticOnly && shouldRunSmokeOnly) {
  console.error('Use --static-only or --smoke-only, not both.')
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

if (shouldRun) runPlan(plan, suggestions, { staticOnly: shouldRunStaticOnly, smokeOnly: shouldRunSmokeOnly })

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
  const broadCandidates = []

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
    if (file.startsWith('docs/')) {
      fileMatched = true
    }
    if (file.startsWith('scripts/') && file.endsWith('.mjs')) {
      fileMatched = true
    }
    if (broadTriggers.some((pattern) => pattern.test(file))) {
      broadCandidates.push(file)
    }
    if (!fileMatched) unmatched.push(file)
  }

  suppressCoveredTarget(matched, '--settings', '--settings-providers')
  suppressCoveredTarget(matched, '--settings', '--pets')
  suppressCoveredTarget(matched, '--right-panel', '--workbench-launcher')
  suppressHeaderForRightPanelCloseDiff(matched, paths)
  suppressHeaderForTerminalCloseDiff(matched, paths)
  suppressHeaderForSmokeHelperDiff(matched, paths)
  suppressHeaderForEnvironmentSmokeHelperDiff(matched, paths)
  restoreDiffTargets(matched, paths)
  suppressDiffCoreForMergeConflictDiff(matched)
  suppressSettingsForProviderSettingsDiff(matched, paths)
  suppressWorkbenchLauncherForContextSidebarTabDiff(matched, paths)
  suppressRightPanelForContextSidebarTerminalDiff(matched, paths)
  suppressWorkbenchLauncherForContextSidebarTerminalDiff(matched, paths)
  suppressRightPanelForWorkbenchTreeFileDiff(matched)
  suppressBrowserForSettingsDiff(matched, paths)
  suppressTranscriptLayoutForLongThreadDiff(matched, paths)
  suppressTranscriptLayoutForPermissionDiff(matched, paths)
  suppressTranscriptLayoutForUserInputDiff(matched, paths)
  suppressTranscriptLayoutForFileReferenceDiff(matched, paths)
  suppressTranscriptPermissionForSettingsDiff(matched, paths)
  suppressComposerForSettingsFocusDiff(matched, paths)
  suppressTranscriptPermissionForAgentEventFocusDiff(matched, paths)
  suppressTranscriptLayoutForForkDiff(matched, paths)
  suppressDesignSystemForSettingsCssDiff(matched, paths)
  suppressDesignSystemForWorktreesSettingsCssDiff(matched, paths)
  suppressDesignSystemForProviderSettingsCommandHandoffDiff(matched, paths)
  suppressDesignSystemForReviewConflictCssDiff(matched, paths)
  suppressTranscriptForkForCodeBlockDiff(matched, paths)
  suppressTranscriptLayoutForAgentEventFocusDiff(matched, paths)
  suppressComposerForWorktreeLifecycleDiff(matched, paths)
  suppressComposerForTerminalHandoffDiff(matched, paths)
  suppressComposerForToolActivityCommandDiff(matched, paths)
  suppressTerminalForToolActivityCommandDiff(matched, paths)
  suppressComposerForWorkbenchGitHandoffDiff(matched, paths)
  suppressComposerForAgentInspectorHandoffDiff(matched, paths)
  suppressWorkbenchLauncherForAgentInspectorDiff(matched, paths)
  suppressComposerForExtensionsHandoffDiff(matched, paths)
  suppressTerminalForWorkbenchGitPrTerminalHandoffDiff(matched, paths)
  suppressTerminalForWorkbenchGitFileTerminalHandoffDiff(matched, paths)
  suppressFilesForWorkbenchGitFileAddToChatDiff(matched, paths)
  suppressComposerForBrowserHandoffDiff(matched, paths)
  suppressTerminalForFilesPathTerminalHandoffDiff(matched, paths)
  suppressTerminalForFileTabPathTerminalHandoffDiff(matched, paths)
  suppressTerminalForReviewPathTerminalHandoffDiff(matched, paths)
  suppressTerminalForEnvironmentPathHandoffDiff(matched, paths)
  suppressTerminalForWorktreesSettingsPathHandoffDiff(matched, paths)
  suppressTerminalForProviderSettingsCommandHandoffDiff(matched, paths)
  suppressFilesAndTerminalForFileReferenceDiff(matched, paths)
  suppressComposerAndFilesForReviewRowAddToChatDiff(matched, paths)
  suppressEnvironmentForGitFileWorkflowDiff(matched, paths)
  suppressWorkbenchForReviewGitHandoffDiff(matched, paths)
  suppressWorkbenchForEnvironmentCreatePrDiff(matched, paths)

  const broadReasons = broadCandidates.filter((file) => !isBroadCandidateCovered(file, matched))
  const coveredBroadReasons = broadCandidates.filter((file) => isBroadCandidateCovered(file, matched))

  return { targets: Array.from(matched.values()), unmatched, broadReasons, coveredBroadReasons }
}

function addMatchedTarget(matched, rule, file) {
  const current = matched.get(rule.flag) ?? { flag: rule.flag, label: rule.label, files: [] }
  if (!current.files.includes(file)) current.files.push(file)
  matched.set(rule.flag, current)
}

function isBroadCandidateCovered(file, matched) {
  for (const target of matched.values()) {
    if (target.files.includes(file)) return true
  }
  return false
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

function suppressSettingsForProviderSettingsDiff(matched, paths) {
  const settings = matched.get('--settings')
  const providers = matched.get('--settings-providers')
  if (!settings || !providers) return
  if (!paths.every((file) =>
    file === 'src/renderer/src/components/Settings/ProvidersSettingsPage.tsx' ||
    file === 'src/renderer/src/index.css' ||
    file === 'src/main/index.ts' ||
    file === 'scripts/run-automated-ui-smoke.mjs' ||
    file === 'scripts/suggest-ui-smoke-targets.mjs' ||
    file.startsWith('docs/')
  )) return
  const diff = [
    paths.includes('src/renderer/src/components/Settings/ProvidersSettingsPage.tsx') ? diffForFile('src/renderer/src/components/Settings/ProvidersSettingsPage.tsx') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : ''
  ].join('\n')
  if (!/settingsProvider|provider-runtime|providerRuntime|provider-runtime-events/.test(diff)) return
  matched.delete('--settings')
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

function suppressHeaderForSmokeHelperDiff(matched, paths) {
  const header = matched.get('--header')
  const workbench = matched.get('--workbench-new-tab')
  if (!header || !workbench) return
  if (!header.files.every((file) => file === 'src/renderer/src/App.tsx')) return
  const appDiff = paths.includes('src/renderer/src/App.tsx') ? diffForFile('src/renderer/src/App.tsx') : ''
  if (!/__orchestratorAppendSessionMessagesForSmoke/.test(appDiff)) return
  matched.delete('--header')
}

function suppressHeaderForEnvironmentSmokeHelperDiff(matched, paths) {
  const header = matched.get('--header')
  const environment = matched.get('--environment')
  if (!header || !environment) return
  if (!header.files.every((file) => file === 'src/renderer/src/App.tsx')) return
  const appDiff = paths.includes('src/renderer/src/App.tsx') ? diffForFile('src/renderer/src/App.tsx') : ''
  if (!/__orchestratorSetSessionReviewMetadataForSmoke/.test(appDiff)) return
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

function suppressRightPanelForContextSidebarTerminalDiff(matched, paths) {
  const rightPanel = matched.get('--right-panel')
  const terminal = matched.get('--terminal')
  if (!rightPanel || !terminal) return
  if (!rightPanel.files.every((file) => file === 'src/renderer/src/components/Session/ContextSidebar.tsx')) return
  const diff = paths.includes('src/renderer/src/components/Session/ContextSidebar.tsx')
    ? diffForFile('src/renderer/src/components/Session/ContextSidebar.tsx')
    : ''
  if (!/right-terminal|effectiveTerminal|Terminal command output|selected terminal output/i.test(diff)) return
  matched.delete('--right-panel')
}

function suppressWorkbenchLauncherForContextSidebarTerminalDiff(matched, paths) {
  const launcher = matched.get('--workbench-launcher')
  const terminal = matched.get('--terminal')
  if (!launcher || !terminal) return
  if (!launcher.files.every((file) => file === 'src/renderer/src/components/Session/ContextSidebar.tsx')) return
  const diff = paths.includes('src/renderer/src/components/Session/ContextSidebar.tsx')
    ? diffForFile('src/renderer/src/components/Session/ContextSidebar.tsx')
    : ''
  if (!/right-terminal|effectiveTerminal|Terminal command output|selected terminal output/i.test(diff)) return
  matched.delete('--workbench-launcher')
}

function suppressRightPanelForWorkbenchTreeFileDiff(matched) {
  const rightPanel = matched.get('--right-panel')
  const files = matched.get('--files')
  if (!rightPanel || !files) return
  if (!rightPanel.files.every((file) => file === 'src/renderer/src/components/Session/WorkbenchTree.tsx')) return
  matched.delete('--right-panel')
}

function suppressBrowserForSettingsDiff(matched, paths) {
  const browser = matched.get('--browser')
  const settings = matched.get('--settings')
  if (!browser || !settings) return
  if (!browser.files.every((file) => file === 'src/main/index.ts' || file === 'scripts/run-automated-ui-smoke.mjs')) return
  const diff = [
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : ''
  ].join('\n')
  if (!/settingsSearch|settings-search|settings[A-Z]/.test(diff)) return
  matched.delete('--browser')
}

function suppressTranscriptLayoutForForkDiff(matched, paths) {
  const transcript = matched.get('--transcript-layout')
  const fork = matched.get('--transcript-fork')
  if (!transcript || !fork) return
  if (!transcript.files.every((file) => file === 'src/renderer/src/components/Session/ChatView.tsx')) return
  const diff = paths.includes('src/renderer/src/components/Session/ChatView.tsx')
    ? diffForFile('src/renderer/src/components/Session/ChatView.tsx')
    : ''
  if (/CodeBlock|chat-code-block|codeBlockCopy/.test(diff)) return
  if (!/ForkFromMessage|chatMessageFork|chat-message-fork/.test(diff)) return
  matched.delete('--transcript-layout')
}

function suppressTranscriptForkForCodeBlockDiff(matched, paths) {
  const fork = matched.get('--transcript-fork')
  if (!fork) return
  const diff = paths.includes('src/renderer/src/components/Session/ChatView.tsx')
    ? diffForFile('src/renderer/src/components/Session/ChatView.tsx')
    : ''
  if (!/CodeBlock|chat-code-block|codeBlockCopy/.test(diff)) return
  matched.delete('--transcript-fork')
}

function suppressTranscriptLayoutForAgentEventFocusDiff(matched, paths) {
  const transcript = matched.get('--transcript-layout')
  const workbench = matched.get('--workbench-new-tab')
  if (!transcript || !workbench) return
  if (!transcript.files.every((file) => file === 'src/renderer/src/components/Session/ChatView.tsx')) return
  const diff = paths.includes('src/renderer/src/components/Session/ChatView.tsx')
    ? diffForFile('src/renderer/src/components/Session/ChatView.tsx')
    : ''
  if (!/orchestrator:focus-waiting-card|data-transcript-focused-message|focusedMessageId|Permission request opened in chat|User input request opened in chat/.test(diff)) return
  matched.delete('--transcript-layout')
}

function suppressTranscriptLayoutForPermissionDiff(matched, paths) {
  const transcript = matched.get('--transcript-layout')
  const permission = matched.get('--transcript-permission')
  if (!transcript || !permission) return
  if (!transcript.files.every((file) => file === 'src/renderer/src/components/Session/ChatView.tsx')) return
  const diff = paths.includes('src/renderer/src/components/Session/ChatView.tsx')
    ? diffForFile('src/renderer/src/components/Session/ChatView.tsx')
    : ''
  if (!/PermissionCard|permissionRequest|chat-permission/.test(diff)) return
  matched.delete('--transcript-layout')
}

function suppressTranscriptLayoutForUserInputDiff(matched, paths) {
  const transcript = matched.get('--transcript-layout')
  const userInput = matched.get('--transcript-user-input')
  if (!transcript || !userInput) return
  if (!transcript.files.every((file) => file === 'src/renderer/src/components/Session/ChatView.tsx')) return
  const diff = paths.includes('src/renderer/src/components/Session/ChatView.tsx')
    ? diffForFile('src/renderer/src/components/Session/ChatView.tsx')
    : ''
  if (!/UserInputCard|QuestionBlock|chat-user-input|userInput[A-Z]|data-user-input/.test(diff)) return
  matched.delete('--transcript-layout')
}

function suppressTranscriptLayoutForFileReferenceDiff(matched, paths) {
  const transcript = matched.get('--transcript-layout')
  const fileReference = matched.get('--transcript-file-reference')
  if (!transcript || !fileReference) return
  if (!transcript.files.every((file) => file === 'src/renderer/src/components/Session/ChatView.tsx')) return
  const diff = paths.includes('src/renderer/src/components/Session/ChatView.tsx')
    ? diffForFile('src/renderer/src/components/Session/ChatView.tsx')
    : ''
  if (!/FileReference|file-reference|fileReference[A-Z]|__orchestratorLastFileReference/.test(diff)) return
  matched.delete('--transcript-layout')
}

function suppressFilesAndTerminalForFileReferenceDiff(matched, paths) {
  const fileReference = matched.get('--transcript-file-reference')
  if (!fileReference) return
  const diff = [
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : '',
    paths.includes('src/renderer/src/components/Session/ChatView.tsx') ? diffForFile('src/renderer/src/components/Session/ChatView.tsx') : ''
  ].join('\n')
  if (!/FileReference|file-reference|fileReference[A-Z]|__orchestratorLastFileReference/.test(diff)) return
  for (const flag of ['--files', '--terminal']) {
    const target = matched.get(flag)
    if (!target) continue
    if (target.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) {
      matched.delete(flag)
    }
  }
}

function suppressTranscriptPermissionForSettingsDiff(matched, paths) {
  const permission = matched.get('--transcript-permission')
  const settings = matched.get('--settings')
  if (!permission || !settings) return
  if (!permission.files.every((file) => file === 'src/main/index.ts' || file === 'scripts/run-automated-ui-smoke.mjs')) return
  const diff = [
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : ''
  ].join('\n')
  if (!/settingsSearch|settings-search|settings[A-Z]/.test(diff)) return
  matched.delete('--transcript-permission')
}

function suppressComposerForSettingsFocusDiff(matched, paths) {
  const composer = matched.get('--composer')
  const settings = matched.get('--settings')
  if (!composer || !settings) return
  if (!composer.files.every((file) => file === 'src/main/index.ts')) return
  const diff = paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  if (!/settingsCloseFocusRestored|composerAfterSettingsClose|settingsWorktreesPathActions/.test(diff)) return
  matched.delete('--composer')
}

function suppressTranscriptPermissionForAgentEventFocusDiff(matched, paths) {
  const permission = matched.get('--transcript-permission')
  const workbench = matched.get('--workbench-new-tab')
  if (!permission || !workbench) return
  if (!permission.files.every((file) =>
    file === 'src/main/index.ts' ||
    file === 'scripts/run-automated-ui-smoke.mjs' ||
    file === 'src/renderer/src/components/Session/ChatView.tsx'
  )) return
  const diff = [
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/renderer/src/components/Session/ChatView.tsx') ? diffForFile('src/renderer/src/components/Session/ChatView.tsx') : ''
  ].join('\n')
  if (!/agentRuntimeEventOpenInChat|agent-event-detail-open-in-chat|focus-waiting-card|Open approval in chat/.test(diff)) return
  matched.delete('--transcript-permission')
}

function suppressDesignSystemForSettingsCssDiff(matched, paths) {
  const designSystem = matched.get('--design-system')
  const settings = matched.get('--settings')
  if (!designSystem || !settings) return
  if (!designSystem.files.every((file) => file === 'src/renderer/src/index.css')) return
  const diff = paths.includes('src/renderer/src/index.css') ? diffForFile('src/renderer/src/index.css') : ''
  if (!/settings-search|settings-topbar-search/.test(diff)) return
  matched.delete('--design-system')
}

function suppressDiffCoreForMergeConflictDiff(matched) {
  const diffCore = matched.get('--diff-core')
  const conflict = matched.get('--diff-conflict')
  if (!diffCore || !conflict) return
  const conflictFiles = new Set(conflict.files)
  if (!diffCore.files.every((file) => conflictFiles.has(file))) return
  const allDiffCoreChangesAreConflictChanges = diffCore.files.every((file) =>
    /review-merge-conflict|reviewMergeConflict/.test(diffForFile(file))
  )
  if (!allDiffCoreChangesAreConflictChanges) return
  matched.delete('--diff-core')
}

function suppressDesignSystemForWorktreesSettingsCssDiff(matched, paths) {
  const designSystem = matched.get('--design-system')
  const settings = matched.get('--settings')
  if (!designSystem || !settings) return
  if (!designSystem.files.every((file) => file === 'src/renderer/src/index.css')) return
  const diff = paths.includes('src/renderer/src/index.css') ? diffForFile('src/renderer/src/index.css') : ''
  if (!/worktrees-row-actions|worktrees-row-header|worktrees-/.test(diff)) return
  matched.delete('--design-system')
}

function suppressDesignSystemForReviewConflictCssDiff(matched, paths) {
  const designSystem = matched.get('--design-system')
  const conflict = matched.get('--diff-conflict')
  if (!designSystem || !conflict) return
  if (!designSystem.files.every((file) => file === 'src/renderer/src/index.css')) return
  const diff = paths.includes('src/renderer/src/index.css') ? diffForFile('src/renderer/src/index.css') : ''
  if (!/review-merge-conflict/.test(diff)) return
  matched.delete('--design-system')
}

function suppressDesignSystemForProviderSettingsCommandHandoffDiff(matched, paths) {
  const designSystem = matched.get('--design-system')
  const providers = matched.get('--settings-providers')
  if (!designSystem || !providers) return
  if (!designSystem.files.every((file) => file === 'src/renderer/src/index.css')) return
  const diff = paths.includes('src/renderer/src/index.css') ? diffForFile('src/renderer/src/index.css') : ''
  if (!/provider-command-output-(?:actions|command|terminal-status)/.test(diff)) return
  matched.delete('--design-system')
}

function suppressTranscriptLayoutForLongThreadDiff(matched, paths) {
  const transcript = matched.get('--transcript-layout')
  const stress = matched.get('--transcript-stress')
  if (!transcript || !stress) return
  if (!transcript.files.every((file) => file === 'src/renderer/src/components/Session/ChatView.tsx')) return
  const diff = paths.includes('src/renderer/src/components/Session/ChatView.tsx')
    ? diffForFile('src/renderer/src/components/Session/ChatView.tsx')
    : ''
  if (!/LoadEarlierMessages|load-earlier-messages|longThreadLoadControl/.test(diff)) return
  matched.delete('--transcript-layout')
}

function suppressComposerForWorktreeLifecycleDiff(matched, paths) {
  const composer = matched.get('--composer')
  const worktree = matched.get('--worktree-lifecycle')
  if (!composer || !worktree) return
  if (!composer.files.every((file) => file === 'src/main/index.ts')) return
  const diff = paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  if (!/worktree-lifecycle|worktreeRetry|WorktreeLifecycleNotice/.test(diff)) return
  matched.delete('--composer')
}

function suppressComposerForTerminalHandoffDiff(matched, paths) {
  const composer = matched.get('--composer')
  const terminal = matched.get('--terminal')
  if (!composer || !terminal) return
  if (!composer.files.every((file) => file === 'src/main/index.ts')) return
  const diff = paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  if (!/terminalOutputAddToChat|terminalSelectedOutputAddToChat|terminalCommandOutputAddToChat|terminal-add-output-to-chat|terminal-add-selected-output-to-chat|terminal-add-command-output-to-chat|Terminal output|selected terminal output|terminal command output|Latest command output/i.test(diff)) return
  matched.delete('--composer')
}

function suppressComposerForToolActivityCommandDiff(matched, paths) {
  const composer = matched.get('--composer')
  const transcript = matched.get('--transcript-layout')
  if (!composer || !transcript) return
  if (!composer.files.every((file) => file === 'src/main/index.ts')) return
  const diff = paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  if (!/toolActivityCommand|tool-activity-command/.test(diff)) return
  matched.delete('--composer')
}

function suppressTerminalForToolActivityCommandDiff(matched, paths) {
  const terminal = matched.get('--terminal')
  const transcript = matched.get('--transcript-layout')
  if (!terminal || !transcript) return
  if (!terminal.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('src/renderer/src/components/Session/ChatView.tsx') ? diffForFile('src/renderer/src/components/Session/ChatView.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/toolActivityCommandRunTerminal|tool-activity-command-run-terminal|Run command in terminal/.test(diff)) return
  matched.delete('--terminal')
}

function suppressComposerForWorkbenchGitHandoffDiff(matched, paths) {
  const composer = matched.get('--composer')
  const workbench = matched.get('--workbench-new-tab')
  if (!composer || !workbench) return
  if (!composer.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/workbenchNewTabGit|git-pr-command|Git PR command/.test(diff)) return
  matched.delete('--composer')
}

function suppressComposerForAgentInspectorHandoffDiff(matched, paths) {
  const composer = matched.get('--composer')
  const inspector = matched.get('--agent-inspector')
  if (!composer || !inspector) return
  if (!composer.files.every((file) =>
    file === 'scripts/run-automated-ui-smoke.mjs' ||
    file === 'src/main/index.ts' ||
    file === 'src/renderer/src/components/Session/EventInspectorPanel.tsx'
  )) return
  const diff = [
    paths.includes('src/renderer/src/components/Session/EventInspectorPanel.tsx') ? diffForFile('src/renderer/src/components/Session/EventInspectorPanel.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/agentSessionContextAddToChat|agent-session-context-add-to-chat|Use this agent activity session context|Session context added to chat|agentSelectedTranscript|agent-selected-add-to-chat|Use this agent transcript context|Agent transcript added to chat/.test(diff)) return
  matched.delete('--composer')
}

function suppressWorkbenchLauncherForAgentInspectorDiff(matched, paths) {
  const launcher = matched.get('--workbench-launcher')
  const inspector = matched.get('--agent-inspector')
  if (!launcher || !inspector) return
  if (!launcher.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/agent-inspector|agentSessionContext|agentRuntimeEvent|agentRuntimeFailureGroup|agentTransportLog|agentSelectedTimeline|agentSelectedTranscript|agent-.*add-to-chat|agent-.*copy|agent-selected-timeline/.test(diff)) return
  matched.delete('--workbench-launcher')
}

function suppressComposerForExtensionsHandoffDiff(matched, paths) {
  const composer = matched.get('--composer')
  const extensions = matched.get('--extensions')
  if (!composer || !extensions) return
  if (!composer.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('src/renderer/src/components/Session/ExtensionsPanel.tsx') ? diffForFile('src/renderer/src/components/Session/ExtensionsPanel.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/extensionsInstructionsAddToChat|extensions-add-instructions-chat|Use this extension instruction context|Extension instructions added to chat/.test(diff)) return
  matched.delete('--composer')
}

function suppressTerminalForWorkbenchGitPrTerminalHandoffDiff(matched, paths) {
  const terminal = matched.get('--terminal')
  const workbench = matched.get('--workbench-new-tab')
  if (!terminal || !workbench) return
  if (!terminal.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('src/renderer/src/components/Session/GitPanel.tsx') ? diffForFile('src/renderer/src/components/Session/GitPanel.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/workbenchNewTabGitPrCommandTerminalHandoff|git-insert-pr-command-terminal|PR command inserted in terminal|__orchestratorLastGitPrTerminal/.test(diff)) return
  matched.delete('--terminal')
}

function suppressTerminalForWorkbenchGitFileTerminalHandoffDiff(matched, paths) {
  const terminal = matched.get('--terminal')
  const workbench = matched.get('--workbench-new-tab')
  if (!terminal || !workbench) return
  if (!terminal.files.every((file) => file === 'src/renderer/src/components/Session/GitPanel.tsx' || file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('src/renderer/src/components/Session/GitPanel.tsx') ? diffForFile('src/renderer/src/components/Session/GitPanel.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/workbenchNewTabGitFileInsertTerminal|git-file-insert-terminal|File path inserted in terminal|__orchestratorLastGitFileTerminal/.test(diff)) return
  matched.delete('--terminal')
}

function suppressFilesForWorkbenchGitFileAddToChatDiff(matched, paths) {
  const files = matched.get('--files')
  const workbench = matched.get('--workbench-new-tab')
  if (!files || !workbench) return
  if (!files.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('src/renderer/src/components/Session/GitPanel.tsx') ? diffForFile('src/renderer/src/components/Session/GitPanel.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/workbenchNewTabGitFileAddToChat|git-file-add-chat|Add .* to chat/.test(diff)) return
  matched.delete('--files')
}

function suppressTerminalForFilesPathTerminalHandoffDiff(matched, paths) {
  const terminal = matched.get('--terminal')
  const files = matched.get('--files')
  if (!terminal || !files) return
  if (!terminal.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('src/renderer/src/components/Session/FilesPanel.tsx') ? diffForFile('src/renderer/src/components/Session/FilesPanel.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/filesInsertPathTerminal|files-row-context-menu-insert-terminal|Path inserted in terminal|__orchestratorLastFilesTerminal/.test(diff)) return
  matched.delete('--terminal')
}

function suppressTerminalForFileTabPathTerminalHandoffDiff(matched, paths) {
  const terminal = matched.get('--terminal')
  const files = matched.get('--files')
  if (!terminal || !files) return
  if (!terminal.files.every((file) =>
    file === 'scripts/run-automated-ui-smoke.mjs' ||
    file === 'src/main/index.ts' ||
    file === 'src/renderer/src/components/Session/FileTabPanel.tsx'
  )) return
  const diff = [
    paths.includes('src/renderer/src/components/Session/FileTabPanel.tsx') ? diffForFile('src/renderer/src/components/Session/FileTabPanel.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/fileSourcePathTerminal|workbench-file-tab-insert-terminal|Path inserted in terminal|__orchestratorLastFileTabTerminal/.test(diff)) return
  matched.delete('--terminal')
}

function suppressTerminalForReviewPathTerminalHandoffDiff(matched, paths) {
  const terminal = matched.get('--terminal')
  const diffCore = matched.get('--diff-core')
  if (!terminal || !diffCore) return
  if (!terminal.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('src/renderer/src/components/Session/DiffPanel.tsx') ? diffForFile('src/renderer/src/components/Session/DiffPanel.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/reviewRowInsertPathTerminal|reviewGitApplyTerminalHandoff|review-row-insert-terminal|review-insert-git-apply-terminal|Review path inserted in terminal|Git apply command inserted in terminal|__orchestratorLastReviewTerminal|__orchestratorLastReviewGitApplyTerminal/.test(diff)) return
  matched.delete('--terminal')
}

function suppressTerminalForEnvironmentPathHandoffDiff(matched, paths) {
  const terminal = matched.get('--terminal')
  const environment = matched.get('--environment')
  if (!terminal || !environment) return
  if (!terminal.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('src/renderer/src/components/Session/EnvironmentPanel.tsx') ? diffForFile('src/renderer/src/components/Session/EnvironmentPanel.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/environmentWorkspacePathActions|codex-environment-insert-workspace-terminal|Workspace path inserted in terminal|__orchestratorLastEnvironmentTerminal/.test(diff)) return
  matched.delete('--terminal')
}

function suppressTerminalForWorktreesSettingsPathHandoffDiff(matched, paths) {
  const terminal = matched.get('--terminal')
  const settings = matched.get('--settings')
  if (!terminal || !settings) return
  if (!terminal.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('src/renderer/src/components/Settings/WorktreesSettingsPage.tsx') ? diffForFile('src/renderer/src/components/Settings/WorktreesSettingsPage.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/settingsWorktreesPathActions|worktree-insert-terminal|Worktree path inserted in terminal|__orchestratorLastWorktreeTerminal/.test(diff)) return
  matched.delete('--terminal')
}

function suppressTerminalForProviderSettingsCommandHandoffDiff(matched, paths) {
  const terminal = matched.get('--terminal')
  const providers = matched.get('--settings-providers')
  if (!terminal || !providers) return
  if (!terminal.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('src/renderer/src/components/Settings/ProvidersSettingsPage.tsx') ? diffForFile('src/renderer/src/components/Settings/ProvidersSettingsPage.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/settingsProviderCommandTerminalHandoff|provider-command-output-terminal|Provider command inserted in terminal|__orchestratorLastProviderCommandTerminal/.test(diff)) return
  matched.delete('--terminal')
}

function suppressComposerAndFilesForReviewRowAddToChatDiff(matched, paths) {
  const diffCore = matched.get('--diff-core')
  if (!diffCore) return
  const diff = [
    paths.includes('src/renderer/src/components/Session/DiffPanel.tsx') ? diffForFile('src/renderer/src/components/Session/DiffPanel.tsx') : '',
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : ''
  ].join('\n')
  if (!/reviewRowAddToChat|review-row-add-chat|Added .* to chat/.test(diff)) return
  const composer = matched.get('--composer')
  if (composer && composer.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) {
    matched.delete('--composer')
  }
  const files = matched.get('--files')
  if (files && files.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) {
    matched.delete('--files')
  }
}

function suppressComposerForBrowserHandoffDiff(matched, paths) {
  const composer = matched.get('--composer')
  const browser = matched.get('--browser')
  if (!composer || !browser) return
  if (!composer.files.every((file) => file === 'scripts/run-automated-ui-smoke.mjs' || file === 'src/main/index.ts')) return
  const diff = [
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : '',
    paths.includes('src/renderer/src/components/Session/BrowserPanel.tsx') ? diffForFile('src/renderer/src/components/Session/BrowserPanel.tsx') : ''
  ].join('\n')
  if (!/browserActionsPageContext|browser-menu-add-page-context|Add page context|Page context added to chat|Review this browser page/.test(diff)) return
  matched.delete('--composer')
}

function suppressEnvironmentForGitFileWorkflowDiff(matched, paths) {
  const environment = matched.get('--environment')
  const workbench = matched.get('--workbench-new-tab')
  if (!environment || !workbench) return
  if (!environment.files.every((file) =>
    file === 'scripts/run-automated-ui-smoke.mjs' ||
    file === 'src/main/index.ts' ||
    file === 'src/renderer/src/components/Session/GitPanel.tsx'
  )) return
  const diff = [
    paths.includes('scripts/run-automated-ui-smoke.mjs') ? diffForFile('scripts/run-automated-ui-smoke.mjs') : '',
    paths.includes('src/main/index.ts') ? diffForFile('src/main/index.ts') : '',
    paths.includes('src/renderer/src/components/Session/GitPanel.tsx') ? diffForFile('src/renderer/src/components/Session/GitPanel.tsx') : ''
  ].join('\n')
  if (!/workbenchNewTabGitFile(?:CopyPath|AddToChat|InsertTerminal|OpenWorkbench)|git-file-(?:copy-path|add-chat|insert-terminal|open-workbench)|Copy path for|Add .* to chat|Insert .* in terminal|File path inserted in terminal|__orchestratorLastGitFileTerminal|Open .* in Workbench/.test(diff)) return
  matched.delete('--environment')
}

function suppressWorkbenchForReviewGitHandoffDiff(matched, paths) {
  const diffCore = matched.get('--diff-core')
  if (!diffCore) return
  const diff = paths
    .filter((file) =>
      file === 'src/main/index.ts' ||
      file === 'scripts/run-automated-ui-smoke.mjs' ||
      file === 'scripts/suggest-ui-smoke-targets.mjs' ||
      file === 'src/renderer/src/components/Session/ContextSidebar.tsx' ||
      file === 'src/renderer/src/components/Session/DiffPanel.tsx' ||
      file === 'src/renderer/src/components/Session/GitPanel.tsx' ||
      file === 'src/renderer/src/index.css' ||
      file === 'src/renderer/src/store/sessions.ts'
    )
    .map(diffForFile)
    .join('\n')
  if (!/reviewGitHandoffSelectedFile|gitReviewHandoffSelectedFile|focusRightPanelGitPath|focusRightPanelReviewPath|gitFocusPath|reviewFocusPath|git-file-row-focused|git-file-open-review/.test(diff)) return
  for (const flag of ['--right-panel', '--workbench-launcher', '--workbench-new-tab', '--design-system']) {
    const target = matched.get(flag)
    if (!target) continue
    if (target.files.every((file) => diffCore.files.includes(file))) matched.delete(flag)
  }
}

function suppressWorkbenchForEnvironmentCreatePrDiff(matched, paths) {
  const environment = matched.get('--environment')
  if (!environment) return
  const diff = paths
    .filter((file) =>
      file === 'src/main/index.ts' ||
      file === 'scripts/run-automated-ui-smoke.mjs' ||
      file === 'scripts/suggest-ui-smoke-targets.mjs' ||
      file === 'src/renderer/src/App.tsx' ||
      file === 'src/renderer/src/components/Session/ContextSidebar.tsx' ||
      file === 'src/renderer/src/components/Session/EnvironmentPanel.tsx' ||
      file === 'src/renderer/src/components/Session/GitPanel.tsx' ||
      file === 'src/renderer/src/store/sessions.ts'
    )
    .map(diffForFile)
    .join('\n')
  if (!/environmentCreatePrOpensGit|environmentCommitOpensGit|environmentBranchOpensGit|environmentWorkspacePathActions|open-git-pr|open-git-commit|open-git-branch|codex-environment-(?:copy-workspace-path|insert-workspace-terminal)|Workspace path (?:copied|inserted in terminal)|__orchestratorLastEnvironment|Open Git to create a pull request|Open Git to commit changes|Open Git branch controls|gitFocusTarget|GitFocusTarget|data-git-focus-target|data-git-focused-target|focusTarget|focusRightPanelGitTarget|__orchestratorSetSessionReviewMetadataForSmoke|onOpenGit/.test(diff)) return
  for (const flag of ['--right-panel', '--workbench-launcher', '--workbench-new-tab']) {
    const target = matched.get(flag)
    if (!target) continue
    if (target.files.every((file) => environment.files.includes(file))) matched.delete(flag)
  }
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
  console.log('Fast iteration pass:')
  console.log('  - pnpm run smoke:ui:changed:static')
  console.log('')
  console.log('Run the complete generated plan:')
  console.log('  - pnpm run smoke:ui:changed')
  if (smokeChecks.length > 0) {
    console.log('')
    console.log('Focused Electron pass after static checks:')
    console.log('  - pnpm run smoke:ui:changed:smoke')
  }

  if (suggestions.broadReasons.length > 0) {
    console.log('')
    console.log('Broad-smoke review needed before running no-flag smoke:')
    for (const file of suggestions.broadReasons) console.log(`  - ${file}`)
  }

  if (suggestions.coveredBroadReasons.length > 0) {
    console.log('')
    console.log('Broad files covered by focused smoke rules:')
    for (const file of suggestions.coveredBroadReasons) console.log(`  - ${file}`)
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
    broadReviewCoveredByFocusedSmoke: suggestions.coveredBroadReasons,
    unmatchedFiles: suggestions.unmatched
  }, null, 2))
}

function runPlan(plan, suggestions, options = {}) {
  const selectedPlan = plan.filter((check) => {
    if (options.staticOnly) return check.kind === 'static'
    if (options.smokeOnly) return check.kind === 'ui-smoke'
    return true
  })

  if (selectedPlan.length === 0) {
    if (options.staticOnly) console.log('No static validation checks matched the changed files.')
    else if (options.smokeOnly) console.log('No focused UI smoke matched the changed files.')
    return
  }

  console.log('')
  if (options.staticOnly) console.log('Running targeted static validation plan')
  else if (options.smokeOnly) console.log('Running focused UI smoke plan')
  else console.log('Running targeted validation plan')
  for (const check of selectedPlan) {
    console.log(`\n> ${formatCommand(check)}`)
    const result = spawnSync(check.command, check.args, {
      cwd: root,
      encoding: 'utf8',
      stdio: 'inherit'
    })
    if (result.status !== 0) process.exit(result.status ?? 1)
  }

  if (!options.staticOnly && suggestions.broadReasons.length > 0) {
    console.log('')
    console.log('Broad-smoke review was flagged, but no no-flag smoke was run automatically.')
  } else if (options.staticOnly && plan.some((check) => check.kind === 'ui-smoke')) {
    console.log('')
    console.log('Static checks passed. Focused UI smoke was not run in --static-only mode.')
  }
}

function formatCommand(check) {
  return [check.command, ...check.args].map(shellQuote).join(' ')
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value)
}
