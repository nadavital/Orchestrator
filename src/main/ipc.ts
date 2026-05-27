import type { IpcMain } from 'electron'
import { dialog, app, clipboard, shell, session } from 'electron'
import { execFile } from 'child_process'
import { request as httpRequest } from 'http'
import { closeSync, openSync, readFileSync, readSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, extname, join } from 'path'
import { inflateRawSync } from 'zlib'
import type { Attachment, AutomationUpsertRequest, CapabilityCreateRequest, CapabilityDeleteRequest, CapabilitySyncRequest, CapabilityUpdateRequest, ChatMessage, GitLineBlameResult, GitPathActionResult, OpenPathMethod, OpenPathOptions, OpenPathResult, OpenTargetAvailability, PerformanceMetric, PreferredOpenTarget, ReviewDiffSource, Session, SessionForkMode, TranscriptPageRequest, WorkspaceSearchRequest } from '../types'
import { browserWebviewPartitionForHost, isOrchestratorBrowserWebviewPartition } from '../types'
import { projectStore } from './projects'
import { sessionManager } from './sessions'
import { automationManager } from './automations'
import { automationEligibilityForSession } from './automationEligibility'
import { gitManager } from './git'
import { settingsStore } from './settings'
import { terminalManager } from './terminal'
import { petOverlayManager } from './petOverlay'
import { getAppProfile } from './appProfile'
import { getProviderDiagnosticsAsync, getProviderPermissionRuntimeContextAsync, getProviderRuntimeInfo, runProviderCommandSurfaceAsync } from './providers'
import { resolveWorkspaceFileReference } from './workspaceResolver'
import { searchWorkspace } from './workspaceSearch'
import { discoverClaudeExtensions } from './claudeExtensions'
import { listProviderResources } from './providerResources'
import { listProviderRuntimeConnections, listProviderRuntimeDebugEvents } from './providerRuntimeDiagnostics'
import { createCapability } from './capabilityCreator'
import { deleteCapability, updateCapability } from './capabilityManager'
import { applyCapabilitySync, previewCapabilitySync } from './capabilitySync'
import { performanceSnapshot, recordPerformanceMetric, resetPerformanceMetrics } from './performanceTelemetry'
import { providerManifests } from './providerManifest'
import { setBrowserSecurityPolicy } from './browserSecurityPolicy'
import { registerBrowserClientToolIpc } from './browserClientTools'
import { EDITOR_OPEN_TARGETS, editorCliTargets, editorFileUrl, editorOpenTarget, findExecutableCommand, normalizePreferredOpenTarget, type EditorOpenTarget } from './editorOpen'
type FilePreviewResult =
  | { kind: 'text'; size: number; text: string; truncated: boolean }
  | { kind: 'markdown'; size: number; text: string; truncated: boolean }
  | { kind: 'json'; size: number; text: string; truncated: boolean }
  | { kind: 'csv'; size: number; text: string; truncated: boolean }
  | { kind: 'notebook'; size: number; text: string; truncated: boolean }
  | { kind: 'document'; size: number; text: string; truncated: boolean; document?: DocumentPreviewPayload }
  | { kind: 'pdf'; size: number; pageCount?: number; truncated: boolean }
  | { kind: 'spreadsheet' | 'slides'; size: number; text?: string; truncated: boolean }
  | { kind: 'image' | 'html' | 'audio' | 'video' | 'binary'; size: number; truncated: boolean }
  | { kind: 'missing' | 'unreadable'; size?: number; truncated: false }

interface ZipEntryRecord {
  name: string
  method: number
  compressedSize: number
  localHeaderOffset: number
}

interface SpreadsheetPreviewCell {
  value: string
  formula?: string
  fillColor?: string
  conditionalFillColor?: string
  dataValidation?: SpreadsheetPreviewDataValidation
  textColor?: string
  bold?: boolean
  wrapText?: boolean
  horizontalAlignment?: 'left' | 'center' | 'right'
  verticalAlignment?: 'top' | 'middle' | 'bottom'
}

interface SpreadsheetPreviewSheet {
  name: string
  rows: SpreadsheetPreviewCell[][]
  merges?: SpreadsheetPreviewMerge[]
  tables?: SpreadsheetPreviewTable[]
  conditionalFormatCount?: number
  dataValidationCount?: number
  columnWidths?: Array<number | undefined>
  rowHeights?: Array<number | undefined>
  freezePanes?: SpreadsheetFreezePanes
}

interface SpreadsheetPreviewMerge {
  ref: string
  startRow: number
  startColumn: number
  rowSpan: number
  colSpan: number
}

interface SpreadsheetPreviewTable {
  ref: string
  name: string
  styleName?: string
  startRow: number
  startColumn: number
  rowSpan: number
  colSpan: number
  showFilterButton?: boolean
  showRowStripes?: boolean
}

interface SpreadsheetPreviewConditionalFormat {
  ref: string
  startRow: number
  startColumn: number
  rowSpan: number
  colSpan: number
  colors: string[]
}

interface SpreadsheetPreviewDataValidation {
  type: 'list'
  values?: string[]
  allowBlank?: boolean
}

interface SpreadsheetPreviewDataValidationRange extends SpreadsheetPreviewDataValidation {
  ref: string
  startRow: number
  startColumn: number
  rowSpan: number
  colSpan: number
}

interface SpreadsheetFreezePanes {
  rows: number
  columns: number
}

interface SpreadsheetCellStyle {
  fillColor?: string
  textColor?: string
  bold?: boolean
  wrapText?: boolean
  horizontalAlignment?: 'left' | 'center' | 'right'
  verticalAlignment?: 'top' | 'middle' | 'bottom'
}

interface SlidePreviewShape {
  text: string[]
  x: number
  y: number
  width: number
  height: number
  fillColor?: string
  textColor?: string
  imageDataUrl?: string
  imageMimeType?: string
}

interface DocumentPreviewParagraphBlock {
  type: 'paragraph'
  text: string
}

interface DocumentPreviewTableBlock {
  type: 'table'
  rows: string[][]
}

interface DocumentPreviewImageBlock {
  type: 'image'
  dataUrl: string
  mimeType: string
  alt?: string
  width?: number
  height?: number
}

type DocumentPreviewBlock = DocumentPreviewParagraphBlock | DocumentPreviewTableBlock | DocumentPreviewImageBlock

interface DocumentPreviewPayload {
  blocks: DocumentPreviewBlock[]
  tableCount: number
  imageCount: number
}

interface BrowserAssetRequest {
  inventoryId: string
  pageUrl?: string | null
  assets: Array<{
    id: string
    kind: string
    name: string
    url: string
  }>
}

interface BrowserLocalTarget {
  url: string
  title: string | null
  source: 'port-scan' | 'recent'
}

interface PastedAttachmentRequest {
  name?: string
  mimeType?: string
  bytes: ArrayBuffer | Uint8Array
}

const FILE_PREVIEW_LIMIT = 80_000
const PDF_PAGE_COUNT_LIMIT = 1_000_000
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx'])
const JSON_EXTENSIONS = new Set(['.json', '.jsonl'])
const CSV_EXTENSIONS = new Set(['.csv', '.tsv'])
const NOTEBOOK_EXTENSIONS = new Set(['.ipynb'])
const DOCUMENT_EXTENSIONS = new Set(['.docx'])
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xlsm'])
const SLIDES_EXTENSIONS = new Set(['.pptx'])
const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.aiff', '.m4a', '.aac', '.flac', '.ogg'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm'])
const BINARY_EXTENSIONS = new Set([
  '.bin', '.exe', '.dmg', '.zip', '.gz', '.tgz', '.br', '.7z', '.woff', '.woff2', '.ttf', '.otf', '.ico', '.icns', '.wasm', '.sqlite',
  '.db', '.jar', '.class', '.so', '.dylib'
])

const BROWSER_ARTIFACT_DIR = 'orchestrator-browser-artifacts'
const COMPOSER_ATTACHMENT_DIR = 'orchestrator-composer-attachments'
const APP_DEEPLINK_PROTOCOL = 'orchestrator'
const BROWSER_LOCAL_TARGET_PORTS = [
  3000, 3001, 3020, 4000, 4010, 5000, 5010, 5173, 5174, 6006, 7000, 8000, 8080, 8888, 9000
]
const MIME_EXTENSIONS: Record<string, string> = {
  'application/json': '.json',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'text/csv': '.csv',
  'text/html': '.html',
  'text/markdown': '.md',
  'text/plain': '.txt'
}

function previewFile(filePath: string): FilePreviewResult {
  try {
    if (!existsSync(filePath)) return { kind: 'missing', truncated: false }
    const stat = statSync(filePath)
    if (!stat.isFile()) return { kind: 'unreadable', size: stat.size, truncated: false }
    const size = stat.size
    const extension = extname(filePath).toLowerCase()
    if (IMAGE_EXTENSIONS.has(extension)) return { kind: 'image', size, truncated: false }
    if (extension === '.pdf') return previewPdfFile(filePath, size)
    if (DOCUMENT_EXTENSIONS.has(extension)) return previewDocxFile(filePath, size)
    if (SPREADSHEET_EXTENSIONS.has(extension)) return previewSpreadsheetFile(filePath, size)
    if (SLIDES_EXTENSIONS.has(extension)) return previewSlidesFile(filePath, size)
    if (HTML_EXTENSIONS.has(extension)) return { kind: 'html', size, truncated: false }
    if (AUDIO_EXTENSIONS.has(extension)) return { kind: 'audio', size, truncated: false }
    if (VIDEO_EXTENSIONS.has(extension)) return { kind: 'video', size, truncated: false }
    if (BINARY_EXTENSIONS.has(extension)) return { kind: 'binary', size, truncated: false }

    const byteCount = Math.min(size, FILE_PREVIEW_LIMIT)
    const buffer = Buffer.alloc(byteCount)
    const fd = openSync(filePath, 'r')
    try {
      readSync(fd, buffer, 0, byteCount, 0)
    } finally {
      closeSync(fd)
    }
    if (looksBinary(buffer)) return { kind: 'binary', size, truncated: false }
    const text = buffer.toString('utf8')
    if (NOTEBOOK_EXTENSIONS.has(extension)) {
      return {
        kind: 'notebook',
        size,
        text,
        truncated: size > FILE_PREVIEW_LIMIT
      }
    }
    if (JSON_EXTENSIONS.has(extension)) {
      return {
        kind: 'json',
        size,
        text,
        truncated: size > FILE_PREVIEW_LIMIT
      }
    }
    if (CSV_EXTENSIONS.has(extension)) {
      return {
        kind: 'csv',
        size,
        text,
        truncated: size > FILE_PREVIEW_LIMIT
      }
    }
    if (MARKDOWN_EXTENSIONS.has(extension)) {
      return {
        kind: 'markdown',
        size,
        text,
        truncated: size > FILE_PREVIEW_LIMIT
      }
    }
    return {
      kind: 'text',
      size,
      text,
      truncated: size > FILE_PREVIEW_LIMIT
    }
  } catch {
    return { kind: 'unreadable', truncated: false }
  }
}

