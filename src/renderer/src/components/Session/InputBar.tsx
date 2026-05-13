import { useState, useRef, useEffect } from 'react'
import type { Attachment, ProviderAgentDef, ProviderRuntimeInfo, ProviderSlashCommand, ResolvedExecutionPolicy, Session } from '../../types'
import type { SlashPaletteCommand } from '../../types'
import { PROVIDER_DEFS, canStopSession, expandSlashCommandPrompt, getAdvancedPermissionModes, getComposerSendState, getDangerPermissionModes, getDefaultPermissionMode, getPrimaryPermissionModes, getVisibleModels, parseClaudeAgentsOutput } from '../../types'
import { useSessionStore } from '../../store/sessions'
import SlashCommandPalette, { getSlashQuery } from './SlashCommandPalette'
import ProviderIcon from '../shared/ProviderIcon'

interface Props {
  session: Session
  isNew: boolean
  injectedText?: string
  onInjectedConsumed?: () => void
}

export default function InputBar({ session, isNew, injectedText, onInjectedConsumed }: Props): JSX.Element {
  const {
    providerAvailability,
    providerModels,
    uiState,
    setShowDiff,
    setShowEvents,
    setShowPlan,
    setShowSettings,
    setShowSideQuestions,
    setShowSkills,
    setShowTerminal,
    appendSideQuestion,
    updateSideQuestion
  } = useSessionStore()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [useWorktree, setUseWorktree] = useState(false)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [showAgentMenu, setShowAgentMenu] = useState(false)
  const [showPermMenu, setShowPermMenu] = useState(false)
  const [showAdvancedPerms, setShowAdvancedPerms] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [runtimeInfo, setRuntimeInfo] = useState<Record<string, ProviderRuntimeInfo>>({})
  const [extensionCommands, setExtensionCommands] = useState<ProviderSlashCommand[]>([])
  const [claudeAgents, setClaudeAgents] = useState<ProviderAgentDef[]>([])
  const [claudeAgentsStatus, setClaudeAgentsStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const agentMenuRef = useRef<HTMLDivElement>(null)
  const permMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.git.isGitRepo(session.workDir).then(setIsGitRepo)
  }, [session.workDir])

  useEffect(() => {
    window.api.providers.getRuntimeInfo().then(setRuntimeInfo)
  }, [])

  useEffect(() => {
    if ((session.provider ?? 'claude') !== 'claude') {
      setExtensionCommands([])
      return
    }
    window.api.providers.discoverClaudeExtensions(session.workDir)
      .then((extensions) => setExtensionCommands([...extensions.commands, ...extensions.skills]))
      .catch(() => setExtensionCommands([]))
  }, [session.provider, session.workDir])

  useEffect(() => {
    if ((session.provider ?? 'claude') !== 'claude') {
      setClaudeAgents([])
      setClaudeAgentsStatus('idle')
      return
    }
    if (!showAgentMenu || claudeAgentsStatus !== 'idle') return
    setClaudeAgentsStatus('loading')
    window.api.providers.runCommandSurface('claude', 'agents-list')
      .then((result) => {
        setClaudeAgents(result.status === 'ok' ? parseClaudeAgentsOutput(result.output) : [])
        setClaudeAgentsStatus(result.status === 'ok' ? 'loaded' : 'error')
      })
      .catch(() => {
        setClaudeAgents([])
        setClaudeAgentsStatus('error')
      })
  }, [session.provider, showAgentMenu, claudeAgentsStatus])

  useEffect(() => {
    if (injectedText) {
      setText(injectedText)
      onInjectedConsumed?.()
      textareaRef.current?.focus()
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
        }
      }, 0)
    }
  }, [injectedText])

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (showModeMenu && modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) setShowModeMenu(false)
      if (showAgentMenu && agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) setShowAgentMenu(false)
      if (showPermMenu && permMenuRef.current && !permMenuRef.current.contains(e.target as Node)) setShowPermMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModeMenu, showAgentMenu, showPermMenu])

  useEffect(() => {
    if (!showPermMenu) setShowAdvancedPerms(false)
  }, [showPermMenu])

  const provider = PROVIDER_DEFS[session.provider ?? 'claude'] ?? PROVIDER_DEFS.claude
  const model = session.model || provider.models[0]?.id || ''
  const effort = session.effort ?? provider.effortLevels[0]?.id ?? ''
  const defaultPermissionMode = getDefaultPermissionMode(provider)
  const permissionMode = session.permissionMode ?? defaultPermissionMode
  const effectiveMode = isNew ? useWorktree : session.useWorktree
  const providerRuntime = runtimeInfo[provider.id]
  const currentUi = uiState[session.id] ?? { showPlan: false, showDiff: false, showEvents: false, showTerminal: false, showSkills: false, showSideQuestions: false, showUsage: false, hasUnread: false }
  const resolvedPermission = providerRuntime?.policies[permissionMode] ?? (providerRuntime
    ? {
        policy: permissionMode,
        support: 'unsupported' as const,
        args: [],
        label: permissionMode,
        description: `${provider.name} does not support this permission mode.`
      }
    : undefined)

  const modelLabel = provider.models.find((m) => m.id === model)?.label ?? model
  const effortLabel = provider.effortLevels.find((e) => e.id === effort)?.label ?? ''
  const selectedAgentName = provider.id === 'claude' ? session.agentName ?? null : null
  const selectedPermissionMode = provider.permissionModes.find((p) => p.id === permissionMode)
  const permLabel = selectedPermissionMode?.label ?? 'Mode'
  const primaryPermissionModes = getPrimaryPermissionModes(provider)
  const advancedPermissionModes = getAdvancedPermissionModes(provider)
  const dangerPermissionModes = getDangerPermissionModes(provider)
  const canUsePermission = resolvedPermission?.support !== 'unsupported'

  // Cursor per-model effort/thinking/fast config
  const cursorCfg = provider.id === 'cursor'
    ? PROVIDER_DEFS.cursor.models.find((m) => m.id === model)?.cursorConfig
    : undefined
  const cursorEffortLevels = cursorCfg?.effortLevels ?? []
  const cursorEffort = session.effort || cursorCfg?.defaultEffort || cursorEffortLevels[0]?.id || ''
  const cursorEfLevel = cursorEffortLevels.find((l) => l.id === cursorEffort)
  const hasFast = !!(cursorEfLevel?.fastModelId || (cursorCfg && cursorEffortLevels.length === 0 && cursorCfg.fastModelId))
  const hasThinking = !!cursorCfg?.supportsThinking
  const useThinking = session.useThinking ?? false
  const useFast = session.useFast ?? false

  const update = (patch: {
    provider?: string
    model?: string
    effort?: string
    agentName?: string | null
    permissionMode?: string
    runtime?: Session['runtime']
    useThinking?: boolean
    useFast?: boolean
    allowedTools?: string[]
    disallowedTools?: string[]
    availableTools?: string[]
    additionalDirs?: string[]
  }): void => {
    window.api.sessions.updateSettings(session.id, patch)
  }

  const switchProvider = (providerId: string): void => {
    const newDef = PROVIDER_DEFS[providerId]
    if (!newDef) return
    update({
      provider: providerId,
      model: newDef.models[0]?.id ?? '',
      effort: newDef.effortLevels[0]?.id ?? '',
      agentName: null,
      permissionMode: getDefaultPermissionMode(newDef),
      useThinking: false,
      useFast: false
    })
  }

  const switchCursorModel = (modelId: string): void => {
    const def = PROVIDER_DEFS.cursor.models.find((m) => m.id === modelId)
    const cfg = def?.cursorConfig
    update({
      model: modelId,
      effort: cfg?.defaultEffort ?? cfg?.effortLevels?.[0]?.id ?? '',
      useThinking: false,
      useFast: false
    })
  }

  const sendState = getComposerSendState({
    text,
    status: session.status,
    canUsePermission
  })
  const canSend = sendState.canSend
  const canStop = canStopSession(session.status)

  const send = async (): Promise<void> => {
    if (!canSend) return
    const rawPrompt = text.trim()
    const sideQuestion = rawPrompt.match(/^\/btw(?:\s+([\s\S]+))?$/)
    if (sideQuestion) {
      const question = (sideQuestion[1] ?? '').trim()
      setText('')
      setAttachments([])
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      setShowSideQuestions(session.id, true)
      if (!question) return
      const userMessageId = crypto.randomUUID()
      const answerMessageId = crypto.randomUUID()
      appendSideQuestion(session.id, {
        id: userMessageId,
        role: 'user',
        content: question,
        status: 'complete'
      })
      appendSideQuestion(session.id, {
        id: answerMessageId,
        role: 'assistant',
        content: 'Thinking...',
        status: 'pending'
      })
      try {
        const result = await window.api.sessions.answerSideQuestion(session.id, question)
        updateSideQuestion(session.id, answerMessageId, {
          content: result.ok ? result.answer : (result.error ?? 'Side question failed.'),
          status: result.ok ? 'complete' : 'error',
          usage: result.usage
        })
      } catch (error) {
        updateSideQuestion(session.id, answerMessageId, {
          content: error instanceof Error ? error.message : 'Side question failed.',
          status: 'error'
        })
      }
      return
    }
    const prompt = expandedCommandPrompt(rawPrompt) ?? rawPrompt
    setText('')
    setAttachments([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await window.api.sessions.sendMessage(session.id, prompt, isNew ? useWorktree : undefined, attachments)
  }

  const attachFiles = async (): Promise<void> => {
    const files = await window.api.dialog.openFiles()
    if (!files?.length) return
    const next = files.map((file): Attachment => ({
      id: crypto.randomUUID(),
      kind: 'local_file',
      path: file.path,
      name: file.name,
      size: file.size
    }))
    setAttachments((current) => dedupeAttachments([...current, ...next]))
    textareaRef.current?.focus()
  }

  const slashQuery = getSlashQuery(text)
  const showSlash = slashQuery !== null

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (showSlash && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab')) return
    if (showSlash && e.key === 'Enter') return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setText(e.target.value)
    setSlashIndex(0)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
  }

  const setTextareaText = (next: string): void => {
    setText(next)
    setSlashIndex(0)
    textareaRef.current?.focus()
    window.setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
        textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
      }
    }, 0)
  }

  const expandedCommandPrompt = (value: string): string | null => {
    const match = value.match(/^(\/\S+)(?:\s+([\s\S]*))?$/)
    if (!match) return null
    const commandName = match[1]
    const args = match[2] ?? ''
    const command = extensionCommands.find((candidate) => candidate.name === commandName)
    return command ? expandSlashCommandPrompt(command, args) : null
  }

  const applySlashCommand = (command: SlashPaletteCommand): void => {
    if (command.handler === 'app-action') {
      setText('')
      setSlashIndex(0)
      if (command.id === 'settings') setShowSettings(true)
      if (command.id === 'diff') setShowDiff(session.id, !currentUi.showDiff)
      if (command.id === 'plan-sidebar') setShowPlan(session.id, !currentUi.showPlan)
      if (command.id === 'agents') setShowEvents(session.id, !currentUi.showEvents)
      if (command.id === 'skills') setShowSkills(session.id, !currentUi.showSkills)
      if (command.id === 'terminal') setShowTerminal(session.id, !currentUi.showTerminal)
      if (command.id === 'btw') setShowSideQuestions(session.id, true)
      if (command.id === 'pet') {
        window.api.pet.getConfig()
          .then((config) => {
            const current = typeof config === 'object' && config !== null && 'isOpen' in config
              ? Boolean((config as { isOpen?: boolean }).isOpen)
              : true
            return window.api.pet.setOpen(!current)
          })
          .catch(() => window.api.pet.setOpen(true))
      }
      if (command.id === 'model') {
        if (isNew) setShowAgentMenu(true)
        else setTextareaText('/model ')
      }
      if (command.id === 'permissions') setShowPermMenu(true)
      return
    }

    if (command.handler === 'insert-prompt' && command.prompt) {
      setTextareaText(command.prompt)
      return
    }

    setTextareaText(`${command.name} `)
  }

  const sendTitle = sendState.willQueue ? 'Queue message (↵)' : 'Send (↵)'

  // Compact agent pill label: "Provider · Model [· Effort]"
  const agentLabel = [
    providerShortName(provider.id),
    selectedAgentName,
    modelLabel,
    provider.supportsEffort && effortLabel ? effortLabel : null,
    provider.id === 'cursor' && cursorEffortLevels.length > 0 && cursorEfLevel ? cursorEfLevel.label : null,
    provider.id === 'cursor' && useThinking ? 'Think' : null,
    provider.id === 'cursor' && useFast ? 'Fast' : null,
  ].filter(Boolean).join(' · ')

  return (
    <div
      className="shrink-0 px-4 py-3"
      style={{
        borderTop: isNew ? 'none' : '1px solid var(--color-border)',
        background: 'var(--color-surface)'
      }}
    >
      <div
        className="rounded-2xl overflow-visible"
        style={{
          background: 'var(--color-surface2)',
          border: '1px solid var(--color-border)',
          boxShadow: isNew ? '0 4px 24px rgba(0,0,0,0.3)' : 'none',
          position: 'relative'
        }}
      >
        {showSlash && (
          <SlashCommandPalette
            query={slashQuery!}
            providerRuntime={providerRuntime}
            discoveredCommands={extensionCommands}
            onSelect={applySlashCommand}
            onDismiss={() => setText('')}
            selectedIndex={slashIndex}
            onSelectedIndexChange={setSlashIndex}
          />
        )}

        {/* Text input */}
        <div className="flex items-end px-4 pt-3 pb-2 gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={isNew ? 'What do you want to build?' : 'Message…'}
            rows={1}
            autoFocus={isNew}
            className="flex-1 resize-none bg-transparent outline-none text-sm"
            style={{ color: 'var(--color-text)', lineHeight: 1.6, maxHeight: 200, userSelect: 'text' }}
          />
        </div>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2" aria-label="Attachments">
            {attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                onRemove={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
              />
            ))}
          </div>
        )}

        {/* Bottom toolbar */}
        <div className="flex items-center px-3 pb-2 gap-1.5">

          {/* Left side */}
          {isNew ? (
            /* New session: worktree mode toggle */
            <div className="relative" ref={modeMenuRef}>
              <ToolbarBtn
                active={effectiveMode}
                onClick={isGitRepo ? () => setShowModeMenu((v) => !v) : undefined}
                muted={!isGitRepo}
                title={!isGitRepo ? 'Not a git repository' : undefined}
              >
                {effectiveMode ? (
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm3-8.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                  </svg>
                ) : (
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z" />
                  </svg>
                )}
                {effectiveMode ? 'Branch' : 'Local'}
                {isGitRepo && <Chevron />}
              </ToolbarBtn>

              {showModeMenu && (
                <DropdownPanel style={{ bottom: '100%', marginBottom: 8, left: 0, minWidth: 160 }}>
                  {(['local', 'worktree'] as const).map((mode) => {
                    const active = mode === 'worktree' ? useWorktree : !useWorktree
                    return (
                      <DropdownRow
                        key={mode}
                        active={active}
                        onClick={() => { setUseWorktree(mode === 'worktree'); setShowModeMenu(false) }}
                      >
                        <div className="text-xs font-medium" style={{ color: active ? 'var(--color-accent)' : 'var(--color-text)' }}>
                          {mode === 'local' ? 'Local' : 'New branch'}
                        </div>
                      </DropdownRow>
                    )
                  })}
                </DropdownPanel>
              )}
            </div>
          ) : (
            /* Active session: read-only agent label */
            <div className="flex items-center gap-1.5 px-1" style={{ color: 'var(--color-text-muted)' }}>
              <ProviderIcon providerId={provider.id} size={11} color="var(--color-text-muted)" />
              <span className="text-xs">{agentLabel}</span>
            </div>
          )}

          <div className="flex-1" />

          <ToolbarBtn active={attachments.length > 0} onClick={attachFiles} title="Attach files">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.775 3.275a2.75 2.75 0 0 1 3.889 3.889l-5.657 5.657a1.75 1.75 0 0 1-2.475-2.475l5.303-5.303a.75.75 0 0 1 1.061 1.061l-5.303 5.303a.25.25 0 1 0 .354.354l5.657-5.657a1.25 1.25 0 0 0-1.768-1.768L3.179 9.993a3.25 3.25 0 0 0 4.596 4.596l5.657-5.657a.75.75 0 0 1 1.061 1.061l-5.657 5.657A4.75 4.75 0 0 1 2.118 8.932Z" />
            </svg>
          </ToolbarBtn>

          {/* New session: combined agent picker */}
          {isNew && (
            <div className="relative" ref={agentMenuRef}>
              <ToolbarBtn
                active={false}
                onClick={() => setShowAgentMenu((v) => !v)}
                providerColor={provider.color}
              >
                <ProviderIcon providerId={provider.id} size={11} color={provider.color} />
                {agentLabel}
                <Chevron />
              </ToolbarBtn>

              {showAgentMenu && (
                <DropdownPanel style={{ bottom: '100%', marginBottom: 8, right: 0, minWidth: 320 }}>
                  {/* Provider row */}
                  <TieredRow label="Provider">
                    {Object.values(PROVIDER_DEFS).sort((a, b) => {
                      const aOk = providerAvailability[a.id] !== false
                      const bOk = providerAvailability[b.id] !== false
                      return aOk === bOk ? 0 : aOk ? -1 : 1
                    }).map((opt) => {
                      const available = providerAvailability[opt.id] !== false
                      const isActive = provider.id === opt.id
                      return (
                        <Chip
                          key={opt.id}
                          active={isActive}
                          disabled={!available}
                          onClick={() => { if (available) switchProvider(opt.id) }}
                          title={!available ? 'not installed' : undefined}
                          activeColor={opt.color}
                        >
                          <ProviderIcon providerId={opt.id} size={10} color={isActive ? '#fff' : available ? opt.color : 'var(--color-text-muted)'} />
                          {opt.name}
                        </Chip>
                      )
                    })}
                  </TieredRow>

                  {/* Model row */}
                  <TieredRow label="Model">
                    {getVisibleModels(provider, providerModels).map((opt) => (
                      <Chip
                        key={opt.id}
                        active={model === opt.id}
                        onClick={() => provider.id === 'cursor' ? switchCursorModel(opt.id) : update({ model: opt.id })}
                        activeColor={provider.color}
                      >
                        {opt.label}
                      </Chip>
                    ))}
                  </TieredRow>

                  {provider.id === 'claude' && (
                    <TieredRow label="Agent">
                      <Chip
                        active={!selectedAgentName}
                        onClick={() => update({ agentName: null })}
                        activeColor={provider.color}
                      >
                        Default
                      </Chip>
                      {claudeAgentsStatus === 'loading' && <InlineHint>Loading</InlineHint>}
                      {claudeAgentsStatus === 'error' && <InlineHint>Unavailable</InlineHint>}
                      {claudeAgentsStatus === 'loaded' && claudeAgents.length === 0 && <InlineHint>None</InlineHint>}
                      {claudeAgents.map((agent) => (
                        <Chip
                          key={agent.id}
                          active={selectedAgentName === agent.name}
                          onClick={() => update({ agentName: agent.name })}
                          activeColor={provider.color}
                          title={agent.model ? `${agent.name} · ${agent.model}` : agent.name}
                        >
                          {agent.name}
                          {agent.model && <span style={{ opacity: 0.72 }}>{agent.model}</span>}
                        </Chip>
                      ))}
                    </TieredRow>
                  )}

                  {/* Cursor: per-model effort row */}
                  {provider.id === 'cursor' && cursorEffortLevels.length > 0 && (
                    <TieredRow label="Effort">
                      {cursorEffortLevels.map((level) => (
                        <Chip
                          key={level.id}
                          active={cursorEffort === level.id}
                          onClick={() => update({ effort: level.id, useFast: false })}
                          activeColor={provider.color}
                        >
                          {level.label}
                        </Chip>
                      ))}
                    </TieredRow>
                  )}

                  {/* Cursor: thinking toggle */}
                  {provider.id === 'cursor' && hasThinking && (
                    <TieredRow label="Thinking">
                      <Chip active={!useThinking} onClick={() => update({ useThinking: false })} activeColor={provider.color}>Off</Chip>
                      <Chip active={useThinking}  onClick={() => update({ useThinking: true  })} activeColor={provider.color}>On</Chip>
                    </TieredRow>
                  )}

                  {/* Cursor: speed toggle */}
                  {provider.id === 'cursor' && hasFast && (
                    <TieredRow label="Speed">
                      <Chip active={!useFast} onClick={() => update({ useFast: false })} activeColor={provider.color}>Standard</Chip>
                      <Chip active={useFast}  onClick={() => update({ useFast: true  })} activeColor={provider.color}>Fast</Chip>
                    </TieredRow>
                  )}

                  {/* Thinking row — only if provider supports it (Claude/Codex) */}
                  {provider.supportsEffort && provider.effortLevels.length > 0 && (
                    <TieredRow label="Thinking">
                      {provider.effortLevels.map((opt) => (
                        <Chip
                          key={opt.id}
                          active={effort === opt.id}
                          onClick={() => update({ effort: opt.id })}
                          activeColor={provider.color}
                        >
                          {opt.label}
                        </Chip>
                      ))}
                    </TieredRow>
                  )}
                </DropdownPanel>
              )}
            </div>
          )}

          {/* Permission mode picker — always shown */}
          <div className="relative" ref={permMenuRef}>
            <ToolbarBtn active={permissionMode !== defaultPermissionMode} onClick={() => setShowPermMenu((v) => !v)}>
              <ProviderIcon providerId={provider.id} size={11} color={provider.color} />
              {permLabel}
              {resolvedPermission?.support === 'unsupported' && <PolicyBadge policy={resolvedPermission} compact />}
              <Chevron />
            </ToolbarBtn>
            {showPermMenu && (
              <DropdownPanel style={{ bottom: '100%', marginBottom: 8, right: 0, minWidth: provider.id === 'claude' ? 260 : 190 }}>
                <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2">
                    <ProviderIcon providerId={provider.id} size={12} color={provider.color} />
                    <div className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                      {providerShortName(provider.id)}
                    </div>
                  </div>
                </div>

                <div className="px-3 py-2" style={{ borderBottom: provider.id === 'claude' ? '1px solid var(--color-border)' : undefined }}>
                  <div className="flex flex-wrap gap-1.5">
                    {primaryPermissionModes.map((opt) => (
                      <PermissionModeChip
                        key={opt.id}
                        opt={opt}
                        active={permissionMode === opt.id}
                        providerColor={provider.color}
                        unsupported={providerRuntime?.policies[opt.id]?.support === 'unsupported'}
                        onSelect={() => update({ permissionMode: opt.id })}
                      />
                    ))}
                  </div>
                  {(advancedPermissionModes.length > 0 || dangerPermissionModes.length > 0) && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
                      <button
                        onClick={() => setShowAdvancedPerms((open) => !open)}
                        className="w-full text-xs font-semibold"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          color: 'var(--color-text-muted)',
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer'
                        }}
                      >
                        Advanced permissions
                        <span>{showAdvancedPerms ? 'Hide' : 'Show'}</span>
                      </button>
                      {showAdvancedPerms && (
                        <div style={{ marginTop: 8 }}>
                          {advancedPermissionModes.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {advancedPermissionModes.map((opt) => (
                                <PermissionModeChip
                                  key={opt.id}
                                  opt={opt}
                                  active={permissionMode === opt.id}
                                  providerColor={provider.color}
                                  unsupported={providerRuntime?.policies[opt.id]?.support === 'unsupported'}
                                  onSelect={() => update({ permissionMode: opt.id })}
                                />
                              ))}
                            </div>
                          )}
                          {dangerPermissionModes.length > 0 && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
                              <div className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-red)', fontSize: 10 }}>
                                Isolated only
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {dangerPermissionModes.map((opt) => (
                                  <PermissionModeChip
                                    key={opt.id}
                                    opt={opt}
                                    active={permissionMode === opt.id}
                                    providerColor="var(--color-red)"
                                    unsupported={providerRuntime?.policies[opt.id]?.support === 'unsupported'}
                                    onSelect={() => update({ permissionMode: opt.id })}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {selectedPermissionMode?.desc && (
                    <div style={{ marginTop: 8, color: 'var(--color-text-muted)', fontSize: 11, lineHeight: 1.35 }}>
                      {selectedPermissionMode.desc}
                    </div>
                  )}
                </div>
                {provider.id === 'claude' && showAdvancedPerms && (
                  <ClaudePermissionRules
                    allowedTools={session.allowedTools ?? []}
                    disallowedTools={session.disallowedTools ?? []}
                    availableTools={session.availableTools ?? []}
                    additionalDirs={session.additionalDirs ?? []}
                    onChange={update}
                  />
                )}
              </DropdownPanel>
            )}
          </div>

          {/* Send / Stop */}
          {canStop && (
            <button
              onClick={() => window.api.sessions.stop(session.id)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: 'var(--color-red)', color: '#fff' }}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="1" />
              </svg>
              Stop
            </button>
          )}
          {(session.status !== 'running' || canSend) && (
            <button
              onClick={send}
              disabled={!canSend}
              className="flex items-center justify-center rounded-lg transition-colors"
              style={{
                width: 30, height: 30,
                background: canSend ? 'var(--color-accent)' : 'var(--color-surface)',
                color: canSend ? '#fff' : 'var(--color-text-muted)',
                cursor: canSend ? 'pointer' : 'default'
              }}
              title={sendTitle}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path
                  d="M8 2.75a.75.75 0 0 1 .75.75v7.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 1 1 1.06-1.06L7.25 11.19V3.5A.75.75 0 0 1 8 2.75Z"
                  style={{ transform: 'rotate(180deg)', transformOrigin: '8px 8px' }}
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {isNew && effectiveMode && (
        <div className="text-center mt-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          New branch
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function PermissionModeChip({
  opt,
  active,
  providerColor,
  unsupported,
  onSelect
}: {
  opt: { id: string; label: string; desc: string }
  active: boolean
  providerColor: string
  unsupported: boolean
  onSelect: () => void
}): JSX.Element {
  return (
    <Chip
      active={active}
      disabled={unsupported}
      onClick={() => {
        if (!unsupported) onSelect()
      }}
      title={unsupported ? 'Unsupported by this runtime' : opt.desc}
      activeColor={providerColor}
    >
      {opt.label}
    </Chip>
  )
}

function AttachmentChip({
  attachment,
  onRemove
}: {
  attachment: Attachment
  onRemove: () => void
}): JSX.Element {
  const label = attachment.kind === 'local_file'
    ? attachment.name
    : attachment.name ?? attachment.relativePath
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-muted)'
      }}
      title={attachment.kind === 'local_file' ? attachment.path : `${attachment.fileId}:${attachment.relativePath}`}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
        <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V5h-2.75A1.75 1.75 0 0 1 8 3.25V1.5Z" />
      </svg>
      <span className="min-w-0 truncate">{label}</span>
      {attachment.kind === 'local_file' && attachment.size !== undefined && (
        <span className="shrink-0" style={{ opacity: 0.7 }}>{formatBytes(attachment.size)}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="grid h-4 w-4 shrink-0 place-items-center rounded"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>
    </span>
  )
}

function dedupeAttachments(attachments: Attachment[]): Attachment[] {
  const seen = new Set<string>()
  return attachments.filter((attachment) => {
    const key = attachment.kind === 'local_file'
      ? `local:${attachment.path}`
      : `claude:${attachment.fileId}:${attachment.relativePath}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function ToolbarBtn({
  children, active, onClick, muted, title, providerColor
}: {
  children: React.ReactNode
  active: boolean
  onClick?: () => void
  muted?: boolean
  title?: string
  providerColor?: string
}): JSX.Element {
  const borderColor = providerColor ?? (active ? 'var(--color-accent)' : 'var(--color-border)')
  const textColor = providerColor ?? (muted ? 'var(--color-text-muted)' : active ? 'var(--color-accent)' : 'var(--color-text-muted)')
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition-colors"
      style={{
        background: active ? 'var(--color-accent-dim)' : 'var(--color-surface)',
        color: textColor,
        border: '1px solid ' + borderColor,
        cursor: onClick ? 'pointer' : 'default'
      }}
    >
      {children}
    </button>
  )
}

function Chevron(): JSX.Element {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor" style={{ opacity: 0.5 }}>
      <path d="M5 7 L1 3 L9 3 Z" />
    </svg>
  )
}

function DropdownPanel({
  children, style
}: {
  children: React.ReactNode
  style: React.CSSProperties
}): JSX.Element {
  return (
    <div
      className="absolute rounded-xl overflow-hidden z-50"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        ...style
      }}
    >
      {children}
    </div>
  )
}

function DropdownRow({
  children, active, onClick, disabled
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      disabled={disabled}
      className="w-full flex items-start gap-2 px-3 py-2 text-left"
      style={{
        background: active ? 'var(--color-surface2)' : 'transparent',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer'
      }}
      onClick={() => { if (!disabled) onClick() }}
      onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.background = 'var(--color-surface2)' }}
      onMouseLeave={(e) => { if (!active && !disabled) e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex-1">
        {children}
      </div>
      {active && (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 mt-0.5" style={{ color: 'var(--color-accent)' }}>
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
      )}
    </button>
  )
}

function parseListInput(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function ClaudePermissionRules({
  allowedTools,
  disallowedTools,
  availableTools,
  additionalDirs,
  onChange
}: {
  allowedTools: string[]
  disallowedTools: string[]
  availableTools: string[]
  additionalDirs: string[]
  onChange: (patch: {
    allowedTools?: string[]
    disallowedTools?: string[]
    availableTools?: string[]
    additionalDirs?: string[]
  }) => void
}): JSX.Element {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--color-surface2)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
    borderRadius: 7,
    padding: '5px 7px',
    fontSize: 11,
    outline: 'none'
  }
  const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '48px 1fr', gap: 8, alignItems: 'center' }
  const labelStyle: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: 11 }

  return (
    <div className="px-3 py-2 space-y-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
      <div style={rowStyle}>
        <span style={labelStyle}>Allow</span>
        <input
          defaultValue={allowedTools.join(', ')}
          placeholder="Read, Edit"
          onBlur={(event) => onChange({ allowedTools: parseListInput(event.currentTarget.value) })}
          style={inputStyle}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Deny</span>
        <input
          defaultValue={disallowedTools.join(', ')}
          placeholder="Bash(git push)"
          onBlur={(event) => onChange({ disallowedTools: parseListInput(event.currentTarget.value) })}
          style={inputStyle}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Tools</span>
        <input
          defaultValue={availableTools.join(', ')}
          placeholder="default"
          onBlur={(event) => onChange({ availableTools: parseListInput(event.currentTarget.value) })}
          style={inputStyle}
        />
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Dirs</span>
        <input
          defaultValue={additionalDirs.join(', ')}
          placeholder="/tmp/shared"
          onBlur={(event) => onChange({ additionalDirs: parseListInput(event.currentTarget.value) })}
          style={inputStyle}
        />
      </div>
    </div>
  )
}

function PolicyBadge({
  policy,
  compact
}: {
  policy: ResolvedExecutionPolicy
  compact?: boolean
}): JSX.Element {
  const color =
    policy.support === 'unsupported'
      ? 'var(--color-red)'
      : policy.support === 'forced'
        ? 'var(--color-yellow)'
        : policy.warning
          ? 'var(--color-yellow)'
          : 'var(--color-text-muted)'
  const label =
    policy.support === 'unsupported'
      ? 'Unsupported'
      : policy.support === 'forced'
        ? 'Forced'
        : policy.warning
          ? 'Note'
          : 'Approx'

  return (
    <span
      className="rounded px-1 py-0.5 text-xs font-medium"
      style={{
        color,
        border: `1px solid ${color}`,
        fontSize: compact ? 9 : 10,
        lineHeight: 1
      }}
    >
      {compact ? '!' : label}
    </span>
  )
}

function TieredRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="flex items-start gap-3 px-3 py-2"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      <span
        className="shrink-0 text-xs font-semibold uppercase tracking-wider pt-0.5"
        style={{ color: 'var(--color-text-muted)', fontSize: 10, width: 52 }}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {children}
      </div>
    </div>
  )
}

function InlineHint({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span className="text-xs" style={{ color: 'var(--color-text-muted)', padding: '2px 4px' }}>
      {children}
    </span>
  )
}

function providerShortName(providerId: string): string {
  const names: Record<string, string> = {
    claude: 'Claude',
    codex: 'Codex',
    copilot: 'Copilot',
    cursor: 'Cursor'
  }
  return names[providerId] ?? providerId
}

function Chip({
  children, active, disabled, onClick, title, activeColor = 'var(--color-accent)'
}: {
  children: React.ReactNode
  active: boolean
  disabled?: boolean
  onClick: () => void
  title?: string
  activeColor?: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors"
      style={{
        background: active ? activeColor : 'var(--color-surface2)',
        color: active ? '#fff' : disabled ? 'var(--color-text-muted)' : 'var(--color-text)',
        border: '1px solid ' + (active ? activeColor : 'var(--color-border)'),
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontWeight: active ? 500 : 400
      }}
    >
      {children}
    </button>
  )
}
