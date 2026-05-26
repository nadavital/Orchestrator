type JsonObject = Record<string, unknown>

export const BROWSER_CLIENT_TOOL_NAMESPACE = 'orchestrator'
export const BROWSER_CLIENT_TOOL_OPEN = 'browser_open'
export const BROWSER_CLIENT_TOOL_READ = 'browser_read'

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