function previewPdfFile(filePath: string, size: number): FilePreviewResult {
  const byteCount = Math.min(size, PDF_PAGE_COUNT_LIMIT)
  const buffer = Buffer.alloc(byteCount)
  const fd = openSync(filePath, 'r')
  try {
    readSync(fd, buffer, 0, byteCount, 0)
  } finally {
    closeSync(fd)
  }
  const pageCount = extractPdfPageCount(buffer.toString('latin1'))
  return pageCount !== undefined
    ? { kind: 'pdf', size, pageCount, truncated: false }
    : { kind: 'pdf', size, truncated: false }
}

function extractPdfPageCount(text: string): number | undefined {
  let pagesCount = 0
  for (const match of text.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,800}?\/Count\s+(\d+)/g)) {
    const value = Number(match[1])
    if (Number.isFinite(value) && value > pagesCount) pagesCount = value
  }
  if (pagesCount > 0) return pagesCount

  const pageObjectCount = [...text.matchAll(/\/Type\s*\/Page\b(?!s)/g)].length
  return pageObjectCount > 0 ? pageObjectCount : undefined
}

function previewDocxFile(filePath: string, size: number): FilePreviewResult {
  const archive = readFileSync(filePath)
  const documentXml = readZipEntry(archive, 'word/document.xml')
  if (!documentXml) return { kind: 'unreadable', size, truncated: false }

  const document = extractDocxPreview(documentXml.toString('utf8'), archive)
  const text = document.blocks
    .flatMap((block) => block.type === 'paragraph'
      ? [block.text]
      : block.type === 'table'
        ? block.rows.map((row) => row.join('\t'))
        : [`[Image${block.alt ? `: ${block.alt}` : ''}]`])
    .filter(Boolean)
    .join('\n\n')
  if (!text.trim()) return { kind: 'document', size, text: '', truncated: false }
  return {
    kind: 'document',
    size,
    text: text.length > FILE_PREVIEW_LIMIT ? text.slice(0, FILE_PREVIEW_LIMIT) : text,
    truncated: text.length > FILE_PREVIEW_LIMIT,
    document
  }
}

function previewSpreadsheetFile(filePath: string, size: number): FilePreviewResult {
  const archive = readFileSync(filePath)
  const summary = extractSpreadsheetPreview(archive)
  return {
    kind: 'spreadsheet',
    size,
    text: summary ? JSON.stringify(summary) : undefined,
    truncated: summary?.truncated === true
  }
}

function previewSlidesFile(filePath: string, size: number): FilePreviewResult {
  const archive = readFileSync(filePath)
  const summary = extractSlidesPreview(archive)
  return {
    kind: 'slides',
    size,
    text: summary ? JSON.stringify(summary) : undefined,
    truncated: summary?.truncated === true
  }
}

function readZipEntry(archive: Buffer, entryName: string): Buffer | null {
  const entry = listZipEntries(archive).find((entry) => entry.name === entryName)
  return entry ? readZipEntryData(archive, entry) : null
}

function listZipEntries(archive: Buffer): ZipEntryRecord[] {
  const eocdOffset = findEndOfCentralDirectory(archive)
  if (eocdOffset < 0 || eocdOffset + 22 > archive.length) return []

  const entryCount = archive.readUInt16LE(eocdOffset + 10)
  let offset = archive.readUInt32LE(eocdOffset + 16)
  const entries: ZipEntryRecord[] = []
  for (let index = 0; index < entryCount && offset + 46 <= archive.length; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) return []
    const method = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const localHeaderOffset = archive.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    const name = archive.toString('utf8', nameStart, nameEnd)
    entries.push({ name, method, compressedSize, localHeaderOffset })
    offset = nameEnd + extraLength + commentLength
  }
  return entries
}

function readZipEntryData(archive: Buffer, entry: ZipEntryRecord): Buffer | null {
  if (entry.localHeaderOffset + 30 > archive.length || archive.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) return null
  const localNameLength = archive.readUInt16LE(entry.localHeaderOffset + 26)
  const localExtraLength = archive.readUInt16LE(entry.localHeaderOffset + 28)
  const dataStart = entry.localHeaderOffset + 30 + localNameLength + localExtraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > archive.length) return null
  const data = archive.subarray(dataStart, dataEnd)
  if (entry.method === 0) return Buffer.from(data)
  if (entry.method === 8) return inflateRawSync(data)
  return null
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const minimumOffset = Math.max(0, archive.length - 65_557)
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

function extractDocxPreview(xml: string, archive: Buffer): DocumentPreviewPayload {
  const body = /<w:body[\s\S]*?>([\s\S]*?)<\/w:body>/.exec(xml)?.[1] ?? xml
  const blocks: DocumentPreviewBlock[] = []
  let tableCount = 0
  let imageCount = 0
  const relationships = extractZipRelationships(archive, 'word/document.xml')
  for (const match of body.matchAll(/<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g)) {
    const tag = match[1]
    const blockXml = match[0] ?? ''
    if (tag === 'tbl') {
      const rows = extractDocxTableRows(blockXml)
      if (rows.length > 0) {
        blocks.push({ type: 'table', rows })
        tableCount += 1
      }
      continue
    }
    const text = extractDocxParagraphText(blockXml)
    if (text) blocks.push({ type: 'paragraph', text })
    const imageBlocks = extractDocxImageBlocks(blockXml, archive, relationships)
    if (imageBlocks.length > 0) {
      blocks.push(...imageBlocks)
      imageCount += imageBlocks.length
    }
  }
  if (blocks.length === 0) {
    const text = extractDocxParagraphText(xml)
    if (text) blocks.push({ type: 'paragraph', text })
  }
  return { blocks: blocks.slice(0, 80), tableCount, imageCount }
}

function extractDocxTableRows(xml: string): string[][] {
  return [...xml.matchAll(/<w:tr[\s\S]*?<\/w:tr>/g)]
    .slice(0, 20)
    .map((rowMatch) => [...(rowMatch[0] ?? '').matchAll(/<w:tc[\s\S]*?<\/w:tc>/g)]
      .slice(0, 10)
      .map((cellMatch) => extractDocxParagraphText(cellMatch[0] ?? '')))
    .filter((row) => row.some((cell) => cell.trim()))
}

function extractDocxParagraphText(xml: string): string {
  const normalized = xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
  const textRuns = [...normalized.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
  return textRuns.map((match) => decodeXmlText(match[1] ?? '')).join('').trim()
}

function extractDocxImageBlocks(xml: string, archive: Buffer, relationships: Map<string, string>): DocumentPreviewImageBlock[] {
  return [...xml.matchAll(/<(?:wp:inline|wp:anchor)\b[\s\S]*?<\/(?:wp:inline|wp:anchor)>/g)]
    .slice(0, 12)
    .flatMap((match) => {
      const imageXml = match[0] ?? ''
      const embedId = /\b(?:r:)?embed="([^"]+)"/.exec(imageXml)?.[1] ?? ''
      const target = relationships.get(embedId)
      if (!target) return []
      const image = readZipEntry(archive, target)
      const mimeType = imageMimeTypeForPath(target)
      if (!image || !mimeType || image.byteLength > 250_000) return []
      const extent = /<wp:extent\b([^>]*)\/>/.exec(imageXml)?.[1] ?? ''
      const width = numberAttribute(extent, 'cx')
      const height = numberAttribute(extent, 'cy')
      const docProperties = /<wp:docPr\b([^>]*)\/>/.exec(imageXml)?.[1] ?? ''
      return [{
        type: 'image' as const,
        dataUrl: `data:${mimeType};base64,${image.toString('base64')}`,
        mimeType,
        alt: docxImageAlt(docProperties),
        width: width ? Math.max(24, Math.round(width / 9_525)) : undefined,
        height: height ? Math.max(24, Math.round(height / 9_525)) : undefined
      }]
    })
}

function docxImageAlt(attributes: string): string | undefined {
  const description = /\bdescr="([^"]*)"/.exec(attributes)?.[1]
  const name = /\bname="([^"]*)"/.exec(attributes)?.[1]
  const value = decodeXmlText((description || name || '').trim())
  return value.length > 0 ? value : undefined
}

function extractSpreadsheetPreview(archive: Buffer): { sheets: SpreadsheetPreviewSheet[]; truncated: boolean } | null {
  const entries = listZipEntries(archive)
  const sharedStrings = extractSpreadsheetSharedStrings(readZipEntry(archive, 'xl/sharedStrings.xml')?.toString('utf8') ?? '')
  const styles = extractSpreadsheetStyles(readZipEntry(archive, 'xl/styles.xml')?.toString('utf8') ?? '')
  const workbookXml = readZipEntry(archive, 'xl/workbook.xml')?.toString('utf8') ?? ''
  const relationshipsXml = readZipEntry(archive, 'xl/_rels/workbook.xml.rels')?.toString('utf8') ?? ''
  const sheetTargets = extractWorkbookSheetTargets(workbookXml, relationshipsXml)
  const worksheetEntries = sheetTargets.length > 0
    ? sheetTargets
    : entries
      .map((entry) => entry.name)
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
      .sort(naturalCompare)
      .map((path, index) => ({ name: `Sheet ${index + 1}`, path }))
  const sheets: SpreadsheetPreviewSheet[] = []
  let truncated = false
  for (const sheet of worksheetEntries.slice(0, 6)) {
    const xml = readZipEntry(archive, sheet.path)?.toString('utf8') ?? ''
    if (!xml) continue
    const parsed = extractWorksheetRows(xml, sharedStrings, styles)
    truncated ||= parsed.truncated
    const merges = extractWorksheetMerges(xml)
    const tables = extractWorksheetTables(xml, archive, sheet.path)
    const conditionalFormats = extractWorksheetConditionalFormats(xml)
    applyWorksheetConditionalFormats(parsed.rows, conditionalFormats)
    const dataValidations = extractWorksheetDataValidations(xml)
    applyWorksheetDataValidations(parsed.rows, dataValidations)
    const columnWidths = extractWorksheetColumnWidths(xml)
    const rowHeights = extractWorksheetRowHeights(xml)
    const freezePanes = extractWorksheetFreezePanes(xml)
    sheets.push({
      name: sheet.name,
      rows: parsed.rows,
      ...(merges.length > 0 ? { merges } : {}),
      ...(tables.length > 0 ? { tables } : {}),
      ...(conditionalFormats.length > 0 ? { conditionalFormatCount: conditionalFormats.length } : {}),
      ...(dataValidations.length > 0 ? { dataValidationCount: dataValidations.length } : {}),
      ...(columnWidths.some((width) => width !== undefined) ? { columnWidths } : {}),
      ...(rowHeights.some((height) => height !== undefined) ? { rowHeights } : {}),
      ...(freezePanes ? { freezePanes } : {})
    })
  }
  if (worksheetEntries.length > 6) truncated = true
  return sheets.length > 0 ? { sheets, truncated } : null
}

