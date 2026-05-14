import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import Icon from '../shared/Icon'
import {
  Button,
  DisclosureSection,
  IconButton,
  StatusBadge,
  SurfaceRow,
} from '../shared/designSystem'
import {
  describeToolAction,
  describeToolActivity,
  extractFileReferences,
  extractWorkspaceRootsFromText,
  pairToolActivities,
  permissionSummary,
  summarizeToolActivities
} from '../../types'
import type { Session, ChatMessage, FileReference, ResultMessage, ToolResultMessage, ToolUseMessage, UserInputQuestion } from '../../types'
import type { Attachment } from '../../types'

type PreferredEditor = 'system' | 'vscode' | 'vscode-insiders' | 'cursor' | 'zed'

interface Props {
  session: Session
  projectName?: string
  onSuggestedPrompt?: (prompt: string) => void
}

const SUGGESTED_PROMPTS = [
  'Explain the structure of this codebase',
  'Find and fix any TypeScript errors',
  'Write tests for the main module',
  'Refactor the largest file for readability'
]

const TOOL_SUMMARY_SCROLL_THRESHOLD = 8
const TOOL_SUMMARY_MAX_HEIGHT = 220
const FOLLOW_BOTTOM_THRESHOLD = 80
const USER_MESSAGE_COLLAPSE_LENGTH = 1400
const USER_MESSAGE_COLLAPSE_MIN_BREAK = 980

export default function ChatView({ session, projectName, onSuggestedPrompt }: Props): JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const shouldFollowBottomRef = useRef(true)
  const pendingScrollFrameRef = useRef<number | null>(null)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [preferredEditor, setPreferredEditor] = useState<PreferredEditor>('system')
  const transcriptItems = groupTranscriptMessages(session.messages)
  const fileReferenceRoots = useMemo(() => sessionFileReferenceRoots(session), [session])
  const lastMessage = session.messages[session.messages.length - 1]
  const lastTextLength = lastMessage?.type === 'text' ? lastMessage.content.length : 0
  const lastAssistantTextId = useMemo(() => {
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
      const message = session.messages[index]
      if (message.type === 'text' && message.role === 'assistant' && message.content.trim()) return message.id
    }
    return null
  }, [session.messages])

  useEffect(() => {
    let cancelled = false
    window.api.settings.get().then((settings) => {
      if (cancelled) return
      setPreferredEditor(normalizePreferredEditor(settings.preferredEditor))
    })
    return () => { cancelled = true }
  }, [])

  const setFollowingBottom = useCallback((isFollowing: boolean) => {
    const shouldShowJumpButton = !isFollowing
    shouldFollowBottomRef.current = isFollowing
    setShowJumpToLatest((current) => current === shouldShowJumpButton ? current : shouldShowJumpButton)
  }, [])

  const scrollToBottom = useCallback((force = false) => {
    if (force) setFollowingBottom(true)
    if (pendingScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingScrollFrameRef.current)
    }
    pendingScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingScrollFrameRef.current = null
      if (!force && !shouldFollowBottomRef.current) return
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    })
  }, [setFollowingBottom])

  const handleScroll = useCallback(() => {
    const scroller = scrollContainerRef.current
    if (!scroller) return
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    setFollowingBottom(distanceFromBottom <= FOLLOW_BOTTOM_THRESHOLD)
  }, [setFollowingBottom])

  useEffect(() => {
    setFollowingBottom(true)
    scrollToBottom(true)
  }, [scrollToBottom, session.id, setFollowingBottom])

  useEffect(() => {
    if (!shouldFollowBottomRef.current) return
    scrollToBottom()
  }, [session.messages.length, lastTextLength, scrollToBottom])

  useEffect(() => {
    return () => {
      if (pendingScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingScrollFrameRef.current)
      }
    }
  }, [])

  // Hero state: no messages yet
  if (session.messages.length === 0 && session.status !== 'running') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-8" style={{ background: 'var(--canvas-bg)' }}>
        <h1
          className="text-3xl font-semibold text-center mb-7 leading-tight"
          style={{ color: 'var(--text-primary)', maxWidth: 560, fontSize: 30 }}
        >
          {projectName ? `What do you want to build in ${projectName}?` : 'What do you want to build?'}
        </h1>
        <div className="grid grid-cols-2 gap-2.5 w-full" style={{ maxWidth: 500 }}>
          {SUGGESTED_PROMPTS.map((prompt, index) => (
            <SurfaceRow
              as="button"
              key={prompt}
              onClick={() => onSuggestedPrompt?.(prompt)}
              index={index}
              className="text-left px-4 py-3 text-sm"
              style={{
                background: 'var(--surface-bg)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                color: 'var(--text-secondary)',
                lineHeight: 1.4
              }}
            >
              {prompt}
            </SurfaceRow>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative flex-1 min-h-0 min-w-0"
      style={{ background: 'var(--canvas-bg)' }}
    >
      <div
        data-testid="transcript-scroll"
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="h-full min-w-0 overflow-y-auto overflow-x-hidden px-6 py-5"
        style={{ userSelect: 'text' }}
      >
        <div
          className="mx-auto flex min-w-0 flex-col"
          style={{
            maxWidth: 'min(920px, 100%)',
            gap: 'var(--transcript-gap, 14px)'
          }}
        >
          {transcriptItems.map((item) => (
            item.type === 'tool_group'
              ? <ToolActivitySummary key={item.id} messages={item.messages} />
              : (
                <MessageRow
                  key={item.message.id}
                  msg={item.message}
                  session={session}
                  fileReferenceRoots={fileReferenceRoots}
                  canCopy={item.message.id === lastAssistantTextId}
                />
              )
          ))}
          {session.status === 'running' && <ThinkingIndicator />}
          <div ref={bottomRef} />
        </div>
      </div>
      {showJumpToLatest && (
        <Button
          dataTestId="jump-to-latest"
          onClick={() => scrollToBottom(true)}
          variant="primary"
          className="absolute bottom-4 right-6 rounded-full shadow-sm"
          style={{
            border: '1px solid rgba(255,255,255,0.16)'
          }}
        >
          Jump to latest
        </Button>
      )}
    </div>
  )
}

type TranscriptItem =
  | { type: 'message'; message: ChatMessage }
  | { type: 'tool_group'; id: string; messages: Array<ToolUseMessage | ToolResultMessage> }

function groupTranscriptMessages(messages: ChatMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  let pendingTools: Array<ToolUseMessage | ToolResultMessage> = []

  const flushTools = (): void => {
    if (pendingTools.length === 0) return
    items.push({
      type: 'tool_group',
      id: `tools-${pendingTools[0].id}-${pendingTools[pendingTools.length - 1].id}`,
      messages: pendingTools
    })
    pendingTools = []
  }

  for (const message of messages) {
    if (message.type === 'tool_use' || message.type === 'tool_result') {
      pendingTools.push(message)
      continue
    }
    flushTools()
    items.push({ type: 'message', message })
  }
  flushTools()

  return items
}

function CopyButton({ getText }: { getText: () => string }): JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(getText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }, [getText])

  return (
    <IconButton
      icon={copied ? 'check' : 'copy'}
      label={copied ? 'Copied' : 'Copy'}
      size="sm"
      tone={copied ? 'success' : 'neutral'}
      onClick={handleCopy}
      style={{
        opacity: copied ? 1 : 0.55
      }}
    />
  )
}

