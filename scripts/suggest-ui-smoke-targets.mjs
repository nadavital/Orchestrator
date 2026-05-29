#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

const targetRules = [
  { flag: '--composer', label: 'Composer', patterns: [/^src\/renderer\/src\/components\/Session\/Composer/, /^src\/renderer\/src\/components\/Session\/ChatComposer/, /^src\/renderer\/src\/components\/Session\/ComposerToolbar/, /^src\/renderer\/src\/stores\/.*composer/i] },
  { flag: '--transcript-layout', label: 'Transcript', patterns: [/^src\/renderer\/src\/components\/Session\/(Transcript|ChatMessage|MessageActions)/, /^src\/renderer\/src\/components\/Session\/Tool/, /^src\/renderer\/src\/stores\/.*message/i] },
  { flag: '--transcript-file-reference', label: 'Transcript file references', patterns: [/^src\/renderer\/src\/components\/Session\/FileReference/, /^src\/renderer\/src\/components\/Session\/.*Reference/] },
  { flag: '--transcript-permission', label: 'Transcript permissions', patterns: [/^src\/renderer\/src\/components\/Session\/.*Permission/, /^src\/main\/.*permission/i, /^src\/main\/providers\/.*permission/i] },
  { flag: '--side-chat', label: 'Side chat', patterns: [/^src\/renderer\/src\/components\/Session\/SideChat/] },
  { flag: '--right-panel', label: 'Right Workbench shell', patterns: [/^src\/renderer\/src\/components\/Session\/(WorkbenchPanel|RightPanel|ContextSidebar)/, /^src\/renderer\/src\/components\/Session\/.*Workbench/, /^src\/renderer\/src\/components\/ui\/ToolbarButton/] },
  { flag: '--workbench-new-tab', label: 'Workbench New Tab', patterns: [/^src\/renderer\/src\/components\/Session\/(WorkbenchNewTab|GitPanel|AgentsPanel|EnvironmentPanel)/, /^src\/main\/git/] },
  { flag: '--environment', label: 'Environment panel', patterns: [/^src\/renderer\/src\/components\/Session\/Environment/] },
  { flag: '--browser', label: 'Browser panel', patterns: [/^src\/renderer\/src\/components\/Session\/Browser/, /^src\/main\/browser/, /^src\/renderer\/src\/.*browser/i] },
  { flag: '--terminal', label: 'Terminal', patterns: [/^src\/renderer\/src\/components\/Session\/Terminal/, /^src\/main\/terminal/, /^src\/preload\/.*terminal/i] },
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

const broadTriggers = [
  /^scripts\/run-automated-ui-smoke\.mjs$/,
  /^src\/main\/index\.ts$/,
  /^src\/preload\//,
  /^src\/shared\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/
]

const files = resolveFiles(process.argv.slice(2))
const suggestions = suggestTargets(files)

printSuggestions(files, suggestions)

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
        const current = matched.get(rule.flag) ?? { flag: rule.flag, label: rule.label, files: [] }
        current.files.push(file)
        matched.set(rule.flag, current)
      }
    }
    if (broadTriggers.some((pattern) => pattern.test(file))) {
      broadReasons.push(file)
    }
    if (!fileMatched) unmatched.push(file)
  }

  suppressCoveredTarget(matched, '--settings', '--settings-providers')
  suppressCoveredTarget(matched, '--settings', '--pets')

  return { targets: Array.from(matched.values()), unmatched, broadReasons }
}

function suppressCoveredTarget(matched, broadFlag, focusedFlag) {
  const broad = matched.get(broadFlag)
  const focused = matched.get(focusedFlag)
  if (!broad || !focused) return
  const focusedFiles = new Set(focused.files)
  if (broad.files.every((file) => focusedFiles.has(file))) matched.delete(broadFlag)
}

function printSuggestions(paths, suggestions) {
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

  console.log('Always run:')
  console.log('  - git diff --check')
  if (paths.some((file) => file.startsWith('src/') || file === 'package.json')) {
    console.log('  - pnpm exec tsc --noEmit')
  }
  if (paths.some((file) => file.startsWith('scripts/') && file.endsWith('.mjs'))) {
    console.log('  - node -c <changed-script>')
  }
  console.log('')

  if (suggestions.targets.length > 0) {
    console.log('Suggested focused UI smoke:')
    for (const target of suggestions.targets) {
      console.log(`  - node scripts/run-automated-ui-smoke.mjs ${target.flag}  # ${target.label}`)
    }
  } else {
    console.log('Suggested focused UI smoke:')
    console.log('  - none from path rules')
  }

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