function extractSlidesPreview(archive: Buffer): { slides: Array<{ index: number; title: string; text: string[]; notes: string; shapes: SlidePreviewShape[]; backgroundColor?: string }>; truncated: boolean } | null {
  const entries = listZipEntries(archive)
  const slideNames = entries
    .map((entry) => entry.name)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(naturalCompare)
  const slides: Array<{ index: number; title: string; text: string[]; notes: string; shapes: SlidePreviewShape[]; backgroundColor?: string }> = []
  let truncated = slideNames.length > 12
  for (const [index, name] of slideNames.slice(0, 12).entries()) {
    const xml = readZipEntry(archive, name)?.toString('utf8') ?? ''
    if (!xml) continue
    const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXmlText(match[1] ?? '').trim())
      .filter(Boolean)
    const shapes = extractSlideShapes(xml, archive, name)
    if (text.length > 12) truncated = true
    slides.push({
      index: index + 1,
      title: text[0] ?? `Slide ${index + 1}`,
      text: text.slice(1, 12),
      notes: extractSlideNotes(archive, name, index + 1),
      shapes,
      backgroundColor: extractSlideBackgroundColor(xml)
    })
  }
  return slides.length > 0 ? { slides, truncated } : null
}

function extractSlideBackgroundColor(xml: string): string | undefined {
  const backgroundXml = /<p:bg\b[\s\S]*?<\/p:bg>/.exec(xml)?.[0] ?? ''
  return backgroundXml ? extractSolidFillColor(backgroundXml) : undefined
}

function extractSlideShapes(xml: string, archive: Buffer, slidePath: string): SlidePreviewShape[] {
  return [
    ...extractSlideTextShapes(xml),
    ...extractSlidePictureShapes(xml, archive, slidePath)
  ].slice(0, 24)
}

function extractSlideTextShapes(xml: string): SlidePreviewShape[] {
  return [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)]
    .slice(0, 24)
    .flatMap((match) => {
      const shapeXml = match[0] ?? ''
      const text = [...shapeXml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
        .map((textMatch) => decodeXmlText(textMatch[1] ?? '').trim())
        .filter(Boolean)
      if (text.length === 0) return []
      const frame = extractSlideShapeFrame(shapeXml)
      if (!frame) return []
      return [{
        text,
        ...frame,
        fillColor: extractShapeFillColor(shapeXml),
        textColor: extractTextFillColor(shapeXml)
      }]
    })
}

function extractSlidePictureShapes(xml: string, archive: Buffer, slidePath: string): SlidePreviewShape[] {
  const relationships = extractZipRelationships(archive, slidePath)
  return [...xml.matchAll(/<p:pic\b[\s\S]*?<\/p:pic>/g)]
    .slice(0, 12)
    .flatMap((match) => {
      const pictureXml = match[0] ?? ''
      const embedId = /\b(?:r:)?embed="([^"]+)"/.exec(pictureXml)?.[1] ?? ''
      const target = relationships.get(embedId)
      if (!target) return []
      const image = readZipEntry(archive, target)
      const mimeType = imageMimeTypeForPath(target)
      const frame = extractSlideShapeFrame(pictureXml)
      if (!image || !mimeType || !frame || image.byteLength > 250_000) return []
      return [{
        text: [],
        ...frame,
        imageDataUrl: `data:${mimeType};base64,${image.toString('base64')}`,
        imageMimeType: mimeType
      }]
    })
}

function extractSlideShapeFrame(xml: string): Pick<SlidePreviewShape, 'x' | 'y' | 'width' | 'height'> | null {
  const transform = /<a:xfrm[\s\S]*?<a:off\b([^>]*)\/>[\s\S]*?<a:ext\b([^>]*)\/>[\s\S]*?<\/a:xfrm>/.exec(xml)
  if (!transform) return null
  const off = transform[1] ?? ''
  const ext = transform[2] ?? ''
  const x = numberAttribute(off, 'x')
  const y = numberAttribute(off, 'y')
  const width = numberAttribute(ext, 'cx')
  const height = numberAttribute(ext, 'cy')
  if ([x, y, width, height].some((value) => value === null) || width === 0 || height === 0) return null
  return {
    x: Math.max(0, Math.min(100, ((x ?? 0) / 12_192_000) * 100)),
    y: Math.max(0, Math.min(100, ((y ?? 0) / 6_858_000) * 100)),
    width: Math.max(1, Math.min(100, ((width ?? 0) / 12_192_000) * 100)),
    height: Math.max(1, Math.min(100, ((height ?? 0) / 6_858_000) * 100))
  }
}

function extractZipRelationships(archive: Buffer, partPath: string): Map<string, string> {
  const relsXml = readZipEntry(archive, zipRelationshipPathForPart(partPath))?.toString('utf8') ?? ''
  const relationships = new Map<string, string>()
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0] ?? ''
    const id = /\bId="([^"]+)"/.exec(tag)?.[1] ?? ''
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1] ?? ''
    if (id && target) relationships.set(id, resolveZipRelationshipTarget(partPath, target))
  }
  return relationships
}

function imageMimeTypeForPath(path: string): string | null {
  const extension = extname(path).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  return null
}

function extractShapeFillColor(xml: string): string | undefined {
  const shapeProperties = /<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(xml)?.[0] ?? ''
  return shapeProperties ? extractSolidFillColor(shapeProperties) : undefined
}

function extractTextFillColor(xml: string): string | undefined {
  const runProperties = /<a:rPr\b[\s\S]*?<\/a:rPr>/.exec(xml)?.[0] ?? ''
  return runProperties ? extractSolidFillColor(runProperties) : undefined
}

function extractSolidFillColor(xml: string): string | undefined {
  const solidFill = /<a:solidFill\b[\s\S]*?<\/a:solidFill>/.exec(xml)?.[0] ?? ''
  const srgb = /\ba:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(solidFill)?.[1]
  if (srgb) return `#${srgb.toUpperCase()}`
  const scheme = /\ba:schemeClr\b[^>]*\bval="([^"]+)"/.exec(solidFill)?.[1]
  if (!scheme) return undefined
  return schemeColorFallback(scheme)
}

function schemeColorFallback(value: string): string | undefined {
  const colors: Record<string, string> = {
    accent1: '#4472C4',
    accent2: '#ED7D31',
    accent3: '#A5A5A5',
    accent4: '#FFC000',
    accent5: '#5B9BD5',
    accent6: '#70AD47',
    bg1: '#FFFFFF',
    bg2: '#000000',
    tx1: '#000000',
    tx2: '#FFFFFF'
  }
  return colors[value]
}

function numberAttribute(attributes: string, name: string): number | null {
  const value = new RegExp(`\\b${name}="(-?\\d+)"`).exec(attributes)?.[1]
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function decimalAttribute(attributes: string, name: string): number | null {
  const value = new RegExp(`\\b${name}="(-?\\d+(?:\\.\\d+)?)"`).exec(attributes)?.[1]
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function extractSlideNotes(archive: Buffer, slidePath: string, slideIndex: number): string {
  const relsXml = readZipEntry(archive, zipRelationshipPathForPart(slidePath))?.toString('utf8') ?? ''
  let notesPath = ''
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0] ?? ''
    const type = /\bType="([^"]+)"/.exec(tag)?.[1] ?? ''
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1] ?? ''
    if (type.endsWith('/notesSlide') && target) {
      notesPath = resolveZipRelationshipTarget(slidePath, target)
      break
    }
  }
  const fallbackPath = `ppt/notesSlides/notesSlide${slideIndex}.xml`
  const xml = readZipEntry(archive, notesPath)?.toString('utf8') ?? readZipEntry(archive, fallbackPath)?.toString('utf8') ?? ''
  return extractXmlText(xml).trim()
}

function zipRelationshipPathForPart(partPath: string): string {
  const parts = partPath.split('/')
  const fileName = parts.pop() ?? ''
  return [...parts, '_rels', `${fileName}.rels`].filter(Boolean).join('/')
}

function resolveZipRelationshipTarget(sourcePartPath: string, target: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return ''
  if (target.startsWith('/')) return target.replace(/^\/+/, '')
  const parts = sourcePartPath.split('/')
  parts.pop()
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

function extractSpreadsheetSharedStrings(xml: string): string[] {
  if (!xml) return []
  return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)]
    .map((match) => extractXmlText(match[0] ?? ''))
}

function extractWorkbookSheetTargets(workbookXml: string, relationshipsXml: string): Array<{ name: string; path: string }> {
  if (!workbookXml) return []
  const relationships = new Map<string, string>()
  for (const match of relationshipsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    const target = match[2] ?? ''
    relationships.set(match[1] ?? '', target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\/?xl\//, '')}`)
  }
  return [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)]
    .map((match, index) => {
      const tag = match[0] ?? ''
      const relId = /\br:id="([^"]+)"/.exec(tag)?.[1] ?? ''
      return {
        name: decodeXmlText(/\bname="([^"]+)"/.exec(tag)?.[1] ?? `Sheet ${index + 1}`),
        path: relationships.get(relId) ?? `xl/worksheets/sheet${index + 1}.xml`
      }
    })
}

function extractWorksheetRows(xml: string, sharedStrings: string[], styles: SpreadsheetCellStyle[]): { rows: SpreadsheetPreviewCell[][]; truncated: boolean } {
  const rows: SpreadsheetPreviewCell[][] = []
  const cellsByAddress = new Map<string, SpreadsheetPreviewCell>()
  let truncated = false
  for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const cells: SpreadsheetPreviewCell[] = []
    for (const cellMatch of (rowMatch[0] ?? '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? ''
      const cellXml = cellMatch[2] ?? ''
      const type = /t="([^"]+)"/.exec(attributes)?.[1] ?? ''
      const address = /\br="([^"]+)"/.exec(attributes)?.[1]?.toUpperCase() ?? ''
      const columnIndex = address ? spreadsheetColumnIndex(address) : cells.length
      while (cells.length < columnIndex) cells.push({ value: '' })
      const formula = decodeXmlText(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(cellXml)?.[1] ?? '').trim()
      const cell: SpreadsheetPreviewCell = { value: '' }
      const style = spreadsheetCellStyle(attributes, styles)
      Object.assign(cell, style)
      if (formula) cell.formula = formula.startsWith('=') ? formula : `=${formula}`
      if (type === 's') {
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1] ?? -1)
        cell.value = Number.isFinite(index) && index >= 0 ? sharedStrings[index] ?? '' : ''
      } else if (type === 'inlineStr') {
        cell.value = extractXmlText(cellXml)
      } else {
        cell.value = decodeXmlText(/<v>([\s\S]*?)<\/v>/.exec(cellXml)?.[1] ?? '').trim()
      }
      cells[columnIndex] = cell
      if (address) cellsByAddress.set(address, cell)
      if (cells.length >= 12) {
        truncated = true
        break
      }
    }
    if (cells.some((cell) => cell.value || cell.formula)) rows.push(cells)
    if (rows.length >= 24) {
      truncated = true
      break
    }
  }
  evaluateWorksheetFormulas(rows, cellsByAddress)
  return { rows, truncated }
}