function makeMarkdownComponents(isUser: boolean): Components {
  return {
    // Code blocks
    code({ className, children, ...props }) {
      const isBlock = className?.startsWith('language-')
      const lang = className?.replace('language-', '') ?? ''
      if (!isBlock) {
        return (
          <code
            style={{
              background: isUser ? 'rgba(0,0,0,0.08)' : 'var(--control-bg)',
              borderRadius: 3,
              padding: '1px 4px',
              fontSize: '0.85em',
              fontFamily: 'monospace',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word'
            }}
            {...props}
          >
            {children}
          </code>
        )
      }
      return (
        <div style={{ position: 'relative', margin: '8px 0', maxWidth: '100%', minWidth: 0, overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              minWidth: 0,
              padding: '4px 10px',
              background: 'var(--color-surface)',
              borderRadius: '6px 6px 0 0',
              borderBottom: '1px solid var(--color-border)'
            }}
          >
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
              {lang || 'code'}
            </span>
          </div>
          <pre
            style={{
              margin: 0,
              padding: '10px 12px',
              width: '100%',
              maxWidth: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
              background: 'var(--color-surface)',
              borderRadius: '0 0 6px 6px',
              overflowX: 'auto',
              overflowY: 'hidden',
              fontSize: '0.82em',
              lineHeight: 1.5
            }}
          >
            <code
              className={className}
              style={{ display: 'block', minWidth: 'max-content' }}
              {...props}
            >
              {children}
            </code>
          </pre>
        </div>
      )
    },
    // Paragraphs — no extra margin inside bubbles
    p({ children }) {
      return <p style={{ margin: '4px 0', lineHeight: 1.6 }}>{children}</p>
    },
    // Lists
    ul({ children }) {
      return <ul style={{ margin: '4px 0', paddingLeft: 18, lineHeight: 1.6 }}>{children}</ul>
    },
    ol({ children }) {
      return <ol style={{ margin: '4px 0', paddingLeft: 18, lineHeight: 1.6 }}>{children}</ol>
    },
    li({ children }) {
      return <li style={{ margin: '2px 0' }}>{children}</li>
    },
    // Headings
    h1({ children }) { return <h1 style={{ fontSize: '1.15em', fontWeight: 700, margin: '8px 0 4px' }}>{children}</h1> },
    h2({ children }) { return <h2 style={{ fontSize: '1.05em', fontWeight: 600, margin: '8px 0 4px' }}>{children}</h2> },
    h3({ children }) { return <h3 style={{ fontSize: '1em', fontWeight: 600, margin: '6px 0 2px' }}>{children}</h3> },
    // Blockquote
    blockquote({ children }) {
      return (
        <blockquote
          style={{
            borderLeft: '3px solid var(--color-border)',
            paddingLeft: 10,
            margin: '6px 0',
            color: 'var(--color-text-muted)',
            fontStyle: 'italic'
          }}
        >
          {children}
        </blockquote>
      )
    },
    // Horizontal rule
    hr() {
      return <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '8px 0' }} />
    },
    // Table
    table({ children }) {
      return (
        <div style={{ overflowX: 'hidden', maxWidth: '100%', minWidth: 0, margin: '6px 0' }}>
          <table
            style={{
              borderCollapse: 'collapse',
              fontSize: '0.9em',
              width: '100%',
              maxWidth: '100%',
              tableLayout: 'fixed'
            }}
          >
            {children}
          </table>
        </div>
      )
    },
    th({ children }) {
      return (
        <th
          style={{
            padding: '4px 8px',
            borderBottom: '1px solid var(--color-border)',
            textAlign: 'left',
            fontWeight: 600,
            verticalAlign: 'top',
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            wordBreak: 'normal'
          }}
        >
          {children}
        </th>
      )
    },
    td({ children }) {
      return (
        <td
          style={{
            padding: '4px 8px',
            borderBottom: '1px solid var(--color-border)',
            verticalAlign: 'top',
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            wordBreak: 'normal'
          }}
        >
          {children}
        </td>
      )
    },
    // Strong / em
    strong({ children }) { return <strong style={{ fontWeight: 700 }}>{children}</strong> },
    em({ children }) { return <em style={{ fontStyle: 'italic' }}>{children}</em> },
    // Links — open externally
    a({ href, children }) {
      return (
        <a
          href={href}
          onClick={(e) => { e.preventDefault(); if (href) window.open(href) }}
          style={{ color: isUser ? 'rgba(255,255,255,0.85)' : 'var(--color-accent)', textDecoration: 'underline', cursor: 'pointer' }}
        >
          {children}
        </a>
      )
    }
  }
}

