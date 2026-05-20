export function isBinaryDiffText(diff: string): boolean {
  return diff.split('\n').some((line) => line.startsWith('Binary files ') || line.startsWith('GIT binary patch'))
}

export function shouldPreferTextDiff(diff: string): boolean {
  return diff.trim().length > 0 && !isBinaryDiffText(diff)
}
