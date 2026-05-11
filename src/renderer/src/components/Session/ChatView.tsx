import { useEffect, useRef, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import {
  describeToolAction,
  describeToolActivity,
  extractFileReferences,
  pairToolActivities,
  permissionSummary,
  summarizeToolActivities
} from '../../types'
import type { Session, ChatMessage, FileReference, ResultMessage, ToolResultMessage, ToolUseMessage, UserInputQuestion } from '../../types'

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

export default function ChatView({ session, projectName, onSuggestedPrompt }: Props): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  const transcriptItems = groupTranscriptMessages(session.messages)
  const lastMessage = session.messages[session.messages.length - 1]
  const lastTextLength = lastMessage?.type === 'text' ? lastMessage.content.length : 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session.messages.length, lastTextLength])

  // Hero state: no messages yet
  if (session.messages.length === 0 && session.status !== 'running') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8 pb-4">
        <h1
          className="text-3xl font-semibold text-center mb-8 leading-tight"
          style={{ color: 'var(--color-text)', maxWidth: 520 }}
        >
          {projectName ? `What do you want to build in ${projectName}?` : 'What do you want to build?'}
        </h1>
        <div className="grid grid-cols-2 gap-2 w-full" style={{ maxWidth: 480 }}>
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => onSuggestedPrompt?.(prompt)}
              className="text-left rounded-xl px-4 py-3 text-sm transition-colors"
              style={{
                background: 'var(--color-surface2)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
                lineHeight: 1.4
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-accent)'
                e.currentTarget.style.color = 'var(--color-text)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)'
                e.currentTarget.style.color = 'var(--color-text-muted)'
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-3" style={{ userSelect: 'text' }}>
      {transcriptItems.map((item) => (
        item.type === 'tool_group'
          ? <ToolActivitySummary key={item.id} messages={item.messages} />
          : <MessageRow key={item.message.id} msg={item.message} session={session} />
      ))}
      {session.status === 'running' && <ThinkingIndicator />}
      <div ref={bottomRef} />
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
    <button
      onClick={handleCopy}
      title={copied ? 'Copied' : 'Copy'}
      aria-label={copied ? 'Copied' : 'Copy'}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md transition-opacity hover:opacity-100 focus-visible:opacity-100"
      style={{
        background: 'transparent',
        color: copied ? 'var(--color-green)' : 'var(--color-text-muted)',
        border: 'none',
        opacity: copied ? 1 : 0.55
      }}
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
          <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
        </svg>
      )}
    </button>
  )
}