const assistantComponents = makeMarkdownComponents(false)
const userComponents = makeMarkdownComponents(true)

function MessageRow({
  msg,
  session,
  fileReferenceRoots,
  canCopy
}: {
  msg: ChatMessage
  session: Session
  fileReferenceRoots: string[]
  canCopy: boolean
}): JSX.Element | null {
  const [isUserMessageExpanded, setIsUserMessageExpanded] = useState(false)

  if (msg.type === 'text') {
    const isUser = msg.role === 'user'
    const isSystem = msg.role === 'system'

    if (isSystem) {
      return (
        <div className="flex justify-center">
          <span className="text-xs px-3 py-1 rounded-full" style={{ background: 'var(--color-surface2)', color: 'var(--color-text-muted)' }}>
            {msg.content.slice(0, 120)}
          </span>
        </div>
      )
    }

    const content = msg.content
    const shouldCollapseUserMessage = isUser && content.length > USER_MESSAGE_COLLAPSE_LENGTH
    const displayContent = shouldCollapseUserMessage && !isUserMessageExpanded
      ? collapsedUserMessageContent(content)
      : content
    const queueState = isUser ? msg.queueState : undefined
    const fileReferences = !isUser && !isSystem
      ? extractFileReferences(content, session.workDir).slice(0, 8)
      : []
    return (
      <div
        className={`flex min-w-0 w-full ${isUser ? 'justify-end' : 'justify-start'}`}
      >
        <div
          className="min-w-0"
          style={{
            maxWidth: isUser ? '78%' : '100%',
            width: isUser ? 'auto' : '100%',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          <div
            className={`min-w-0 break-words ${isUser ? 'px-4 py-3 pr-9' : 'pr-8 py-1'}`}
            style={{
              background: isUser ? 'var(--control-bg-active)' : 'transparent',
              color: 'var(--text-primary)',
              overflowWrap: 'anywhere',
              borderRadius: isUser ? 'var(--radius-xl)' : undefined,
              border: isUser ? '1px solid var(--border-subtle)' : 'none',
              fontSize: 'var(--transcript-font-size, 14px)',
              lineHeight: 1.65
            }}
          >
            {shouldCollapseUserMessage && !isUserMessageExpanded ? (
              <div style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</div>
            ) : (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={isUser ? userComponents : assistantComponents}
              >
                {displayContent}
              </ReactMarkdown>
            )}
            {msg.isStreaming && (
              <span
                aria-label="Streaming"
                className="inline-block align-baseline"
                style={{ color: 'var(--color-accent)', marginLeft: 2 }}
              >
                |
              </span>
            )}
            {fileReferences.length > 0 && <FileReferenceList files={fileReferences} cwd={session.workDir} searchRoots={fileReferenceRoots} preferredEditor={preferredEditor} />}
            {isUser && msg.attachments && msg.attachments.length > 0 && <MessageAttachmentList attachments={msg.attachments} />}
            {shouldCollapseUserMessage && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsUserMessageExpanded((expanded) => !expanded)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    background: 'color-mix(in srgb, var(--accent) 10%, var(--control-bg))',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-secondary)'
                  }}
                  aria-expanded={isUserMessageExpanded}
                >
                  <span>{isUserMessageExpanded ? 'Show less' : 'Show more'}</span>
                  <span style={{ transform: isUserMessageExpanded ? 'rotate(180deg)' : undefined, display: 'inline-flex' }}>
                    <Icon name="chevronDown" size={12} />
                  </span>
                </button>
              </div>
            )}
            {queueState && (
              <div className="mt-2 flex items-center justify-end gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: 'rgba(255,255,255,0.16)', color: 'rgba(255,255,255,0.82)' }}
                >
                  {queueState === 'steer_next' ? 'Steering next' : 'Queued'}
                </span>
                {queueState === 'queued' && (
                  <button
                    type="button"
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: 'rgba(255,255,255,0.9)', color: 'var(--color-accent)' }}
                    title="Send after the current tool call completes"
                    onClick={() => window.api.sessions.steerQueuedMessage(session.id, msg.id)}
                  >
                    Steer
                  </button>
                )}
              </div>
            )}
          </div>
          {canCopy && (
            <div
              style={{
                position: 'absolute',
                top: 2,
                right: 0
              }}
            >
              <CopyButton getText={() => content} />
            </div>
          )}
        </div>
      </div>
    )
  }

  if (msg.type === 'result') {
    if (msg.subtype === 'waiting_for_user') {
      return <UserInputCard msg={msg} sessionId={session.id} sessionStatus={session.status} />
    }
    if (msg.permissionDenials && msg.permissionDenials.length > 0) {
      return <PermissionCard msg={msg} sessionId={session.id} sessionStatus={session.status} />
    }
    if (msg.subtype === 'status') {
      return <StatusCard content={msg.content} />
    }
    if (msg.subtype === 'success') return null
    return (
      <div className="flex justify-center">
        <span
          className="text-xs px-3 py-1 rounded-full"
          style={{ background: '#2d1a1a', color: 'var(--color-red)' }}
        >
          ✗ Error{msg.content ? ` — ${msg.content.slice(0, 80)}` : ''}
        </span>
      </div>
    )
  }

  return null
}

