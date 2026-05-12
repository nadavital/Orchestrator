export function nativeTerminalControlResponses(data: string): string[] {
  const responses: string[] = []
  if (data.includes('\x1b[>0q')) {
    responses.push('\x1bP>|XTerm(379)\x1b\\')
  }
  if (data.includes('\x1b[c')) {
    responses.push('\x1b[?1;2c')
  }
  if (data.includes('\x1b[?2026$p')) {
    responses.push('\x1b[?2026;0$y')
  }
  return responses
}
