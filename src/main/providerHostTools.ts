import { BrowserWindow } from 'electron'
import {
  browserClientDynamicTools,
  callBrowserClientTool,
  isBrowserClientDynamicTool,
  type BrowserClientToolResponse
} from './browserClientTools'

type JsonObject = Record<string, unknown>

export interface ProviderHostToolCall {
  sessionId: string
  namespace: string | null
  tool: string
  arguments: JsonObject
}

export interface ProviderHostToolBridge {
  dynamicTools: JsonObject[]
  isSupported(namespace: string | null, tool: string): boolean
  call(call: ProviderHostToolCall): Promise<BrowserClientToolResponse>
}

export function browserProviderHostToolBridge(
  windows: () => BrowserWindow[] = () => BrowserWindow.getAllWindows()
): ProviderHostToolBridge {
  return {
    dynamicTools: browserClientDynamicTools,
    isSupported: isBrowserClientDynamicTool,
    call: (call) => callBrowserClientTool(windows(), call)
  }
}
