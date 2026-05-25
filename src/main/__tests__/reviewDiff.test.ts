import assert from 'node:assert/strict'
import test from 'node:test'
import { diffForPathFromUnifiedDiff, parseFileChangesFromUnifiedDiff, resolveReviewDiffRenderWindow } from '../../types'

test('review diff parser derives file changes and per-file diff bodies', () => {
  const diff = [
    'diff --git a/src/old.ts b/src/new.ts',
    'similarity index 88%',
    'rename from src/old.ts',
    'rename to src/new.ts',
    '--- a/src/old.ts',
    '+++ b/src/new.ts',
    '@@ -1 +1,2 @@',
    '-old',
    '+new',
    '+next',
    'diff --git a/docs/new.md b/docs/new.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/docs/new.md',
    '@@ -0,0 +1 @@',
    '+hello',
    'diff --git a/docs/gone.md b/docs/gone.md',
    'deleted file mode 100644',
    '--- a/docs/gone.md',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye'
  ].join('\n')

  assert.deepEqual(parseFileChangesFromUnifiedDiff(diff), [
    { path: 'src/new.ts', status: 'R', additions: 2, deletions: 1 },
    { path: 'docs/new.md', status: 'A', additions: 1, deletions: 0 },
    { path: 'docs/gone.md', status: 'D', additions: 0, deletions: 1 }
  ])
  assert.match(diffForPathFromUnifiedDiff(diff, 'src/old.ts'), /rename from src\/old\.ts/)
  assert.match(diffForPathFromUnifiedDiff(diff, 'src/new.ts'), /rename to src\/new\.ts/)
  assert.equal(diffForPathFromUnifiedDiff(diff, 'missing.ts'), '')
})

test('review diff render window limits large diffs until explicitly expanded', () => {
  const lines = Array.from({ length: 12 }, (_, index) => `+line ${index + 1}`)

  const limited = resolveReviewDiffRenderWindow(lines, false, {
    lineThreshold: 5,
    initialLineCount: 4
  })
  assert.equal(limited.limited, true)
  assert.equal(limited.totalLineCount, 12)
  assert.equal(limited.renderedLineCount, 4)
  assert.equal(limited.changedLineCount, 12)
  assert.equal(limited.changedBytes, 75)
  assert.deepEqual(limited.lines, lines.slice(0, 4))

  const expanded = resolveReviewDiffRenderWindow(lines, true, {
    lineThreshold: 5,
    initialLineCount: 4
  })
  assert.equal(expanded.limited, false)
  assert.equal(expanded.renderedLineCount, 12)
  assert.equal(expanded.lines, lines)
})

test('review diff render window follows Codex-scale changed-line thresholds by default', () => {
  const mediumDiff = Array.from({ length: 3204 }, (_, index) =>
    index % 2 === 0 ? `+medium changed line ${index}` : `-medium changed line ${index}`
  )
  const medium = resolveReviewDiffRenderWindow(mediumDiff, false)
  assert.equal(medium.limited, false)
  assert.equal(medium.renderedLineCount, mediumDiff.length)
  assert.equal(medium.changedLineCount, 3204)

  const codexLargeDiff = Array.from({ length: 15002 }, (_, index) =>
    index % 2 === 0 ? `+codex large changed line ${index}` : `-codex large changed line ${index}`
  )
  const limited = resolveReviewDiffRenderWindow(codexLargeDiff, false)
  assert.equal(limited.limited, true)
  assert.equal(limited.changedLineCount, 15002)
  assert.equal(limited.renderedLineCount, 600)
  assert.deepEqual(limited.lines, codexLargeDiff.slice(0, 600))
})