function extractWorksheetMerges(xml: string): SpreadsheetPreviewMerge[] {
  return [...xml.matchAll(/<mergeCell\b[^>]*ref="([^"]+)"[^>]*\/>/g)]
    .slice(0, 24)
    .flatMap((match) => {
      const ref = (match[1] ?? '').toUpperCase()
      const [startAddress, endAddress] = ref.split(':')
      const start = spreadsheetCellPosition(startAddress)
      const end = spreadsheetCellPosition(endAddress ?? startAddress)
      if (!start || !end) return []
      const startRow = Math.min(start.row, end.row)
      const endRow = Math.max(start.row, end.row)
      const startColumn = Math.min(start.column, end.column)
      const endColumn = Math.max(start.column, end.column)
      const rowSpan = endRow - startRow + 1
      const colSpan = endColumn - startColumn + 1
      if (rowSpan <= 1 && colSpan <= 1) return []
      if (startRow >= 24 || startColumn >= 12) return []
      return [{
        ref,
        startRow,
        startColumn,
        rowSpan: Math.min(rowSpan, 24 - startRow),
        colSpan: Math.min(colSpan, 12 - startColumn)
      }]
    })
}

function extractWorksheetTables(xml: string, archive: Buffer, sheetPath: string): SpreadsheetPreviewTable[] {
  const tableRelIds = [...xml.matchAll(/<tablePart\b[^>]*r:id="([^"]+)"[^>]*\/>/g)]
    .map((match) => match[1] ?? '')
    .filter(Boolean)
    .slice(0, 8)
  if (tableRelIds.length === 0) return []
  const relsXml = readZipEntry(archive, zipRelationshipPathForPart(sheetPath))?.toString('utf8') ?? ''
  const relationships = new Map<string, string>()
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0] ?? ''
    const id = /\bId="([^"]+)"/.exec(tag)?.[1] ?? ''
    const type = /\bType="([^"]+)"/.exec(tag)?.[1] ?? ''
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1] ?? ''
    if (id && target && type.endsWith('/table')) relationships.set(id, resolveZipRelationshipTarget(sheetPath, target))
  }
  return tableRelIds.flatMap((relId) => {
    const tablePath = relationships.get(relId)
    const tableXml = tablePath ? readZipEntry(archive, tablePath)?.toString('utf8') ?? '' : ''
    if (!tableXml) return []
    const tableTag = /<table\b([^>]*)>/.exec(tableXml)?.[1] ?? ''
    const ref = /\bref="([^"]+)"/.exec(tableTag)?.[1]?.toUpperCase() ?? ''
    const [startAddress, endAddress] = ref.split(':')
    const start = spreadsheetCellPosition(startAddress)
    const end = spreadsheetCellPosition(endAddress ?? startAddress)
    if (!start || !end) return []
    const startRow = Math.min(start.row, end.row)
    const endRow = Math.max(start.row, end.row)
    const startColumn = Math.min(start.column, end.column)
    const endColumn = Math.max(start.column, end.column)
    if (startRow >= 24 || startColumn >= 12) return []
    const styleTag = /<tableStyleInfo\b([^>]*)\/>/.exec(tableXml)?.[1] ?? ''
    const name = decodeXmlText(
      /\bdisplayName="([^"]+)"/.exec(tableTag)?.[1] ??
      /\bname="([^"]+)"/.exec(tableTag)?.[1] ??
      'Table'
    )
    return [{
      ref,
      name,
      startRow,
      startColumn,
      rowSpan: Math.min(endRow - startRow + 1, 24 - startRow),
      colSpan: Math.min(endColumn - startColumn + 1, 12 - startColumn),
      ...(/\bname="([^"]+)"/.exec(styleTag)?.[1] ? { styleName: /\bname="([^"]+)"/.exec(styleTag)?.[1] } : {}),
      ...(/<autoFilter\b/.test(tableXml) ? { showFilterButton: true } : {}),
      ...(/\bshowRowStripes="1"/.test(styleTag) ? { showRowStripes: true } : {})
    }]
  })
}

function extractWorksheetConditionalFormats(xml: string): SpreadsheetPreviewConditionalFormat[] {
  return [...xml.matchAll(/<conditionalFormatting\b([^>]*)>([\s\S]*?)<\/conditionalFormatting>/g)]
    .slice(0, 12)
    .flatMap((match) => {
      const attributes = match[1] ?? ''
      const body = match[2] ?? ''
      const sqref = /\bsqref="([^"]+)"/.exec(attributes)?.[1] ?? ''
      const colorScale = /<cfRule\b[^>]*\btype="colorScale"[^>]*>[\s\S]*?<colorScale\b[\s\S]*?<\/colorScale>[\s\S]*?<\/cfRule>/.exec(body)?.[0] ?? ''
      if (!sqref || !colorScale) return []
      const colors = [...colorScale.matchAll(/<color\b[^>]*\/>/g)]
        .map((colorMatch) => extractSpreadsheetColor(colorMatch[0] ?? ''))
        .filter((color): color is string => Boolean(color))
        .slice(0, 3)
      if (colors.length < 2) return []
      return sqref
        .split(/\s+/)
        .filter(Boolean)
        .flatMap((ref) => {
          const range = spreadsheetRangePosition(ref.toUpperCase())
          if (!range) return []
          return [{
            ref: ref.toUpperCase(),
            startRow: range.startRow,
            startColumn: range.startColumn,
            rowSpan: range.endRow - range.startRow + 1,
            colSpan: range.endColumn - range.startColumn + 1,
            colors
          }]
        })
    })
    .filter((format) => format.startRow < 24 && format.startColumn < 12)
    .map((format) => ({
      ...format,
      rowSpan: Math.min(format.rowSpan, 24 - format.startRow),
      colSpan: Math.min(format.colSpan, 12 - format.startColumn)
    }))
}

function applyWorksheetConditionalFormats(rows: SpreadsheetPreviewCell[][], formats: SpreadsheetPreviewConditionalFormat[]): void {
  for (const format of formats) {
    const cells: Array<{ cell: SpreadsheetPreviewCell; value: number }> = []
    for (let rowIndex = format.startRow; rowIndex < format.startRow + format.rowSpan; rowIndex += 1) {
      const row = rows[rowIndex]
      if (!row) continue
      for (let columnIndex = format.startColumn; columnIndex < format.startColumn + format.colSpan; columnIndex += 1) {
        const cell = row[columnIndex]
        if (!cell) continue
        const value = Number(cell.value)
        if (Number.isFinite(value)) cells.push({ cell, value })
      }
    }
    if (cells.length === 0) continue
    const values = cells.map((item) => item.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    for (const item of cells) {
      const position = max === min ? 0 : (item.value - min) / (max - min)
      item.cell.conditionalFillColor = spreadsheetColorScaleValue(format.colors, position)
    }
  }
}

function spreadsheetColorScaleValue(colors: string[], position: number): string {
  if (colors.length >= 3) {
    if (position <= 0.5) return interpolateSpreadsheetColor(colors[0], colors[1], position * 2)
    return interpolateSpreadsheetColor(colors[1], colors[2], (position - 0.5) * 2)
  }
  return interpolateSpreadsheetColor(colors[0], colors[1], position)
}

function interpolateSpreadsheetColor(startColor: string, endColor: string, position: number): string {
  const start = spreadsheetColorChannels(startColor)
  const end = spreadsheetColorChannels(endColor)
  const clamped = Math.max(0, Math.min(1, position))
  return `#${start.map((channel, index) => {
    const value = Math.round(channel + (end[index] - channel) * clamped)
    return value.toString(16).padStart(2, '0').toUpperCase()
  }).join('')}`
}

function spreadsheetColorChannels(color: string): [number, number, number] {
  const hex = color.replace(/^#/, '').slice(-6)
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ]
}

function spreadsheetRangePosition(ref: string): { startRow: number; startColumn: number; endRow: number; endColumn: number } | null {
  const [startAddress, endAddress] = ref.split(':')
  const start = spreadsheetCellPosition(startAddress)
  const end = spreadsheetCellPosition(endAddress ?? startAddress)
  if (!start || !end) return null
  return {
    startRow: Math.min(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endRow: Math.max(start.row, end.row),
    endColumn: Math.max(start.column, end.column)
  }
}

function extractWorksheetDataValidations(xml: string): SpreadsheetPreviewDataValidationRange[] {
  return [...xml.matchAll(/<dataValidation\b([^>]*)>([\s\S]*?)<\/dataValidation>/g)]
    .slice(0, 12)
    .flatMap((match) => {
      const attributes = match[1] ?? ''
      const body = match[2] ?? ''
      if (!/\btype="list"/.test(attributes)) return []
      const sqref = /\bsqref="([^"]+)"/.exec(attributes)?.[1] ?? ''
      if (!sqref) return []
      const values = spreadsheetDataValidationListValues(body)
      const allowBlank = /\ballowBlank="(?:1|true)"/i.test(attributes)
      return sqref
        .split(/\s+/)
        .filter(Boolean)
        .flatMap((ref) => {
          const range = spreadsheetRangePosition(ref.toUpperCase())
          if (!range) return []
          return [{
            ref: ref.toUpperCase(),
            startRow: range.startRow,
            startColumn: range.startColumn,
            rowSpan: range.endRow - range.startRow + 1,
            colSpan: range.endColumn - range.startColumn + 1,
            type: 'list' as const,
            ...(values.length > 0 ? { values } : {}),
            ...(allowBlank ? { allowBlank: true } : {})
          }]
        })
    })
    .filter((validation) => validation.startRow < 24 && validation.startColumn < 12)
    .map((validation) => ({
      ...validation,
      rowSpan: Math.min(validation.rowSpan, 24 - validation.startRow),
      colSpan: Math.min(validation.colSpan, 12 - validation.startColumn)
    }))
}

function spreadsheetDataValidationListValues(xml: string): string[] {
  const formula = decodeXmlText(/<formula1(?:\s[^>]*)?>([\s\S]*?)<\/formula1>/.exec(xml)?.[1] ?? '').trim()
  const inlineList = /^"([\s\S]*)"$/.exec(formula)?.[1]
  if (!inlineList) return []
  return inlineList
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 24)
}

