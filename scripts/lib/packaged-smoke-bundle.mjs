import { spawnSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export function prepareMacSmokeBundle({ root, profile }) {
  const sourceApp = join(root, 'dist/mac-arm64/Orchestrator.app')
  if (!existsSync(sourceApp)) {
    console.error(`Packaged app not found at ${sourceApp}`)
    console.error('Run npm run pack:mac first, or use a dev smoke profile.')
    process.exit(1)
  }

  const suffix = bundleIdSuffix(profile)
  const appName = `Orchestrator ${titleCaseProfile(profile)}`
  const bundleRoot = join(tmpdir(), 'orchestrator-app-bundles', suffix)
  const appPath = join(bundleRoot, `${appName}.app`)
  rmSync(appPath, { recursive: true, force: true })
  mkdirSync(bundleRoot, { recursive: true })
  cpSync(sourceApp, appPath, { recursive: true, verbatimSymlinks: true })

  const plist = join(appPath, 'Contents/Info.plist')
  const executableName = `Orchestrator-${suffix}`
  renameSync(join(appPath, 'Contents/MacOS/Orchestrator'), join(appPath, 'Contents/MacOS', executableName))
  updatePlist(plist, 'CFBundleDisplayName', appName)
  updatePlist(plist, 'CFBundleExecutable', executableName)
  updatePlist(plist, 'CFBundleIdentifier', `com.navital.orchestrator.${suffix}`)

  return {
    appPath,
    executable: join(appPath, 'Contents/MacOS', executableName)
  }
}

function updatePlist(plist, key, value) {
  const result = spawnSync('plutil', ['-replace', key, '-string', value, plist], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function titleCaseProfile(name) {
  return name
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function bundleIdSuffix(name) {
  const suffix = String(name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return suffix || 'smoke'
}
