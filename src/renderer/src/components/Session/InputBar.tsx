import { useState, useRef, useEffect } from 'react'
import type { Attachment, ProviderAgentDef, ProviderRuntimeInfo, ProviderSlashCommand, ResolvedExecutionPolicy, Session } from '../../types'
import type { SlashPaletteCommand } from '../../types'
import { PROVIDER_DEFS, canStopSession, expandSlashCommandPrompt, getAdvancedPermissionModes, getComposerSendState, getDangerPermissionModes, getDefaultPermissionMode, getPrimaryPermissionModes, getVisibleModels, parseClaudeAgentsOutput } from '../../types'
import { useSessionStore } from '../../store/sessions'
import SlashCommandPalette, { getSlashQuery } from './SlashCommandPalette'
import ProviderIcon from '../shared/ProviderIcon'
import Icon from '../shared/Icon'
import { AttachmentPill, DismissablePopoverSurface, Tooltip } from '../shared/designSystem'

interface Props {
  session: Session
  isNew: boolean
}

export default function InputBar({ session, isNew }: Props): JSX.Element {
  const {
    providerAvailability,
    providerModels,
    uiState,
    setShowDiff,
    setShowEvents,
    setShowPlan,
    setShowSettings,
    setShowCapabilities,
    setShowExtensions,
    setShowTerminal,
    openSideChat,
    appendSideChatMessage,
    updateSideChatMessage
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
  const [isSavingPastedFiles, setIsSavingPastedFiles] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const resizeTextarea = (textarea: HTMLTextAreaElement): void => {
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
  }

  const moveTextareaCursorToEnd = (textarea: HTMLTextAreaElement): void => {
    const end = textarea.value.length
    textarea.setSelectionRange(end, end)
    textarea.scrollTop = textarea.scrollHeight
  }

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
    const onAddComposerAttachment = (event: Event): void => {
      const detail = (event as CustomEvent<Partial<Extract<Attachment, { kind: 'local_file' }>>>).detail
      if (!detail?.path) return
      const filePath = detail.path
      const pathParts = filePath.split(/[\\/]/)
      const name = detail.name ?? pathParts.at(-1) ?? filePath
      setAttachments((current) => dedupeAttachments([
        ...current,
        {
          id: crypto.randomUUID(),
          kind: 'local_file',
          path: filePath,
          name,
          size: detail.size
        }
      ]))
      textareaRef.current?.focus()
    }
    window.addEventListener('orchestrator:add-composer-attachment', onAddComposerAttachment)
    return () => window.removeEventListener('orchestrator:add-composer-attachment', onAddComposerAttachment)
  }, [])

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
  const currentUi = uiState[session.id] ?? { showPlan: false, showDiff: false, showEvents: false, showTerminal: false, showExtensions: false, showSideQuestions: false, hasUnread: false }
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
  const canSend = sendState.canSend && !isSavingPastedFiles
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
      const sideChatId = crypto.randomUUID()
      openSideChat(session.id, sideChatId, question ? sideChatTitle(question) : 'Side chat')
      if (!question) return
      const userMessageId = crypto.randomUUID()
      const answerMessageId = crypto.randomUUID()
      appendSideChatMessage(session.id, sideChatId, {
        id: userMessageId,
        role: 'user',
        content: question,
        status: 'complete'
      })
      appendSideChatMessage(session.id, sideChatId, {
        id: answerMessageId,
        role: 'assistant',
        content: 'Thinking...',
        status: 'pending'
      })
      try {
        const result = await window.api.sessions.answerSideQuestion(session.id, question)
        updateSideChatMessage(session.id, sideChatId, answerMessageId, {
          content: result.ok ? result.answer : (result.error ?? 'Side question failed.'),
          status: result.ok ? 'complete' : 'error',
          usage: result.usage
        })
      } catch (error) {
        updateSideChatMessage(session.id, sideChatId, answerMessageId, {
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

  const attachPastedFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    setIsSavingPastedFiles(true)
    try {
      const saved = await Promise.all(files.map(async (file): Promise<Attachment | null> => {
        try {
          const bytes = await file.arrayBuffer()
          const attachment = await window.api.attachments.savePastedFile({
            name: file.name || undefined,
            mimeType: file.type || undefined,
            bytes
          })
          return {
            id: crypto.randomUUID(),
            kind: 'local_file',
            path: attachment.path,
            name: attachment.name,
            size: attachment.size,
            mimeType: attachment.mimeType
          }
        } catch (error) {
          console.warn('Unable to attach pasted file', error)
          return null
        }
      }))
      const next = saved.filter((attachment): attachment is Attachment => attachment !== null)
      if (next.length > 0) {
        setAttachments((current) => dedupeAttachments([...current, ...next]))
        textareaRef.current?.focus()
      }
    } finally {
      setIsSavingPastedFiles(false)
    }
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
    resizeTextarea(e.target)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const textarea = e.currentTarget
    const pastedFiles = getClipboardFiles(e.clipboardData)
    if (pastedFiles.length > 0) {
      e.preventDefault()
      const pastedText = e.clipboardData.getData('text/plain')
      if (pastedText) insertTextAtSelection(textarea, pastedText)
      void attachPastedFiles(pastedFiles)
      return
    }
    window.setTimeout(() => {
      resizeTextarea(textarea)
      moveTextareaCursorToEnd(textarea)
    }, 0)
  }

  const insertTextAtSelection = (textarea: HTMLTextAreaElement, value: string): void => {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const next = `${textarea.value.slice(0, start)}${value}${textarea.value.slice(end)}`
    setText(next)
    setSlashIndex(0)
    window.setTimeout(() => {
      if (!textareaRef.current) return
      const cursor = start + value.length
      textareaRef.current.setSelectionRange(cursor, cursor)
      resizeTextarea(textareaRef.current)
    }, 0)
  }

  const setTextareaText = (next: string): void => {
    setText(next)
    setSlashIndex(0)
    textareaRef.current?.focus()
    window.setTimeout(() => {
      if (textareaRef.current) {
        resizeTextarea(textareaRef.current)
        moveTextareaCursorToEnd(textareaRef.current)
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
      if (command.id === 'skills') {
        setShowCapabilities(true)
      }
      if (command.id === 'extensions') setShowExtensions(session.id, true)
      if (command.id === 'terminal') setShowTerminal(session.id, !currentUi.showTerminal)
      if (command.id === 'btw') openSideChat(session.id, crypto.randomUUID(), 'Side chat')
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

  const sendTitle = isSavingPastedFiles ? 'Saving pasted files' : sendState.willQueue ? 'Queue message (↵)' : 'Send (↵)'

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
      className="shrink-0 px-6 pt-2 pb-3"
      style={{
        background: 'var(--canvas-bg)'
      }}
    >
      <div
        className="overflow-visible mx-auto"
        style={{
          maxWidth: isNew ? 700 : 860,
          background: 'var(--surface-bg)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: isNew ? 'var(--shadow-composer)' : '0 6px 18px rgba(15, 23, 42, 0.045)',
          position: 'relative',
          transition: 'box-shadow 140ms ease, border-color 140ms ease'
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
        <div className="flex items-end px-4 pt-3 pb-1 gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder={isNew ? 'What do you want to build?' : 'Message…'}
            rows={1}
            autoFocus={isNew}
            className="flex-1 resize-none bg-transparent outline-none"
            style={{ color: 'var(--text-primary)', lineHeight: 1.5, maxHeight: 180, userSelect: 'text', fontSize: 14 }}
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
            <div className="relative">
              <ToolbarBtn
                active={effectiveMode}
                onClick={isGitRepo ? () => setShowModeMenu((v) => !v) : undefined}
                muted={!isGitRepo}
                title={!isGitRepo ? 'Not a git repository' : undefined}
                dataTestId="composer-worktree-menu"
              >
                <Icon name={effectiveMode ? 'branch' : 'folder'} size={13} />
                {effectiveMode ? 'Branch' : 'Local'}
                {isGitRepo && <Chevron />}
              </ToolbarBtn>

              {showModeMenu && (
                <DropdownPanel onClose={() => setShowModeMenu(false)} style={{ bottom: '100%', marginBottom: 8, left: 0, minWidth: 160 }}>
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
            <div className="flex items-center gap-1.5 px-1" style={{ color: 'var(--color-text-muted)', minWidth: 0 }}>
              <ProviderIcon providerId={provider.id} size={11} color="var(--color-text-muted)" />
              <span className="text-xs truncate" style={{ maxWidth: 360 }}>{agentLabel}</span>
            </div>
          )}

          <div className="flex-1" />

          <ToolbarBtn
            active={attachments.length > 0 || isSavingPastedFiles}
            onClick={attachFiles}
            title={isSavingPastedFiles ? 'Saving pasted files' : 'Attach files'}
            ariaLabel={isSavingPastedFiles ? 'Saving pasted files' : 'Attach files'}
          >
            <Icon name="paperclip" size={13} />
          </ToolbarBtn>

          {/* New session: combined agent picker */}
          {isNew && (
            <div className="relative">
              <ToolbarBtn
                active={false}
                onClick={() => setShowAgentMenu((v) => !v)}
                providerColor={provider.color}
                dataTestId="composer-agent-menu"
              >
                <ProviderIcon providerId={provider.id} size={11} color={provider.color} />
                {agentLabel}
                <Chevron />
              </ToolbarBtn>

              {showAgentMenu && (
                <DropdownPanel onClose={() => setShowAgentMenu(false)} style={{ bottom: '100%', marginBottom: 8, right: 0, minWidth: 320 }}>
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
                          <ProviderIcon providerId={opt.id} size={10} color={available ? opt.color : 'var(--color-text-muted)'} />
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
          <div className="relative">
            <ToolbarBtn active={permissionMode !== defaultPermissionMode} onClick={() => setShowPermMenu((v) => !v)} dataTestId="composer-permission-menu">
              <ProviderIcon providerId={provider.id} size={11} color={provider.color} />
              {permLabel}
              {resolvedPermission?.support === 'unsupported' && <PolicyBadge policy={resolvedPermission} compact />}
              <Chevron />
            </ToolbarBtn>
            {showPermMenu && (
              <DropdownPanel onClose={() => setShowPermMenu(false)} style={{ bottom: '100%', marginBottom: 8, right: 0, minWidth: provider.id === 'claude' ? 260 : 190 }}>
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
            <Tooltip label={sendTitle}>
              <button
                onClick={send}
                disabled={!canSend}
                aria-label={sendTitle}
                data-tooltip-label={sendTitle}
                data-native-title-free="true"
                className="flex items-center justify-center rounded-lg transition-colors"
                style={{
                  width: 30, height: 30,
                  background: canSend ? 'var(--text-primary)' : 'var(--control-bg)',
                  color: canSend ? 'var(--canvas-bg)' : 'var(--color-text-muted)',
                  cursor: canSend ? 'pointer' : 'default'
                }}
              >
                <Icon name="arrowUp" size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
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

function sideChatTitle(question: string): string {
  const compact = question.replace(/\s+/g, ' ').trim()
  return compact.length > 28 ? `${compact.slice(0, 25)}...` : compact || 'Side chat'
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
    <AttachmentPill
      label={label}
      title={attachment.kind === 'local_file' ? attachment.path : `${attachment.fileId}:${attachment.relativePath}`}
      meta={attachment.kind === 'local_file' && attachment.size !== undefined ? formatBytes(attachment.size) : undefined}
      onRemove={onRemove}
    />
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

function getClipboardFiles(clipboardData: DataTransfer): File[] {
  const files = Array.from(clipboardData.files ?? [])
  if (files.length > 0) return files
  return Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function ToolbarBtn({
  children, active, onClick, muted, title, ariaLabel, providerColor, dataTestId
}: {
  children: React.ReactNode
  active: boolean
  onClick?: () => void
  muted?: boolean
  title?: string
  ariaLabel?: string
  providerColor?: string
  dataTestId?: string
}): JSX.Element {
  const borderColor = active ? 'var(--border-strong)' : 'transparent'
  const textColor = muted ? 'var(--text-tertiary)' : active ? 'var(--text-primary)' : 'var(--text-secondary)'
  void providerColor
  const button = (
    <button
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true })
        onClick?.()
      }}
      aria-label={ariaLabel}
      data-tooltip-label={title}
      data-native-title-free="true"
      data-testid={dataTestId}
      className="flex items-center gap-1.5 text-xs transition-colors"
      style={{
        background: active ? 'var(--control-bg-active)' : 'var(--control-bg)',
        color: textColor,
        border: '1px solid ' + borderColor,
        borderRadius: 'var(--radius-lg)',
        padding: '5px 8px',
        cursor: onClick ? 'pointer' : 'default',
        fontWeight: 600,
        minHeight: 28
      }}
    >
      {children}
    </button>
  )
  return title ? <Tooltip label={title}>{button}</Tooltip> : button
}

function Chevron(): JSX.Element {
  return (
    <span style={{ opacity: 0.55, display: 'inline-flex' }}>
      <Icon name="chevronDown" size={12} />
    </span>
  )
}

function DropdownPanel({
  children, onClose, style
}: {
  children: React.ReactNode
  onClose: () => void
  style: React.CSSProperties
}): JSX.Element {
  return (
    <DismissablePopoverSurface
      className="absolute overflow-hidden z-50"
      onClose={onClose}
      style={{
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-popover)',
        ...style
      }}
    >
      {children}
    </DismissablePopoverSurface>
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
        background: active ? 'var(--control-bg-active)' : 'transparent',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer'
      }}
      onClick={() => { if (!disabled) onClick() }}
      onMouseEnter={(e) => { if (!active && !disabled) e.currentTarget.style.background = 'var(--control-bg-hover)' }}
      onMouseLeave={(e) => { if (!active && !disabled) e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex-1">
        {children}
      </div>
      {active && (
        <span className="shrink-0 mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
          <Icon name="check" size={13} />
        </span>
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
      className="flex items-center gap-1.5 text-xs transition-colors"
      style={{
        background: active ? 'var(--control-bg-active)' : 'var(--control-bg)',
        color: active ? activeColor : disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
        border: '1px solid ' + (active ? activeColor : 'var(--border-subtle)'),
        borderRadius: 'var(--radius-pill)',
        padding: '5px 9px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontWeight: active ? 650 : 500
      }}
    >
      {children}
    </button>
  )
}