function makeMarkdownComponents(isUser: boolean): Components {
  return {
    // Code blocks with copy button
    code({ className, children, ...props }) {
      const isBlock = className?.startsWith('language-')
      const lang = className?.replace('language-', '') ?? ''
      const code = String(children).replace(/\n$/, '')
      if (!isBlock) {
        return (
          <code
            style={{
              background: isUser ? 'rgba(0,0,0,0.2)' : 'var(--color-surface)',
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
              justifyContent: 'space-between',
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
            <CopyButton getText={() => code} />
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

function MessageRow({ msg, session }: { msg: ChatMessage; session: Session }): JSX.Element | null {
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
    const fileReferences = !isUser && !isSystem
      ? extractFileReferences(content, session.workDir).slice(0, 4)
      : []

    return (
      <div
        className={`flex min-w-0 w-full ${isUser ? 'justify-end' : 'justify-start'}`}
      >
        <div
          className="min-w-0"
          style={{
            maxWidth: isUser ? '80%' : 'min(760px, 100%)',
            width: isUser ? 'auto' : '100%',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          <div
            className={`text-sm min-w-0 break-words ${isUser ? 'rounded-2xl px-4 py-2.5 pr-9' : 'pr-8 py-1'}`}
            style={{
              background: isUser ? 'var(--color-accent)' : 'transparent',
              color: isUser ? '#fff' : 'var(--color-text)',
              overflowWrap: 'anywhere'
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={isUser ? userComponents : assistantComponents}
            >
              {content}
            </ReactMarkdown>
            {msg.isStreaming && (
              <span
                aria-label="Streaming"
                className="inline-block align-baseline"
                style={{ color: 'var(--color-accent)', marginLeft: 2 }}
              >
                |
              </span>
            )}
            {fileReferences.length > 0 && <FileReferenceList files={fileReferences} />}
          </div>
          <div
            style={{
              position: 'absolute',
              top: isUser ? 6 : 2,
              right: isUser ? 6 : 0
            }}
          >
            <CopyButton getText={() => content} />
          </div>
        </div>
      </div>
    )
  }

  if (msg.type === 'result') {
    if (msg.subtype === 'waiting_for_user') {
      return <UserInputCard msg={msg} sessionId={session.id} />
    }
    if (msg.permissionDenials && msg.permissionDenials.length > 0) {
      return <PermissionCard msg={msg} sessionId={session.id} />
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

function FileReferenceList({ files }: { files: FileReference[] }): JSX.Element {
  return (
    <div className="mt-3 space-y-1.5" aria-label="Referenced files">
      {files.map((file) => (
        <FileReferenceCard key={file.path} file={file} />
      ))}
    </div>
  )
}

function FileReferenceCard({ file }: { file: FileReference }): JSX.Element {
  const [exists, setExists] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.fs.statPath(file.path).then((stat) => {
      if (!cancelled) setExists(stat.exists)
    }).catch(() => {
      if (!cancelled) setExists(false)
    })
    return () => { cancelled = true }
  }, [file.path])

  const openPath = async (): Promise<void> => {
    setError(null)
    const result = await window.api.fs.openPath(file.path)
    if (result) setError(result)
  }

  const revealPath = async (): Promise<void> => {
    setError(null)
    await window.api.fs.showInFolder(file.path)
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
          <div className="font-medium truncate">{file.label}</div>
          <div className="truncate" style={{ color: 'var(--color-text-muted)', fontSize: 10 }} title={file.path}>
            {file.path}
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
          Open
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

function ToolActivitySummary({ messages }: { messages: Array<ToolUseMessage | ToolResultMessage> }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const activities = pairToolActivities(messages)
  const orphanResults = messages.filter((message): message is ToolResultMessage => message.type === 'tool_result' && !activities.some((activity) => activity.result?.id === message.id))
  const hasErrors = activities.some((activity) => activity.result?.isError) || orphanResults.some((result) => result.isError)
  const summary = summarizeToolActivities(activities, orphanResults)
  const rowCount = activities.length + orphanResults.length
  const shouldScroll = rowCount > TOOL_SUMMARY_SCROLL_THRESHOLD

  return (
    <div className="flex justify-start min-w-0 w-full">
      <div className="w-full min-w-0" style={{ maxWidth: 'min(760px, 100%)' }}>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs transition-colors"
          onClick={() => setExpanded((value) => !value)}
          style={{ color: hasErrors ? 'var(--color-red)' : 'var(--color-text-muted)' }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className="shrink-0 transition-transform"
            style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          >
            <path d="M5 7 L1 3 L9 3 Z" />
          </svg>
          <span className="truncate">{summary}</span>
        </button>
        {expanded && (
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
        )}
      </div>
    </div>
  )
}

function actionColor(risk: 'low' | 'medium' | 'high'): string {
  if (risk === 'high') return 'var(--color-red)'
  if (risk === 'medium') return 'var(--color-yellow)'
  return 'var(--color-text-muted)'
}

function UserInputCard({ msg, sessionId }: { msg: ResultMessage; sessionId: string }): JSX.Element {
  const [answer, setAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const questions = msg.userInputQuestions?.length ? msg.userInputQuestions : [{ question: msg.content }]

  const submitAnswer = async (value: string): Promise<void> => {
    const trimmed = value.trim()
    if (!trimmed) return
    setSubmitted(true)
    await window.api.sessions.answerUserInput(sessionId, trimmed)
  }

  return (
    <div className="flex justify-center my-1">
      <div
        className="rounded-xl px-4 py-3 w-full"
        style={{
          maxWidth: 560,
          background: 'var(--color-surface2)',
          border: '1px solid var(--color-border)'
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--color-yellow)', flexShrink: 0 }}>
            <path d="M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm7.25 4.25a.75.75 0 0 1 1.5 0v.01a.75.75 0 0 1-1.5 0v-.01ZM6.5 5.75A1.5 1.5 0 0 1 8 4.25c.828 0 1.5.67 1.5 1.49 0 .54-.277.86-.897 1.296l-.335.23C7.55 7.76 7.25 8.29 7.25 9.25a.75.75 0 0 0 1.5 0c0-.34.043-.427.367-.65l.35-.24C10.101 7.914 11 7.28 11 5.74a3 3 0 0 0-6 .01.75.75 0 0 0 1.5 0Z" />
          </svg>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
            Answer Required
          </span>
        </div>
        <div className="space-y-3">
          {questions.map((question, index) => (
            <QuestionBlock
              key={`${question.question}-${index}`}
              question={question}
              disabled={submitted}
              onAnswer={submitAnswer}
            />
          ))}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void submitAnswer(answer)
          }}
        >
          <input
            value={answer}
            disabled={submitted}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Type an answer..."
            className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)'
            }}
          />
          <button
            type="submit"
            disabled={submitted || !answer.trim()}
            className="rounded-lg px-4 py-2 text-xs font-medium transition-opacity disabled:opacity-50"
            style={{ background: 'var(--color-accent)', color: '#fff' }}
          >
            Send
          </button>
        </form>
        {submitted && (
          <div className="mt-2 text-xs" style={{ color: 'var(--color-green)' }}>
            Answer sent - resuming...
          </div>
        )}
      </div>
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
            <button
              key={option.label}
              type="button"
              disabled={disabled}
              className="rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-50"
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)'
              }}
              onClick={() => { void onAnswer(option.label) }}
            >
              <div className="text-sm">{option.label}</div>
              {option.description && (
                <div className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {option.description}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PermissionCard({ msg, sessionId }: { msg: ResultMessage; sessionId: string }): JSX.Element {
  const [decision, setDecision] = useState<'pending' | 'allowed_once' | 'allowed_session' | 'denied'>('pending')
  const denials = msg.permissionDenials ?? []
  const toolNames = [...new Set(denials.map((d) => d.tool_name))]
  const isPlanApproval = denials.some((d) => d.tool_name === 'ExitPlanMode')

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
      <div
        className="rounded-xl px-4 py-3 w-full"
        style={{
          maxWidth: 480,
          background: 'var(--color-surface2)',
          border: '1px solid var(--color-border)'
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ color: 'var(--color-accent)', flexShrink: 0 }}>
            <path d="M8 0a5 5 0 0 0-5 5v1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V5a5 5 0 0 0-5-5Zm-3 5a3 3 0 1 1 6 0v1H5V5Zm3 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
          </svg>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
            {isPlanApproval ? 'Plan Ready' : 'Permission Required'}
          </span>
        </div>
        <div className="mb-3 space-y-1">
          {denials.map((d, i) => (
            <div key={i} className="text-xs font-mono truncate" style={{ color: 'var(--color-text-muted)' }}>
              {permissionSummary(d)}
            </div>
          ))}
        </div>
        {decision === 'pending' ? (
          isPlanApproval ? (
            <div className="flex gap-2">
              <button
                onClick={handleAllowOnce}
                className="flex-1 rounded-lg py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
                style={{ background: 'var(--color-accent)', color: '#fff' }}
              >
                Approve Plan
              </button>
              <button
                onClick={handleDeny}
                className="rounded-lg px-4 py-1.5 text-xs transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
              >
                Keep Planning
              </button>
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto' }}>
              <button
                onClick={handleAllowOnce}
                className="rounded-lg py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
                style={{ background: 'var(--color-accent)', color: '#fff' }}
              >
                Allow Once
              </button>
              <button
                onClick={handleAllowSession}
                className="rounded-lg py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              >
                Allow Session
              </button>
              <button
                onClick={handleDeny}
                className="rounded-lg px-4 py-1.5 text-xs transition-opacity hover:opacity-80"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
              >
                Deny
              </button>
            </div>
          )
        ) : (
          <div className="text-xs font-medium" style={{ color: decision.startsWith('allowed') ? 'var(--color-green)' : 'var(--color-text-muted)' }}>
            {decision === 'allowed_session'
              ? isPlanApproval ? 'Approving plan...' : 'Allowed for session - resuming...'
              : decision === 'allowed_once'
                ? isPlanApproval ? 'Approving plan...' : 'Allowed once - resuming...'
                : isPlanApproval ? 'Continuing plan...' : 'Denied'}
          </div>
        )}
      </div>
    </div>
  )
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