function applyWorksheetDataValidations(rows: SpreadsheetPreviewCell[][], validations: SpreadsheetPreviewDataValidationRange[]): void {
  for (const validation of validations) {
    for (let rowIndex = validation.startRow; rowIndex < validation.startRow + validation.rowSpan; rowIndex += 1) {
      const row = rows[rowIndex]
      if (!row) continue
      for (let columnIndex = validation.startColumn; columnIndex < validation.startColumn + validation.colSpan; columnIndex += 1) {
        const cell = row[columnIndex]
        if (!cell) continue
        cell.dataValidation = {
          type: validation.type,
          ...(validation.values ? { values: validation.values } : {}),
          ...(validation.allowBlank ? { allowBlank: true } : {})
        }
      }
    }
  }
}

function extractWorksheetColumnWidths(xml: string): Array<number | undefined> {
  const widths: Array<number | undefined> = []
  for (const match of xml.matchAll(/<col\b([^>]*)\/>/g)) {
    const attributes = match[1] ?? ''
    const min = numberAttribute(attributes, 'min')
    const max = numberAttribute(attributes, 'max')
    const width = decimalAttribute(attributes, 'width')
    if (min === null || max === null || width === null) continue
    const start = Math.max(0, min - 1)
    const end = Math.min(11, max - 1)
    const pixels = Math.max(48, Math.min(320, Math.round(width * 7 + 5)))
    for (let index = start; index <= end; index += 1) widths[index] = pixels
  }
  return widths.slice(0, 12)
}

function extractWorksheetRowHeights(xml: string): Array<number | undefined> {
  const heights: Array<number | undefined> = []
  for (const match of xml.matchAll(/<row\b([^>]*)>/g)) {
    const attributes = match[1] ?? ''
    const row = numberAttribute(attributes, 'r')
    const height = decimalAttribute(attributes, 'ht')
    if (row === null || height === null) continue
    const index = row - 1
    if (index < 0 || index >= 24) continue
    heights[index] = Math.max(22, Math.min(180, Math.round(height * 96 / 72)))
  }
  return heights.slice(0, 24)
}

function extractWorksheetFreezePanes(xml: string): SpreadsheetFreezePanes | null {
  const paneTag = /<pane\b([^>]*)\/>/.exec(xml)?.[1] ?? ''
  if (!paneTag || !/\bstate="frozen(?:Split)?"/i.test(paneTag)) return null
  const rows = Math.max(0, Math.min(6, Math.round(decimalAttribute(paneTag, 'ySplit') ?? 0)))
  const columns = Math.max(0, Math.min(6, Math.round(decimalAttribute(paneTag, 'xSplit') ?? 0)))
  return rows > 0 || columns > 0 ? { rows, columns } : null
}

function extractSpreadsheetStyles(xml: string): SpreadsheetCellStyle[] {
  if (!xml) return []
  const fonts = [...xml.matchAll(/<font\b[\s\S]*?<\/font>/g)].map((match) => {
    const fontXml = match[0] ?? ''
    return {
      bold: /<b(?:\s[^>]*)?\/>/.test(fontXml),
      textColor: extractSpreadsheetColor(fontXml)
    }
  })
  const fills = [...xml.matchAll(/<fill\b[\s\S]*?<\/fill>/g)].map((match) => extractSpreadsheetColor(match[0] ?? ''))
  return [...xml.matchAll(/<cellXfs\b[\s\S]*?<\/cellXfs>/g)][0]?.[0]
    ?.match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)
    ?.map((xfXml) => {
      const attributes = /<xf\b([^>]*)/.exec(xfXml)?.[1] ?? ''
      const alignmentAttributes = /<alignment\b([^>]*)\/>/.exec(xfXml)?.[1] ?? ''
      const horizontalAlignment = spreadsheetHorizontalAlignment(alignmentAttributes)
      const verticalAlignment = spreadsheetVerticalAlignment(alignmentAttributes)
      const wrapText = /\bwrapText="(?:1|true)"/i.test(alignmentAttributes)
      const fontId = numberAttribute(attributes, 'fontId') ?? 0
      const fillId = numberAttribute(attributes, 'fillId') ?? 0
      const font = fonts[fontId] ?? {}
      const fillColor = fills[fillId]
      return {
        ...(fillColor ? { fillColor } : {}),
        ...(font.textColor ? { textColor: font.textColor } : {}),
        ...(font.bold ? { bold: true } : {}),
        ...(wrapText ? { wrapText: true } : {}),
        ...(horizontalAlignment ? { horizontalAlignment } : {}),
        ...(verticalAlignment ? { verticalAlignment } : {})
      }
    }) ?? []
}

function spreadsheetCellStyle(attributes: string, styles: SpreadsheetCellStyle[]): SpreadsheetCellStyle {
  const styleIndex = numberAttribute(attributes, 's')
  if (styleIndex === null) return {}
  return styles[styleIndex] ?? {}
}

function extractSpreadsheetColor(xml: string): string | undefined {
  const tag = /<(?:fgColor|color)\b([^>]*)\/>/.exec(xml)?.[1] ?? ''
  const rgb = /\brgb="([A-Fa-f0-9]{6,8})"/.exec(tag)?.[1]
  if (rgb) return `#${rgb.slice(-6).toUpperCase()}`
  return undefined
}

function spreadsheetHorizontalAlignment(attributes: string): 'left' | 'center' | 'right' | undefined {
  const value = /\bhorizontal="([^"]+)"/.exec(attributes)?.[1]
  if (value === 'left' || value === 'center' || value === 'right') return value
  return undefined
}

function spreadsheetVerticalAlignment(attributes: string): 'top' | 'middle' | 'bottom' | undefined {
  const value = /\bvertical="([^"]+)"/.exec(attributes)?.[1]
  if (value === 'top' || value === 'bottom') return value
  if (value === 'center') return 'middle'
  return undefined
}

function spreadsheetColumnIndex(address: string): number {
  const letters = /^[A-Z]+/.exec(address)?.[0] ?? ''
  let value = 0
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64)
  return Math.max(0, value - 1)
}

function spreadsheetCellPosition(address: string | undefined): { row: number; column: number } | null {
  if (!address) return null
  const match = /^([A-Z]+)(\d+)$/i.exec(address.trim())
  if (!match) return null
  const row = Number(match[2]) - 1
  const column = spreadsheetColumnIndex(match[1])
  return Number.isFinite(row) && row >= 0 && column >= 0 ? { row, column } : null
}

function evaluateWorksheetFormulas(rows: SpreadsheetPreviewCell[][], cellsByAddress: Map<string, SpreadsheetPreviewCell>): void {
  for (const row of rows) {
    for (const cell of row) {
      if (!cell.formula) continue
      const computed = evaluateSpreadsheetFormula(cell.formula, cellsByAddress)
      if (computed !== null) cell.value = formatSpreadsheetNumber(computed)
    }
  }
}

function evaluateSpreadsheetFormula(formula: string, cellsByAddress: Map<string, SpreadsheetPreviewCell>): number | null {
  const expression = formula.replace(/^=/, '').trim()
  const sumMatch = /^SUM\(([^)]+)\)$/i.exec(expression)
  if (sumMatch) {
    return sumMatch[1]
      .split(',')
      .flatMap((part) => spreadsheetFormulaValues(part.trim(), cellsByAddress))
      .reduce((total, value) => total + value, 0)
  }
  const arithmetic = expression.replace(/\b[A-Z]{1,3}\d+\b/g, (address) => String(spreadsheetCellNumber(cellsByAddress.get(address.toUpperCase()))))
  if (!/^[\d+\-*/().\s]+$/.test(arithmetic)) return null
  try {
    const value = Function(`"use strict"; return (${arithmetic})`)() as unknown
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function spreadsheetFormulaValues(reference: string, cellsByAddress: Map<string, SpreadsheetPreviewCell>): number[] {
  const rangeMatch = /^([A-Z]{1,3})(\d+):([A-Z]{1,3})(\d+)$/i.exec(reference)
  if (!rangeMatch) return [spreadsheetCellNumber(cellsByAddress.get(reference.toUpperCase()))]
  const startColumn = spreadsheetColumnIndex(rangeMatch[1].toUpperCase())
  const endColumn = spreadsheetColumnIndex(rangeMatch[3].toUpperCase())
  const startRow = Number(rangeMatch[2])
  const endRow = Number(rangeMatch[4])
  const values: number[] = []
  for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row += 1) {
    for (let column = Math.min(startColumn, endColumn); column <= Math.max(startColumn, endColumn); column += 1) {
      values.push(spreadsheetCellNumber(cellsByAddress.get(`${spreadsheetColumnName(column)}${row}`)))
    }
  }
  return values
}

function spreadsheetColumnName(index: number): string {
  let value = index + 1
  let label = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

function spreadsheetCellNumber(cell: SpreadsheetPreviewCell | undefined): number {
  const value = Number(cell?.value ?? 0)
  return Number.isFinite(value) ? value : 0
}

function formatSpreadsheetNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toFixed(8)))
}

function extractXmlText(xml: string): string {
  return [...xml.matchAll(/<[^:>]*:?t(?:\s[^>]*)?>([\s\S]*?)<\/[^:>]*:?t>/g)]
    .map((match) => decodeXmlText(match[1] ?? ''))
    .join('')
}

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function writeBrowserDataUrlArtifact(dataUrl: string, suggestedName?: string): { path: string; size: number } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) throw new Error('Invalid browser artifact data URL')
  const isBase64 = match[2] === ';base64'
  const payload = match[3] ?? ''
  const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
  const dir = join(tmpdir(), BROWSER_ARTIFACT_DIR)
  mkdirSync(dir, { recursive: true })
  const safeName = sanitizeArtifactName(suggestedName || `browser-screenshot-${Date.now()}.png`)
  const filePath = join(dir, uniqueArtifactName(dir, safeName))
  writeFileSync(filePath, buffer)
  return { path: filePath, size: buffer.byteLength }
}

function writePastedAttachment(request: PastedAttachmentRequest): { path: string; name: string; size: number; mimeType?: string } {
  const buffer = request.bytes instanceof ArrayBuffer
    ? Buffer.from(request.bytes)
    : Buffer.from(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength)
  const dir = join(tmpdir(), COMPOSER_ATTACHMENT_DIR)
  mkdirSync(dir, { recursive: true })
  const name = clipboardAttachmentName(request.name, request.mimeType)
  const filePath = join(dir, uniqueArtifactName(dir, name))
  writeFileSync(filePath, buffer)
  return {
    path: filePath,
    name: basename(filePath),
    size: buffer.byteLength,
    mimeType: request.mimeType || undefined
  }
}