function collapsedUserMessageContent(content: string): string {
  const hardCut = content.slice(0, USER_MESSAGE_COLLAPSE_LENGTH)
  const lastNewline = hardCut.lastIndexOf('\n')
  const lastSpace = hardCut.lastIndexOf(' ')
  const breakIndex = Math.max(lastNewline, lastSpace)
  const cutIndex = breakIndex >= USER_MESSAGE_COLLAPSE_MIN_BREAK ? breakIndex : USER_MESSAGE_COLLAPSE_LENGTH
  return `${content.slice(0, cutIndex).trimEnd()}\n...`
}

type StatusMeta = {
  label: string
  tone: string
  icon: JSX.Element
}

function StatusCard({ content }: { content: string }): JSX.Element {
  const meta = statusMeta(content)
  return (
    <div className="flex justify-start min-w-0 w-full">
      <SurfaceRow
        className="flex min-w-0 items-start gap-2 rounded-md px-3 py-2 text-xs"
        style={{
          maxWidth: 'min(680px, 100%)',
          background: 'var(--color-surface2)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)'
        }}
      >
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded" style={{ color: meta.tone, background: 'var(--color-surface)' }}>
          {meta.icon}
        </span>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-normal" style={{ color: meta.tone }}>
            {meta.label}
          </div>
          <div className="mt-0.5" style={{ color: 'var(--color-text)', overflowWrap: 'anywhere' }}>
            {statusBody(content)}
          </div>
        </div>
      </SurfaceRow>
    </div>
  )
}

function statusBody(content: string): string {
  if (/^Diff updated/i.test(content)) return content
  const stripped = content.replace(/^(Goal|Auto-review|MCP progress|Reasoning|Patch updated|Thread compacted|Context compacted|Thread status|Thread renamed|Thread closed|Turn started|Hook started|Hook completed|Realtime|Model rerouted|Model verification|Codex warning|Codex guardian warning|Codex deprecation notice|Codex config warning):?\s*/i, '')
  return stripped.trim() || content
}

function statusMeta(content: string): StatusMeta {
  const lower = content.toLowerCase()
  if (lower.startsWith('goal')) return { label: 'Goal', tone: 'var(--color-accent)', icon: iconPath('target') }
  if (lower.startsWith('diff updated') || lower.startsWith('patch updated')) return { label: 'Changes', tone: 'var(--color-green)', icon: iconPath('diff') }
  if (lower.startsWith('auto-review') || lower.includes('review mode')) return { label: 'Review', tone: 'var(--color-yellow)', icon: iconPath('review') }
  if (lower.startsWith('mcp')) return { label: 'MCP', tone: 'var(--color-accent)', icon: iconPath('plug') }
  if (lower.startsWith('reasoning')) return { label: 'Reasoning', tone: 'var(--color-text-muted)', icon: iconPath('spark') }
  if (lower.includes('warning') || lower.includes('error')) return { label: 'Notice', tone: 'var(--color-yellow)', icon: iconPath('warning') }
  if (lower.startsWith('thread') || lower.startsWith('turn') || lower.startsWith('hook')) return { label: 'Run', tone: 'var(--color-text-muted)', icon: iconPath('activity') }
  if (lower.startsWith('realtime')) return { label: 'Realtime', tone: 'var(--color-accent)', icon: iconPath('wave') }
  return { label: 'Status', tone: 'var(--color-text-muted)', icon: iconPath('activity') }
}

