import type { PermissionDenial, ToolResultMessage, ToolUseMessage } from './index'

export type ToolActionKind =
  | 'read'
  | 'write'
  | 'edit'
  | 'delete'
  | 'shell'
  | 'search'
  | 'list'
  | 'web'
  | 'mcp'
  | 'agent'
  | 'plan'
  | 'question'
  | 'other'

export type ToolActionRisk = 'low' | 'medium' | 'high'

export interface ToolActionDescriptor {
  kind: ToolActionKind
  verb: string
  unit: string
  label: string
  risk: ToolActionRisk
  target?: string
}

export interface ToolActivity {
  tool: ToolUseMessage
  result?: ToolResultMessage
}

const TOOL_ACTIONS: Array<{
  match: (name: string, input: Record<string, unknown>) => boolean
  descriptor: Omit<ToolActionDescriptor, 'target'>
}> = [
  {
    match: (name) => name.includes('delete') || name.includes('remove') || name.includes('unlink'),
    descriptor: { kind: 'delete', verb: 'Deleted', unit: 'file', label: 'Delete', risk: 'high' }
  },
  {
    match: (name) => name.includes('todo') || name.includes('plan'),
    descriptor: { kind: 'plan', verb: 'Updated', unit: 'plan', label: 'Plan', risk: 'low' }
  },
  {
    match: (name) => name.includes('multiedit') || name.includes('edit'),
    descriptor: { kind: 'edit', verb: 'Edited', unit: 'file', label: 'Edit', risk: 'medium' }
  },
  {
    match: (name) => name.includes('write') || name.includes('create'),
    descriptor: { kind: 'write', verb: 'Wrote', unit: 'file', label: 'Write', risk: 'medium' }
  },
  {
    match: (name) => name.includes('read') || name.includes('open'),
    descriptor: { kind: 'read', verb: 'Read', unit: 'file', label: 'Read', risk: 'low' }
  },
  {
    match: (name, input) => name.includes('bash') || name.includes('shell') || name.includes('command') || hasStringField(input, ['command', 'cmd']),
    descriptor: { kind: 'shell', verb: 'Ran', unit: 'command', label: 'Shell', risk: 'medium' }
  },
  {
    match: (name) => name.includes('mcp'),
    descriptor: { kind: 'mcp', verb: 'Used MCP', unit: 'tool', label: 'MCP', risk: 'medium' }
  },
  {
    match: (name) => name.includes('grep') || name.includes('search') || name.includes('ripgrep'),
    descriptor: { kind: 'search', verb: 'Searched', unit: 'query', label: 'Search', risk: 'low' }
  },
  {
    match: (name) => name.includes('glob') || name.includes('list') || name.includes('ls'),
    descriptor: { kind: 'list', verb: 'Listed', unit: 'listing', label: 'List', risk: 'low' }
  },
  {
    match: (name) => name.includes('web') || name.includes('fetch') || name.includes('url'),
    descriptor: { kind: 'web', verb: 'Browsed', unit: 'page', label: 'Web', risk: 'low' }
  },
  {
    match: (name) => name.includes('agent') || name.includes('subtask') || name === 'task',
    descriptor: { kind: 'agent', verb: 'Delegated', unit: 'agent', label: 'Agent', risk: 'low' }
  },
  {
    match: (name) => name.includes('question') || name.includes('askuser'),
    descriptor: { kind: 'question', verb: 'Asked', unit: 'question', label: 'Question', risk: 'low' }
  }
]

export function describeToolAction(tool: ToolUseMessage): ToolActionDescriptor {
  const name = normalizeToolName(tool.toolName)
  const matched = TOOL_ACTIONS.find((action) => action.match(name, tool.toolInput))
  const descriptor = matched?.descriptor ?? {
    kind: 'other' as const,
    verb: 'Used',
    unit: 'tool',
    label: tool.toolName || 'Tool',
    risk: 'low' as const
  }
  return {
    ...descriptor,
    target: toolTarget(tool.toolInput)
  }
}

export function pairToolActivities(messages: Array<ToolUseMessage | ToolResultMessage>): ToolActivity[] {
  const resultsByToolId = new Map<string, ToolResultMessage>()
  const tools: ToolUseMessage[] = []

  for (const message of messages) {
    if (message.type === 'tool_use') {
      tools.push(message)
    } else {
      resultsByToolId.set(message.toolUseId, message)
    }
  }

  return tools.map((tool) => ({ tool, result: resultsByToolId.get(tool.id) }))
}

export function summarizeToolActivities(
  activities: ToolActivity[],
  orphanResults: ToolResultMessage[] = []
): string {
  const counts = new Map<string, { descriptor: ToolActionDescriptor; count: number }>()
  for (const activity of activities) {
    const descriptor = describeToolAction(activity.tool)
    const existing = counts.get(descriptor.kind)
    counts.set(descriptor.kind, {
      descriptor,
      count: (existing?.count ?? 0) + 1
    })
  }

  if (orphanResults.length > 0 && counts.size === 0) {
    counts.set('other', {
      descriptor: { kind: 'other', verb: 'Received', unit: 'result', label: 'Result', risk: 'low' },
      count: orphanResults.length
    })
  }

  const parts = [...counts.values()].map(({ descriptor, count }) =>
    `${descriptor.verb} ${count} ${pluralizeToolUnit(descriptor.unit, count)}`
  )
  const errorCount = activities.filter((activity) => activity.result?.isError).length +
    orphanResults.filter((result) => result.isError).length
  const summary = parts.length > 0 ? parts.join(' · ') : 'Used tools'
  return `${summary}${errorCount > 0 ? ` · ${errorCount} error${errorCount === 1 ? '' : 's'}` : ''}`
}

export function describeToolActivity(tool: ToolUseMessage): string {
  const action = describeToolAction(tool)
  return action.target ? `${tool.toolName} ${action.target}` : tool.toolName
}

export function permissionSummary(denial: PermissionDenial): string {
  const { tool_name, tool_input } = denial
  if (tool_name === 'ExitPlanMode') {
    const plan = stringField(tool_input, ['plan', 'summary', 'description'])
    const firstLine = plan?.split('\n').map((line) => line.trim()).find(Boolean)
    return firstLine ? `Plan: ${firstLine.replace(/^#+\s*/, '')}` : 'Plan is ready'
  }

  const syntheticTool: ToolUseMessage = {
    id: denial.tool_use_id,
    role: 'assistant',
    type: 'tool_use',
    toolName: tool_name,
    toolInput: tool_input,
    timestamp: 0
  }
  const action = describeToolAction(syntheticTool)
  return action.target ? `${tool_name} ${action.target}` : tool_name
}

export function toolTarget(input: Record<string, unknown>, maxLength = 160): string {
  const value = stringField(input, [
    'file_path',
    'path',
    'pattern',
    'query',
    'command',
    'cmd',
    'url',
    'description',
    'prompt'
  ])
  return value ? value.replace(/\s+/g, ' ').slice(0, maxLength) : ''
}

function normalizeToolName(toolName: string): string {
  return toolName.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function hasStringField(input: Record<string, unknown>, keys: string[]): boolean {
  return stringField(input, keys) !== undefined
}

function stringField(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

function pluralizeToolUnit(unit: string, count: number): string {
  if (count === 1) return unit
  if (unit === 'query') return 'queries'
  return `${unit}s`
}
