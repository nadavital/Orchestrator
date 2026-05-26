import { BrowserWindow } from 'electron'
import type { IpcMain } from 'electron'
import { safeWindowSend } from './safeWebContents'

type JsonObject = Record<string, unknown>

export interface BrowserClientToolCall {
  sessionId: string
  requestId: string
  namespace: string | null
  tool: string
  arguments: JsonObject
}

export interface BrowserClientToolResponse {
  success: boolean
  contentItems: Array<{ type: 'inputText'; text: string }>
}

interface PendingBrowserClientToolRequest {
  resolve: (response: BrowserClientToolResponse) => void
  timeout: NodeJS.Timeout
  interval: NodeJS.Timeout
}

export const BROWSER_CLIENT_TOOL_NAMESPACE = 'orchestrator'
export const BROWSER_CLIENT_TOOL_OPEN = 'browser_open'
export const BROWSER_CLIENT_TOOL_READ = 'browser_read'

const BROWSER_CLIENT_TOOL_TIMEOUT_MS = 8_000
const BROWSER_CLIENT_TOOL_RETRY_MS = 150
const pendingBrowserClientToolRequests = new Map<string, PendingBrowserClientToolRequest>()
let nextBrowserClientToolRequestId = 1

export const browserClientDynamicTools: JsonObject[] = [
  {
    namespace: BROWSER_CLIENT_TOOL_NAMESPACE,
    name: BROWSER_CLIENT_TOOL_OPEN,
    description: 'Open a URL in Orchestrator Browser and return the current page URL, title, and visible page structure.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          description: 'The http, https, file, or about URL to open in the Browser panel.'
        }
      }
    }
  },
  {
    namespace: BROWSER_CLIENT_TOOL_NAMESPACE,
    name: BROWSER_CLIENT_TOOL_READ,
    description: 'Read the current Orchestrator Browser page and return URL, title, and visible page structure.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  }
]

export function isBrowserClientDynamicTool(namespace: string | null | undefined, tool: string | null | undefined): boolean {
  return namespace === BROWSER_CLIENT_TOOL_NAMESPACE &&
    (tool === BROWSER_CLIENT_TOOL_OPEN || tool === BROWSER_CLIENT_TOOL_READ)
}

export function registerBrowserClientToolIpc(ipcMain: IpcMain): void {
  ipcMain.handle('browser:clientToolResponse', (_, response: unknown): boolean => {
    const record = asRecord(response)
    const requestId = stringValue(record?.requestId)
    if (!requestId) return false
    const pending = pendingBrowserClientToolRequests.get(requestId)
    if (!pending) return false

    pendingBrowserClientToolRequests.delete(requestId)
    clearTimeout(pending.timeout)
    clearInterval(pending.interval)
    pending.resolve(normalizeBrowserClientToolResponse(record ?? {}))
    return true
  })
  ipcMain.handle('browser:runClientToolSmoke', async (_, call: unknown): Promise<BrowserClientToolResponse> => {
    if (!process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT) {
      return browserClientToolFailure('Browser client tool smoke is only available during automated UI smoke.')
    }
    const record = asRecord(call) ?? {}
    return callBrowserClientTool(BrowserWindow.getAllWindows(), {
      sessionId: stringValue(record.sessionId) ?? '',
      namespace: stringValue(record.namespace) ?? BROWSER_CLIENT_TOOL_NAMESPACE,
      tool: stringValue(record.tool) ?? BROWSER_CLIENT_TOOL_READ,
      arguments: asRecord(record.arguments) ?? {}
    })
  })
}

export async function callBrowserClientTool(
  windows: BrowserWindow[],
  call: Omit<BrowserClientToolCall, 'requestId'>
): Promise<BrowserClientToolResponse> {
  if (!isBrowserClientDynamicTool(call.namespace, call.tool)) {
    return browserClientToolFailure(`Unsupported Browser client tool: ${call.namespace ? `${call.namespace}.` : ''}${call.tool}`)
  }

  const request: BrowserClientToolCall = {
    ...call,
    requestId: `browser-client-tool-${nextBrowserClientToolRequestId++}`
  }

  return new Promise((resolve) => {
    const finish = (response: BrowserClientToolResponse): void => {
      const pending = pendingBrowserClientToolRequests.get(request.requestId)
      if (pending) {
        pendingBrowserClientToolRequests.delete(request.requestId)
        clearTimeout(pending.timeout)
        clearInterval(pending.interval)
      }
      resolve(response)
    }

    const sendRequest = (): void => {
      for (const win of windows) {
        safeWindowSend(win, 'browser:clientToolCall', request)
      }
    }

    const timeout = setTimeout(() => {
      finish(browserClientToolFailure('Browser client tool timed out waiting for the Browser panel renderer.'))
    }, BROWSER_CLIENT_TOOL_TIMEOUT_MS)
    const interval = setInterval(sendRequest, BROWSER_CLIENT_TOOL_RETRY_MS)
    pendingBrowserClientToolRequests.set(request.requestId, { resolve: finish, timeout, interval })
    sendRequest()
  })
}

function normalizeBrowserClientToolResponse(record: JsonObject): BrowserClientToolResponse {
  const success = record.success !== false
  const contentItems = Array.isArray(record.contentItems)
    ? record.contentItems
        .map((item) => {
          const itemRecord = asRecord(item)
          const text = stringValue(itemRecord?.text)
          return text ? { type: 'inputText' as const, text } : null
        })
        .filter((item): item is { type: 'inputText'; text: string } => Boolean(item))
    : []
  if (contentItems.length > 0) return { success, contentItems }
  const content = typeof record.content === 'string'
    ? record.content
    : JSON.stringify({ ok: success, error: stringValue(record.error) ?? null })
  return {
    success,
    contentItems: [{ type: 'inputText', text: content }]
  }
}

function browserClientToolFailure(message: string): BrowserClientToolResponse {
  return {
    success: false,
    contentItems: [{
      type: 'inputText',
      text: JSON.stringify({ ok: false, error: message })
    }]
  }
}

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