function iconPath(kind: 'target' | 'diff' | 'review' | 'plug' | 'spark' | 'warning' | 'activity' | 'wave'): JSX.Element {
  const paths: Record<typeof kind, string> = {
    target: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm0 2.25a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z',
    diff: 'M4.75 2a.75.75 0 0 1 .75.75V5h2.25a.75.75 0 0 1 0 1.5H5.5v2.25a.75.75 0 0 1-1.5 0V6.5H1.75a.75.75 0 0 1 0-1.5H4V2.75A.75.75 0 0 1 4.75 2Zm5.5 7.5h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1 0-1.5Z',
    review: 'M2.75 2A1.75 1.75 0 0 0 1 3.75v8.5C1 13.216 1.784 14 2.75 14h10.5A1.75 1.75 0 0 0 15 12.25v-8.5A1.75 1.75 0 0 0 13.25 2H2.75Zm1 3h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 3h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1 0-1.5Z',
    plug: 'M5 1.75a.75.75 0 0 1 1.5 0V4h3V1.75a.75.75 0 0 1 1.5 0V4h.75a.75.75 0 0 1 0 1.5H11v1.25A3.75 3.75 0 0 1 8.75 10.2v2.05a.75.75 0 0 1-1.5 0V10.2A3.75 3.75 0 0 1 5 6.75V5.5h-.75a.75.75 0 0 1 0-1.5H5V1.75Z',
    spark: 'M8 1.5 9.25 5.7 13.5 7 9.25 8.3 8 12.5 6.75 8.3 2.5 7l4.25-1.3L8 1.5Z',
    warning: 'M7.16 2.33a1 1 0 0 1 1.68 0l6.02 9.52A1 1 0 0 1 14.02 13H1.98a1 1 0 0 1-.84-1.15l6.02-9.52ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm0 6a.8.8 0 1 0 0-1.6.8.8 0 0 0 0 1.6Z',
    activity: 'M1.75 8.75h2.5l1.25-4 2.5 7.5 2-5h4.25a.75.75 0 0 0 0-1.5H9l-.9 2.25-2.7-8.1-2.25 7.35h-1.4a.75.75 0 0 0 0 1.5Z',
    wave: 'M1.5 8c1.2-2.1 2.4-2.1 3.6 0s2.4 2.1 3.6 0 2.4-2.1 3.6 0 2.4 2.1 3.6 0v2c-1.2 2.1-2.4 2.1-3.6 0s-2.4-2.1-3.6 0-2.4 2.1-3.6 0-2.4-2.1-3.6 0V8Z'
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={paths[kind]} />
    </svg>
  )
}

function MessageAttachmentList({ attachments }: { attachments: Attachment[] }): JSX.Element {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {attachments.map((attachment) => (
        <span
          key={attachment.id}
          className="inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-[10px]"
          style={{ background: 'rgba(255,255,255,0.16)', color: 'rgba(255,255,255,0.84)' }}
          title={attachment.kind === 'local_file' ? attachment.path : `${attachment.fileId}:${attachment.relativePath}`}
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0">
            <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Z" />
          </svg>
          <span className="min-w-0 truncate">{attachment.kind === 'local_file' ? attachment.name : attachment.name ?? attachment.relativePath}</span>
        </span>
      ))}
    </div>
  )
}

function FileReferenceList({ files, cwd, searchRoots, preferredEditor }: { files: FileReference[]; cwd: string; searchRoots: string[]; preferredEditor: PreferredEditor }): JSX.Element {
  return (
    <div className="mt-3 space-y-1.5" aria-label="Referenced files">
      {files.map((file) => (
        <FileReferenceCard key={file.path} file={file} cwd={cwd} searchRoots={searchRoots} preferredEditor={preferredEditor} />
      ))}
    </div>
  )
}