async function bundleBrowserAssets(request: BrowserAssetRequest): Promise<{
  directoryPath: string
  manifestPath: string
  assets: Array<{ id: string; kind: string; name: string; url: string; path: string; contentType: string | null }>
  failures: Array<{ id: string; kind: string; name: string; url: string; reason: string }>
  summary: { requestedCount: number; downloadedCount: number; failedCount: number }
}> {
  const dir = join(tmpdir(), BROWSER_ARTIFACT_DIR, sanitizeArtifactName(request.inventoryId || `inventory-${Date.now()}`))
  mkdirSync(dir, { recursive: true })
  const downloaded: Array<{ id: string; kind: string; name: string; url: string; path: string; contentType: string | null }> = []
  const failures: Array<{ id: string; kind: string; name: string; url: string; reason: string }> = []

  for (const asset of request.assets.slice(0, 80)) {
    try {
      if (!/^https?:/i.test(asset.url) && !/^data:/i.test(asset.url)) {
        throw new Error('Only http, https, and data URLs can be bundled')
      }
      const safeName = uniqueArtifactName(dir, sanitizeArtifactName(asset.name || `${asset.kind}-${asset.id}`))
      const filePath = join(dir, safeName)
      let contentType: string | null = null
      let buffer: Buffer
      if (/^data:/i.test(asset.url)) {
        const saved = writeBrowserDataUrlArtifact(asset.url, safeName)
        buffer = Buffer.from(readFileSync(saved.path))
        contentType = /^data:([^;,]+)/i.exec(asset.url)?.[1] ?? null
      } else {
        const response = await fetch(asset.url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        contentType = response.headers.get('content-type')
        buffer = Buffer.from(await response.arrayBuffer())
      }
      writeFileSync(filePath, buffer)
      downloaded.push({ ...asset, path: filePath, contentType })
    } catch (error) {
      failures.push({ ...asset, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  const manifestPath = join(dir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify({
    pageUrl: request.pageUrl ?? null,
    inventoryId: request.inventoryId,
    assets: downloaded,
    failures,
    summary: {
      requestedCount: request.assets.length,
      downloadedCount: downloaded.length,
      failedCount: failures.length
    }
  }, null, 2))

  return {
    directoryPath: dir,
    manifestPath,
    assets: downloaded,
    failures,
    summary: {
      requestedCount: request.assets.length,
      downloadedCount: downloaded.length,
      failedCount: failures.length
    }
  }
}

async function discoverBrowserLocalTargets(recentUrls: string[] = []): Promise<BrowserLocalTarget[]> {
  const candidates = new Map<string, BrowserLocalTarget['source']>()
  for (const port of BROWSER_LOCAL_TARGET_PORTS) {
    candidates.set(`http://127.0.0.1:${port}/`, 'port-scan')
  }
  const smokeUrl = normalizeLocalBrowserUrl(process.env.ORCHESTRATOR_BROWSER_SMOKE_URL)
  if (smokeUrl) candidates.set(smokeUrl, 'recent')
  for (const url of recentUrls.slice(0, 12)) {
    const normalized = normalizeLocalBrowserUrl(url)
    if (normalized) candidates.set(normalized, 'recent')
  }

  const targets = await Promise.all(
    [...candidates.entries()].slice(0, 28).map(([url, source]) => probeBrowserLocalTarget(url, source))
  )
  const seen = new Set<string>()
  return targets
    .filter((target): target is BrowserLocalTarget => Boolean(target))
    .filter((target) => {
      const key = target.url.replace(/\/+$/, '')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 6)
}

function normalizeLocalBrowserUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const parsed = new URL(raw.trim())
    if (parsed.protocol !== 'http:') return null
    if (!['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(parsed.hostname)) return null
    parsed.hostname = '127.0.0.1'
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return null
  }
}

function probeBrowserLocalTarget(url: string, source: BrowserLocalTarget['source']): Promise<BrowserLocalTarget | null> {
  return new Promise((resolve) => {
    const request = httpRequest(url, {
      method: 'GET',
      timeout: 700,
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.1',
        'User-Agent': 'Orchestrator local browser discovery'
      }
    }, (response) => {
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer) => {
        if (length >= 16_384) return
        const next = chunk.subarray(0, Math.max(0, 16_384 - length))
        chunks.push(next)
        length += next.byteLength
      })
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        const title = /<title[^>]*>([^<]+)<\/title>/i.exec(body)?.[1]?.replace(/\s+/g, ' ').trim() || null
        resolve({ url, title, source })
      })
    })
    request.on('timeout', () => {
      request.destroy()
      resolve(null)
    })
    request.on('error', () => resolve(null))
    request.end()
  })
}

function sanitizeArtifactName(name: string): string {
  const compact = name.replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96)
  return compact || `artifact-${Date.now()}`
}

function clipboardAttachmentName(name?: string, mimeType?: string): string {
  const extension = mimeType ? MIME_EXTENSIONS[mimeType.toLowerCase()] : ''
  const fallback = mimeType?.startsWith('image/') ? `pasted-image-${Date.now()}${extension || '.png'}` : `pasted-file-${Date.now()}${extension}`
  const safeName = sanitizeArtifactName(basename(name || fallback))
  return extension && !extname(safeName) ? `${safeName}${extension}` : safeName
}

function uniqueArtifactName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name
  const extension = extname(name)
  const stem = extension ? name.slice(0, -extension.length) : name
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}${extension}`
    if (!existsSync(join(dir, candidate))) return candidate
  }
  return `${stem}-${Date.now()}${extension}`
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false
  let suspicious = 0
  const sampleLength = Math.min(buffer.length, 4096)
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = buffer[index]
    if (byte === 0) return true
    const allowedControl = byte === 7 || byte === 8 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 27
    if (byte < 32 && !allowedControl) suspicious += 1
  }
  return suspicious / sampleLength > 0.08
}

async function openPathWithPreferredEditor(filePath: string, options: OpenPathOptions = {}): Promise<OpenPathResult> {
  const preferredTarget = normalizePreferredOpenTarget(options.target ?? settingsStore.get('preferredEditor', 'system'))
  const target = editorOpenTarget(preferredTarget)
  if (!target) return openWithSystem(filePath, options, 'system')
  if (process.platform !== 'darwin') return openWithSystem(filePath, options, preferredTarget)

  const cliResult = await openWithCliTarget(target, filePath, options)
  if (cliResult.ok) return cliResult

  const lineUrl = editorFileUrl(target.urlScheme, filePath, options)
  if (lineUrl) {
    try {
      await shell.openExternal(lineUrl)
      return openResult(filePath, preferredTarget, 'url-scheme', options, true, { openedWith: lineUrl, fallbackFrom: cliResult.attempted ? 'cli' : undefined })
    } catch {
      // Fall through to opening the file in the selected app.
    }
  }

  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-a', target.macAppName, filePath], (error, _stdout, stderr) => {
      if (!error) {
        resolve(openResult(filePath, preferredTarget, 'app', options, true, {
          openedWith: target.macAppName,
          fallbackFrom: lineUrl ? 'url-scheme' : cliResult.attempted ? 'cli' : undefined
        }))
        return
      }
      const details = stderr.trim() || error.message
      resolve(openResult(filePath, preferredTarget, 'app', options, false, {
        openedWith: target.macAppName,
        fallbackFrom: lineUrl ? 'url-scheme' : cliResult.attempted ? 'cli' : undefined,
        message: `Unable to open in ${target.label}${details ? `: ${details}` : '.'}`
      }))
    })
  })
}

async function openWithSystem(filePath: string, options: OpenPathOptions, target: PreferredOpenTarget): Promise<OpenPathResult> {
  const message = await shell.openPath(filePath)
  return openResult(filePath, target, 'system', options, message === '', {
    openedWith: 'system',
    message: message || undefined
  })
}

function openResult(
  filePath: string,
  target: PreferredOpenTarget,
  method: OpenPathMethod,
  options: OpenPathOptions,
  ok: boolean,
  extras: Pick<OpenPathResult, 'message' | 'openedWith' | 'fallbackFrom'> = {}
): OpenPathResult {
  return {
    ok,
    filePath,
    target,
    method,
    line: options.line,
    column: options.column,
    ...extras
  }
}

async function openWithCliTarget(target: EditorOpenTarget, filePath: string, options: OpenPathOptions): Promise<OpenPathResult & { attempted: boolean }> {
  const args = editorCliTargets(target, filePath, options)
  if (args.length === 0) return { ...openResult(filePath, target.id, 'cli', options, false), attempted: false }
  const command = findCliCommand(target.cli?.commands ?? [])
  if (!command) return { ...openResult(filePath, target.id, 'cli', options, false, { message: `${target.label} CLI was not found.` }), attempted: false }
  return new Promise((resolve) => {
    execFile(command, args, (error, _stdout, stderr) => {
      if (!error) {
        resolve({ ...openResult(filePath, target.id, 'cli', options, true, { openedWith: command }), attempted: true })
        return
      }
      resolve({ ...openResult(filePath, target.id, 'cli', options, false, { openedWith: command, message: stderr.trim() || error.message }), attempted: true })
    })
  })
}

function findCliCommand(candidates: string[]): string | null {
  return findExecutableCommand(candidates, process.env.PATH, existsSync)
}

async function listOpenTargets(): Promise<OpenTargetAvailability[]> {
  const targets: OpenTargetAvailability[] = [{
    id: 'system',
    label: 'System default',
    available: true,
    methods: ['system'],
    supportsLineTarget: false
  }]

  for (const target of Object.values(EDITOR_OPEN_TARGETS)) {
    targets.push(await openTargetAvailability(target))
  }

  return targets
}

async function openTargetAvailability(target: EditorOpenTarget): Promise<OpenTargetAvailability> {
  const methods: OpenPathMethod[] = []
  const cli = findCliCommand(target.cli?.commands ?? [])
  if (cli) methods.push('cli')
  const appAvailable = process.platform === 'darwin' && await macAppIsRegistered(target.macAppName)
  if (target.urlScheme && appAvailable) methods.push('url-scheme')
  if (appAvailable) methods.push('app')

  return {
    id: target.id,
    label: target.label,
    available: methods.length > 0,
    methods,
    supportsLineTarget: Boolean(target.urlScheme || target.cli),
    appName: target.macAppName,
    unavailableReason: methods.length > 0 ? undefined : `${target.label} was not found on this Mac.`
  }
}

async function macAppIsRegistered(appName: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  return new Promise((resolve) => {
    execFile('/usr/bin/open', ['-Ra', appName], (error) => {
      resolve(!error)
    })
  })
}

function formatConversationMarkdown(session: Session | undefined): string {
  if (!session) return '# Conversation\n\n_Conversation not found._\n'

  const lines: string[] = [`# ${session.name}`]
  lines.push(
    '',
    `Provider: ${session.provider}`,
    `Model: ${session.model}`,
    `Working directory: \`${session.workDir}\``,
    `Created: ${new Date(session.createdAt).toISOString()}`
  )

  if (session.messages.length === 0) {
    lines.push('', '_No transcript messages yet._')
    return `${lines.join('\n')}\n`
  }

  for (const message of session.messages) {
    const rendered = renderMessageMarkdown(message)
    if (rendered) lines.push('', rendered)
  }

  return `${lines.join('\n')}\n`
}

