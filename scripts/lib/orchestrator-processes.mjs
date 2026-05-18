import { spawnSync } from 'child_process'

const INSTALLED_APP_MARKER = '/Applications/Orchestrator.app/Contents/'

export function listOrchestratorProcesses() {
  const result = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`Unable to inspect running processes${detail ? `: ${detail}` : ''}`)
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/)
      if (!match) return null
      return { pid: Number(match[1]), command: match[2] }
    })
    .filter((entry) => entry && entry.pid !== process.pid)
    .filter((entry) => /Orchestrator(?: Helper.*?)?\.app\/Contents\//.test(entry.command))
}

export function installedOrchestratorProcesses() {
  return listOrchestratorProcesses()
    .filter((entry) => entry.command.includes(INSTALLED_APP_MARKER))
}

export function assertNoRunningInstalledOrchestrator(action) {
  if (process.env.ORCHESTRATOR_ALLOW_RUNNING_APP === '1') return

  let running
  try {
    running = installedOrchestratorProcesses()
  } catch (error) {
    console.error(`Refusing to ${action}: could not verify whether /Applications/Orchestrator.app is running.`)
    console.error(error instanceof Error ? error.message : String(error))
    console.error('Set ORCHESTRATOR_ALLOW_RUNNING_APP=1 only if you intentionally want to bypass this guard.')
    process.exit(1)
  }

  if (running.length === 0) return

  console.error(`Refusing to ${action}: /Applications/Orchestrator.app is currently running.`)
  for (const processInfo of running.slice(0, 8)) {
    console.error(`  pid ${processInfo.pid}: ${processInfo.command}`)
  }
  console.error('Quit Orchestrator first, or set ORCHESTRATOR_ALLOW_RUNNING_APP=1 if you deliberately accept the risk.')
  process.exit(1)
}
