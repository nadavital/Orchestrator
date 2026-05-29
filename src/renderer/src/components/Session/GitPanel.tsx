import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { fileStatusLabel } from '../../types'
import type { FileChange, GitRefOption } from '../../types'
import Icon, { type IconName } from '../shared/Icon'
import { Button, IconButton } from '../shared/designSystem'

interface Props {
  sessionId: string
  workDir: string
  embedded?: boolean
  onOpenReview: () => void
}

type GitActionState = 'idle' | 'loading' | 'staging' | 'unstaging' | 'committing'

export default function GitPanel({ sessionId, workDir, embedded = false, onOpenReview }: Props): JSX.Element {
  const [changes, setChanges] = useState<FileChange[]>([])
  const [branches, setBranches] = useState<GitRefOption[]>([])
  const [actionState, setActionState] = useState<GitActionState>('loading')
  const [actionMessage, setActionMessage] = useState<{ text: string; tone: 'info' | 'danger' } | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [lastCommit, setLastCommit] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    setActionState((current) => current === 'idle' ? 'loading' : current)
    try {
      const [nextChanges, nextBranches] = await Promise.all([
        window.api.sessions.getChangedFiles(sessionId, 'all').catch(() => []),
        window.api.git.listBranches(workDir).catch(() => [])
      ])
      setChanges(nextChanges)
      setBranches(nextBranches)
    } finally {
      setActionState((current) => current === 'loading' ? 'idle' : current)
    }
  }

  useEffect(() => {
    let cancelled = false
    setActionState('loading')
    void Promise.all([
      window.api.sessions.getChangedFiles(sessionId, 'all').catch(() => []),
      window.api.git.listBranches(workDir).catch(() => [])
    ]).then(([nextChanges, nextBranches]) => {
      if (cancelled) return
      setChanges(nextChanges)
      setBranches(nextBranches)
      setActionState('idle')
    })
    return () => {
      cancelled = true
    }
  }, [sessionId, workDir])

  const stagedPaths = useMemo(() => changes.filter((change) => change.staged).map((change) => change.path), [changes])
  const unstagedPaths = useMemo(() => changes.filter((change) => change.unstaged).map((change) => change.path), [changes])
  const totals = useMemo(() => changes.reduce((acc, change) => ({
    additions: acc.additions + change.additions,
    deletions: acc.deletions + change.deletions
  }), { additions: 0, deletions: 0 }), [changes])
  const currentBranch = branches.find((branch) => branch.current)?.label ?? 'main'
  const busy = actionState !== 'idle'
  const commitReady = stagedPaths.length > 0 && commitMessage.trim().length > 0

  const runPathAction = async (action: 'stage' | 'unstage'): Promise<void> => {
    const paths = action === 'stage' ? unstagedPaths : stagedPaths
    if (paths.length === 0 || busy) return
    const countLabel = `${paths.length} ${paths.length === 1 ? 'file' : 'files'}`
    setActionState(action === 'stage' ? 'staging' : 'unstaging')
    setActionMessage({ text: action === 'stage' ? `Staging ${countLabel}` : `Unstaging ${countLabel}`, tone: 'info' })
    try {
      const result = action === 'stage'
        ? await window.api.git.stagePaths(workDir, paths)
        : await window.api.git.unstagePaths(workDir, paths)
      setChanges(result.changedFiles)
      if (result.ok) {
        setActionMessage({ text: action === 'stage' ? `Staged ${countLabel}` : `Unstaged ${countLabel}`, tone: 'info' })
      } else {
        setActionMessage({
          text: result.error || (action === 'stage' ? `Stage failed for ${countLabel}` : `Unstage failed for ${countLabel}`),
          tone: 'danger'
        })
      }
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : 'Git action failed', tone: 'danger' })
    } finally {
      setActionState('idle')
    }
  }

  const runCommit = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault()
    if (!commitReady || busy) return
    const stagedCount = stagedPaths.length
    const countLabel = `${stagedCount} ${stagedCount === 1 ? 'file' : 'files'}`
    setActionState('committing')
    setActionMessage({ text: `Committing ${countLabel}`, tone: 'info' })
    setLastCommit(null)
    try {
      const result = await window.api.git.commitStaged(workDir, commitMessage)
      setChanges(result.changedFiles)
      if (result.ok) {
        setCommitMessage('')
        setLastCommit(result.commit ?? null)
        setActionMessage({ text: `Committed ${result.commit ?? 'changes'}`, tone: 'info' })
      } else {
        setActionMessage({ text: result.error || `Commit failed for ${countLabel}`, tone: 'danger' })
      }
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : 'Commit failed', tone: 'danger' })
    } finally {
      setActionState('idle')
    }
  }

  return (
    <section
      className="git-panel environment-panel"
      data-testid="git-panel"
      data-git-change-count={changes.length}
      data-git-staged-count={stagedPaths.length}
      data-git-unstaged-count={unstagedPaths.length}
      data-git-action-state={actionState}
      data-git-last-commit={lastCommit ?? ''}
      style={{ height: embedded ? '100%' : undefined }}
    >
      <div className="environment-panel-scroll">
        <div className="environment-card" data-testid="git-summary-card">
          <div className="environment-card-header">
            <span>Git</span>
            <div className="flex items-center gap-1">
              <IconButton
                icon="refresh"
                label="Refresh Git status"
                size="xs"
                variant="ghost"
                dataTestId="git-refresh"
                disabled={busy}
                onClick={() => { void refresh() }}
              />
            </div>
          </div>
          {actionMessage && (
            <div
              className="git-action-status"
              data-testid="git-action-status"
              role={actionMessage.tone === 'danger' ? 'alert' : 'status'}
              aria-live={actionMessage.tone === 'danger' ? 'assertive' : 'polite'}
              aria-atomic="true"
              data-git-action-status-tone={actionMessage.tone}
            >
              {actionMessage.text}
            </div>
          )}
          <GitRow icon="branch" label={currentBranch} dataTestId="git-current-branch" />
          <GitRow
            icon="diff"
            label="Changes"
            dataTestId="git-changes-row"
            onClick={onOpenReview}
            action="open-review"
            title="Open Review"
            trailing={(
              <span className="environment-change-totals" data-testid="git-change-totals">
                <span className="environment-additions">+{totals.additions.toLocaleString()}</span>
                <span className="environment-deletions">-{totals.deletions.toLocaleString()}</span>
              </span>
            )}
          />
          <GitRow
            icon="plus"
            label="Stageable"
            dataTestId="git-stageable-row"
            trailing={<span className="environment-row-muted">{unstagedPaths.length}</span>}
          />
          <GitRow
            icon="eraser"
            label="Staged"
            dataTestId="git-staged-row"
            trailing={<span className="environment-row-muted">{stagedPaths.length}</span>}
          />
        </div>

        <div className="environment-card" data-testid="git-actions-card">
          <div className="environment-card-header">
            <span>Actions</span>
          </div>
          <div className="git-actions-row">
            <Button
              variant="primary"
              dataTestId="git-stage-all"
              disabled={busy || unstagedPaths.length === 0}
              onClick={() => { void runPathAction('stage') }}
            >
              Stage all
            </Button>
            <Button
              variant="ghost"
              dataTestId="git-unstage-all"
              disabled={busy || stagedPaths.length === 0}
              onClick={() => { void runPathAction('unstage') }}
            >
              Unstage all
            </Button>
            <Button variant="ghost" dataTestId="git-open-review" onClick={onOpenReview}>
              Open Review
            </Button>
          </div>
        </div>

        <form className="environment-card git-commit-card" data-testid="git-commit-card" onSubmit={(event) => { void runCommit(event) }}>
          <div className="environment-card-header">
            <span>Commit</span>
            <span className="environment-row-muted">{stagedPaths.length} staged</span>
          </div>
          <div className="git-commit-row">
            <input
              className="git-commit-input"
              data-testid="git-commit-message"
              value={commitMessage}
              disabled={busy}
              placeholder="Commit message"
              aria-label="Commit message"
              onChange={(event) => setCommitMessage(event.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              dataTestId="git-commit-staged"
              disabled={busy || !commitReady}
            >
              Commit staged
            </Button>
          </div>
          {lastCommit && (
            <div className="git-commit-meta" data-testid="git-last-commit">Last commit {lastCommit}</div>
          )}
        </form>

        <div className="environment-card" data-testid="git-file-list-card">
          <div className="environment-card-header">
            <span>Files</span>
            <span className="environment-row-muted">{changes.length}</span>
          </div>
          {changes.length === 0 ? (
            <div className="git-empty-state" data-testid="git-empty-state">No local changes</div>
          ) : changes.slice(0, 24).map((change) => (
            <div
              key={change.path}
              className="git-file-row"
              data-testid="git-file-row"
              data-git-file-path={change.path}
              data-git-file-staged={change.staged ? 'true' : 'false'}
              data-git-file-unstaged={change.unstaged ? 'true' : 'false'}
              title={change.path}
            >
              <span className="git-file-status">{fileStatusLabel(change.status)}</span>
              <span className="git-file-path">{change.path}</span>
              <span className="git-file-delta">
                +{change.additions.toLocaleString()} -{change.deletions.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function GitRow({
  icon,
  label,
  trailing,
  dataTestId,
  action,
  title,
  onClick
}: {
  icon: IconName
  label: string
  trailing?: JSX.Element
  dataTestId: string
  action?: string
  title?: string
  onClick?: () => void
}): JSX.Element {
  const content = (
    <>
      <Icon name={icon} size={15} />
      <span className="environment-row-label">{label}</span>
      {trailing && <span className="environment-row-trailing">{trailing}</span>}
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        className="environment-row"
        data-testid={dataTestId}
        data-git-row-action={action}
        aria-label={title ? `${label}. ${title}` : label}
        title={title}
        onClick={onClick}
      >
        {content}
      </button>
    )
  }
  return (
    <div className="environment-row" data-testid={dataTestId} data-git-row-action={action} title={title}>
      {content}
    </div>
  )
}
