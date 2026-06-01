import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { fileStatusLabel } from '../../types'
import type { FileChange, GitBranchActionResult, GitCommitResult, GitPullRequestCreateResult, GitRefOption, Session } from '../../types'
import type { GitFocusTarget } from '../../store/sessions'
import { Button, DialogContent, DialogFooter, DialogHeader, MotionOverlay } from '../shared/designSystem'
import Icon from '../shared/Icon'

interface Props {
  session: Session
  initialTarget: GitFocusTarget
  focusPath?: string | null
  onClose: () => void
}

type GitDialogState = 'idle' | 'loading' | 'staging' | 'unstaging' | 'branching' | 'checking-out' | 'committing' | 'creating-pr'

export default function GitActionDialog({ session, initialTarget, focusPath = null, onClose }: Props): JSX.Element {
  const [target, setTarget] = useState<GitFocusTarget>(initialTarget)
  const [changes, setChanges] = useState<FileChange[]>([])
  const [branches, setBranches] = useState<GitRefOption[]>([])
  const [state, setState] = useState<GitDialogState>('loading')
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'danger' } | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [branchName, setBranchName] = useState('')
  const [checkoutBranchName, setCheckoutBranchName] = useState('')
  const [prCreateUrl, setPrCreateUrl] = useState('')
  const [prPushCommand, setPrPushCommand] = useState('')
  const [prBranchPublished, setPrBranchPublished] = useState<boolean | null>(null)
  const [prError, setPrError] = useState<string | null>(null)

  const workDir = session.workDir
  const selectedChange = useMemo(
    () => changes.find((change) => change.path === focusPath) ?? null,
    [changes, focusPath]
  )
  const stagedPaths = useMemo(() => changes.filter((change) => change.staged).map((change) => change.path), [changes])
  const unstagedPaths = useMemo(() => changes.filter((change) => change.unstaged).map((change) => change.path), [changes])
  const selectedPaths = selectedChange ? [selectedChange.path] : []
  const currentBranch = branches.find((branch) => branch.current)?.label ?? 'main'
  const repositoryLabel = shortWorkDirLabel(workDir)
  const visibleChanges = changes.slice(0, 4)
  const hiddenChangeCount = Math.max(0, changes.length - visibleChanges.length)
  const checkoutBranchOptions = branches.filter((branch) => !branch.current && !branch.description?.startsWith('Remote branch'))
  const defaultBaseBranch = inferDefaultBaseBranch(branches)
  const prCommand = currentBranch && currentBranch !== defaultBaseBranch
    ? `gh pr create --fill --base ${shellQuote(defaultBaseBranch)} --head ${shellQuote(currentBranch)}`
    : ''
  const busy = state !== 'idle'
  const canCommit = stagedPaths.length > 0 && commitMessage.trim().length > 0 && !busy

  useEffect(() => {
    setTarget(initialTarget)
  }, [initialTarget])

  useEffect(() => {
    let cancelled = false
    setState('loading')
    void Promise.all([
      window.api.sessions.getChangedFiles(session.id, 'all').catch(() => []),
      window.api.git.listBranches(workDir).catch(() => [])
    ]).then(([nextChanges, nextBranches]) => {
      if (cancelled) return
      setChanges(nextChanges)
      setBranches(nextBranches)
      setState('idle')
    }).catch((error) => {
      if (cancelled) return
      setMessage({ text: error instanceof Error ? error.message : 'Git status unavailable', tone: 'danger' })
      setState('idle')
    })
    return () => {
      cancelled = true
    }
  }, [session.id, workDir])

  useEffect(() => {
    let cancelled = false
    setPrCreateUrl('')
    setPrPushCommand('')
    setPrBranchPublished(null)
    setPrError(null)
    if (!prCommand) return
    void window.api.git.getPullRequestCreateUrl(workDir, defaultBaseBranch, currentBranch)
      .then((result) => {
        if (cancelled) return
        setPrBranchPublished(typeof result.branchPublished === 'boolean' ? result.branchPublished : null)
        setPrPushCommand(result.pushCommand ?? '')
        if (result.ok && result.url) {
          setPrCreateUrl(result.url)
        } else {
          setPrError(result.error ?? 'Create PR URL unavailable')
        }
      })
      .catch((error) => {
        if (cancelled) return
        setPrError(error instanceof Error ? error.message : 'Create PR URL unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [currentBranch, defaultBaseBranch, prCommand, workDir])

  const refreshChanges = async (): Promise<void> => {
    setChanges(await window.api.sessions.getChangedFiles(session.id, 'all').catch(() => []))
  }

  const runPathAction = async (action: 'stage' | 'unstage', paths: string[]): Promise<void> => {
    if (paths.length === 0 || busy) return
    setState(action === 'stage' ? 'staging' : 'unstaging')
    setMessage({ text: action === 'stage' ? `Staging ${paths.length} file${paths.length === 1 ? '' : 's'}` : `Unstaging ${paths.length} file${paths.length === 1 ? '' : 's'}`, tone: 'info' })
    try {
      const result = action === 'stage'
        ? await window.api.git.stagePaths(workDir, paths)
        : await window.api.git.unstagePaths(workDir, paths)
      setChanges(result.changedFiles)
      setMessage({
        text: result.ok
          ? action === 'stage' ? `Staged ${paths.length} file${paths.length === 1 ? '' : 's'}` : `Unstaged ${paths.length} file${paths.length === 1 ? '' : 's'}`
          : result.error ?? 'Git file action failed',
        tone: result.ok ? 'info' : 'danger'
      })
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Git file action failed', tone: 'danger' })
    } finally {
      setState('idle')
    }
  }

  const runCommit = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault()
    if (!canCommit) return
    setState('committing')
    setMessage({ text: `Committing ${stagedPaths.length} file${stagedPaths.length === 1 ? '' : 's'}`, tone: 'info' })
    try {
      const result: GitCommitResult = await window.api.git.commitStaged(workDir, commitMessage)
      setChanges(result.changedFiles)
      if (result.ok) {
        setCommitMessage('')
        setMessage({ text: `Committed ${result.commit ?? 'changes'}`, tone: 'info' })
      } else {
        setMessage({ text: result.error ?? 'Commit failed', tone: 'danger' })
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Commit failed', tone: 'danger' })
    } finally {
      setState('idle')
    }
  }

  const runCreateBranch = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault()
    const nextBranchName = branchName.trim()
    if (!nextBranchName || busy) return
    setState('branching')
    try {
      const result: GitBranchActionResult = await window.api.git.createBranch(workDir, nextBranchName)
      setBranches(result.branches)
      setMessage({ text: result.ok ? `Created branch ${result.currentBranch ?? result.branchName ?? nextBranchName}` : result.error ?? 'Create branch failed', tone: result.ok ? 'info' : 'danger' })
      if (result.ok) {
        setBranchName('')
        await refreshChanges()
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Create branch failed', tone: 'danger' })
    } finally {
      setState('idle')
    }
  }

  const runCheckoutBranch = async (): Promise<void> => {
    const nextBranchName = checkoutBranchName.trim()
    if (!nextBranchName || busy) return
    setState('checking-out')
    try {
      const result = await window.api.git.checkoutBranch(workDir, nextBranchName)
      setBranches(result.branches)
      setMessage({ text: result.ok ? `Checked out ${result.currentBranch ?? result.branchName ?? nextBranchName}` : result.error ?? 'Checkout failed', tone: result.ok ? 'info' : 'danger' })
      if (result.ok) {
        setCheckoutBranchName('')
        await refreshChanges()
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Checkout failed', tone: 'danger' })
    } finally {
      setState('idle')
    }
  }

  const copyText = async (text: string, label: string): Promise<void> => {
    if (!text || busy) return
    try {
      const didWrite = await window.api.clipboard?.writeText?.(text)
      if (!didWrite) await navigator.clipboard.writeText(text)
      setMessage({ text: `${label} copied`, tone: 'info' })
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : `Copy ${label.toLowerCase()} failed`, tone: 'danger' })
    }
  }

  const runCreatePullRequest = async (): Promise<void> => {
    if (!prCommand || prBranchPublished !== true || busy) return
    setState('creating-pr')
    setPrError(null)
    try {
      const result: GitPullRequestCreateResult = await window.api.git.createPullRequest(workDir, defaultBaseBranch, currentBranch)
      if (result.ok) {
        setMessage({ text: 'Pull request created', tone: 'info' })
        if (result.url) setPrCreateUrl(result.url)
      } else {
        setPrError(result.error ?? 'Create pull request failed')
        setMessage({ text: result.error ?? 'Create pull request failed', tone: 'danger' })
      }
    } catch (error) {
      const nextError = error instanceof Error ? error.message : 'Create pull request failed'
      setPrError(nextError)
      setMessage({ text: nextError, tone: 'danger' })
    } finally {
      setState('idle')
    }
  }

  return (
    <MotionOverlay onClose={onClose} surfaceClassName="orchestrator-dialog-surface orchestrator-dialog-surface-wide">
      <DialogContent>
        <DialogHeader
          title={target === 'branch' ? 'Branch' : target === 'pull-request' ? 'Pull request' : 'Commit or push'}
          description={(
            <span className="git-action-dialog-context">
              <span>{currentBranch}</span>
              <span>{repositoryLabel}</span>
            </span>
          )}
        />
        <div
          className="git-action-dialog"
          data-testid="git-action-dialog"
          data-git-action-dialog-target={target}
          data-git-action-dialog-state={state}
        >
          <div className="git-action-dialog-tabs" role="tablist" aria-label="Git actions">
            <button type="button" className="git-action-dialog-tab" data-active={target === 'commit'} onClick={() => setTarget('commit')}>Commit</button>
            <button type="button" className="git-action-dialog-tab" data-active={target === 'branch'} onClick={() => setTarget('branch')}>Branch</button>
            <button type="button" className="git-action-dialog-tab" data-active={target === 'pull-request'} onClick={() => setTarget('pull-request')}>PR</button>
          </div>
          {target === 'commit' && (
            <form className="git-action-dialog-section" onSubmit={(event) => void runCommit(event)}>
              <div className="git-action-dialog-summary">
                <span>{changes.length} changed</span>
                <span>{stagedPaths.length} staged</span>
                {selectedChange && <span className="git-action-dialog-selected-path">{selectedChange.path}</span>}
              </div>
              <div className="git-action-dialog-row">
                <Button variant="secondary" disabled={busy || unstagedPaths.length === 0} onClick={() => void runPathAction('stage', selectedChange?.unstaged ? selectedPaths : unstagedPaths)}>
                  {selectedChange?.unstaged ? 'Stage selected' : 'Stage all'}
                </Button>
                <Button variant="ghost" disabled={busy || stagedPaths.length === 0} onClick={() => void runPathAction('unstage', selectedChange?.staged ? selectedPaths : stagedPaths)}>
                  {selectedChange?.staged ? 'Unstage selected' : 'Unstage all'}
                </Button>
              </div>
              <textarea
                className="git-action-dialog-textarea"
                value={commitMessage}
                placeholder="Commit message"
                rows={3}
                onChange={(event) => setCommitMessage(event.currentTarget.value)}
              />
              <div className="git-action-dialog-files">
                {visibleChanges.map((change) => (
                  <span key={change.path} className="git-action-dialog-file">
                    <Icon name={change.staged ? 'check' : 'diff'} size={12} />
                    {change.path} ({fileStatusLabel(change.status)})
                  </span>
                ))}
                {hiddenChangeCount > 0 && <span className="git-action-dialog-file git-action-dialog-file-more">+{hiddenChangeCount} more</span>}
              </div>
            </form>
          )}
          {target === 'branch' && (
            <div className="git-action-dialog-section">
              <form className="git-action-dialog-row" onSubmit={(event) => void runCreateBranch(event)}>
                <input className="git-action-dialog-input" value={branchName} placeholder="new-branch-name" onChange={(event) => setBranchName(event.currentTarget.value)} />
                <Button variant="primary" type="submit" disabled={busy || branchName.trim().length === 0}>Create</Button>
              </form>
              <div className="git-action-dialog-row">
                <select className="git-action-dialog-input" value={checkoutBranchName} onChange={(event) => setCheckoutBranchName(event.currentTarget.value)}>
                  <option value="">Switch branch...</option>
                  {checkoutBranchOptions.map((branch) => <option key={`${branch.value}:${branch.label}`} value={branch.value}>{branch.label}</option>)}
                </select>
                <Button variant="secondary" disabled={busy || checkoutBranchName.trim().length === 0} onClick={() => void runCheckoutBranch()}>Switch</Button>
              </div>
            </div>
          )}
          {target === 'pull-request' && (
            <div className="git-action-dialog-section">
              <div className="git-action-dialog-summary">
                <span>Base {defaultBaseBranch}</span>
                <span>Head {currentBranch}</span>
                {prBranchPublished === false && <span>Push required</span>}
              </div>
              {prError && <p className="git-action-dialog-status" data-tone="danger">{prError}</p>}
              <div className="git-action-dialog-row">
                <Button variant="secondary" disabled={!prCommand || busy} onClick={() => void copyText(prCommand, 'PR command')}>Copy command</Button>
                <Button variant="ghost" disabled={!prPushCommand || busy} onClick={() => void copyText(prPushCommand, 'Push command')}>Copy push</Button>
                <Button variant="primary" disabled={!prCommand || prBranchPublished !== true || busy} onClick={() => void runCreatePullRequest()}>Create PR</Button>
              </div>
              {prCreateUrl && (
                <Button variant="ghost" disabled={busy} onClick={() => void window.api.browser.openExternal(prCreateUrl)}>Open create URL</Button>
              )}
            </div>
          )}
          {message && <p className="git-action-dialog-status" data-tone={message.tone} role={message.tone === 'danger' ? 'alert' : 'status'}>{message.text}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {target === 'commit' && <Button variant="primary" disabled={!canCommit} onClick={() => void runCommit()}>Commit</Button>}
        </DialogFooter>
      </DialogContent>
    </MotionOverlay>
  )
}

function inferDefaultBaseBranch(branches: GitRefOption[]): string {
  return branches.find((branch) => branch.label === 'main')?.label ??
    branches.find((branch) => branch.label === 'master')?.label ??
    branches.find((branch) => branch.description?.includes('default'))?.label ??
    'main'
}

function shortWorkDirLabel(workDir: string): string {
  const parts = workDir.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? workDir
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9._/@:-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}
