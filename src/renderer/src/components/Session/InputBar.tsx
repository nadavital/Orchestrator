import { memo, useState, useRef, useEffect } from 'react'
import type { Attachment, PermissionExecutionContract, ProviderAgentDef, ProviderPermissionMode, ProviderPermissionRuntimeContext, ProviderRuntimeInfo, ProviderSlashCommand, ResolvedExecutionPolicy, Session } from '../../types'
import type { SlashPaletteCommand } from '../../types'
import { PROVIDER_DEFS, canStopSession, expandSlashCommandPrompt, getAdvancedPermissionModes, getComposerSendState, getDangerPermissionModes, getDefaultPermissionMode, getPrimaryPermissionModes, getVisibleModels, parseClaudeAgentsOutput } from '../../types'
import { defaultUI, sideChatContextSnapshot, useSessionStore } from '../../store/sessions'
import SlashCommandPalette, { getSlashQuery } from './SlashCommandPalette'
import ProviderIcon from '../shared/ProviderIcon'
import Icon from '../shared/Icon'
import { AttachmentPill, DismissablePopoverSurface, Tooltip } from '../shared/designSystem'
import { useShallow } from 'zustand/react/shallow'

interface Props {
  session: Session
  isNew: boolean
}

interface PendingAttachment {
  id: string
  name: string
  size?: number
  status: 'saving' | 'error'
  error?: string
}

