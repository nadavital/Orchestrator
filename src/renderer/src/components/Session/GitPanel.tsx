import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { fileStatusLabel } from '../../types'
import type { FileChange, GitPullRequestCreateResult, GitRefOption, ReviewMetadata, Session } from '../../types'
import type { GitFocusTarget } from '../../store/sessions'
import { useSessionStore } from '../../store/sessions'
import Icon, { type IconName } from '../shared/Icon'
import { Button, DialogContent, DialogFooter, DialogHeader, IconButton, MotionOverlay } from '../shared/designSystem'

interface Props {
  session: Session
  embedded?: boolean
  focusPath?: string | null
  focusRequest?: number
  focusTarget?: GitFocusTarget | null
  focusTargetRequest?: number
  onOpenReview: (path?: string) => void
}

type GitActionState = 'idle' | 'loading' | 'staging' | 'unstaging' | 'branching' | 'checking-out' | 'committing' | 'discarding' | 'terminal'
type GitPullRequestCreateState = 'idle' | 'creating' | 'created' | 'error'

export default function GitPanel({
  session,
  embedded = false,
  focusPath = null,
  focusRequest,
  focusTarget = null,
  focusTargetRequest,
  onOpenReview
}: Props): JSX.Element {
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
  const [prCreateUrl, setPrCreateUrl] = useState('')
  const [prCreateUrlError, setPrCreateUrlError] = useState<string | null>(null)
  const [prBranchPublished, setPrBranchPublished] = useState<boolean | null>(null)
  const [prRemoteBranch, setPrRemoteBranch] = useState('')
  const [prUpstreamBranch, setPrUpstreamBranch] = useState('')
  const [prPushCommand, setPrPushCommand] = useState('')
  const [prCreateState, setPrCreateState] = useState<GitPullRequestCreateState>('idle')
  const [prCreateError, setPrCreateError] = useState<string | null>(null)
  const [loadedReviewMetadata, setLoadedReviewMetadata] = useState<ReviewMetadata | undefined>(session.reviewMetadata)
  const [reviewMetadataState, setReviewMetadataState] = useState<'idle' | 'loading' | 'loaded' | 'unavailable' | 'error'>(
    session.reviewMetadata ? 'loaded' : 'idle'
  )
  const [reviewMetadataError, setReviewMetadataError] = useState<string | null>(null)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const [discardTargetPaths, setDiscardTargetPaths] = useState<string[] | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const branchCardRef = useRef<HTMLFormElement | null>(null)
  const prCardRef = useRef<HTMLDivElement | null>(null)
  const commitCardRef = useRef<HTMLFormElement | null>(null)
  const openRightPanelFileTab = useSessionStore((state) => state.openRightPanelFileTab)
  const setShowTerminal = useSessionStore((state) => state.setShowTerminal)
  const addTerminalTab = useSessionStore((state) => state.addTerminalTab)
  const setActiveTerminalTab = useSessionStore((state) => state.setActiveTerminalTab)
  const sessionId = session.id
  const workDir = session.workDir

  const refresh = async (): Promise<void> => {
    setActionState((current) => current === 'idle' ? 'loading' : current)
    setActionMessage({ text: 'Refreshing Git status', tone: 'info' })
    try {
      const [nextChanges, nextBranches] = await Promise.all([
        window.api.sessions.getChangedFiles(sessionId, 'all').catch(() => []),
        window.api.git.listBranches(workDir).catch(() => [])
      ])
      setChanges(nextChanges)
      setBranches(nextBranches)
      setActionMessage({ text: 'Git status refreshed', tone: 'info' })
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : 'Refresh Git status failed', tone: 'danger' })
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
  const reviewMetadata = session.reviewMetadata ?? loadedReviewMetadata
  const pullRequest = reviewMetadata?.pullRequest
  const providerWarnings = (reviewMetadata?.providerWarnings ?? []).filter((warning) => warning.trim().length > 0)
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
  const pendingDiscardPaths = discardTargetPaths ?? discardablePaths
  const pendingDiscardDescription = pendingDiscardPaths.length === 1
    ? `This removes local changes in ${pendingDiscardPaths[0]}.`
    : `This removes local changes in ${pendingDiscardPaths.length} files.`
  const focusedReviewPath = focusPath && changes.some((change) => change.path === focusPath) ? focusPath : null

  useEffect(() => {
    if (!focusPath || focusRequest === undefined) return
    const root = rootRef.current
    if (!root) return
    const row = [...root.querySelectorAll('[data-testid="git-file-row"]')]
      .find((candidate) => candidate instanceof HTMLElement && candidate.getAttribute('data-git-file-path') === focusPath)
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'nearest' })
    }
  }, [changes, focusPath, focusRequest])

  useEffect(() => {
    if (!focusTarget || focusTargetRequest === undefined) return
    const targetCard = focusTarget === 'branch'
      ? branchCardRef.current
      : focusTarget === 'pull-request'
        ? prCardRef.current
        : commitCardRef.current
    if (!targetCard) return
    targetCard.scrollIntoView({ block: 'nearest' })
    const focusTargetInput = targetCard.querySelector('input, select, button')
    if (focusTargetInput instanceof HTMLElement) {
      focusTargetInput.focus({ preventScroll: true })
    }
  }, [focusTarget, focusTargetRequest])

  useEffect(() => {
    let cancelled = false
    setPrCreateUrl('')
    setPrCreateUrlError(null)
    setPrBranchPublished(null)
    setPrRemoteBranch('')
    setPrUpstreamBranch('')
    setPrPushCommand('')
    setPrCreateState('idle')
    setPrCreateError(null)
    if (!prCommand) return
    void window.api.git.getPullRequestCreateUrl(workDir, defaultBaseBranch, currentBranch)
      .then((result) => {
        if (cancelled) return
        setPrBranchPublished(typeof result.branchPublished === 'boolean' ? result.branchPublished : null)
        setPrRemoteBranch(result.remoteBranch ?? '')
        setPrUpstreamBranch(result.upstreamBranch ?? '')
        setPrPushCommand(result.pushCommand ?? '')
        if (result.ok && result.url) {
          setPrCreateUrl(result.url)
          setPrCreateUrlError(null)
        } else {
          setPrCreateUrlError(result.error ?? 'Create PR URL unavailable')
        }
      })
      .catch((error) => {
        if (cancelled) return
        setPrCreateUrlError(error instanceof Error ? error.message : 'Create PR URL unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [currentBranch, defaultBaseBranch, prCommand, workDir])

  useEffect(() => {
    if (session.reviewMetadata) {
      setLoadedReviewMetadata(session.reviewMetadata)
      setReviewMetadataState('loaded')
      setReviewMetadataError(null)
    }
  }, [session.reviewMetadata])

  useEffect(() => {
    if (session.reviewMetadata || loadedReviewMetadata || !prCommand || prBranchPublished !== true) return
    let cancelled = false
    setReviewMetadataState('loading')
    setReviewMetadataError(null)
    window.api.sessions.getReviewMetadata(sessionId)
      .then((metadata) => {
        if (cancelled) return
        if (metadata) {
          setLoadedReviewMetadata(metadata)
          setReviewMetadataState('loaded')
        } else {
          setReviewMetadataState('unavailable')
        }
      })
      .catch((error) => {
        if (cancelled) return
        setReviewMetadataState('error')
        setReviewMetadataError(error instanceof Error ? error.message : 'Pull request metadata unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [loadedReviewMetadata, prBranchPublished, prCommand, session.reviewMetadata, sessionId])

  const writeGitClipboardText = async (text: string): Promise<void> => {
    if (typeof window.api.clipboard?.writeText === 'function') {
      const didWrite = await window.api.clipboard.writeText(text)
      if (didWrite) return
    }
    await navigator.clipboard.writeText(text)
  }

  const refreshPullRequestMetadata = async (): Promise<void> => {
    if (busy) return
    setReviewMetadataState('loading')
    setReviewMetadataError(null)
    setActionMessage({ text: 'Refreshing pull request metadata', tone: 'info' })
    try {
      const metadata = await window.api.sessions.getReviewMetadata(sessionId, { force: true })
      if (metadata) {
        setLoadedReviewMetadata(metadata)
        setReviewMetadataState('loaded')
        setActionMessage({ text: 'Pull request metadata refreshed', tone: 'info' })
      } else {
        setReviewMetadataState('unavailable')
        setActionMessage({ text: 'No hosted pull request metadata found', tone: 'info' })
      }
    } catch (error) {
      setReviewMetadataState('error')
      const message = error instanceof Error ? error.message : 'Refresh pull request metadata failed'
      setReviewMetadataError(message)
      setActionMessage({ text: message, tone: 'danger' })
    }
  }

  const runPathAction = async (action: 'stage' | 'unstage', targetPaths?: string[]): Promise<void> => {
    const paths = targetPaths ?? (action === 'stage' ? unstagedPaths : stagedPaths)
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

  const addCommitDraftToChat = (): void => {
    if (busy || stagedPaths.length === 0) return
    const stagedChanges = changes.filter((change) => change.staged)
    const fileLines = stagedChanges.slice(0, 12).map((change) =>
      `- ${change.path} (${fileStatusLabel(change.status)}, +${change.additions}, -${change.deletions})`
    )
    const text = [
      'Draft a concise commit message for these staged changes:',
      `Workspace: ${workDir}`,
      `Branch: ${currentBranch}`,
      `Staged files: ${stagedPaths.length}`,
      ...(fileLines.length > 0 ? ['Files:', ...fileLines] : ['Files: none'])
    ].join('\n')
    const globals = window as typeof window & { __orchestratorLastGitCommitDraftForSmoke?: string }
    globals.__orchestratorLastGitCommitDraftForSmoke = text
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: { text }
    }))
    setActionMessage({ text: 'Commit draft request added to chat', tone: 'info' })
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

  const copyPullRequestPushCommand = async (): Promise<void> => {
    if (!prPushCommand || busy) return
    setActionMessage({ text: 'Copying push command', tone: 'info' })
    try {
      const globals = window as typeof window & { __orchestratorLastGitPrPushCommandForSmoke?: string }
      globals.__orchestratorLastGitPrPushCommandForSmoke = prPushCommand
      await writeGitClipboardText(prPushCommand)
      setActionMessage({ text: 'Push command copied', tone: 'info' })
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : 'Copy push command failed', tone: 'danger' })
    }
  }

  const openPullRequestCreateUrl = (): void => {
    if (!prCreateUrl || prBranchPublished !== true || busy) return
    const globals = window as typeof window & { __orchestratorLastGitPrCreateUrlForSmoke?: string }
    globals.__orchestratorLastGitPrCreateUrlForSmoke = prCreateUrl
    setActionMessage({ text: 'Opening create PR', tone: 'info' })
    void window.api.browser.openExternal(prCreateUrl)
  }

  const runCreatePullRequest = async (): Promise<void> => {
    if (!prCommand || prBranchPublished !== true || pullRequestUrl || busy) return
    setActionState('loading')
    setPrCreateState('creating')
    setPrCreateError(null)
    setActionMessage({ text: 'Creating pull request', tone: 'info' })
    try {
      const result: GitPullRequestCreateResult = await window.api.git.createPullRequest(workDir, defaultBaseBranch, currentBranch)
      const globals = window as typeof window & {
        __orchestratorLastGitPrCreateResultForSmoke?: GitPullRequestCreateResult
      }
      globals.__orchestratorLastGitPrCreateResultForSmoke = result
      if (!result.ok) {
        const message = result.error ?? 'Create pull request failed'
        setPrCreateState('error')
        setPrCreateError(message)
        setActionMessage({ text: message, tone: 'danger' })
        return
      }
      if (result.metadata) {
        setLoadedReviewMetadata(result.metadata)
        setReviewMetadataState('loaded')
      } else {
        await refreshPullRequestMetadata()
      }
      setPrCreateState('created')
      setActionMessage({ text: 'Pull request created', tone: 'info' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create pull request failed'
      setPrCreateState('error')
      setPrCreateError(message)
      setActionMessage({ text: message, tone: 'danger' })
    } finally {
      setActionState('idle')
    }
  }

  const addPullRequestCommandToChat = (): void => {
    if (!prCommand || busy) return
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: {
        text: [
          'Use this pull request command:',
          `Workspace: ${workDir}`,
          `Branch: ${currentBranch}`,
          `Base: ${defaultBaseBranch}`,
          `Command: ${prCommand}`
        ].join('\n')
      }
    }))
    setActionMessage({ text: 'PR command added to chat', tone: 'info' })
  }

  const insertPullRequestCommandInTerminal = async (): Promise<void> => {
    if (!prCommand || busy) return
    setActionState('terminal')
    setActionMessage({ text: 'Opening terminal for PR command', tone: 'info' })
    try {
      const tabId = addTerminalTab(sessionId)
      setShowTerminal(sessionId, true)
      setActiveTerminalTab(sessionId, tabId)
      const terminalId = `${sessionId}-${tabId}`
      const globals = window as typeof window & {
        __orchestratorLastGitPrTerminalCommandForSmoke?: string
        __orchestratorLastGitPrTerminalIdForSmoke?: string
      }
      globals.__orchestratorLastGitPrTerminalCommandForSmoke = prCommand
      globals.__orchestratorLastGitPrTerminalIdForSmoke = terminalId
      await window.api.terminal.spawn(terminalId, workDir)
      await window.api.terminal.write(terminalId, prCommand)
      setActionMessage({ text: 'PR command inserted in terminal', tone: 'info' })
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : 'Insert PR command in terminal failed', tone: 'danger' })
    } finally {
      setActionState('idle')
    }
  }

  const addGitStatusToChat = (): void => {
    if (busy) return
    const fileLines = changes.slice(0, 12).map((change) => {
      const state = change.staged && change.unstaged
        ? 'staged and unstaged'
        : change.staged
          ? 'staged'
          : change.unstaged
            ? 'unstaged'
            : 'changed'
      return `- ${change.path} (${fileStatusLabel(change.status)}, ${state}, +${change.additions}, -${change.deletions})`
    })
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: {
        text: [
          'Use this Git status:',
          `Workspace: ${workDir}`,
          `Branch: ${currentBranch}`,
          `Changes: ${changes.length} ${changes.length === 1 ? 'file' : 'files'}, +${totals.additions}, -${totals.deletions}`,
          `Staged: ${stagedPaths.length}`,
          `Unstaged: ${unstagedPaths.length}`,
          ...(pullRequestUrl ? [`Pull request: ${pullRequestUrl}`] : []),
          ...(fileLines.length > 0 ? ['Files:', ...fileLines] : ['Files: none'])
        ].join('\n')
      }
    }))
    setActionMessage({ text: 'Git status added to chat', tone: 'info' })
  }

  const copyChangedFilePath = async (path: string): Promise<void> => {
    if (!path || busy) return
    setActionMessage({ text: 'Copying file path', tone: 'info' })
    try {
      await writeGitClipboardText(path)
      setActionMessage({ text: 'File path copied', tone: 'info' })
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : 'Copy file path failed', tone: 'danger' })
    }
  }

  const addChangedFileToChat = (path: string): void => {
    if (!path || busy) return
    const name = fileNameFromPath(path)
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-attachment', {
      detail: {
        path: joinPath(workDir, path),
        name
      }
    }))
    setActionMessage({ text: `Added ${name} to chat`, tone: 'info' })
  }

  const insertChangedFilePathInTerminal = async (path: string): Promise<void> => {
    if (!path || busy) return
    setActionState('terminal')
    setActionMessage({ text: 'Opening terminal for file path', tone: 'info' })
    try {
      const state = useSessionStore.getState()
      const currentPanel = state.uiState[sessionId]?.terminalPanel
      const existingTab = typeof currentPanel?.activeTabId === 'number'
        ? currentPanel.activeTabId
        : currentPanel?.tabs.find((tab): tab is number => typeof tab === 'number')
      const tabId = existingTab ?? addTerminalTab(sessionId)
      setShowTerminal(sessionId, true)
      setActiveTerminalTab(sessionId, tabId)
      const terminalId = `${sessionId}-${tabId}`
      const globals = window as typeof window & {
        __orchestratorLastGitFileTerminalPathForSmoke?: string
        __orchestratorLastGitFileTerminalIdForSmoke?: string
      }
      globals.__orchestratorLastGitFileTerminalPathForSmoke = path
      globals.__orchestratorLastGitFileTerminalIdForSmoke = terminalId
      await window.api.terminal.spawn(terminalId, workDir)
      await window.api.terminal.write(terminalId, shellQuote(path))
      setActionMessage({ text: 'File path inserted in terminal', tone: 'info' })
    } catch (error) {
      setActionMessage({ text: error instanceof Error ? error.message : 'Insert file path in terminal failed', tone: 'danger' })
    } finally {
      setActionState('idle')
    }
  }

  const openChangedFileInWorkbench = (path: string): void => {
    if (!path || busy) return
    openRightPanelFileTab(sessionId, path, { preview: true })
  }

  const closeDiscardConfirm = (): void => {
    setDiscardConfirmOpen(false)
    setDiscardTargetPaths(null)
  }

  const requestDiscard = (paths = discardablePaths): void => {
    if (paths.length === 0 || busy) return
    setDiscardTargetPaths(paths)
    setDiscardConfirmOpen(true)
  }

  const runDiscard = async (): Promise<void> => {
    const paths = pendingDiscardPaths
    if (paths.length === 0 || busy) return
    const countLabel = `${paths.length} ${paths.length === 1 ? 'file' : 'files'}`
    setDiscardConfirmOpen(false)
    setDiscardTargetPaths(null)
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
      ref={rootRef}
      className="git-panel environment-panel"
      data-testid="git-panel"
      data-git-change-count={changes.length}
      data-git-staged-count={stagedPaths.length}
      data-git-unstaged-count={unstagedPaths.length}
      data-git-action-state={actionState}
      data-git-last-commit={lastCommit ?? ''}
      data-git-last-created-branch={lastCreatedBranch ?? ''}
      data-git-last-checked-out-branch={lastCheckedOutBranch ?? ''}
      data-git-focus-path={focusPath ?? ''}
      data-git-focus-request={focusRequest ?? ''}
      data-git-focus-path-found={focusedReviewPath ? 'true' : 'false'}
      data-git-focus-target={focusTarget ?? ''}
      data-git-focus-target-request={focusTargetRequest ?? ''}
      style={{ height: embedded ? '100%' : undefined }}
    >
      <div className="environment-panel-scroll">
        <div className="environment-card" data-testid="git-summary-card">
          <div className="environment-card-header">
            <span>Git</span>
            <div className="flex items-center gap-1">
              <IconButton
                icon="chat"
                label="Add Git status to chat"
                size="xs"
                dataTestId="git-add-status-to-chat"
                disabled={busy}
                onClick={addGitStatusToChat}
              />
              <IconButton
                icon="refresh"
                label="Refresh Git status"
                size="xs"
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
            onClick={() => onOpenReview()}
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
            <Button variant="ghost" dataTestId="git-open-review" onClick={() => onOpenReview(focusedReviewPath ?? undefined)}>
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

        <form
          ref={branchCardRef}
          className="environment-card git-branch-card"
          data-testid="git-branch-card"
          data-git-focused-target={focusTarget === 'branch' ? 'true' : 'false'}
          onSubmit={(event) => { void runCreateBranch(event) }}
        >
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

        <div
          ref={prCardRef}
          className="environment-card git-pr-card"
          data-testid="git-pr-card"
          data-git-pr-command={prCommand}
          data-git-pr-create-url={prCreateUrl}
          data-git-pr-create-error={prCreateUrlError ?? ''}
          data-git-pr-branch-published={prBranchPublished === null ? 'unknown' : prBranchPublished ? 'true' : 'false'}
          data-git-pr-remote-branch={prRemoteBranch}
          data-git-pr-upstream-branch={prUpstreamBranch}
          data-git-pr-push-command={prPushCommand}
          data-git-pr-create-state={prCreateState}
          data-git-pr-create-result-error={prCreateError ?? ''}
          data-git-pr-metadata-state={reviewMetadataState}
          data-git-pr-metadata-error={reviewMetadataError ?? ''}
          data-git-pr-metadata-warnings={providerWarnings.length}
          data-git-pr-number={pullRequest?.number ?? ''}
          data-git-focused-target={focusTarget === 'pull-request' ? 'true' : 'false'}
        >
          <div className="environment-card-header">
            <span>Pull Request</span>
            <div className="flex items-center gap-1">
              <span className="environment-row-muted">{pullRequest?.number ? `PR ${pullRequest.number}` : defaultBaseBranch}</span>
              <IconButton
                icon="refresh"
                label="Refresh pull request metadata"
                size="xs"
                dataTestId="git-refresh-pr-metadata"
                disabled={busy || reviewMetadataState === 'loading'}
                onClick={() => { void refreshPullRequestMetadata() }}
              />
            </div>
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
                dataTestId="git-open-create-pr"
                disabled={busy || !prCreateUrl || prBranchPublished !== true}
                title={prBranchPublished === false ? 'Push branch before opening create PR' : prBranchPublished === null ? 'Checking branch publish state' : prCreateUrl || prCreateUrlError || 'Create or switch to a topic branch first'}
                onClick={openPullRequestCreateUrl}
              >
                Open create PR
              </Button>
              <Button
                variant="primary"
                dataTestId="git-create-pr"
                disabled={busy || !prCommand || prBranchPublished !== true || Boolean(pullRequestUrl)}
                title={pullRequestUrl ? 'Pull request already exists' : prBranchPublished === false ? 'Push branch before creating PR' : prBranchPublished === null ? 'Checking branch publish state' : 'Create pull request with GitHub CLI'}
                onClick={() => { void runCreatePullRequest() }}
              >
                Create PR
              </Button>
              {prCommand && (
                <div className="git-commit-meta" data-testid="git-pr-publish-status">
                  {prBranchPublished === false
                    ? `Branch not pushed. Push ${prRemoteBranch || currentBranch} before opening hosted PR.`
                    : prBranchPublished === true
                      ? `Branch published${prUpstreamBranch ? ` at ${prUpstreamBranch}` : prRemoteBranch ? ` at ${prRemoteBranch}` : ''}.`
                      : 'Checking branch publish state.'}
                  {prCreateState === 'created' && ' Pull request created.'}
                  {prCreateState === 'error' && prCreateError ? ` ${prCreateError}` : ''}
                </div>
              )}
              {prPushCommand && (
                <>
                  <input
                    className="git-commit-input"
                    data-testid="git-pr-push-command"
                    value={prPushCommand}
                    readOnly
                    aria-label="Push branch command"
                  />
                  <Button
                    variant="ghost"
                    dataTestId="git-copy-pr-push-command"
                    disabled={busy || !prPushCommand}
                    onClick={() => { void copyPullRequestPushCommand() }}
                  >
                    Copy push command
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                dataTestId="git-copy-pr-command"
                disabled={busy || !prCommand}
                onClick={() => { void copyPullRequestCommand() }}
              >
                Copy PR command
              </Button>
              <Button
                variant="ghost"
                dataTestId="git-add-pr-command-to-chat"
                disabled={busy || !prCommand}
                onClick={addPullRequestCommandToChat}
              >
                Add to chat
              </Button>
              <Button
                variant="ghost"
                dataTestId="git-insert-pr-command-terminal"
                disabled={busy || !prCommand}
                onClick={() => { void insertPullRequestCommandInTerminal() }}
              >
                Insert in terminal
              </Button>
            </div>
          )}
          {providerWarnings.length > 0 && (
            <div
              className="git-commit-meta"
              data-testid="git-pr-metadata-warning"
              role="status"
              aria-live="polite"
              title={providerWarnings.join('\n')}
            >
              {providerWarnings[0]}
            </div>
          )}
        </div>

        <form
          ref={commitCardRef}
          className="environment-card git-commit-card"
          data-testid="git-commit-card"
          data-git-focused-target={focusTarget === 'commit' ? 'true' : 'false'}
          onSubmit={(event) => { void runCommit(event) }}
        >
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
              type="button"
              variant="ghost"
              dataTestId="git-add-commit-draft-to-chat"
              disabled={busy || stagedPaths.length === 0}
              onClick={addCommitDraftToChat}
            >
              Draft message
            </Button>
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
            <span className="git-file-list-header-meta">
              {focusPath && (
                <span
                  className="git-focused-review-path"
                  data-testid="git-focused-review-path"
                  title={focusPath}
                >
                  Focused from Review: {focusPath}
                </span>
              )}
              <span className="environment-row-muted">{changes.length}</span>
            </span>
          </div>
          {changes.length === 0 ? (
            <div className="git-empty-state" data-testid="git-empty-state">No local changes</div>
          ) : changes.slice(0, 24).map((change) => (
            <div
              key={change.path}
              className={`git-file-row${change.path === focusedReviewPath ? ' git-file-row-focused' : ''}`}
              data-testid="git-file-row"
              data-git-file-path={change.path}
              data-git-file-staged={change.staged ? 'true' : 'false'}
              data-git-file-unstaged={change.unstaged ? 'true' : 'false'}
              data-git-file-focused={change.path === focusedReviewPath ? 'true' : 'false'}
              title={change.path}
            >
              <span className="git-file-status">{fileStatusLabel(change.status)}</span>
              <span className="git-file-path">{change.path}</span>
              <span className="git-file-delta">
                +{change.additions.toLocaleString()} -{change.deletions.toLocaleString()}
              </span>
              <span className="git-file-actions">
                <IconButton
                  icon="plus"
                  label={`Stage ${change.path}`}
                  size="xs"
                  dataTestId="git-file-stage"
                  disabled={busy || !change.unstaged}
                  onClick={() => { void runPathAction('stage', [change.path]) }}
                />
                <IconButton
                  icon="eraser"
                  label={`Unstage ${change.path}`}
                  size="xs"
                  dataTestId="git-file-unstage"
                  disabled={busy || !change.staged}
                  onClick={() => { void runPathAction('unstage', [change.path]) }}
                />
                <IconButton
                  icon="copy"
                  label={`Copy path for ${change.path}`}
                  size="xs"
                  dataTestId="git-file-copy-path"
                  disabled={busy}
                  onClick={() => { void copyChangedFilePath(change.path) }}
                />
                <IconButton
                  icon="paperclip"
                  label={`Add ${change.path} to chat`}
                  size="xs"
                  dataTestId="git-file-add-chat"
                  disabled={busy}
                  onClick={() => addChangedFileToChat(change.path)}
                />
                <IconButton
                  icon="terminal"
                  label={`Insert ${change.path} in terminal`}
                  size="xs"
                  dataTestId="git-file-insert-terminal"
                  disabled={busy}
                  onClick={() => { void insertChangedFilePathInTerminal(change.path) }}
                />
                <IconButton
                  icon="trash"
                  label={`Discard ${change.path}`}
                  size="xs"
                  tone="danger"
                  dataTestId="git-file-discard"
                  disabled={busy}
                  onClick={() => requestDiscard([change.path])}
                />
                <IconButton
                  icon="file"
                  label={`Open ${change.path} in Workbench`}
                  size="xs"
                  dataTestId="git-file-open-workbench"
                  disabled={busy || change.status === 'D'}
                  onClick={() => openChangedFileInWorkbench(change.path)}
                />
                <IconButton
                  icon="diff"
                  label={`Open ${change.path} in Review`}
                  size="xs"
                  dataTestId="git-file-open-review"
                  disabled={busy}
                  onClick={() => onOpenReview(change.path)}
                />
              </span>
            </div>
          ))}
        </div>
      </div>
      {discardConfirmOpen && (
        <MotionOverlay
          onClose={closeDiscardConfirm}
          surfaceClassName="orchestrator-dialog-surface"
        >
          <DialogContent dataTestId="git-discard-confirm-dialog">
            <DialogHeader
              title="Discard changes?"
              description={pendingDiscardDescription}
            />
            <DialogFooter>
              <Button
                variant="ghost"
                dataTestId="git-discard-confirm-cancel"
                onClick={closeDiscardConfirm}
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

function joinPath(root: string, filePath: string): string {
  return `${root.replace(/\/+$/, '')}/${filePath.replace(/^\/+/, '')}`
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath
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