function formatSessionDeeplink(sessionId: string): string {
  return `${APP_DEEPLINK_PROTOCOL}://threads/${encodeURIComponent(sessionId)}`
}

function renderMessageMarkdown(message: ChatMessage): string | null {
  if (message.type === 'text') {
    const attachmentLines = (message.attachments ?? []).map((attachment) => {
      if (attachment.kind === 'local_file') return `- ${attachment.name} (${attachment.path})`
      return `- ${attachment.name ?? attachment.relativePath} (${attachment.fileId})`
    })
    return [
      `## ${roleTitle(message.role)}`,
      message.content.trim() || '_Empty message_',
      attachmentLines.length > 0 ? ['', 'Attachments:', ...attachmentLines].join('\n') : null
    ].filter((part): part is string => Boolean(part)).join('\n\n')
  }

  if (message.type === 'tool_use') {
    return [
      `## Tool: ${message.toolName}`,
      '```json',
      JSON.stringify(message.toolInput, null, 2),
      '```'
    ].join('\n')
  }

  if (message.type === 'tool_result') {
    return [
      `## Tool Result${message.isError ? ' (error)' : ''}`,
      fencedBlock(message.content)
    ].join('\n\n')
  }

  if (message.type === 'result') {
    return [
      `## Run Result: ${message.subtype}`,
      message.content.trim() || '_No result content._'
    ].join('\n\n')
  }

  return null
}

function roleTitle(role: 'user' | 'assistant' | 'system'): string {
  if (role === 'user') return 'User'
  if (role === 'assistant') return 'Assistant'
  return 'System'
}

function fencedBlock(content: string): string {
  const fence = content.includes('```') ? '````' : '```'
  return `${fence}\n${content.trim() || '(empty)'}\n${fence}`
}