function InputBar({ session, isNew }: Props): JSX.Element {
  const providerAvailability = useSessionStore((state) => state.providerAvailability)
  const providerModels = useSessionStore((state) => state.providerModels)
  const queuedFollowUpSummary = useSessionStore(useShallow((state) => {
    const current = state.sessions.find((candidate) => candidate.id === session.id)
    const queuedMessages = (current?.messages ?? []).filter((message) =>
      message.type === 'text' && message.role === 'user' && message.queueState
    )
    const queued = queuedMessages.filter((message) => message.queueState === 'queued').length
    const steering = queuedMessages.filter((message) => message.queueState === 'steer_next').length
    return { queued, steering }
  }))
  const currentUi = useSessionStore((state) => state.uiState[session.id] ?? defaultUI)
  const setComposerDraft = useSessionStore((state) => state.setComposerDraft)
  const setComposerAttachments = useSessionStore((state) => state.setComposerAttachments)
  const setShowDiff = useSessionStore((state) => state.setShowDiff)
  const setShowEvents = useSessionStore((state) => state.setShowEvents)
  const setShowPlan = useSessionStore((state) => state.setShowPlan)
  const setShowSettings = useSessionStore((state) => state.setShowSettings)
  const setShowCapabilities = useSessionStore((state) => state.setShowCapabilities)
  const setShowExtensions = useSessionStore((state) => state.setShowExtensions)
  const setShowTerminal = useSessionStore((state) => state.setShowTerminal)
  const openSideChat = useSessionStore((state) => state.openSideChat)
  const appendSideChatMessage = useSessionStore((state) => state.appendSideChatMessage)
  const updateSideChatMessage = useSessionStore((state) => state.updateSideChatMessage)
  const [text, setText] = useState(() => currentUi.composerDraft ?? '')
  const attachments = currentUi.composerAttachments ?? []
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [useWorktree, setUseWorktree] = useState(false)
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [showAgentMenu, setShowAgentMenu] = useState(false)
  const [showPermMenu, setShowPermMenu] = useState(false)
  const [showAdvancedPerms, setShowAdvancedPerms] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [runtimeInfo, setRuntimeInfo] = useState<Record<string, ProviderRuntimeInfo>>({})
  const [permissionContext, setPermissionContext] = useState<ProviderPermissionRuntimeContext | null>(null)
  const [extensionCommands, setExtensionCommands] = useState<ProviderSlashCommand[]>([])
  const [claudeAgents, setClaudeAgents] = useState<ProviderAgentDef[]>([])
  const [claudeAgentsStatus, setClaudeAgentsStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [isSavingPastedFiles, setIsSavingPastedFiles] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [attachmentStatus, setAttachmentStatus] = useState<{ text: string; tone: 'info' | 'danger' } | null>(null)
  const [permissionRulesStatus, setPermissionRulesStatus] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cancelledPendingAttachments = useRef<Set<string>>(new Set())
  const activeAttachmentSaves = useRef<Set<string>>(new Set())

  useEffect(() => {
    const globals = window as typeof window & { __orchestratorInputBarCommitCount?: number }
    if (typeof globals.__orchestratorInputBarCommitCount === 'number') {
      globals.__orchestratorInputBarCommitCount += 1
    }
  })

  const setComposerText = (next: string, sessionId = session.id): void => {
    setText(next)
    setComposerDraft(sessionId, next)
  }

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
    let alive = true
    setPermissionContext(null)
    window.api.providers.getPermissionContext(session.provider ?? 'claude', session.workDir)
      .then((context) => {
        if (alive) setPermissionContext(context)
      })
      .catch(() => {
        if (alive) setPermissionContext(null)
      })
    return () => { alive = false }
  }, [session.provider, session.workDir])

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
    const nextDraft = useSessionStore.getState().uiState[session.id]?.composerDraft ?? ''
    setText(nextDraft)
    setPendingAttachments([])
    setIsSavingPastedFiles(false)
    setDragActive(false)
    setAttachmentStatus(null)
    setPermissionRulesStatus(null)
    setSlashIndex(0)
    window.setTimeout(() => {
      if (textareaRef.current) resizeTextarea(textareaRef.current)
    }, 0)
  }, [session.id])

  useEffect(() => {
    const onAddComposerAttachment = (event: Event): void => {
      const detail = (event as CustomEvent<Partial<Extract<Attachment, { kind: 'local_file' }>>>).detail
      if (!detail?.path) return
      const filePath = detail.path
      const pathParts = filePath.split(/[\\/]/)
      const name = detail.name ?? pathParts.at(-1) ?? filePath
      setComposerAttachments(session.id, (current) => dedupeAttachments([
        ...current,
        {
          id: crypto.randomUUID(),
          kind: 'local_file',
          path: filePath,
          name,
          size: detail.size
        }
      ]))
      setAttachmentStatus({ text: `Attached ${name}`, tone: 'info' })
      textareaRef.current?.focus()
    }
    window.addEventListener('orchestrator:add-composer-attachment', onAddComposerAttachment)
    return () => window.removeEventListener('orchestrator:add-composer-attachment', onAddComposerAttachment)
  }, [session.id, setComposerAttachments])

  useEffect(() => {
    if (!showPermMenu) setShowAdvancedPerms(false)
  }, [showPermMenu])

  const provider = PROVIDER_DEFS[session.provider ?? 'claude'] ?? PROVIDER_DEFS.claude
  const model = session.model || provider.models[0]?.id || ''
  const effort = session.effort ?? provider.effortLevels[0]?.id ?? ''
  const contextDefaultPermissionMode = permissionContext?.providerId === provider.id ? permissionContext.defaultPolicy : undefined
  const defaultPermissionMode = contextDefaultPermissionMode ?? getDefaultPermissionMode(provider)
  const permissionMode = session.permissionMode ?? defaultPermissionMode
  const effectiveMode = isNew ? useWorktree : session.useWorktree
  const providerRuntime = runtimeInfo[provider.id]
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
  const permissionSourceLabel = permissionContext ? permissionSourceBadgeLabel(permissionContext) : null
  const permissionTriggerLabel = [
    `Permission mode: ${permLabel}`,
    permissionSourceLabel ? `${permissionSourceLabel} permission config` : null,
    resolvedPermission?.support === 'unsupported' ? 'unsupported by this runtime' : null
  ].filter(Boolean).join('. ')
  const permissionTriggerTitle = [
    permissionTriggerLabel,
    permissionContext?.summary
  ].filter(Boolean).join('. ')
  const primaryPermissionModes = filterPermissionModes(getPrimaryPermissionModes(provider), permissionContext, permissionMode)
  const advancedPermissionModes = filterPermissionModes(getAdvancedPermissionModes(provider), permissionContext, permissionMode)
  const dangerPermissionModes = filterPermissionModes(getDangerPermissionModes(provider), permissionContext, permissionMode)
  const canUsePermission = resolvedPermission?.support !== 'unsupported'
  const queuedFollowUpCount = queuedFollowUpSummary.queued
  const steeringFollowUpCount = queuedFollowUpSummary.steering
  const queuedFollowUpTotal = queuedFollowUpCount + steeringFollowUpCount
  const queuedFollowUpLabel = [
    queuedFollowUpCount > 0 ? `${queuedFollowUpCount} queued` : null,
    steeringFollowUpCount > 0 ? `${steeringFollowUpCount} steering` : null
  ].filter(Boolean).join(' · ')

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

  const selectPermissionMode = (modeId: string): void => {
    update({ permissionMode: modeId })
    setPermissionRulesStatus(null)
    setShowPermMenu(false)
  }

  const updatePermissionRules = (
    label: string,
    patch: {
      allowedTools?: string[]
      disallowedTools?: string[]
      availableTools?: string[]
      additionalDirs?: string[]
    }
  ): void => {
    update(patch)
    setPermissionRulesStatus(`${label} saved`)
  }

  const sendState = getComposerSendState({
    text,
    status: session.status,
    canUsePermission
  })
  const canSend = sendState.canSend && !isSavingPastedFiles
  const canStop = canStopSession(session.status)
  const hasDraftText = text.trim().length > 0
  const composerSendNotice = hasDraftText && !canUsePermission
    ? {
        state: 'unsupported-permission' as const,
        tone: 'danger' as const,
        title: 'Permission mode unavailable',
        detail: resolvedPermission?.description ?? 'Choose a supported permission mode before sending.'
      }
    : hasDraftText && isSavingPastedFiles
      ? {
          state: 'saving-attachments' as const,
          tone: 'neutral' as const,
          title: 'Saving attachments',
          detail: 'The message will be ready after attached files finish saving.'
        }
      : sendState.willQueue
        ? {
            state: 'will-queue' as const,
            tone: 'accent' as const,
            title: 'Will queue after current run',
            detail: 'Press Enter to send this as a queued follow-up.'
          }
        : null

  const send = async (): Promise<void> => {
    if (!canSend) return
    const rawPrompt = text.trim()
    const sideQuestion = rawPrompt.match(/^\/btw(?:\s+([\s\S]+))?$/)
    if (sideQuestion) {
      const question = (sideQuestion[1] ?? '').trim()
      setComposerText('')
      setComposerAttachments(session.id, [])
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      const sideChatId = crypto.randomUUID()
      openSideChat(
        session.id,
        sideChatId,
        question ? sideChatTitle(question) : 'Side chat',
        sideChatContextSnapshot(session, 'composer-btw', question)
      )
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
    setComposerText('')
    setComposerAttachments(session.id, [])
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
    setComposerAttachments(session.id, (current) => dedupeAttachments([...current, ...next]))
    setAttachmentStatus({ text: `Attached ${next.length} ${next.length === 1 ? 'file' : 'files'}`, tone: 'info' })
    textareaRef.current?.focus()
  }

  const attachPastedFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    const targetSessionId = session.id
    const pending = files.map((file): PendingAttachment => ({
      id: crypto.randomUUID(),
      name: file.name || 'Pasted file',
      size: file.size,
      status: 'saving'
    }))
    for (const item of pending) activeAttachmentSaves.current.add(item.id)
    setPendingAttachments((current) => [...current, ...pending])
    setIsSavingPastedFiles(true)
    setAttachmentStatus({ text: `Saving ${files.length} ${files.length === 1 ? 'attachment' : 'attachments'}`, tone: 'info' })
    try {
      const saved = await Promise.all(files.map(async (file, index): Promise<{ pendingId: string; attachment?: Attachment; error?: string }> => {
        const pendingId = pending[index].id
        try {
          const bytes = await file.arrayBuffer()
          if (cancelledPendingAttachments.current.has(pendingId)) return { pendingId }
          const attachment = await window.api.attachments.savePastedFile({
            name: file.name || undefined,
            mimeType: file.type || undefined,
            bytes
          })
          if (cancelledPendingAttachments.current.has(pendingId)) return { pendingId }
          return {
            pendingId,
            attachment: {
              id: crypto.randomUUID(),
              kind: 'local_file',
              path: attachment.path,
              name: attachment.name,
              size: attachment.size,
              mimeType: attachment.mimeType
            }
          }
        } catch (error) {
          console.warn('Unable to attach pasted file', error)
          return {
            pendingId,
            error: error instanceof Error ? error.message : 'Unable to attach file.'
          }
        }
      }))
      const next = saved.flatMap((result) => result.attachment ? [result.attachment] : [])
      if (next.length > 0) {
        setComposerAttachments(targetSessionId, (current) => dedupeAttachments([...current, ...next]))
        setAttachmentStatus({ text: `Attached ${next.length} ${next.length === 1 ? 'file' : 'files'}`, tone: 'info' })
        if (useSessionStore.getState().activeSessionId === targetSessionId) {
          textareaRef.current?.focus()
        }
      }
      const completedIds = new Set(saved.filter((result) => result.attachment || !result.error).map((result) => result.pendingId))
      const failed = new Map(saved.filter((result) => result.error).map((result) => [result.pendingId, result.error!]))
      setPendingAttachments((current) => current
        .map((item): PendingAttachment => failed.has(item.id) ? { ...item, status: 'error', error: failed.get(item.id) } : item)
        .filter((item) => !completedIds.has(item.id))
      )
      if (failed.size > 0) {
        setAttachmentStatus({ text: `${failed.size} ${failed.size === 1 ? 'attachment' : 'attachments'} failed`, tone: 'danger' })
      }
    } finally {
      for (const item of pending) {
        cancelledPendingAttachments.current.delete(item.id)
        activeAttachmentSaves.current.delete(item.id)
      }
      setIsSavingPastedFiles(activeAttachmentSaves.current.size > 0)
    }
  }

  const cancelPendingAttachment = (id: string): void => {
    cancelledPendingAttachments.current.add(id)
    activeAttachmentSaves.current.delete(id)
    setIsSavingPastedFiles(activeAttachmentSaves.current.size > 0)
    setPendingAttachments((current) => current.filter((item) => item.id !== id))
    setAttachmentStatus({ text: 'Attachment canceled', tone: 'info' })
  }

  const removeAttachment = (attachment: Attachment): void => {
    const label = attachment.kind === 'local_file'
      ? attachment.name
      : attachment.name ?? attachment.relativePath
    setComposerAttachments(session.id, (current) => current.filter((item) => item.id !== attachment.id))
    setAttachmentStatus({ text: `Removed ${label}`, tone: 'info' })
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
    setComposerText(e.target.value)
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

  const handleDragEvent = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDataTransferFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.type === 'dragenter' || event.type === 'dragover') setDragActive(true)
    if (event.type === 'dragleave') setDragActive(false)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDataTransferFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) void attachPastedFiles(files)
  }

  const insertTextAtSelection = (textarea: HTMLTextAreaElement, value: string): void => {
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const next = `${textarea.value.slice(0, start)}${value}${textarea.value.slice(end)}`
    setComposerText(next)
    setSlashIndex(0)
    window.setTimeout(() => {
      if (!textareaRef.current) return
      const cursor = start + value.length
      textareaRef.current.setSelectionRange(cursor, cursor)
      resizeTextarea(textareaRef.current)
    }, 0)
  }

  const setTextareaText = (next: string): void => {
    setComposerText(next)
    setSlashIndex(0)
    textareaRef.current?.focus()
    window.setTimeout(() => {
      if (textareaRef.current) {
        resizeTextarea(textareaRef.current)
        moveTextareaCursorToEnd(textareaRef.current)
      }
    }, 0)
  }

  useEffect(() => {
    const onAddComposerText = (event: Event): void => {
      const detail = (event as CustomEvent<{ text?: string }>).detail
      const nextText = detail?.text?.trim()
      if (!nextText) return
      setComposerText(text ? `${text.trimEnd()}\n\n${nextText}` : nextText)
      setSlashIndex(0)
      textareaRef.current?.focus()
      window.setTimeout(() => {
        if (!textareaRef.current) return
        resizeTextarea(textareaRef.current)
        moveTextareaCursorToEnd(textareaRef.current)
      }, 0)
    }
    window.addEventListener('orchestrator:add-composer-text', onAddComposerText)
    return () => window.removeEventListener('orchestrator:add-composer-text', onAddComposerText)
  }, [session.id, text])

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
      setComposerText('')
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
      if (command.id === 'btw') {
        openSideChat(session.id, crypto.randomUUID(), 'Side chat', sideChatContextSnapshot(session, 'slash-command'))
      }
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
        className="composer-shell overflow-visible mx-auto"
        data-testid="composer-shell"
        data-drag-active={dragActive ? 'true' : 'false'}
        data-composer-attachment-status={attachmentStatus?.text ?? ''}
        data-composer-attachment-status-tone={attachmentStatus?.tone ?? ''}
        onDragEnter={handleDragEvent}
        onDragOver={handleDragEvent}
        onDragLeave={handleDragEvent}
        onDrop={handleDrop}
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
        {dragActive && (
          <div
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border text-sm font-medium"
            data-testid="composer-drop-overlay"
            style={{
              color: 'var(--accent)',
              background: 'color-mix(in srgb, var(--surface-bg) 86%, var(--accent) 14%)',
              borderColor: 'var(--accent)'
            }}
          >
            Drop files to attach
          </div>
        )}
        {showSlash && (
          <SlashCommandPalette
            query={slashQuery!}
            providerRuntime={providerRuntime}
            discoveredCommands={extensionCommands}
            onSelect={applySlashCommand}
            onDismiss={() => setComposerText('')}
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
        {(attachments.length > 0 || pendingAttachments.length > 0) && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2" aria-label="Attachments">
            {attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment)}
              />
            ))}
            {pendingAttachments.map((attachment) => (
              <PendingAttachmentChip
                key={attachment.id}
                attachment={attachment}
                onRemove={() => cancelPendingAttachment(attachment.id)}
              />
            ))}
          </div>
        )}
        {attachmentStatus && (
          <div
            className="composer-attachment-status mx-4 mb-2"
            data-testid="composer-attachment-status"
            data-composer-attachment-status-tone={attachmentStatus.tone}
            role={attachmentStatus.tone === 'danger' ? 'alert' : 'status'}
            aria-live={attachmentStatus.tone === 'danger' ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            {attachmentStatus.text}
          </div>
        )}
        {composerSendNotice && (
          <div
            className="mx-3 mb-2 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
            data-testid="composer-send-status"
            data-composer-send-state={composerSendNotice.state}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={{
              borderColor: composerSendNotice.tone === 'danger'
                ? 'color-mix(in srgb, var(--color-red) 45%, var(--border-subtle))'
                : 'var(--border-subtle)',
              background: composerSendNotice.tone === 'danger'
                ? 'color-mix(in srgb, var(--color-red) 9%, var(--surface-bg))'
                : 'var(--control-bg)',
              color: composerSendNotice.tone === 'danger' ? 'var(--color-red)' : 'var(--text-secondary)'
            }}
          >
            <span className="font-semibold" style={{ color: composerSendNotice.tone === 'danger' ? 'var(--color-red)' : 'var(--text-primary)' }}>
              {composerSendNotice.title}
            </span>
            <span className="min-w-0 flex-1 truncate">{composerSendNotice.detail}</span>
            {composerSendNotice.state === 'unsupported-permission' && (
              <button
                type="button"
                className="shrink-0 rounded-md px-1.5 py-0.5 font-semibold"
                data-testid="composer-send-status-action"
                aria-label="Change permission mode"
                onClick={() => setShowPermMenu(true)}
                style={{
                  background: 'var(--surface-bg)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)'
                }}
              >
                Change
              </button>
            )}
          </div>
        )}

        {/* Bottom toolbar */}
        <div className="composer-toolbar flex items-center px-3 pb-2 gap-1.5" data-testid="composer-toolbar">

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
                className="composer-worktree-trigger"
                ariaExpanded={isGitRepo ? showModeMenu : undefined}
                ariaHasPopup={isGitRepo ? 'menu' : undefined}
                onKeyDown={(event) => {
                  if (isGitRepo) handleDropdownTriggerKeyDown(event, () => setShowModeMenu(true))
                }}
              >
                <Icon name={effectiveMode ? 'branch' : 'folder'} size={13} />
                <span className="composer-control-label composer-control-label-sm">
                  {effectiveMode ? 'Branch' : 'Local'}
                </span>
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
            /* Active session: compact thread settings */
            <div className="relative flex items-center gap-1.5" style={{ minWidth: 0 }}>
              <ToolbarBtn
                active={showAgentMenu}
                onClick={() => setShowAgentMenu((v) => !v)}
                providerColor={provider.color}
                dataTestId="composer-agent-menu"
                className="composer-agent-trigger"
                title="Thread model settings"
                ariaLabel="Thread model settings"
                ariaExpanded={showAgentMenu}
                ariaHasPopup="menu"
                onKeyDown={(event) => handleDropdownTriggerKeyDown(event, () => setShowAgentMenu(true))}
              >
                <ProviderIcon providerId={provider.id} size={11} color={provider.color} />
                <span className="composer-control-label">{agentLabel}</span>
                <Chevron />
              </ToolbarBtn>
              {queuedFollowUpTotal > 0 && (
                <span
                  className="composer-queued-summary"
                  data-testid="composer-queued-summary"
                  data-queued-follow-up-count={queuedFollowUpCount}
                  data-steering-follow-up-count={steeringFollowUpCount}
                >
                  {queuedFollowUpLabel}
                </span>
              )}
              {showAgentMenu && (
                <DropdownPanel onClose={() => setShowAgentMenu(false)} style={{ bottom: '100%', marginBottom: 8, left: 0, minWidth: 300 }}>
                  <div
                    className="px-3 py-2"
                    data-testid="composer-active-agent-summary"
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                  >
                    <div className="flex items-center gap-2">
                      <ProviderIcon providerId={provider.id} size={12} color={provider.color} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                          {provider.name}
                        </div>
                        <div className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                          Thread settings
                        </div>
                      </div>
                    </div>
                  </div>

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

                  {provider.id === 'cursor' && hasThinking && (
                    <TieredRow label="Thinking">
                      <Chip active={!useThinking} onClick={() => update({ useThinking: false })} activeColor={provider.color}>Off</Chip>
                      <Chip active={useThinking} onClick={() => update({ useThinking: true })} activeColor={provider.color}>On</Chip>
                    </TieredRow>
                  )}

                  {provider.id === 'cursor' && hasFast && (
                    <TieredRow label="Speed">
                      <Chip active={!useFast} onClick={() => update({ useFast: false })} activeColor={provider.color}>Standard</Chip>
                      <Chip active={useFast} onClick={() => update({ useFast: true })} activeColor={provider.color}>Fast</Chip>
                    </TieredRow>
                  )}

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
                className="composer-agent-trigger"
                ariaExpanded={showAgentMenu}
                ariaHasPopup="menu"
                onKeyDown={(event) => handleDropdownTriggerKeyDown(event, () => setShowAgentMenu(true))}
              >
                <ProviderIcon providerId={provider.id} size={11} color={provider.color} />
                <span className="composer-control-label">{agentLabel}</span>
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
            <ToolbarBtn
              active={permissionMode !== defaultPermissionMode}
              onClick={() => setShowPermMenu((v) => !v)}
              dataTestId="composer-permission-menu"
              className="composer-permission-trigger"
              title={permissionTriggerTitle}
              ariaLabel={permissionTriggerLabel}
              ariaExpanded={showPermMenu}
              ariaHasPopup="menu"
              onKeyDown={(event) => handleDropdownTriggerKeyDown(event, () => setShowPermMenu(true))}
            >
              <ProviderIcon providerId={provider.id} size={11} color={provider.color} />
              <span className="composer-control-label composer-control-label-xs">{permLabel}</span>
              {permissionContext && (
                <span
                  className="composer-permission-source-badge"
                  data-testid="composer-permission-context-badge"
                  data-permission-context-status={permissionContext.status}
                  data-permission-context-source={permissionContext.source}
                >
                  {permissionSourceBadgeLabel(permissionContext)}
                </span>
              )}
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
                        onSelect={() => selectPermissionMode(opt.id)}
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
                                  onSelect={() => selectPermissionMode(opt.id)}
                                />
                              ))}
                            </div>
                          )}
                          {dangerPermissionModes.length > 0 && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border)' }}>
                              <div
                                className="mb-1.5 text-[11px] font-semibold tracking-normal"
                                data-testid="composer-permission-danger-label"
                                style={{ color: 'var(--color-red)' }}
                              >
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
                                    onSelect={() => selectPermissionMode(opt.id)}
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
                  {resolvedPermission?.execution && (
                    <PermissionExecutionChips execution={resolvedPermission.execution} />
                  )}
                  {permissionContext && permissionContext.source !== 'static' && (
                    <PermissionContextNote context={permissionContext} />
                  )}
                </div>
                {provider.id === 'claude' && showAdvancedPerms && (
                  <ClaudePermissionRules
                    allowedTools={session.allowedTools ?? []}
                    disallowedTools={session.disallowedTools ?? []}
                    availableTools={session.availableTools ?? []}
                    additionalDirs={session.additionalDirs ?? []}
                    status={permissionRulesStatus}
                    onChange={updatePermissionRules}
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

export default memo(InputBar, (prev, next) => {
  return prev.isNew === next.isNew &&
    prev.session.id === next.session.id &&
    prev.session.workDir === next.session.workDir &&
    prev.session.provider === next.session.provider &&
    prev.session.model === next.session.model &&
    prev.session.effort === next.session.effort &&
    prev.session.agentName === next.session.agentName &&
    prev.session.permissionMode === next.session.permissionMode &&
    prev.session.status === next.session.status &&
    prev.session.useWorktree === next.session.useWorktree &&
    prev.session.runtime === next.session.runtime &&
    prev.session.useThinking === next.session.useThinking &&
    prev.session.useFast === next.session.useFast &&
    shallowEqualArray(prev.session.allowedTools, next.session.allowedTools) &&
    shallowEqualArray(prev.session.disallowedTools, next.session.disallowedTools) &&
    shallowEqualArray(prev.session.availableTools, next.session.availableTools) &&
    shallowEqualArray(prev.session.additionalDirs, next.session.additionalDirs)
})

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

function PendingAttachmentChip({
  attachment,
  onRemove
}: {
  attachment: PendingAttachment
  onRemove: () => void
}): JSX.Element {
  const meta = attachment.status === 'saving'
    ? attachment.size !== undefined ? `Saving, ${formatBytes(attachment.size)}` : 'Saving'
    : 'Failed'
  return (
    <AttachmentPill
      label={attachment.name}
      title={attachment.error ?? attachment.name}
      meta={meta}
      tone={attachment.status === 'error' ? 'danger' : 'accent'}
      onRemove={onRemove}
      className="composer-pending-attachment"
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

function hasDataTransferFiles(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.files?.length > 0) return true
  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file')
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function ToolbarBtn({
  children, active, onClick, onKeyDown, muted, title, ariaLabel, ariaExpanded, ariaHasPopup, providerColor, dataTestId, className
}: {
  children: React.ReactNode
  active: boolean
  onClick?: () => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  muted?: boolean
  title?: string
  ariaLabel?: string
  ariaExpanded?: boolean
  ariaHasPopup?: 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog'
  providerColor?: string
  dataTestId?: string
  className?: string
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
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      onKeyDown={onKeyDown}
      data-tooltip-label={title}
      data-native-title-free="true"
      data-testid={dataTestId}
      className={`flex items-center gap-1.5 text-xs transition-colors ${className ?? ''}`}
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
  children, onClose, style, testId = 'composer-dropdown-surface'
}: {
  children: React.ReactNode
  onClose: () => void
  style: React.CSSProperties
  testId?: string
}): JSX.Element {
  return (
    <DismissablePopoverSurface
      className="absolute z-50 composer-dropdown-surface"
      onClose={onClose}
      style={{
        border: '0.5px solid var(--border-subtle)',
        borderRadius: 12,
        background: 'color-mix(in srgb, var(--surface-bg) 90%, transparent)',
        boxShadow: 'var(--shadow-menu)',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
        maxWidth: 'min(420px, calc(100vw - 16px))',
        maxHeight: 'min(360px, calc(100vh - 16px))',
        ...style
      }}
    >
      <div
        data-testid={testId}
        data-composer-dropdown-surface="true"
        onKeyDown={handleDropdownSurfaceKeyDown}
      >
        {children}
      </div>
    </DismissablePopoverSurface>
  )
}

function handleDropdownTriggerKeyDown(
  event: React.KeyboardEvent<HTMLButtonElement>,
  openDropdown: () => void
): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  event.stopPropagation()
  const trigger = event.currentTarget
  openDropdown()
  window.setTimeout(() => {
    focusComposerDropdownButton(trigger, event.key === 'ArrowUp' ? 'last' : 'first')
  }, 0)
}

function handleDropdownSurfaceKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
  const root = event.currentTarget
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !root.contains(active)) return

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    event.stopPropagation()
  } else {
    return
  }

  const buttons = composerDropdownButtons(root)
  if (buttons.length === 0) return

  const activeIndex = buttons.findIndex((button) => button === active || button.contains(active))
  if (event.key === 'Home') {
    buttons[0]?.focus({ preventScroll: true })
    return
  }
  if (event.key === 'End') {
    buttons.at(-1)?.focus({ preventScroll: true })
    return
  }

  const offset = event.key === 'ArrowUp' ? -1 : 1
  const nextIndex = activeIndex >= 0
    ? (activeIndex + offset + buttons.length) % buttons.length
    : (offset < 0 ? buttons.length - 1 : 0)
  buttons[nextIndex]?.focus({ preventScroll: true })
}

