import assert from 'node:assert/strict'
import test from 'node:test'
import {
  artifactImportKindForPath,
  artifactImportKindSupportsSource,
  artifactTabPresentationForPath
} from '../../types'

test('artifact tab presentation mirrors Codex side-panel import kind mapping', () => {
  assert.deepEqual(artifactTabPresentationForPath('/workspace/report.csv'), {
    artifactType: 'spreadsheet',
    importKind: 'csv'
  })
  assert.deepEqual(artifactTabPresentationForPath('/workspace/report.tsv'), {
    artifactType: 'spreadsheet',
    importKind: 'tsv'
  })
  assert.deepEqual(artifactTabPresentationForPath('/workspace/budget.xlsm'), {
    artifactType: 'spreadsheet',
    importKind: 'xlsx'
  })
  assert.deepEqual(artifactTabPresentationForPath('/workspace/budget.xlsx'), {
    artifactType: 'spreadsheet',
    importKind: 'xlsx'
  })
  assert.deepEqual(artifactTabPresentationForPath('/workspace/notes.docx'), {
    artifactType: 'document',
    importKind: 'docx'
  })
  assert.deepEqual(artifactTabPresentationForPath('/workspace/slides.pptx'), {
    artifactType: 'slides',
    importKind: 'pptx'
  })
  assert.deepEqual(artifactTabPresentationForPath('/workspace/notebook.ipynb'), {
    artifactType: 'notebook',
    importKind: 'ipynb'
  })
  assert.deepEqual(artifactTabPresentationForPath('/workspace/paper.tex'), {
    artifactType: 'pdf',
    importKind: 'tex'
  })
  assert.deepEqual(artifactTabPresentationForPath('/workspace/paper.pdf'), {
    artifactType: 'pdf',
    importKind: 'pdf'
  })
  assert.equal(artifactTabPresentationForPath('/workspace/plain.txt'), null)
})

test('artifact source option follows Codex import-kind boundary', () => {
  assert.equal(artifactImportKindForPath('/workspace/UPPER.CSV'), 'csv')
  assert.equal(artifactImportKindForPath('/workspace/archive.tar.gz'), null)
  assert.equal(artifactImportKindSupportsSource('csv'), true)
  assert.equal(artifactImportKindSupportsSource('tsv'), true)
  assert.equal(artifactImportKindSupportsSource('tex'), true)
  assert.equal(artifactImportKindSupportsSource('ipynb'), true)
  assert.equal(artifactImportKindSupportsSource('docx'), false)
  assert.equal(artifactImportKindSupportsSource('pdf'), false)
  assert.equal(artifactImportKindSupportsSource('pptx'), false)
  assert.equal(artifactImportKindSupportsSource('xlsx'), false)
})