function FileReferenceCard({ file, cwd, searchRoots, preferredEditor }: { file: FileReference; cwd: string; searchRoots: string[]; preferredEditor: PreferredEditor }): JSX.Element {
  const [exists, setExists] = useState<boolean | null>(null)
  const [resolvedPath, setResolvedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const displayPath = resolvedPath ?? file.path
  const displayLabel = resolvedPath ? fileName(resolvedPath) : file.label

  useEffect(() => {
    let cancelled = false
    setExists(null)
    setResolvedPath(null)
    setError(null)

    const resolve = async (): Promise<void> => {
      try {
        const stat = await window.api.fs.statPath(file.path)
        if (cancelled) return
        if (stat.exists) {
          setResolvedPath(file.path)
          setExists(true)
          return
        }

        for (const root of uniqueRoots(cwd, searchRoots)) {
          const workspacePath = await window.api.fs.resolveWorkspaceFileReference(root, file.path)
          if (cancelled) return
          if (workspacePath) {
            setResolvedPath(workspacePath)
            setExists(true)
            return
          }
        }

        setExists(false)
      } catch {
        if (!cancelled) setExists(false)
      }
    }

    void resolve()
    return () => { cancelled = true }
  }, [cwd, file.path, searchRoots])

  const openPath = async (): Promise<void> => {
    setError(null)
    const result = await window.api.fs.openPath(displayPath)
    if (result) setError(result)
  }

  const revealPath = async (): Promise<void> => {
    setError(null)
    await window.api.fs.showInFolder(displayPath)
  }

  return (
    <div
      className="rounded-lg px-3 py-2 text-xs"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text)'
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--color-accent)', flexShrink: 0 }}>
          <path d="M2 1.75C2 .784 2.784 0 3.75 0h5.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16h-8.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V5h-2.75A1.75 1.75 0 0 1 8 3.25V1.5Zm5.75.06v1.69c0 .138.112.25.25.25h1.69Z" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{displayLabel}</div>
          <div className="truncate" style={{ color: 'var(--color-text-muted)', fontSize: 10 }} title={displayPath}>
            {displayPath}
          </div>
        </div>
        {exists === false && (
          <span className="shrink-0" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
            missing
          </span>
        )}
        <button
          type="button"
          onClick={openPath}
          disabled={exists === false}
          className="shrink-0 rounded-md px-2 py-1 transition-colors"
          style={{
            color: exists === false ? 'var(--color-text-muted)' : 'var(--color-accent)',
            background: 'transparent',
            border: '1px solid var(--color-border)',
            opacity: exists === false ? 0.5 : 1
          }}
        >
          {openButtonLabel(preferredEditor)}
        </button>
        <button
          type="button"
          onClick={revealPath}
          disabled={exists === false}
          className="shrink-0 rounded-md px-2 py-1 transition-colors"
          style={{
            color: exists === false ? 'var(--color-text-muted)' : 'var(--color-text)',
            background: 'transparent',
            border: '1px solid var(--color-border)',
            opacity: exists === false ? 0.5 : 1
          }}
        >
          Reveal
        </button>
      </div>
      {error && (
        <div className="mt-1" style={{ color: 'var(--color-red)', fontSize: 10 }}>
          {error}
        </div>
      )}
    </div>
  )
}

function fileName(filePath: string): string {
  return filePath.split('/').filter(Boolean).at(-1) ?? filePath
}

function normalizePreferredEditor(value: unknown): PreferredEditor {
  return value === 'vscode' || value === 'vscode-insiders' || value === 'cursor' || value === 'zed'
    ? value
    : 'system'
}

function openButtonLabel(editor: PreferredEditor): string {
  switch (editor) {
    case 'cursor':
      return 'Open in Cursor'
    case 'vscode':
      return 'Open in VS Code'
    case 'vscode-insiders':
      return 'Open in Insiders'
    case 'zed':
      return 'Open in Zed'
    case 'system':
      return 'Open'
  }
}

function uniqueRoots(cwd: string, roots: string[]): string[] {
  return [...new Set([cwd, ...roots].filter(Boolean).map((root) => root.replace(/\/+$/, '')))]
}

function sessionFileReferenceRoots(session: Session): string[] {
  const roots = new Set<string>()
  roots.add(session.workDir)
  for (const dir of session.additionalDirs ?? []) roots.add(dir)

  for (const message of session.messages.slice(-80)) {
    const content = fileReferenceSearchContent(message)
    if (!content) continue
    for (const root of extractWorkspaceRootsFromText(content, session.workDir)) {
      roots.add(root)
    }
  }

  return [...roots]
}

function fileReferenceSearchContent(message: ChatMessage): string | null {
  if (message.type === 'text' || message.type === 'tool_result') return message.content
  if (message.type === 'tool_use') return JSON.stringify(message.toolInput)
  return null
}