function focusComposerDropdownButton(trigger: HTMLElement, position: 'first' | 'last'): void {
  const owner = trigger.closest('.relative') ?? trigger.parentElement
  const surface = owner?.querySelector('[data-composer-dropdown-surface="true"]')
  if (!(surface instanceof HTMLElement)) return
  const buttons = composerDropdownButtons(surface)
  const target = position === 'last' ? buttons.at(-1) : buttons[0]
  target?.focus({ preventScroll: true })
}

function composerDropdownButtons(root: ParentNode): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll('button'))
    .filter((button): button is HTMLButtonElement =>
      button instanceof HTMLButtonElement &&
      !button.disabled &&
      button.tabIndex !== -1 &&
      button.offsetParent !== null
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
  status,
  onChange
}: {
  allowedTools: string[]
  disallowedTools: string[]
  availableTools: string[]
  additionalDirs: string[]
  status: string | null
  onChange: (label: string, patch: {
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
    <div
      className="px-3 py-2 space-y-1.5"
      data-testid="composer-permission-rules"
      style={{ borderTop: '1px solid var(--color-border)' }}
    >
      <div style={rowStyle}>
        <label htmlFor="composer-permission-allow-tools" style={labelStyle}>Allow</label>
        <input
          id="composer-permission-allow-tools"
          data-testid="composer-permission-allow-tools"
          defaultValue={allowedTools.join(', ')}
          placeholder="Read, Edit"
          onBlur={(event) => onChange('Allowed tools', { allowedTools: parseListInput(event.currentTarget.value) })}
          style={inputStyle}
        />
      </div>
      <div style={rowStyle}>
        <label htmlFor="composer-permission-deny-tools" style={labelStyle}>Deny</label>
        <input
          id="composer-permission-deny-tools"
          data-testid="composer-permission-deny-tools"
          defaultValue={disallowedTools.join(', ')}
          placeholder="Bash(git push)"
          onBlur={(event) => onChange('Denied tools', { disallowedTools: parseListInput(event.currentTarget.value) })}
          style={inputStyle}
        />
      </div>
      <div style={rowStyle}>
        <label htmlFor="composer-permission-available-tools" style={labelStyle}>Tools</label>
        <input
          id="composer-permission-available-tools"
          data-testid="composer-permission-available-tools"
          defaultValue={availableTools.join(', ')}
          placeholder="default"
          onBlur={(event) => onChange('Available tools', { availableTools: parseListInput(event.currentTarget.value) })}
          style={inputStyle}
        />
      </div>
      <div style={rowStyle}>
        <label htmlFor="composer-permission-additional-dirs" style={labelStyle}>Dirs</label>
        <input
          id="composer-permission-additional-dirs"
          data-testid="composer-permission-additional-dirs"
          defaultValue={additionalDirs.join(', ')}
          placeholder="/tmp/shared"
          onBlur={(event) => onChange('Additional dirs', { additionalDirs: parseListInput(event.currentTarget.value) })}
          style={inputStyle}
        />
      </div>
      {status && (
        <div
          className="rounded-md px-1.5 py-1 text-[10.5px]"
          data-testid="composer-permission-rules-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{
            color: 'var(--accent)',
            background: 'color-mix(in srgb, var(--accent) 8%, var(--surface-bg))',
            border: '1px solid color-mix(in srgb, var(--accent) 20%, var(--border-subtle))'
          }}
        >
          {status}
        </div>
      )}
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
        className="shrink-0 pt-0.5 text-[11px] font-semibold tracking-normal"
        data-testid="composer-agent-row-label"
        style={{ color: 'var(--color-text-muted)', width: 52 }}
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

function PermissionExecutionChips({ execution }: { execution: PermissionExecutionContract }): JSX.Element {
  const chips = permissionExecutionLabels(execution)
  if (chips.length === 0) return <></>
  return (
    <div
      data-testid="composer-permission-execution-contract"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 5,
        marginTop: 8
      }}
    >
      {chips.map((chip) => (
        <span
          key={`${chip.label}:${chip.value}`}
          style={{
            minWidth: 0,
            maxWidth: 170,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            border: '1px solid var(--color-border)',
            borderRadius: 7,
            padding: '3px 6px',
            fontSize: 10,
            color: 'var(--color-text-muted)',
            background: 'var(--color-surface)'
          }}
          title={`${chip.label}: ${chip.value}`}
        >
          {chip.label} {chip.value}
        </span>
      ))}
    </div>
  )
}