export function registerIpcHandlers(ipcMain: IpcMain): void {
  registerBrowserClientToolIpc(ipcMain)

  // App profile
  ipcMain.handle('app:getProfile', () => getAppProfile())

  // Projects
  ipcMain.handle('projects:list', () => projectStore.list())
  ipcMain.handle('projects:add', (_, name: string, rootPath: string) =>
    projectStore.add(name, rootPath)
  )
  ipcMain.handle('projects:importCodex', () => projectStore.importCodexProjects())
  ipcMain.handle('projects:remove', (_, id: string) => projectStore.remove(id))
  ipcMain.handle('projects:updateName', (_, id: string, name: string) => projectStore.updateName(id, name))
  ipcMain.handle('projects:updatePinned', (_, id: string, pinned: boolean) => projectStore.updatePinned(id, pinned))
  ipcMain.handle('projects:addSession', (_, projectId: string, sessionId: string) =>
    projectStore.addSession(projectId, sessionId)
  )
  ipcMain.handle('projects:removeSession', (_, projectId: string, sessionId: string) =>
    projectStore.removeSession(projectId, sessionId)
  )

  // Sessions
  ipcMain.handle('sessions:list', () => sessionManager.list())
  ipcMain.handle('sessions:listSummaries', () => sessionManager.listSummaries())
  ipcMain.handle('sessions:listArchivedSummaries', () => sessionManager.listArchivedSummaries())
  ipcMain.handle('sessions:get', (_, id: string) => sessionManager.get(id))
  ipcMain.handle('sessions:getTranscriptPage', (_, id: string, request?: TranscriptPageRequest) =>
    sessionManager.getTranscriptPage(id, request ?? {})
  )
  ipcMain.handle('sessions:searchTranscript', (_, id: string, query: string, limit?: number) =>
    sessionManager.searchTranscript(id, query, limit)
  )
  ipcMain.handle('sessions:copyMarkdown', (_, id: string) => {
    const session = sessionManager.get(id)
    const markdown = formatConversationMarkdown(session)
    clipboard.writeText(markdown)
    return markdown
  })
  ipcMain.handle('sessions:copyDeeplink', (_, id: string) => {
    const deeplink = formatSessionDeeplink(id)
    clipboard.writeText(deeplink)
    return deeplink
  })
  ipcMain.handle('sessions:create', (_, opts) => sessionManager.create(opts))
  ipcMain.handle('sessions:fork', (_, id: string, mode: SessionForkMode) => {
    if (!['local', 'same-worktree', 'new-worktree'].includes(mode)) {
      throw new Error(`Unsupported fork mode: ${mode}`)
    }
    return sessionManager.fork(id, mode).then((forked) => {
      projectStore.addSession(forked.projectId, forked.id)
      return forked
    })
  })
  ipcMain.handle('sessions:retryPendingWorktree', (_, id: string) => sessionManager.retryPendingWorktree(id))
  ipcMain.handle('sessions:sendMessage', (_, sessionId: string, prompt: string, useWorktree?: boolean, attachments?: Attachment[]) =>
    sessionManager.sendMessage(sessionId, prompt, useWorktree, attachments ?? [])
  )
  ipcMain.handle('sessions:answerSideQuestion', (_, sessionId: string, question: string) =>
    sessionManager.answerSideQuestion(sessionId, question)
  )
  ipcMain.handle('sessions:updateName', (_, id: string, name: string) =>
    sessionManager.updateName(id, name)
  )
  ipcMain.handle('sessions:updatePinned', (_, id: string, pinned: boolean) =>
    sessionManager.updatePinned(id, pinned)
  )
  ipcMain.handle('sessions:reorderPinned', (_, orderedPinnedSessionIds: string[]) =>
    sessionManager.reorderPinned(orderedPinnedSessionIds)
  )
  ipcMain.handle('sessions:updateSettings', (_, id: string, patch: {
    provider?: string
    model?: string
    effort?: string
    agentName?: string | null
    permissionMode?: string
    runtime?: 'headless' | 'interactive' | 'sdk' | 'app-server'
    useThinking?: boolean
    useFast?: boolean
    allowedTools?: string[]
    disallowedTools?: string[]
    availableTools?: string[]
    additionalDirs?: string[]
  }) =>
    sessionManager.updateSettings(id, patch)
  )
  ipcMain.handle('sessions:checkProviders', () => sessionManager.checkProviders())
  ipcMain.handle('sessions:stop', (_, sessionId: string) => sessionManager.stop(sessionId))
  ipcMain.handle('sessions:steerQueuedMessage', (_, sessionId: string, messageId: string) =>
    sessionManager.steerQueuedMessage(sessionId, messageId)
  )
  ipcMain.handle('sessions:archive', (_, sessionId: string) => sessionManager.archive(sessionId))
  ipcMain.handle('sessions:restoreArchived', (_, sessionId: string) => sessionManager.restoreArchived(sessionId))
  ipcMain.handle('sessions:remove', (_, sessionId: string) => sessionManager.remove(sessionId))
  ipcMain.handle('worktrees:list', () => sessionManager.listWorktrees())
  ipcMain.handle('worktrees:delete', (_, workDir: string) => sessionManager.deleteWorktree(workDir))
  ipcMain.handle('sessions:getDiff', (_, sessionId: string) => sessionManager.getDiff(sessionId))
  ipcMain.handle('sessions:getReviewMetadata', (_, sessionId: string) => sessionManager.getReviewMetadata(sessionId))
  ipcMain.handle('sessions:getChangedFiles', (_, sessionId: string, source: ReviewDiffSource = 'all', ref?: string) => {
    const session = sessionManager.get(sessionId)
    if (!session) return []
    return gitManager.getChangedFiles(session.workDir, source, ref)
  })
  ipcMain.handle('sessions:getDiffForFile', (_, sessionId: string, filePath: string, source: ReviewDiffSource = 'all', ref?: string) => {
    const session = sessionManager.get(sessionId)
    if (!session) return ''
    return gitManager.getDiffForFile(session.workDir, filePath, source, ref)
  })
  ipcMain.handle('sessions:undoChangedFiles', (_, sessionId: string, paths: string[]): Promise<GitPathActionResult> => {
    const session = sessionManager.get(sessionId)
    if (!session) return Promise.resolve({ ok: false, paths: [], changedFiles: [], discarded: false, error: 'Session not found' })
    return gitManager.discardPaths(session.workDir, Array.isArray(paths) ? paths : [])
  })
  ipcMain.handle('sessions:writeToPty', (_, sessionId: string, data: string) =>
    sessionManager.writeToPty(sessionId, data)
  )
  ipcMain.handle('sessions:grantAndResume', (_, sessionId: string, toolNames: string[]) =>
    sessionManager.grantAndResume(sessionId, toolNames)
  )
  ipcMain.handle('sessions:allowOnceAndResume', (_, sessionId: string, toolNames: string[]) =>
    sessionManager.allowOnceAndResume(sessionId, toolNames)
  )
  ipcMain.handle('sessions:answerUserInput', (_, sessionId: string, answer: string) =>
    sessionManager.answerUserInput(sessionId, answer)
  )
  ipcMain.handle('sessions:denyPermission', (_, sessionId: string) =>
    sessionManager.denyPermission(sessionId)
  )

  // Automations
  ipcMain.handle('automations:list', () => automationManager.list())
  ipcMain.handle('automations:listForSession', (_, sessionId: string) =>
    automationManager.listForSession(sessionId)
  )
  ipcMain.handle('automations:listRuns', (_, automationId: string) =>
    automationManager.listRuns(automationId)
  )
  ipcMain.handle('automations:upsert', (_, request: AutomationUpsertRequest) =>
    automationManager.upsert(request)
  )
  ipcMain.handle('automations:runNow', (_, id: string) =>
    automationManager.runNow({
      id,
      isEligible: (automation) => automationEligibilityForSession(automation, (sessionId) => sessionManager.get(sessionId)),
      execute: async ({ automation, run }) => {
        await sessionManager.sendMessage(
          automation.target.sessionId,
          automation.prompt,
          undefined,
          [],
          {
            permissionSnapshot: automation.permissionSnapshot ?? null,
            onProviderRunComplete: (result) => {
              automationManager.finishRun(run.id, result.ok ? 'SUCCEEDED' : 'FAILED', result.error ?? null)
            }
          }
        )
        return { deferCompletion: true }
      }
    })
  )
  ipcMain.handle('automations:pause', (_, id: string) => automationManager.pause(id))
  ipcMain.handle('automations:resume', (_, id: string) => automationManager.resume(id))
  ipcMain.handle('automations:delete', (_, id: string) => automationManager.delete(id))

  // Providers
  ipcMain.handle('providers:getRuntimeInfo', () => getProviderRuntimeInfo())
  ipcMain.handle('providers:getManifest', () => providerManifests())
  ipcMain.handle('providers:getDiagnostics', (_, providerId?: string) => getProviderDiagnosticsAsync(providerId))
  ipcMain.handle('providers:listRuntimeDebugEvents', (_, providerId?: string, includeNoisy?: boolean) =>
    listProviderRuntimeDebugEvents({ providerId, includeNoisy, limit: 200 })
  )
  ipcMain.handle('providers:listRuntimeConnections', (_, providerId?: string) =>
    listProviderRuntimeConnections({ providerId, limit: 200 })
  )
  ipcMain.handle('providers:runCommandSurface', (_, providerId: string, surfaceId: string) =>
    runProviderCommandSurfaceAsync(providerId, surfaceId)
  )
  ipcMain.handle('providers:refreshSidebarMetadata', (_, providerId: string, cwd?: string) => {
    if (providerId !== 'codex') {
      return {
        ok: true,
        providerId,
        changed: 0,
        skipped: 'unsupported-provider'
      }
    }
    return sessionManager.refreshCodexSidebarMetadata(cwd)
  })
  ipcMain.handle('providers:getPermissionContext', (_, providerId: string, cwd?: string) =>
    getProviderPermissionRuntimeContextAsync(providerId, cwd)
  )
  ipcMain.handle('providers:listResources', (_, providerId?: string, cwd?: string) =>
    listProviderResources(providerId, cwd)
  )
  ipcMain.handle('providers:createCapability', (_, request: CapabilityCreateRequest) =>
    createCapability(request)
  )
  ipcMain.handle('providers:updateCapability', (_, request: CapabilityUpdateRequest) =>
    updateCapability(request)
  )
  ipcMain.handle('providers:deleteCapability', (_, request: CapabilityDeleteRequest) =>
    deleteCapability(request)
  )
  ipcMain.handle('providers:previewCapabilitySync', (_, request: CapabilitySyncRequest) =>
    previewCapabilitySync(request)
  )
  ipcMain.handle('providers:syncCapability', (_, request: CapabilitySyncRequest) =>
    applyCapabilitySync(request)
  )
  ipcMain.handle('providers:discoverClaudeExtensions', (_, workDir: string) =>
    discoverClaudeExtensions(workDir)
  )

  // Performance
  ipcMain.handle('performance:record', (_, metric: Omit<PerformanceMetric, 'id'>) =>
    recordPerformanceMetric(metric)
  )
  ipcMain.handle('performance:snapshot', () => performanceSnapshot())
  ipcMain.handle('performance:reset', () => resetPerformanceMetrics())

  // Git
  ipcMain.handle('git:isGitRepo', (_, dir: string) => gitManager.isGitRepo(dir))
  ipcMain.handle('git:getCurrentBranch', (_, dir: string) => gitManager.getCurrentBranch(dir))
  ipcMain.handle('git:listBranches', (_, dir: string) => gitManager.listBranches(dir))
  ipcMain.handle('git:listRecentCommits', (_, dir: string) => gitManager.listRecentCommits(dir))
  ipcMain.handle('git:stagePaths', (_, dir: string, paths: string[]): Promise<GitPathActionResult> =>
    gitManager.stagePaths(dir, Array.isArray(paths) ? paths : [])
  )
  ipcMain.handle('git:unstagePaths', (_, dir: string, paths: string[]): Promise<GitPathActionResult> =>
    gitManager.unstagePaths(dir, Array.isArray(paths) ? paths : [])
  )
  ipcMain.handle('git:blameLine', (_, dir: string, filePath: string, line: number): Promise<GitLineBlameResult> =>
    gitManager.blameLine(dir, filePath, line)
  )

  // Browser side panel
  ipcMain.handle('browser:openExternal', (_, url: string): Promise<void> => shell.openExternal(url))
  ipcMain.handle('browser:clearData', async (_, kind: string = 'all', partition?: string): Promise<void> => {
    const browserPartition = isOrchestratorBrowserWebviewPartition(partition)
      ? partition
      : browserWebviewPartitionForHost()
    const browserSession = session.fromPartition(browserPartition)
    const dataTypesByKind = {
      all: ['cache', 'cookies', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'],
      cache: ['cache'],
      cookies: ['cookies'],
      siteData: ['fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL']
    } as const
    const clearKind =
      kind === 'cache' || kind === 'cookies' || kind === 'siteData' || kind === 'all' ? kind : 'all'
    if (clearKind === 'all' || clearKind === 'cookies') {
      await browserSession.clearAuthCache()
    }
    await browserSession.clearData({ dataTypes: [...dataTypesByKind[clearKind]] })
  })
  ipcMain.handle('browser:saveDataUrlArtifact', (_, dataUrl: string, suggestedName?: string) =>
    writeBrowserDataUrlArtifact(dataUrl, suggestedName)
  )
  ipcMain.handle('browser:discoverLocalTargets', (_, recentUrls?: string[]) =>
    discoverBrowserLocalTargets(recentUrls)
  )
  ipcMain.handle('browser:bundleAssets', (_, request: BrowserAssetRequest) =>
    bundleBrowserAssets(request)
  )
  ipcMain.handle('browser:setSecurityPolicy', (_, policy: Parameters<typeof setBrowserSecurityPolicy>[0]) =>
    setBrowserSecurityPolicy(policy)
  )
  ipcMain.handle('attachments:savePastedFile', (_, request: PastedAttachmentRequest) =>
    writePastedAttachment(request)
  )

  // App settings
  ipcMain.handle('settings:get', () => settingsStore.store)
  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    settingsStore.set(key as keyof typeof settingsStore.store, value as never)
  })

  // File system (for provider instructions and skills)
  ipcMain.handle('fs:resolveHome', () => app.getPath('home'))
  ipcMain.handle('fs:readFile', (_, filePath: string): string | null => {
    try { return readFileSync(filePath, 'utf-8') } catch { return null }
  })
  ipcMain.handle('fs:previewFile', (_, filePath: string): FilePreviewResult => previewFile(filePath))
  ipcMain.handle('fs:writeFile', (_, filePath: string, content: string): void => {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, 'utf-8')
  })
  ipcMain.handle('fs:listDir', (_, dirPath: string): string[] | null => {
    try { return readdirSync(dirPath) } catch { return null }
  })
  ipcMain.handle('fs:statPath', (_, filePath: string): { exists: boolean; isFile?: boolean; isDirectory?: boolean; size?: number } => {
    try {
      if (!existsSync(filePath)) return { exists: false }
      const stat = statSync(filePath)
      return {
        exists: true,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        size: stat.size
      }
    } catch {
      return { exists: false }
    }
  })
  ipcMain.handle('fs:resolveWorkspaceFileReference', (_, cwd: string, filePath: string): string | null =>
    resolveWorkspaceFileReference(cwd, filePath)
  )
  ipcMain.handle('fs:searchWorkspace', (_, request: WorkspaceSearchRequest) => searchWorkspace(request))
  ipcMain.handle('fs:listOpenTargets', (): Promise<OpenTargetAvailability[]> => listOpenTargets())
  ipcMain.handle('fs:openPath', (_, filePath: string, options?: OpenPathOptions): Promise<OpenPathResult> =>
    openPathWithPreferredEditor(filePath, options ?? {})
  )
  ipcMain.handle('fs:showInFolder', (_, filePath: string): void => shell.showItemInFolder(filePath))

  // User shell terminal (separate from provider subprocesses)
  ipcMain.handle('terminal:spawn', (_, sessionId: string, workDir: string) =>
    terminalManager.spawn(sessionId, workDir)
  )
  ipcMain.handle('terminal:write', (_, sessionId: string, data: string) =>
    terminalManager.write(sessionId, data)
  )
  ipcMain.handle('terminal:runCommand', (_, sessionId: string, command: string) =>
    terminalManager.runCommand(sessionId, command)
  )
  ipcMain.handle('terminal:resize', (_, sessionId: string, cols: number, rows: number) =>
    terminalManager.resize(sessionId, cols, rows)
  )
  ipcMain.handle('terminal:getBuffer', (_, terminalId: string) =>
    terminalManager.getBuffer(terminalId)
  )
  ipcMain.handle('terminal:getServiceSnapshot', () =>
    terminalManager.getServiceSnapshot()
  )
  ipcMain.handle('terminal:clear', (_, terminalId: string) =>
    terminalManager.clear(terminalId)
  )
  ipcMain.handle('terminal:kill', (_, terminalId: string) =>
    terminalManager.kill(terminalId)
  )

  // File dialog
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('dialog:openFiles', async (): Promise<Array<{ path: string; name: string; size?: number }> | null> => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    if (result.canceled) return null
    return result.filePaths.map((filePath) => {
      let size: number | undefined
      try { size = statSync(filePath).size } catch { /* ignore stat races */ }
      return { path: filePath, name: basename(filePath), size }
    })
  })

  // Pet overlay
  ipcMain.handle('pet:getConfig', () => petOverlayManager.getConfig())
  ipcMain.handle('pet:selectPet', (_, id: string) => petOverlayManager.selectPet(id))
  ipcMain.handle('pet:import', () => petOverlayManager.importPet())
  ipcMain.handle('pet:importCodexPets', () => petOverlayManager.importCodexPets())
  ipcMain.handle('pet:setOpen', (_, v: boolean) => petOverlayManager.setOpen(v))
  ipcMain.handle('pet:close', () => petOverlayManager.setOpen(false))
  ipcMain.handle('pet:focusMain', (_, sessionId?: string) => petOverlayManager.focusMain(sessionId))
  ipcMain.on('pet:drag:start', (_, clientX: number, clientY: number) =>
    petOverlayManager.dragStart(clientX, clientY))
  ipcMain.on('pet:drag:move', (_, screenX: number, screenY: number) =>
    petOverlayManager.dragMove(screenX, screenY))
  ipcMain.on('pet:drag:end', () => petOverlayManager.dragEnd())
  ipcMain.on('pet:drag:release', (_, vx: number, vy: number) =>
    petOverlayManager.dragRelease(vx, vy))
  ipcMain.on('pet:pointer', (_, v: boolean) => petOverlayManager.setPointerInteractive(v))
  ipcMain.on('pet:keyboard', (_, v: boolean) => petOverlayManager.setKeyboardInteractive(v))
  ipcMain.on('pet:trayCount', (_, count: number) => petOverlayManager.setTrayCount(count))
  ipcMain.on('pet:trayHeight', (_, h: number) => petOverlayManager.setTrayHeight(h))
  ipcMain.on('pet:traySize', (_, size: { width: number; height: number }) => petOverlayManager.setTraySize(size))
  ipcMain.on('pet:elementMetrics', (_, metrics: { isTrayVisible: boolean; mascot: { width: number; height: number }; tray: { width: number; height: number } | null }) =>
    petOverlayManager.setElementMetrics(metrics))
  ipcMain.on('pet:mascotSize', (_, size: { width: number; height: number }) => petOverlayManager.setMascotSize(size))
  ipcMain.on('pet:mascotResizePreview', (_, width: number) => petOverlayManager.setMascotResizePreview(width))
  ipcMain.on('pet:mascotWidth', (_, width: number) => petOverlayManager.setMascotWidth(width))
}
