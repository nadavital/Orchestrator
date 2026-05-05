import { useEffect, useRef, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import type { Session, ChatMessage, ResultMessage, PermissionDenial } from '../../types'
import ToolCallCard from '../shared/ToolCallCard'

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

export default function ChatView({ session, projectName, onSuggestedPrompt }: Props): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session.messages.length])

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
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ userSelect: 'text' }}>
      {session.messages.map((msg) => (
        <MessageRow key={msg.id} msg={msg} sessionId={session.id} />
      ))}
      {session.status === 'running' && <ThinkingIndicator />}
      <div ref={bottomRef} />
    </div>
  )
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
      title="Copy"
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-opacity"
      style={{
        background: 'var(--color-surface)',
        color: copied ? 'var(--color-green)' : 'var(--color-text-muted)',
        border: '1px solid var(--color-border)',
        opacity: 0.9
      }}
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
          <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
          <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
        </svg>
      )}
      {copied ? 'Copied' : 'Copy'}
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
              fontFamily: 'monospace'
            }}
            {...props}
          >
            {children}
          </code>
        )
      }
      return (
        <div style={{ position: 'relative', margin: '8px 0' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
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
              background: 'var(--color-surface)',
              borderRadius: '0 0 6px 6px',
              overflowX: 'auto',
              fontSize: '0.82em',
              lineHeight: 1.5
            }}
          >
            <code className={className} {...props}>{children}</code>
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
        <div style={{ overflowX: 'auto', margin: '6px 0' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.9em', width: '100%' }}>{children}</table>
        </div>
      )
    },
    th({ children }) {
      return (
        <th style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)', textAlign: 'left', fontWeight: 600 }}>
          {children}
        </th>
      )
    },
    td({ children }) {
      return <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--color-border)' }}>{children}</td>
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

function MessageRow({ msg, sessionId }: { msg: ChatMessage; sessionId: string }): JSX.Element | null {
  const [hovered, setHovered] = useState(false)

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

    return (
      <div
        className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {!isUser && (
          <div
            className="shrink-0 rounded-full mr-2 mt-1 flex items-center justify-center font-bold"
            style={{ width: 22, height: 22, background: 'var(--color-accent)', color: '#fff', fontSize: 9 }}
          >
            C
          </div>
        )}
        <div style={{ maxWidth: '80%', display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', gap: 4 }}>
          <div
            className="rounded-2xl px-4 py-2.5 text-sm break-words"
            style={{
              background: isUser ? 'var(--color-accent)' : 'var(--color-surface2)',
              color: isUser ? '#fff' : 'var(--color-text)'
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={isUser ? userComponents : assistantComponents}
            >
              {content}
            </ReactMarkdown>
          </div>
          {hovered && (
            <CopyButton getText={() => content} />
          )}
        </div>
      </div>
    )
  }

  if (msg.type === 'tool_use') {
    return <ToolCallCard msg={msg} />
  }

  if (msg.type === 'tool_result') {
    const content = msg.content.slice(0, 2000)
    const truncated = msg.content.length > 2000
    return (
      <div className="flex justify-start pl-8">
        <div
          className="max-w-[80%] rounded-xl px-3 py-2 text-xs font-mono"
          style={{
            background: msg.isError ? '#2d1a1a' : 'var(--color-surface2)',
            color: msg.isError ? 'var(--color-red)' : 'var(--color-text-muted)',
            border: `1px solid ${msg.isError ? 'var(--color-red)' : 'var(--color-border)'}`,
            maxHeight: 200,
            overflow: 'auto'
          }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {msg.isError ? '✗ Error' : '✓ Result'}
            </span>
            <CopyButton getText={() => msg.content} />
          </div>
          <pre className="whitespace-pre-wrap break-all">
            {content}{truncated ? '\n…(truncated)' : ''}
          </pre>
        </div>
      </div>
    )
  }

  if (msg.type === 'result') {
    if (msg.permissionDenials && msg.permissionDenials.length > 0) {
      return <PermissionCard msg={msg} sessionId={sessionId} />
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

function describeDenial(denial: PermissionDenial): string {
  const { tool_name, tool_input } = denial
  if (tool_name === 'Write' || tool_name === 'Edit' || tool_name === 'Read' || tool_name === 'MultiEdit') {
    const path = (tool_input.file_path ?? tool_input.path ?? '') as string
    return `${tool_name} ${path}`
  }
  if (tool_name === 'Bash') {
    const cmd = ((tool_input.command ?? '') as string).slice(0, 80)
    return `Bash: ${cmd}`
  }
  return tool_name
}

function PermissionCard({ msg, sessionId }: { msg: ResultMessage; sessionId: string }): JSX.Element {
  const [decision, setDecision] = useState<'pending' | 'allowed' | 'denied'>('pending')
  const denials = msg.permissionDenials ?? []
  const toolNames = [...new Set(denials.map((d) => d.tool_name))]

  const handleAllow = async (): Promise<void> => {
    setDecision('allowed')
    await window.api.sessions.grantAndResume(sessionId, toolNames)
  }

  const handleDeny = (): void => setDecision('denied')

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
            Permission Required
          </span>
        </div>
        <div className="mb-3 space-y-1">
          {denials.map((d, i) => (
            <div key={i} className="text-xs font-mono truncate" style={{ color: 'var(--color-text-muted)' }}>
              {describeDenial(d)}
            </div>
          ))}
        </div>
        {decision === 'pending' ? (
          <div className="flex gap-2">
            <button
              onClick={handleAllow}
              className="flex-1 rounded-lg py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
              style={{ background: 'var(--color-accent)', color: '#fff' }}
            >
              Allow &amp; Continue
            </button>
            <button
              onClick={handleDeny}
              className="rounded-lg px-4 py-1.5 text-xs transition-opacity hover:opacity-80"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
            >
              Deny
            </button>
          </div>
        ) : (
          <div className="text-xs font-medium" style={{ color: decision === 'allowed' ? 'var(--color-green)' : 'var(--color-text-muted)' }}>
            {decision === 'allowed' ? '✓ Allowed — resuming...' : '✗ Denied'}
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