function ToolActivitySummary({ messages }: { messages: Array<ToolUseMessage | ToolResultMessage> }): JSX.Element {
  const activities = pairToolActivities(messages)
  const orphanResults = messages.filter((message): message is ToolResultMessage => message.type === 'tool_result' && !activities.some((activity) => activity.result?.id === message.id))
  const hasErrors = activities.some((activity) => activity.result?.isError) || orphanResults.some((result) => result.isError)
  const summary = summarizeToolActivities(activities, orphanResults)
  const rowCount = activities.length + orphanResults.length
  const shouldScroll = rowCount > TOOL_SUMMARY_SCROLL_THRESHOLD

  return (
    <div className="flex justify-start min-w-0 w-full">
      <div className="w-full min-w-0" style={{ maxWidth: 'min(760px, 100%)' }}>
        <DisclosureSection
          title={<span style={{ color: hasErrors ? 'var(--color-red)' : 'var(--color-text-muted)' }}>{summary}</span>}
        >
          <div
            className="min-w-0 overflow-y-auto overflow-x-hidden pl-5 pr-1 pb-1 text-xs"
            style={{
              color: 'var(--color-text-muted)',
              maxHeight: shouldScroll ? TOOL_SUMMARY_MAX_HEIGHT : undefined,
              overscrollBehavior: 'contain'
            }}
          >
            <div className="min-w-0 space-y-1">
              {activities.map((activity) => (
                <div key={activity.tool.id} className="flex min-w-0 max-w-full items-start gap-2">
                  <span
                    className="shrink-0"
                    style={{ color: activity.result?.isError ? 'var(--color-red)' : actionColor(describeToolAction(activity.tool).risk) }}
                  >
                    {activity.result?.isError ? 'Error' : 'Done'}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={describeToolActivity(activity.tool)}>
                    {describeToolActivity(activity.tool)}
                  </span>
                </div>
              ))}
              {orphanResults.map((result) => (
                <div key={result.id} className="flex min-w-0 max-w-full items-start gap-2">
                  <span className="shrink-0" style={{ color: result.isError ? 'var(--color-red)' : 'var(--color-text-muted)' }}>
                    {result.isError ? 'Error' : 'Done'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    Tool result
                  </span>
                </div>
              ))}
            </div>
          </div>
        </DisclosureSection>
      </div>
    </div>
  )
}

function actionColor(risk: 'low' | 'medium' | 'high'): string {
  if (risk === 'high') return 'var(--color-red)'
  if (risk === 'medium') return 'var(--color-yellow)'
  return 'var(--color-text-muted)'
}

function UserInputCard({
  msg,
  sessionId,
  sessionStatus
}: {
  msg: ResultMessage
  sessionId: string
  sessionStatus: Session['status']
}): JSX.Element {
  const [answer, setAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const questions = msg.userInputQuestions?.length ? msg.userInputQuestions : [{ question: msg.content }]
  const requestIsActive = sessionStatus === 'waiting_for_user'
  const isAnswered = submitted || !requestIsActive

  const submitAnswer = async (value: string): Promise<void> => {
    const trimmed = value.trim()
    if (!trimmed) return
    setSubmitted(true)
    await window.api.sessions.answerUserInput(sessionId, trimmed)
  }

  return (
    <div className="flex justify-center my-1">
      <SurfaceRow
        className="rounded-xl px-4 py-3 w-full"
        style={{
          maxWidth: 560,
          background: 'var(--color-surface2)',
          border: '1px solid var(--color-border)'
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ color: isAnswered ? 'var(--color-green)' : 'var(--color-yellow)', flexShrink: 0 }}>
            {isAnswered ? (
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            ) : (
              <path d="M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm7.25 4.25a.75.75 0 0 1 1.5 0v.01a.75.75 0 0 1-1.5 0v-.01ZM6.5 5.75A1.5 1.5 0 0 1 8 4.25c.828 0 1.5.67 1.5 1.49 0 .54-.277.86-.897 1.296l-.335.23C7.55 7.76 7.25 8.29 7.25 9.25a.75.75 0 0 0 1.5 0c0-.34.043-.427.367-.65l.35-.24C10.101 7.914 11 7.28 11 5.74a3 3 0 0 0-6 .01.75.75 0 0 0 1.5 0Z" />
            )}
          </svg>
          <StatusBadge label={isAnswered ? 'Answer sent' : 'Answer required'} tone={isAnswered ? 'success' : 'warning'} />
        </div>
        <div className="space-y-3">
          {questions.map((question, index) => (
            <QuestionBlock
              key={`${question.question}-${index}`}
              question={question}
              disabled={isAnswered}
              onAnswer={submitAnswer}
            />
          ))}
        </div>
        {!isAnswered && (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void submitAnswer(answer)
            }}
          >
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Type an answer..."
              className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)'
              }}
            />
            <Button
              type="submit"
              disabled={!answer.trim()}
              variant="primary"
              className="px-4 py-2"
            >
              Send
            </Button>
          </form>
        )}
        {isAnswered && (
          <div className="mt-2 text-xs" style={{ color: 'var(--color-green)' }}>
            {submitted ? 'Answer sent - resuming...' : 'Answered'}
          </div>
        )}
      </SurfaceRow>
    </div>
  )
}

function QuestionBlock({
  question,
  disabled,
  onAnswer
}: {
  question: UserInputQuestion
  disabled: boolean
  onAnswer: (answer: string) => Promise<void>
}): JSX.Element {
  return (
    <div>
      {question.header && (
        <div className="mb-1 text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {question.header}
        </div>
      )}
      <div className="text-sm" style={{ color: 'var(--color-text)' }}>
        {question.question}
      </div>
      {question.options && question.options.length > 0 && (
        <div className="mt-2 grid gap-1.5">
          {question.options.map((option) => (
            <SurfaceRow
              as="button"
              key={option.label}
              disabled={disabled}
              className="rounded-lg px-3 py-2 text-left disabled:opacity-50"
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)'
              }}
              onClick={() => { if (!disabled) void onAnswer(option.label) }}
            >
              <div className="text-sm">{option.label}</div>
              {option.description && (
                <div className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {option.description}
                </div>
              )}
            </SurfaceRow>
          ))}
        </div>
      )}
    </div>
  )
}

