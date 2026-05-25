export type ArtifactImportKind = 'csv' | 'docx' | 'ipynb' | 'pdf' | 'pptx' | 'tex' | 'tsv' | 'xlsx'
export type ArtifactType = 'document' | 'notebook' | 'pdf' | 'slides' | 'spreadsheet'

export interface ArtifactTabPresentation {
  artifactType: ArtifactType
  importKind: ArtifactImportKind
}

const ARTIFACT_IMPORT_KIND_BY_EXTENSION: Record<string, ArtifactImportKind> = {
  csv: 'csv',
  docx: 'docx',
  ipynb: 'ipynb',
  pdf: 'pdf',
  pptx: 'pptx',
  tex: 'tex',
  tsv: 'tsv',
  xlsm: 'xlsx',
  xlsx: 'xlsx'
}

export function artifactImportKindForPath(path: string): ArtifactImportKind | null {
  const extension = fileExtension(path)
  return extension ? ARTIFACT_IMPORT_KIND_BY_EXTENSION[extension] ?? null : null
}

export function artifactTabPresentationForPath(path: string): ArtifactTabPresentation | null {
  const importKind = artifactImportKindForPath(path)
  if (!importKind) return null

  switch (importKind) {
    case 'csv':
    case 'tsv':
    case 'xlsx':
      return { artifactType: 'spreadsheet', importKind }
    case 'docx':
      return { artifactType: 'document', importKind }
    case 'ipynb':
      return { artifactType: 'notebook', importKind }
    case 'pdf':
    case 'tex':
      return { artifactType: 'pdf', importKind }
    case 'pptx':
      return { artifactType: 'slides', importKind }
  }
}

export function artifactImportKindSupportsSource(importKind: ArtifactImportKind): boolean {
  switch (importKind) {
    case 'csv':
    case 'ipynb':
    case 'tex':
    case 'tsv':
      return true
    case 'docx':
    case 'pdf':
    case 'pptx':
    case 'xlsx':
      return false
  }
}

function fileExtension(path: string): string | null {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
  const index = name.lastIndexOf('.')
  if (index <= 0 || index === name.length - 1) return null
  return name.slice(index + 1).toLowerCase()
}
