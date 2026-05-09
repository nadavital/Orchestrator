import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(__dirname, '..')
const providersModulePath = join(repoRoot, 'out-test/src/main/providers.js')

if (!existsSync(providersModulePath)) {
  console.error('Missing compiled providers module. Run this through npm run smoke:providers.')
  process.exit(1)
}

const { PROVIDERS, getProviderDiagnostics, getProviderRuntimeInfo, resolveProviderBinary } = await import(providersModulePath)

const versionArgs = {
  claude: ['--version'],
  codex: ['--version'],
  copilot: ['--version'],
  cursor: ['--version']
}

function runProbe(binary, args) {
  try {
    const output = execFileSync(binary, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000
    })
    return { ok: true, output: output.trim().split('\n')[0] ?? '' }
  } catch (error) {
    const stderr = typeof error.stderr === 'string'
      ? error.stderr.trim()
      : error.stderr?.toString('utf8').trim()
    const stdout = typeof error.stdout === 'string'
      ? error.stdout.trim()
      : error.stdout?.toString('utf8').trim()
    return {
      ok: false,
      output: (stderr || stdout || error.message || 'probe failed').split('\n')[0]
    }
  }
}

function policySummary(runtime) {
  return Object.values(runtime.policies).map((policy) => ({
    id: policy.policy,
    support: policy.support,
    intent: policy.intent ?? 'unknown',
    interaction: policy.interaction ?? 'unknown',
    controls: [...new Set((policy.controls ?? []).map((control) => control.kind))].join(',') || 'none'
  }))
}

const runtimeInfo = getProviderRuntimeInfo()
const diagnostics = getProviderDiagnostics()
const failures = []

console.log('Provider diagnostics\n')

for (const [providerId, provider] of Object.entries(PROVIDERS)) {
  const runtime = runtimeInfo[providerId]
  const binary = resolveProviderBinary(provider)
  console.log(`${providerId}`)
  console.log(`  binary: ${binary ?? 'missing'}`)

  if (!runtime) {
    failures.push(`${providerId}: missing runtime info`)
    console.log('  runtime: missing')
    continue
  }

  if (!binary) {
    failures.push(`${providerId}: missing binary`)
    continue
  }

  const probe = runProbe(binary, versionArgs[providerId] ?? ['--version'])
  console.log(`  version: ${probe.ok ? probe.output : `probe failed: ${probe.output}`}`)
  if (!probe.ok && !/SecItemCopyMatching|keychain/i.test(probe.output)) {
    failures.push(`${providerId}: version probe failed`)
  }

  console.log(`  capabilities: ${runtime.abstractCapabilities.map((cap) => `${cap.key}=${cap.support}`).join(', ')}`)
  console.log(`  registry: ${runtime.registry.features.length} features, ${runtime.registry.gaps.length} gaps, ${runtime.registry.probes.length} no-quota probes`)
  if (runtime.registry.gaps.length > 0) {
    const gapSummary = runtime.registry.gaps
      .map((gap) => `${gap.id}=${gap.status}/${gap.severity}`)
      .join(', ')
    console.log(`  gaps: ${gapSummary}`)
  }
  if (diagnostics[providerId]?.probes?.length > 0) {
    console.log(`  probes: ${diagnostics[providerId].probes.map((p) => `${p.id}=${p.status}`).join(', ')}`)
  }
  console.log('  policies:')
  for (const policy of policySummary(runtime)) {
    console.log(`    - ${policy.id}: ${policy.support}; ${policy.intent}; ${policy.interaction}; controls=${policy.controls}`)
  }
  console.log('')
}

if (failures.length > 0) {
  console.error('Diagnostics failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('Diagnostics completed. Keychain-related probe failures are treated as environment warnings.')
