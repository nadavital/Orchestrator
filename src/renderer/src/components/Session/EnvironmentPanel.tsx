import { useEffect, useMemo, useState } from 'react'
import type { FileChange, GitRefOption, Session } from '../../types'
import Icon from '../shared/Icon'
import type { IconName } from '../shared/Icon'
import { IconButton } from '../shared/designSystem'
import { useSessionStore } from '../../store/sessions'

interface Props {
  session: Session
  embedded?: boolean
  onOpenReview: () => void
  onOpenGit: () => void
}

export default function EnvironmentPanel({ session, embedded = false, onOpenReview, onOpenGit }: Props): JSX.Element {
  const [changes, setChanges] = useState<FileChange[]>([])
  const [branches, setBranches] = useState<GitRefOption[]>([])
  const [actionStatus, setActionStatus] = useState('')
  const setShowSettings = useSessionStore((state) => state.setShowSettings)
  const setShowCapabilities = useSessionStore((state) => state.setShowCapabilities)
  const setSettingsSection = useSessionStore((state) => state.setSettingsSection)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      window.api.sessions.getChangedFiles(session.id, 'all').catch(() => []),
      window.api.git.listBranches(session.workDir).catch(() => [])
    ]).then(([nextChanges, nextBranches]) => {
      if (cancelled) return
      setChanges(nextChanges)
      setBranches(nextBranches)
    })
    return () => {
      cancelled = true
    }
  }, [session.id, session.workDir])

  const totals = useMemo(() => changes.reduce((acc, change) => ({
    additions: acc.additions + change.additions,
    deletions: acc.deletions + change.deletions
  }), { additions: 0, deletions: 0 }), [changes])
  const stagedCount = useMemo(() => changes.filter((change) => change.staged).length, [changes])
  const unstagedCount = useMemo(() => changes.filter((change) => change.unstaged).length, [changes])
  const currentBranch = branches.find((branch) => branch.current)?.label ?? 'main'
  const pullRequest = session.reviewMetadata?.pullRequest
  const pullRequestUrl = pullRequest?.url?.trim() ?? ''
  const pullRequestLabel = pullRequestUrl
    ? `View pull request`
    : 'Create pull request'
  const pullRequestTrailing = pullRequest?.number
    ? `PR ${pullRequest.number}`
    : pullRequestUrl
      ? 'Open'
      : 'Git'
  const commitTrailing = changes.length > 0
    ? stagedCount > 0
      ? `${stagedCount} staged`
      : `${changes.length} ${changes.length === 1 ? 'file' : 'files'}`
    : 'No changes'
  const changesTrailingLabel = [
    changes.length === 1 ? '1 file' : `${changes.length} files`,
    stagedCount > 0 ? `${stagedCount} staged` : null,
    unstagedCount > 0 ? `${unstagedCount} unstaged` : null
  ].filter(Boolean).join(' · ')

  const openPullRequest = (): void => {
    if (!pullRequestUrl) {
      onOpenGit()
      setActionStatus('Opening Git to create pull request')
      return
    }
    void window.api.browser.openExternal(pullRequestUrl)
  }

  const openProviderSettings = (): void => {
    setSettingsSection('providers')
    setShowCapabilities(false)
    setShowSettings(true)
  }

  const addEnvironmentToChat = (): void => {
    const sourceSummary = 'Web search: unavailable (provider web-search source is not connected for this session)'
    const summary = [
      'Use this environment context:',
      `Workspace: ${session.workDir}`,
      `Provider: ${session.provider ?? 'unknown'}`,
      `Status: ${session.status}`,
      `Branch: ${currentBranch}`,
      `Changes: ${changes.length} ${changes.length === 1 ? 'file' : 'files'}, +${totals.additions}, -${totals.deletions} (${stagedCount} staged, ${unstagedCount} unstaged)`,
      pullRequestUrl
        ? `Pull request: ${pullRequest?.number ? `#${pullRequest.number} ` : ''}${pullRequestUrl}`
        : 'Pull request: none',
      `Sources: ${sourceSummary}`
    ].join('\n')
    window.dispatchEvent(new CustomEvent('orchestrator:add-composer-text', {
      detail: { text: summary }
    }))
    setActionStatus('Environment context added to chat')
  }

  return (
    <section
      className="environment-panel"
      data-testid="codex-environment-panel"
      data-environment-change-count={changes.length}
      data-environment-additions={totals.additions}
      data-environment-deletions={totals.deletions}
      data-environment-staged-count={stagedCount}
      data-environment-unstaged-count={unstagedCount}
      data-environment-pull-request={pullRequestUrl ? 'true' : 'false'}
      style={{ height: embedded ? '100%' : undefined }}
    >
      <div className="environment-panel-scroll">
        <div className="environment-card" data-testid="codex-environment-card">
          <div className="environment-card-header">
            <span>Environment</span>
            <div className="flex items-center gap-1">
              <IconButton
                icon="chat"
                label="Add environment to chat"
                size="xs"
                variant="ghost"
                dataTestId="codex-environment-add-to-chat"
                onClick={addEnvironmentToChat}
              />
              <IconButton
                icon="settings"
                label="Open provider settings"
                size="xs"
                variant="ghost"
                dataTestId="codex-environment-settings"
                onClick={openProviderSettings}
              />
            </div>
          </div>
          {actionStatus && (
            <div
              className="mx-2 mb-2 rounded-md border px-2 py-1 text-[11px]"
              data-testid="codex-environment-action-status"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              style={{
                color: 'var(--accent)',
                background: 'color-mix(in srgb, var(--accent) 8%, var(--surface-bg))',
                borderColor: 'color-mix(in srgb, var(--accent) 20%, var(--border-subtle))'
              }}
            >
              {actionStatus}
            </div>
          )}
          <EnvironmentRow
            icon="diff"
            label="Changes"
            dataTestId="codex-environment-changes"
            onClick={onOpenReview}
            trailing={(
              <span className="environment-change-totals" data-testid="codex-environment-change-totals">
                <span className="environment-additions">+{totals.additions.toLocaleString()}</span>
                <span className="environment-deletions">-{totals.deletions.toLocaleString()}</span>
              </span>
            )}
            title={changesTrailingLabel}
          />
          <EnvironmentRow
            icon="monitor"
            label="Local"
            dataTestId="codex-environment-local"
            trailing={session.provider ? <span className="environment-row-muted">{session.provider}</span> : undefined}
          />
          <EnvironmentRow icon="branch" label={currentBranch} dataTestId="codex-environment-branch" />
          <EnvironmentRow
            icon="dot"
            label="Commit"
            dataTestId="codex-environment-commit"
            disabled={changes.length === 0}
            disabledReason="No changes to commit"
            action="open-review"
            title={changes.length > 0 ? 'Review changes before committing' : 'No changes to commit'}
            trailing={<span className="environment-row-muted">{commitTrailing}</span>}
            onClick={changes.length > 0 ? onOpenReview : undefined}
          />
          <EnvironmentRow
            icon={pullRequestUrl ? 'external' : 'browser'}
            label={pullRequestLabel}
            dataTestId="codex-environment-create-pr"
            action={pullRequestUrl ? 'open-pull-request' : 'open-git-pr'}
            title={pullRequestUrl ? pullRequestUrl : 'Open Git to create a pull request'}
            trailing={<span className="environment-row-muted">{pullRequestTrailing}</span>}
            onClick={openPullRequest}
          />
        </div>

        <div className="environment-card environment-sources-card" data-testid="codex-environment-sources-card">
          <div className="environment-card-header">
            <span>Sources</span>
          </div>
          <EnvironmentRow
            icon="browser"
            label="Web search"
            dataTestId="codex-environment-web-search"
            disabled
            disabledReason="Provider web-search source is not connected for this session"
            trailing={<span className="environment-row-muted">Unavailable</span>}
          />
        </div>
      </div>
    </section>
  )
}

function EnvironmentRow({
  icon,
  label,
  trailing,
  dataTestId,
  disabled = false,
  disabledReason,
  action,
  title,
  onClick
}: {
  icon: IconName
  label: string
  trailing?: JSX.Element
  dataTestId: string
  disabled?: boolean
  disabledReason?: string
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

  if (onClick && !disabled) {
    return (
      <button
        type="button"
        className="environment-row"
        data-testid={dataTestId}
        data-environment-row-action={action}
        aria-label={title ? `${label}. ${title}` : label}
        title={title}
        onClick={onClick}
      >
        {content}
      </button>
    )
  }

  return (
    <div
      className="environment-row"
      data-testid={dataTestId}
      data-environment-row-disabled={disabled ? 'true' : 'false'}
      data-environment-row-disabled-reason={disabledReason}
      data-environment-row-action={action}
      aria-disabled={disabled ? true : undefined}
      aria-label={disabledReason ? `${label}. ${disabledReason}` : label}
      title={title ?? disabledReason}
    >
      {content}
    </div>
  )
}