function PermissionContextNote({ context }: { context: ProviderPermissionRuntimeContext }): JSX.Element {
  const tone = context.status === 'ok'
    ? 'var(--color-green)'
    : context.status === 'error'
      ? 'var(--color-red)'
      : 'var(--color-text-muted)'
  return (
    <div
      data-testid="composer-permission-runtime-context"
      style={{
        marginTop: 7,
        fontSize: 10.5,
        lineHeight: 1.35,
        color: tone,
        maxWidth: 280
      }}
      title={context.cwd ? `${context.summary ?? ''} ${context.cwd}` : context.summary}
    >
      {context.status === 'ok' ? 'Live config' : 'Config fallback'} · {context.summary ?? 'Permission config checked.'}
    </div>
  )
}

function permissionSourceBadgeLabel(context: ProviderPermissionRuntimeContext): string {
  if (context.status === 'ok') return 'Live'
  if (context.source === 'app-server') return 'Fallback'
  return 'Static'
}

function permissionExecutionLabels(execution: PermissionExecutionContract): Array<{ label: string; value: string }> {
  return [
    execution.nativeMode ? { label: 'Mode', value: execution.nativeMode } : null,
    execution.approvalPolicy ? { label: 'Approval', value: execution.approvalPolicy } : null,
    execution.approvalsReviewer && execution.approvalsReviewer !== 'user' ? { label: 'Reviewer', value: execution.approvalsReviewer } : null,
    execution.sandboxMode ? { label: 'Sandbox', value: execution.sandboxMode } : null,
    execution.toolPolicy ? { label: 'Tools', value: execution.toolPolicy } : null,
    execution.configSource ? { label: 'Source', value: execution.configSource } : null
  ].filter((chip): chip is { label: string; value: string } => Boolean(chip))
}

function filterPermissionModes(
  modes: ProviderPermissionMode[],
  context: ProviderPermissionRuntimeContext | null,
  selectedPolicy: string
): ProviderPermissionMode[] {
  if (!context || context.status !== 'ok' || !context.visiblePolicies || context.visiblePolicies.length === 0) return modes
  const visible = new Set(context.visiblePolicies)
  return modes.filter((mode) => visible.has(mode.id) || mode.id === selectedPolicy)
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

function shallowEqualArray<T>(a?: T[], b?: T[]): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
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
  const button = (
    <button
      onClick={onClick}
      disabled={disabled}
      data-tooltip-label={title}
      data-native-title-free="true"
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
  return title ? <Tooltip label={title}>{button}</Tooltip> : button
}