function PermissionCard({ msg, sessionId, sessionStatus }: { msg: ResultMessage; sessionId: string; sessionStatus: Session['status'] }): JSX.Element {
  const [decision, setDecision] = useState<'pending' | 'allowed_once' | 'allowed_session' | 'denied'>('pending')
  const denials = msg.permissionDenials ?? []
  const toolNames = [...new Set(denials.map((d) => d.tool_name))]
  const isPlanApproval = denials.some((d) => d.tool_name === 'ExitPlanMode')
  const requestIsActive = sessionStatus === 'waiting_for_permission'
  const displayDecision = msg.permissionDecision ?? decision

  const handleAllowOnce = async (): Promise<void> => {
    setDecision('allowed_once')
    if (isPlanApproval) {
      await window.api.sessions.grantAndResume(sessionId, toolNames)
    } else {
      await window.api.sessions.allowOnceAndResume(sessionId, toolNames)
    }
  }

  const handleAllowSession = async (): Promise<void> => {
    setDecision('allowed_session')
    await window.api.sessions.grantAndResume(sessionId, toolNames)
  }

  const handleDeny = async (): Promise<void> => {
    setDecision('denied')
    if (isPlanApproval) {
      await window.api.sessions.answerUserInput(sessionId, 'Keep planning. Do not exit plan mode yet.')
    } else {
      await window.api.sessions.denyPermission(sessionId)
    }
  }

  return (
    <div className="flex justify-center my-1">
      <SurfaceRow
        className="rounded-xl px-4 py-3 w-full"
        style={{
          maxWidth: 560,
          background: 'var(--color-surface2)',
          border: '1px solid var(--color-border)'
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--color-accent)', flexShrink: 0 }}>
            <path d="M8 0a5 5 0 0 0-5 5v1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V5a5 5 0 0 0-5-5Zm-3 5a3 3 0 1 1 6 0v1H5V5Zm3 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
          </svg>
          <StatusBadge label={isPlanApproval ? 'Plan ready' : 'Permission required'} tone="accent" pulse={requestIsActive && decision === 'pending'} />
        </div>
        <div className="mb-3 space-y-1">
          {denials.map((d, i) => (
            <div
              key={i}
              className="text-xs font-mono"
              style={{
                color: 'var(--color-text-muted)',
                lineHeight: 1.45,
                overflowWrap: 'anywhere',
                whiteSpace: 'normal'
              }}
            >
              {permissionSummary(d)}
            </div>
          ))}
        </div>
        {decision === 'pending' && requestIsActive ? (
          isPlanApproval ? (
            <div className="flex gap-2">
              <Button
                onClick={handleAllowOnce}
                variant="primary"
                className="flex-1"
              >
                Approve Plan
              </Button>
              <Button
                onClick={handleDeny}
                variant="secondary"
                className="px-4"
              >
                Keep Planning
              </Button>
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto' }}>
              <Button
                onClick={handleAllowOnce}
                variant="primary"
              >
                Allow Once
              </Button>
              <Button
                onClick={handleAllowSession}
                variant="secondary"
              >
                Allow Session
              </Button>
              <Button
                onClick={handleDeny}
                variant="secondary"
                className="px-4"
              >
                Deny
              </Button>
            </div>
          )
        ) : (
          <div className="text-xs font-medium" style={{ color: permissionDecisionColor(displayDecision) }}>
            {displayDecision === 'allowed_session'
              ? isPlanApproval ? 'Plan approved' : requestIsActive ? 'Allowed for session - resuming...' : 'Allowed for session'
              : displayDecision === 'allowed_once'
                ? isPlanApproval ? 'Plan approved' : requestIsActive ? 'Allowed once - resuming...' : 'Allowed once'
                : displayDecision === 'denied'
                  ? isPlanApproval ? 'Kept planning' : 'Denied'
                  : displayDecision === 'kept_planning'
                    ? 'Kept planning'
                    : 'Handled'}
          </div>
        )}
      </SurfaceRow>
    </div>
  )
}

function permissionDecisionColor(decision: ResultMessage['permissionDecision'] | 'pending'): string {
  if (decision === 'allowed_once' || decision === 'allowed_session') return 'var(--color-green)'
  if (decision === 'denied') return 'var(--color-red)'
  return 'var(--color-text-muted)'
}

function ThinkingIndicator(): JSX.Element {
  return (
    <div className="flex items-center gap-2 pl-8">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-full"
            style={{
              width: 6, height: 6,
              background: 'var(--color-text-muted)',
              animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`
            }}
          />
        ))}
      </div>
      <style>{`@keyframes pulse { 0%,80%,100%{opacity:.3;transform:scale(.8)}40%{opacity:1;transform:scale(1)} }`}</style>
    </div>
  )
}
