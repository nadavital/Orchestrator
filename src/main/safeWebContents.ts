interface SendableWebContents {
  isDestroyed(): boolean
  isCrashed?(): boolean
  send(channel: string, ...args: unknown[]): void
}

interface SendableWindow {
  isDestroyed(): boolean
  webContents: SendableWebContents
}

export function canSendToWebContents(
  contents: SendableWebContents | null | undefined
): contents is SendableWebContents {
  if (!contents) return false
  if (contents.isDestroyed()) return false
  if (contents.isCrashed?.()) return false
  return true
}

export function safeWebContentsSend(
  contents: SendableWebContents | null | undefined,
  channel: string,
  ...args: unknown[]
): boolean {
  const target = contents
  if (!canSendToWebContents(target)) return false
  try {
    target.send(channel, ...args)
    return true
  } catch {
    return false
  }
}

export function safeWindowSend(
  win: SendableWindow | null | undefined,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!win || win.isDestroyed()) return false
  return safeWebContentsSend(win.webContents, channel, ...args)
}
