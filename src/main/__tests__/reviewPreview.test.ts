import assert from 'node:assert/strict'
import test from 'node:test'

import { isBinaryDiffText, shouldPreferTextDiff } from '../../types'

test('review preview prefers textual diffs over rich current-file previews', () => {
  const diff = [
    'diff --git a/docs/plan.md b/docs/plan.md',
    '--- a/docs/plan.md',
    '+++ b/docs/plan.md',
    '@@ -1,2 +1,2 @@',
    '-old plan',
    '+new plan'
  ].join('\n')

  assert.equal(shouldPreferTextDiff(diff), true)
})

test('review preview does not send binary diff markers through text diff rendering', () => {
  assert.equal(isBinaryDiffText('Binary files a/image.png and b/image.png differ'), true)
  assert.equal(isBinaryDiffText('GIT binary patch\nliteral 12'), true)
  assert.equal(shouldPreferTextDiff('Binary files a/image.png and b/image.png differ'), false)
})
