type JsonObject = Record<string, unknown>

export const BROWSER_CLIENT_TOOL_NAMESPACE = 'orchestrator'
export const BROWSER_CLIENT_TOOL_OPEN = 'browser_open'
export const BROWSER_CLIENT_TOOL_READ = 'browser_read'
export const BROWSER_CLIENT_TOOL_CLICK = 'browser_click'
export const BROWSER_CLIENT_TOOL_TYPE = 'browser_type'
export const BROWSER_CLIENT_TOOL_SCREENSHOT = 'browser_screenshot'

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
  },
  {
    namespace: BROWSER_CLIENT_TOOL_NAMESPACE,
    name: BROWSER_CLIENT_TOOL_CLICK,
    description: 'Click a visible element in Orchestrator Browser by nodeId, CSS selector, visible text, or target index. Use browser_read first to discover node ids and target previews.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        nodeId: {
          type: 'string',
          description: 'A node id returned by browser_read, such as node-1.'
        },
        selector: {
          type: 'string',
          description: 'A CSS selector for the element to click.'
        },
        text: {
          type: 'string',
          description: 'Visible text or accessible name to match when nodeId and selector are not provided.'
        },
        index: {
          type: 'number',
          description: '1-based target index from browser_read.'
        }
      }
    }
  },
  {
    namespace: BROWSER_CLIENT_TOOL_NAMESPACE,
    name: BROWSER_CLIENT_TOOL_TYPE,
    description: 'Type text into a visible input, textarea, select-like control, or contenteditable element in Orchestrator Browser. Use browser_read first to discover node ids and target previews.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: {
          type: 'string',
          description: 'Text to type into the selected element.'
        },
        nodeId: {
          type: 'string',
          description: 'A node id returned by browser_read, such as node-2.'
        },
        selector: {
          type: 'string',
          description: 'A CSS selector for the element to type into.'
        },
        targetText: {
          type: 'string',
          description: 'Visible text or accessible name to match when nodeId and selector are not provided.'
        },
        index: {
          type: 'number',
          description: '1-based target index from browser_read.'
        }
      }
    }
  },
  {
    namespace: BROWSER_CLIENT_TOOL_NAMESPACE,
    name: BROWSER_CLIENT_TOOL_SCREENSHOT,
    description: 'Capture the current Orchestrator Browser page and return screenshot metadata plus the saved local artifact path.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  }
]

export function isBrowserClientDynamicTool(namespace: string | null | undefined, tool: string | null | undefined): boolean {
  return namespace === BROWSER_CLIENT_TOOL_NAMESPACE &&
    (
      tool === BROWSER_CLIENT_TOOL_OPEN ||
      tool === BROWSER_CLIENT_TOOL_READ ||
      tool === BROWSER_CLIENT_TOOL_CLICK ||
      tool === BROWSER_CLIENT_TOOL_TYPE ||
      tool === BROWSER_CLIENT_TOOL_SCREENSHOT
    )
}
