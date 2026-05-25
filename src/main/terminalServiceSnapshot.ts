import type { TerminalServiceSessionSnapshot, TerminalServiceSnapshot } from '../types'

export interface TerminalServiceSnapshotState {
  shellIds: Iterable<string>
  startingIds: Iterable<string>
  buffers: ReadonlyMap<string, string>
  workDirs: ReadonlyMap<string, string>
  exitStates: ReadonlyMap<string, { exitCode: number; signal: number | null }>
}

export function createTerminalServiceSnapshot(state: TerminalServiceSnapshotState): TerminalServiceSnapshot {
  const runningIds = new Set(state.shellIds)
  const startingIds = new Set(state.startingIds)
  const terminalIds = new Set<string>([
    ...runningIds,
    ...startingIds,
    ...state.buffers.keys(),
    ...state.workDirs.keys(),
    ...state.exitStates.keys()
  ])
  const sessions = [...terminalIds]
    .sort((left, right) => left.localeCompare(right))
    .map((terminalId): TerminalServiceSessionSnapshot => {
      const bufferLength = state.buffers.get(terminalId)?.length ?? 0
      const exitState = state.exitStates.get(terminalId)
      const status = startingIds.has(terminalId)
        ? 'starting'
        : runningIds.has(terminalId)
          ? 'running'
          : exitState
            ? 'exited'
            : 'buffered'
      return {
        terminalId,
        workDir: state.workDirs.get(terminalId) ?? null,
        status,
        bufferLength,
        hasBuffer: bufferLength > 0,
        ...(exitState ? { exitCode: exitState.exitCode, signal: exitState.signal } : {})
      }
    })

  return {
    sessions,
    sessionCount: sessions.length,
    runningCount: sessions.filter((session) => session.status === 'running').length,
    startingCount: sessions.filter((session) => session.status === 'starting').length,
    exitedCount: sessions.filter((session) => session.status === 'exited').length,
    bufferedCount: sessions.filter((session) => session.status === 'buffered').length,
    totalBufferLength: sessions.reduce((sum, session) => sum + session.bufferLength, 0)
  }
}
