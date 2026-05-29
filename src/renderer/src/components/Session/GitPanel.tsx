import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { fileStatusLabel } from '../../types'
import type { FileChange, GitRefOption, Session } from '../../types'
import Icon, { type IconName } from '../shared/Icon'
import { Button, DialogContent, DialogFooter, DialogHeader, IconButton, MotionOverlay } from '../shared/designSystem'

interface Props {
  session: Session
  embedded?: boolean
  onOpenReview: () => void
}

type GitActionState = 'idle' | 'loading' | 'staging' | 'unstaging' | 'branching' | 'checking-out' | 'committing' | 'discarding'

export default function GitPanel({ session, embedded = false, onOpenReview }: Props): JSX.Element {
  const [changes, setChanges] = useState<FileChange[]>([])
  const [branches, setBranches] = useState<GitRefOption[]>([])
  const [actionState, setActionState] = useState<GitActionState>('loading')
  const [actionMessage, setActionMessage] = useState<{ text: string; tone: 'info' | 'danger' } | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [branchName, setBranchName] = useState('')
  const [checkoutBranchName, setCheckoutBranchName] = useState('')
  const [lastCommit, setLastCommit] = useState<string | null>(null)
  const [lastCreatedBranch, setLastCreatedBranch] = useState<string | null>(null)
  const [lastCheckedOutBranch, setLastCheckedOutBranch] = useState<string | null>(null)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const sessionId = session.id
  const workDir = session.workDir

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
  const discardablePaths = useMemo(() => changes.map((change) => change.path), [changes])
  const totals = useMemo(() => changes.reduce((acc, change) => ({
    additions: acc.additions + change.additions,
    deletions: acc.deletions + change.deletions
  }), { additions: 0, deletions: 0 }), [changes])
  const currentBranch = branches.find((branch) => branch.current)?.label ?? 'main'
  const pullRequest = session.reviewMetadata?.pullRequest
  const pullRequestUrl = pullRequest?.url?.trim() ?? ''
  const defaultBaseBranch = pullRequest?.baseBranch ?? inferDefaultBaseBranch(branches)
  const prCommand = currentBranch && currentBranch !== defaultBaseBranch
    ? `gh pr create --fill --base ${shellQuote(defaultBaseBranch)} --head ${shellQuote(currentBranch)}`
    : ''
  const checkoutBranchOptions = useMemo(
    () => branches.filter((branch) => !branch.current && !branch.description?.startsWith('Remote branch')),
    [branches]
  )
  const busy = actionState !== 'idle'
  const commitReady = stagedPaths.length > 0 && commitMessage.trim().length > 0
  const branchReady = branchName.trim().length > 0
  const checkoutReady = checkoutBranchName.trim().length > 0

  const writeGitClipboardText = async (text: string): Promise<void> => {
    if (typeof window.api.clipboard?.writeText === 'function') {
      const didWrite = await window.api.clipboard.writeText(text)
      if (didWrite) return
    }
    await navigator.clipboard.writeText(text)
  }

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

  const runCreateBranch = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault()
    if (!branchReady || busy) return
    const nextBranchName = branchName.trim()
    setActionState('branching')
    setActionMessage({ text: `Creating branch ${nextBranchName}`, tone: 'info' })
    setLastCreatedBranch(null)
    try {
      const result = await window.api.git.createBranch(workDir, nextBranchName)
      setBranches(result.branches)
      if (result.ok) {
        setBranchName('')
        setLastCreatedBranch(result.currentBranch ?? result.branchName ?? nextBranchName)
        setActionMessage({ text: `Created branch ${result.currentBranch ?? result.branchName ?? nextBranchName}`, tone: 'info' })
      } else {
        setActionMessage({ text: result.error || `Create branch failed for ${nextBranchName}`, tone: 'danger' })
      }
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : 'Create branch failed', tone: 'danger' })
    } finally {
      setActionState('idle')
    }
  }

  const runCheckoutBranch = async (): Promise<void> => {
    if (!checkoutReady || busy) return
    const nextBranchName = checkoutBranchName.trim()
    setActionState('checking-out')
    setActionMessage({ text: `Checking out ${nextBranchName}`, tone: 'info' })
    setLastCheckedOutBranch(null)
    try {
      const result = await window.api.git.checkoutBranch(workDir, nextBranchName)
      setBranches(result.branches)
      if (result.ok) {
        const checkedOutBranch = result.currentBranch ?? result.branchName ?? nextBranchName
        setLastCheckedOutBranch(checkedOutBranch)
        setCheckoutBranchName('')
        setChanges(await window.api.sessions.getChangedFiles(sessionId, 'all').catch(() => []))
        setActionMessage({ text: `Checked out ${checkedOutBranch}`, tone: 'info' })
      } else {
        setActionMessage({ text: result.error || `Checkout failed for ${nextBranchName}`, tone: 'danger' })
      }
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : 'Checkout failed', tone: 'danger' })
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

  const openPullRequest = (): void => {
    if (!pullRequestUrl || busy) return
    setActionMessage({ text: 'Opening pull request', tone: 'info' })
    void window.api.browser.openExternal(pullRequestUrl)
  }

  const copyPullRequestCommand = async (): Promise<void> => {
    if (!prCommand || busy) return
    setActionMessage({ text: 'Copying PR command', tone: 'info' })
    try {
      const globals = window as typeof window & { __orchestratorLastGitPrCommandForSmoke?: string }
      globals.__orchestratorLastGitPrCommandForSmoke = prCommand
      await writeGitClipboardText(prCommand)
      setActionMessage({ text: 'PR command copied', tone: 'info' })
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : 'Copy PR command failed', tone: 'danger' })
    }
  }

  const requestDiscard = (): void => {
    if (discardablePaths.length === 0 || busy) return
    setDiscardConfirmOpen(true)
  }

  const runDiscard = async (): Promise<void> => {
    if (discardablePaths.length === 0 || busy) return
    const paths = discardablePaths
    const countLabel = `${paths.length} ${paths.length === 1 ? 'file' : 'files'}`
    setDiscardConfirmOpen(false)
    setActionState('discarding')
    setActionMessage({ text: `Discarding ${countLabel}`, tone: 'info' })
    try {
      const result = await window.api.git.discardPaths(workDir, paths)
      setChanges(result.changedFiles)
      if (result.ok) {
        setActionMessage({ text: `Discarded ${countLabel}`, tone: 'info' })
      } else {
        setActionMessage({ text: result.error || `Discard failed for ${countLabel}`, tone: 'danger' })
      }
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : 'Discard failed', tone: 'danger' })
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
      data-git-last-created-branch={lastCreatedBranch ?? ''}
      data-git-last-checked-out-branch={lastCheckedOutBranch ?? ''}
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
          <GitRow icon="branch" label={currentBranch} dataTestId="git-current-branch" dataCurrentBranch={currentBranch} />
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
            <Button
              variant="danger"
              dataTestId="git-discard-all"
              disabled={busy || discardablePaths.length === 0}
              onClick={requestDiscard}
            >
              Discard all
            </Button>
          </div>
        </div>

        <form className="environment-card git-branch-card" data-testid="git-branch-card" onSubmit={(event) => { void runCreateBranch(event) }}>
          <div className="environment-card-header">
            <span>Branch</span>
            <span className="environment-row-muted">{currentBranch}</span>
          </div>
          <div className="git-commit-row">
            <input
              className="git-commit-input"
              data-testid="git-branch-name"
              value={branchName}
              disabled={busy}
              placeholder="New branch name"
              aria-label="New branch name"
              onChange={(event) => setBranchName(event.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              dataTestId="git-create-branch"
              disabled={busy || !branchReady}
            >
              Create branch
            </Button>
          </div>
          {lastCreatedBranch && (
            <div className="git-commit-meta" data-testid="git-last-created-branch">Current branch {lastCreatedBranch}</div>
          )}
          <div className="git-commit-row">
            <select
              className="git-commit-input"
              data-testid="git-checkout-branch"
              value={checkoutBranchName}
              disabled={busy || checkoutBranchOptions.length === 0}
              aria-label="Checkout branch"
              onChange={(event) => setCheckoutBranchName(event.target.value)}
            >
              <option value="">Switch branch</option>
              {checkoutBranchOptions.map((branch) => (
                <option key={branch.name} value={branch.name}>{branch.label}</option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              dataTestId="git-checkout-branch-action"
              disabled={busy || !checkoutReady}
              onClick={() => { void runCheckoutBranch() }}
            >
              Checkout
            </Button>
          </div>
          {lastCheckedOutBranch && (
            <div className="git-commit-meta" data-testid="git-last-checked-out-branch">Current branch {lastCheckedOutBranch}</div>
          )}
        </form>

        <div className="environment-card git-pr-card" data-testid="git-pr-card" data-git-pr-command={prCommand}>
          <div className="environment-card-header">
            <span>Pull Request</span>
            <span className="environment-row-muted">{pullRequest?.number ? `PR ${pullRequest.number}` : defaultBaseBranch}</span>
          </div>
          {pullRequestUrl ? (
            <div className="git-actions-row">
              <Button
                variant="primary"
                dataTestId="git-view-pr"
                disabled={busy}
                title={pullRequestUrl}
                onClick={openPullRequest}
              >
                View pull request
              </Button>
            </div>
          ) : (
            <div className="git-commit-row">
              <input
                className="git-commit-input"
                data-testid="git-pr-command"
                value={prCommand || 'Create or switch to a topic branch first'}
                readOnly
                aria-label="Pull request command"
              />
              <Button
                variant="primary"
                dataTestId="git-copy-pr-command"
                disabled={busy || !prCommand}
                onClick={() => { void copyPullRequestCommand() }}
              >
                Copy PR command
              </Button>
            </div>
          )}
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
      {discardConfirmOpen && (
        <MotionOverlay
          onClose={() => setDiscardConfirmOpen(false)}
          surfaceClassName="orchestrator-dialog-surface"
        >
          <DialogContent dataTestId="git-discard-confirm-dialog">
            <DialogHeader
              title="Discard changes?"
              description={`This removes local changes in ${discardablePaths.length} ${discardablePaths.length === 1 ? 'file' : 'files'}.`}
            />
            <DialogFooter>
              <Button
                variant="ghost"
                dataTestId="git-discard-confirm-cancel"
                onClick={() => setDiscardConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                dataTestId="git-discard-confirm-submit"
                onClick={() => { void runDiscard() }}
              >
                Discard
              </Button>
            </DialogFooter>
          </DialogContent>
        </MotionOverlay>
      )}
    </section>
  )
}

function inferDefaultBaseBranch(branches: GitRefOption[]): string {
  const names = branches.map((branch) => branch.name)
  if (names.includes('origin/main') || names.includes('main')) return 'main'
  if (names.includes('origin/master') || names.includes('master')) return 'master'
  return 'main'
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9._/@:-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

function GitRow({
  icon,
  label,
  trailing,
  dataTestId,
  action,
  title,
  onClick,
  dataCurrentBranch
}: {
  icon: IconName
  label: string
  trailing?: JSX.Element
  dataTestId: string
  action?: string
  title?: string
  onClick?: () => void
  dataCurrentBranch?: string
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
        data-git-current-branch={dataCurrentBranch}
        aria-label={title ? `${label}. ${title}` : label}
        title={title}
        onClick={onClick}
      >
        {content}
      </button>
    )
  }
  return (
    <div className="environment-row" data-testid={dataTestId} data-git-row-action={action} data-git-current-branch={dataCurrentBranch} title={title}>
      {content}
    </div>
  )
}
