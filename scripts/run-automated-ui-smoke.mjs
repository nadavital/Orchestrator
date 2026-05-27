#!/usr/bin/env node
import { spawn, spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { prepareMacSmokeBundle } from './lib/packaged-smoke-bundle.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const captureView = process.argv.includes('--settings-deeplink')
  ? 'settings-deeplink'
  : process.argv.includes('--settings-providers')
  ? 'settings-providers'
  : process.argv.includes('--settings')
  ? 'settings'
  : process.argv.includes('--capabilities')
    ? 'capabilities'
    : process.argv.includes('--resources')
    ? 'resources'
      : process.argv.includes('--composer')
        ? 'composer'
      : process.argv.includes('--pets')
        ? 'pets'
      : process.argv.includes('--terminal-visual')
        ? 'terminal-visual'
      : process.argv.includes('--header')
        ? 'header'
      : process.argv.includes('--multi-window-focus')
        ? 'multi-window-focus'
      : process.argv.includes('--workbench-new-tab')
        ? 'workbench-new-tab'
      : process.argv.includes('--environment')
        ? 'environment'
      : process.argv.includes('--right-panel')
        ? 'right-panel'
      : process.argv.includes('--workbench-perf')
        ? 'workbench-perf'
      : process.argv.includes('--diff-entry')
        ? 'diff-entry'
      : process.argv.includes('--diff-empty')
        ? 'diff-empty'
      : process.argv.includes('--diff-loading')
        ? 'diff-loading'
      : process.argv.includes('--diff-conflict')
        ? 'diff-conflict'
      : process.argv.includes('--diff-narrow')
        ? 'diff-narrow'
      : process.argv.includes('--diff-core')
        ? 'diff-core'
      : process.argv.includes('--diff-last-turn')
        ? 'diff-last-turn'
      : process.argv.includes('--diff-source')
        ? 'diff-source'
      : process.argv.includes('--diff-preview')
        ? 'diff-preview'
      : process.argv.includes('--diff')
        ? 'diff'
      : process.argv.includes('--files')
        ? 'files'
      : process.argv.includes('--side-chat')
        ? 'side-chat'
      : process.argv.includes('--motion-reduced')
          ? 'motion-reduced'
        : process.argv.includes('--empty-state')
          ? 'empty-state'
        : process.argv.includes('--pet-overlay')
          ? 'pet-overlay'
          : process.argv.includes('--sidebar')
            ? 'sidebar'
            : process.argv.includes('--transcript-layout')
              ? 'transcript-layout'
              : process.argv.includes('--transcript-stress')
                ? 'transcript-stress'
                : process.argv.includes('--streaming-drag')
                  ? 'streaming-drag'
                : process.argv.includes('--streaming-typing')
                  ? 'streaming-typing'
                : process.argv.includes('--session-switch')
                  ? 'session-switch'
                  : process.argv.includes('--extensions')
                    ? 'extensions'
                    : process.argv.includes('--design-system')
                      ? 'design-system'
                      : process.argv.includes('--scroll')
                        ? 'scroll'
                        : process.argv.includes('--browser')
                          ? 'browser'
                          : process.argv.includes('--plan')
                            ? 'plan'
                          : process.argv.includes('--inspector')
                            ? 'inspector'
                            : process.argv.includes('--terminal')
                              ? 'terminal'
                              : 'main'
const runPackaged = process.argv.includes('--packaged')
const runInstalled = process.argv.includes('--installed')
if (runPackaged && runInstalled) {
  console.error('Use either --packaged or --installed, not both.')
  process.exit(1)
}
const foregroundSmoke = process.argv.includes('--foreground') ||
  captureView === 'multi-window-focus' ||
  process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_FOREGROUND === '1'
const profile = 'automated-ui-smoke'
const userDataDir = join(tmpdir(), 'orchestrator-profiles', `${profile}-${captureView}`)
const workspaceDir = join(tmpdir(), 'orchestrator-automated-ui-workspace')
const isDiffCaptureView = captureView === 'diff' || captureView.startsWith('diff-')
const fixtureWorkspaceViews = new Set(['inspector', 'right-panel', 'workbench-new-tab', 'environment', 'workbench-perf', 'diff', 'diff-entry', 'diff-empty', 'diff-loading', 'diff-conflict', 'diff-narrow', 'diff-core', 'diff-last-turn', 'diff-source', 'diff-preview', 'files', 'side-chat', 'browser'])
const resetWorkspaceViews = new Set([...fixtureWorkspaceViews, 'sidebar', 'multi-window-focus'])
const outputPath = join(tmpdir(), `orchestrator-automated-ui-smoke-${captureView}-${Date.now()}.json`)
const screenshotPath = join(tmpdir(), `orchestrator-automated-ui-smoke-${captureView}-${Date.now()}.png`)
let browserSmokeServer = null
let browserSmokeUrl = ''

function buildDiffChecks(result, view) {
  const allChecks = {
    isolatedProfile: result.profile?.isIsolated === true,
    diffToolbarCompact: result.diffToolbarCompactWorks === true,
    reviewToolbarHeaderRow: result.reviewToolbarHeaderRowWorks === true,
    reviewToolbarPrimaryOrder: result.reviewToolbarPrimaryOrderWorks === true,
    reviewSourceSummaryHeader: result.reviewSourceSummaryHeaderWorks === true,
    reviewMetadataToolbar: result.reviewMetadataToolbarWorks === true,
    reviewMetadataFlyoutShared: result.reviewMetadataFlyoutSharedWorks === true,
    reviewTranscriptCard: result.reviewTranscriptCardWorks === true,
    reviewTranscriptCardUndo: result.reviewTranscriptCardUndoWorks === true,
    reviewTranscriptCardLastTurn: result.reviewTranscriptCardLastTurnWorks === true,
    reviewLastTurnVisualState: result.reviewLastTurnVisualStateWorks === true,
    reviewEnvironmentPanel: result.reviewEnvironmentPanelWorks === true,
    reviewEmptyState: result.reviewEmptyStateWorks === true,
    reviewEmptyStateCalm: result.reviewEmptyStateCalmWorks === true,
    reviewLoadingState: result.reviewLoadingStateWorks === true,
    reviewLoadingStateCalm: result.reviewLoadingStateCalmWorks === true,
    reviewLoadingKeepsSidePane: result.reviewLoadingKeepsSidePaneWorks === true,
    reviewMergeConflictHelpers: result.reviewMergeConflictHelpersWorks === true,
    reviewNarrowOverlay: result.reviewNarrowOverlayWorks === true,
    reviewNarrowNoHorizontalOverflow: result.reviewNarrowNoHorizontalOverflowWorks === true,
    reviewNarrowToolbarContained: result.reviewNarrowToolbarContainedWorks === true,
    reviewNarrowSidePaneContained: result.reviewNarrowSidePaneContainedWorks === true,
    reviewNarrowDiffReadable: result.reviewNarrowDiffReadableWorks === true,
    diffListCompact: result.diffListCompactWorks === true,
    reviewFileSections: result.reviewFileSectionStructureWorks === true,
    reviewFileHeaderMetrics: result.reviewFileHeaderMetricsWork === true,
    reviewFileHeaderPathFirst: result.reviewFileHeaderPathFirstWorks === true,
    reviewDiffRowMetrics: result.reviewDiffRowMetricsWork === true,
    reviewHunkSeparatorStructure: result.reviewHunkSeparatorStructureWorks === true,
    reviewDiffIndicatorStructure: result.reviewDiffIndicatorStructureWork === true,
    reviewDiffNativeColorCalm: result.reviewDiffNativeColorCalmWorks === true,
    reviewDiffLineNumberContent: result.reviewDiffLineNumberContentWorks === true,
    reviewDiffGutterUtility: result.reviewDiffGutterUtilityWorks === true,
    reviewFileTreeGitLane: result.reviewFileTreeGitLaneWorks === true,
    reviewVisualCheckpointReset: result.reviewVisualCheckpointResetWorks === true,
    reviewTabPanelFocusRingCalm: result.reviewTabPanelFocusRingCalmWorks === true,
    diffWorkbenchTree: result.diffWorkbenchTreeWorks === true,
    diffWorkbenchTreeNativeTitleFree: result.diffWorkbenchTreeNativeTitleFreeWorks === true,
    diffRevealSelectedPath: result.diffRevealSelectedPathWorks === true,
    diffTreeGrouping: result.diffTreeGroupingWorks === true,
    diffKeyboardNavigation: result.diffKeyboardNavigationWorks === true,
    diffLineNumbers: result.diffLineNumbersWork === true,
    diffLineSelection: result.diffLineSelectionWorks === true,
    reviewLineComments: result.reviewLineCommentsWork === true,
    reviewAnnotatedSelectionCalm: result.reviewAnnotatedSelectionCalmWork === true,
    reviewSidePaneCommentCount: result.reviewSidePaneCommentCountWork === true,
    reviewLineBlame: result.reviewLineBlameWork === true,
    reviewGutterBlameSummary: result.reviewGutterBlameSummaryWork === true,
    reviewGutterActionPopover: result.reviewGutterActionPopoverWork === true,
    reviewMenuMessage: result.reviewMenuMessageWorks === true,
    reviewFileJump: result.reviewFileJumpWorks === true,
    reviewSidePaneChrome: result.reviewSidePaneChromeWorks === true,
    reviewSidePaneResize: result.reviewSidePaneResizeWorks === true,
    reviewLineOpensFileSourceTab: result.reviewLineOpensFileSourceTabWork === true,
    reviewHiddenContextSeparatorStructure: result.reviewHiddenContextSeparatorStructureWork === true,
    reviewHiddenContextExpansion: result.reviewHiddenContextExpansionWork === true,
    reviewHiddenContextExpandAll: result.reviewHiddenContextExpandAllWork === true,
    reviewLargeDiffWindow: result.reviewLargeDiffWindowWorks === true,
    diffHunkCollapse: result.diffHunkCollapseWorks === true,
    diffModeToggle: result.diffModeToggleWorks === true,
    diffExpandCollapse: result.diffExpandCollapseWorks === true,
    reviewWhitespaceToggle: result.reviewWhitespaceToggleWorks === true,
    reviewWordDiffToggle: result.reviewWordDiffToggleWorks === true,
    diffActionMenuCompact: result.diffActionMenuCompactWorks === true,
    diffActionMenuMaterial: result.diffActionMenuMaterialWorks === true,
    reviewGitApplyCommandCoversAll: result.reviewGitApplyCommandCoversAllWorks === true,
    reviewFloatingGitActions: result.reviewFloatingGitActionsWork === true,
    reviewRevertAllConfirmation: result.reviewRevertAllConfirmationWorks === true,
    reviewLastTurnGitApplyCommand: result.reviewLastTurnGitApplyCommandWorks === true,
    reviewSearch: result.reviewSearchWorks === true,
    reviewSearchProjection: result.reviewSearchProjectionWorks === true,
    reviewSearchContent: result.reviewSearchContentWorks === true,
    reviewSourceModes: result.reviewSourceModesWork === true,
    reviewProviderSourceUnavailableReasons: result.reviewProviderSourceUnavailableReasonsWork === true,
    reviewWorktreeProviderSource: result.reviewWorktreeProviderSourceWorks === true,
    reviewFullSourceRows: result.reviewFullSourceRowsWork === true,
    reviewFullSourceBlame: result.reviewFullSourceBlameWorks === true,
    reviewLoadFullFile: result.reviewLoadFullFileWorks === true,
    reviewSearchClear: result.reviewSearchClearWorks === true,
    reviewDiffFirst: result.reviewDiffFirstWorks === true,
    reviewJsonPreview: result.reviewJsonPreviewWorks === true,
    reviewCsvPreview: result.reviewCsvPreviewWorks === true,
    reviewDocumentPreview: result.reviewDocumentPreviewWorks === true,
    reviewNotebookPreview: result.reviewNotebookPreviewWorks === true,
    reviewImageBinaryDiffFirst: result.reviewImageBinaryDiffFirstWorks === true,
    reviewImagePreview: result.reviewImagePreviewWorks === true,
    reviewBinaryState: result.reviewBinaryStateWorks === true,
    reviewFallbackNoticeShared: result.reviewFallbackNoticeSharedWorks === true,
    reviewBinaryActions: result.reviewBinaryActionsWork === true,
    reviewGitActions: result.reviewGitActionsWork === true
  }
  const groups = {
    'diff-entry': [
      'isolatedProfile',
      'diffToolbarCompact',
      'reviewToolbarHeaderRow',
      'reviewToolbarPrimaryOrder',
      'reviewSourceSummaryHeader',
      'reviewMetadataToolbar',
      'reviewMetadataFlyoutShared',
      'reviewTranscriptCard',
      'reviewTranscriptCardUndo',
      'reviewEnvironmentPanel'
    ],
    'diff-empty': [
      'isolatedProfile',
      'reviewEmptyState',
      'reviewEmptyStateCalm'
    ],
    'diff-loading': [
      'isolatedProfile',
      'reviewLoadingState',
      'reviewLoadingStateCalm',
      'reviewLoadingKeepsSidePane'
    ],
    'diff-conflict': [
      'isolatedProfile',
      'reviewMergeConflictHelpers'
    ],
    'diff-narrow': [
      'isolatedProfile',
      'reviewNarrowOverlay',
      'reviewNarrowNoHorizontalOverflow',
      'reviewNarrowToolbarContained',
      'reviewNarrowSidePaneContained',
      'reviewNarrowDiffReadable'
    ],
    'diff-core': [
      'isolatedProfile',
      'diffToolbarCompact',
      'reviewToolbarHeaderRow',
      'reviewToolbarPrimaryOrder',
      'reviewSourceSummaryHeader',
      'diffListCompact',
      'reviewFileSections',
      'reviewFileHeaderMetrics',
      'reviewDiffRowMetrics',
      'reviewHunkSeparatorStructure',
      'reviewDiffIndicatorStructure',
      'reviewDiffNativeColorCalm',
      'reviewDiffLineNumberContent',
      'reviewDiffGutterUtility',
      'reviewFileTreeGitLane',
      'reviewTabPanelFocusRingCalm',
      'diffWorkbenchTree',
      'diffWorkbenchTreeNativeTitleFree',
      'diffRevealSelectedPath',
      'diffTreeGrouping',
      'diffKeyboardNavigation',
      'diffLineNumbers',
      'diffLineSelection',
      'diffHunkCollapse',
      'diffModeToggle',
      'diffExpandCollapse',
      'diffActionMenuCompact',
      'diffActionMenuMaterial',
      'reviewGitApplyCommandCoversAll',
      'reviewFloatingGitActions',
      'reviewRevertAllConfirmation'
    ],
    'diff-last-turn': [
      'isolatedProfile',
      'reviewTranscriptCardLastTurn',
      'reviewFileHeaderPathFirst',
      'reviewLastTurnVisualState'
    ],
    'diff-source': [
      'isolatedProfile',
      'reviewSearch',
      'reviewSearchProjection',
      'reviewSearchContent',
      'reviewSourceModes',
      'reviewProviderSourceUnavailableReasons',
      'reviewTranscriptCardLastTurn',
      'reviewLastTurnGitApplyCommand',
      'reviewWorktreeProviderSource',
      'reviewFullSourceRows',
      'reviewFullSourceBlame',
      'reviewLoadFullFile',
      'reviewSearchClear',
      'reviewLineComments',
      'reviewAnnotatedSelectionCalm',
      'reviewSidePaneCommentCount',
      'reviewLineBlame',
      'reviewGutterBlameSummary',
      'reviewGutterActionPopover',
      'reviewMenuMessage',
      'reviewFileJump',
      'reviewSidePaneChrome',
      'reviewSidePaneResize',
      'reviewLineOpensFileSourceTab',
      'reviewHiddenContextSeparatorStructure',
      'reviewHiddenContextExpansion',
      'reviewHiddenContextExpandAll',
      'reviewLargeDiffWindow'
    ],
    'diff-preview': [
      'isolatedProfile',
      'reviewWhitespaceToggle',
      'reviewWordDiffToggle',
      'reviewDiffFirst',
      'reviewJsonPreview',
      'reviewCsvPreview',
      'reviewDocumentPreview',
      'reviewNotebookPreview',
      'reviewImageBinaryDiffFirst',
      'reviewImagePreview',
      'reviewBinaryState',
      'reviewFallbackNoticeShared',
      'reviewBinaryActions',
      'reviewGitActions'
    ]
  }
  const keys = groups[view] ?? Object.keys(allChecks)
  return Object.fromEntries(keys.map((key) => [key, allChecks[key]]))
}

rmSync(userDataDir, { recursive: true, force: true })
if (resetWorkspaceViews.has(captureView)) {
  rmSync(workspaceDir, { recursive: true, force: true })
}
mkdirSync(userDataDir, { recursive: true })
mkdirSync(workspaceDir, { recursive: true })

if (captureView === 'capabilities') {
  const smokeSkillDir = join(workspaceDir, '.claude', 'skills', 'orchestrator-smoke-skill')
  const smokeCommandDir = join(workspaceDir, '.claude', 'commands')
  mkdirSync(smokeSkillDir, { recursive: true })
  mkdirSync(smokeCommandDir, { recursive: true })
  writeFileSync(join(workspaceDir, 'AGENTS.md'), '# Automated UI smoke\n\nProject instruction fixture.\n')
  writeFileSync(join(smokeSkillDir, 'SKILL.md'), '# Orchestrator Smoke Skill\n\nA deterministic fixture used by UI smoke tests.\n')
  writeFileSync(join(smokeCommandDir, 'orchestrator-smoke.md'), '# Orchestrator smoke command\n\nRun the smoke fixture.\n')
}

function createDocxFixture(blocks) {
  const imageBlocks = blocks
    .filter((block) => block && typeof block === 'object' && block.imageBase64)
    .map((block, index) => ({ block, index: index + 1 }))
  const blockXml = blocks.map((block) => {
    if (block && typeof block === 'object' && Array.isArray(block.rows)) {
      return `<w:tbl>
        ${block.rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t>${escapeXml(String(cell))}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('\n        ')}
      </w:tbl>`
    }
    if (block && typeof block === 'object' && block.imageBase64) {
      const imageIndex = imageBlocks.find((image) => image.block === block)?.index ?? 1
      const alt = escapeXml(String(block.alt ?? `Document image ${imageIndex}`))
      const cx = Number(block.cx ?? 914400)
      const cy = Number(block.cy ?? 914400)
      return `<w:p><w:r><w:drawing><wp:inline>
        <wp:extent cx="${Number.isFinite(cx) ? cx : 914400}" cy="${Number.isFinite(cy) ? cy : 914400}"/>
        <wp:docPr id="${imageIndex}" name="Picture ${imageIndex}" descr="${alt}"/>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic><pic:blipFill><a:blip r:embed="rImage${imageIndex}"/></pic:blipFill></pic:pic>
        </a:graphicData></a:graphic>
      </wp:inline></w:drawing></w:r></w:p>`
    }
    return `<w:p><w:r><w:t>${escapeXml(String(block))}</w:t></w:r></w:p>`
  }).join('\n    ')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${blockXml}
  </w:body>
</w:document>`
  return createStoredZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${imageBlocks.map((image) => `<Relationship Id="rImage${image.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/document-image-${image.index}.png"/>`).join('\n  ')}
</Relationships>`
    },
    { name: 'word/document.xml', data: documentXml },
    ...imageBlocks.map((image) => ({
      name: `word/media/document-image-${image.index}.png`,
      data: Buffer.from(String(image.block.imageBase64), 'base64')
    }))
  ])
}

function createXlsxFixture({ sheetName, rows, sheets }) {
  const workbookSheets = sheets ?? [{ sheetName, rows }]
  const sharedStrings = []
  const sharedStringIndex = new Map()
  const cellStyles = [{}]
  const cellStyleIndex = new Map([['{}', 0]])
  const styleIndexFor = (rawValue) => {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return 0
    const style = {
      ...(rawValue.fillColor ? { fillColor: String(rawValue.fillColor).toUpperCase() } : {}),
      ...(rawValue.textColor ? { textColor: String(rawValue.textColor).toUpperCase() } : {}),
      ...(rawValue.bold === true ? { bold: true } : {})
    }
    const key = JSON.stringify(style)
    if (key === '{}') return 0
    let index = cellStyleIndex.get(key)
    if (index === undefined) {
      index = cellStyles.length
      cellStyleIndex.set(key, index)
      cellStyles.push(style)
    }
    return index
  }
  const worksheetEntries = workbookSheets.map((sheet, sheetIndex) => {
    const mergeRefs = (sheet.merges ?? [])
      .map((merge) => typeof merge === 'string' ? merge : merge?.ref)
      .filter((merge) => typeof merge === 'string' && /^[A-Z]+\d+:[A-Z]+\d+$/i.test(merge))
    const columnXml = Array.isArray(sheet.columnWidths)
      ? sheet.columnWidths
          .map((width, columnIndex) => {
            const number = Number(width)
            if (!Number.isFinite(number) || number <= 0) return ''
            return `<col min="${columnIndex + 1}" max="${columnIndex + 1}" width="${String(number)}" customWidth="1"/>`
          })
          .filter(Boolean)
          .join('')
      : ''
    const cellXml = sheet.rows.map((row, rowIndex) => {
      const rowHeight = Number(sheet.rowHeights?.[rowIndex])
      const rowAttributes = Number.isFinite(rowHeight) && rowHeight > 0
        ? ` r="${rowIndex + 1}" ht="${String(rowHeight)}" customHeight="1"`
        : ` r="${rowIndex + 1}"`
      const cells = row.map((rawValue, columnIndex) => {
        const formula = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
          ? String(rawValue.formula ?? '').replace(/^=/, '')
          : ''
        const value = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
          ? rawValue.value
          : rawValue
        const styleIndex = styleIndexFor(rawValue)
        const styleAttribute = styleIndex > 0 ? ` s="${styleIndex}"` : ''
        if (formula) {
          const cachedValue = value === undefined || value === null || value === ''
            ? ''
            : `<v>${escapeXml(String(value))}</v>`
          return `<c r="${columnName(columnIndex)}${rowIndex + 1}"${styleAttribute}><f>${escapeXml(formula)}</f>${cachedValue}</c>`
        }
        const key = String(value)
        let index = sharedStringIndex.get(key)
        if (index === undefined) {
          index = sharedStrings.length
          sharedStringIndex.set(key, index)
          sharedStrings.push(key)
        }
        return `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="s"${styleAttribute}><v>${index}</v></c>`
      }).join('')
      return `<row${rowAttributes}>${cells}</row>`
    }).join('\n      ')
    return {
      name: `xl/worksheets/sheet${sheetIndex + 1}.xml`,
      data: `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${columnXml ? `<cols>${columnXml}</cols>` : ''}
  <sheetData>
      ${cellXml}
  </sheetData>
  ${mergeRefs.length > 0 ? `<mergeCells count="${mergeRefs.length}">${mergeRefs.map((merge) => `<mergeCell ref="${escapeXml(merge.toUpperCase())}"/>`).join('')}</mergeCells>` : ''}
</worksheet>`
    }
  })
  return createStoredZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${workbookSheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n  ')}
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookSheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('\n  ')}
  <Relationship Id="rId${workbookSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId${workbookSheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.sheetName)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
</workbook>`
    },
    {
      name: 'xl/sharedStrings.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
  ${sharedStrings.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join('\n  ')}
</sst>`
    },
    {
      name: 'xl/styles.xml',
      data: createXlsxStylesXml(cellStyles)
    },
    ...worksheetEntries
  ])
}

function createXlsxStylesXml(cellStyles) {
  const fonts = cellStyles.map((style) => `<font>${style.bold ? '<b/>' : ''}${style.textColor ? `<color rgb="FF${String(style.textColor).replace(/^#/, '')}"/>` : ''}<sz val="11"/><name val="Arial"/></font>`)
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    ...cellStyles.slice(1).map((style) => style.fillColor
      ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${String(style.fillColor).replace(/^#/, '')}"/><bgColor indexed="64"/></patternFill></fill>`
      : '<fill><patternFill patternType="none"/></fill>')
  ]
  const cellXfs = cellStyles.map((style, index) => `<xf numFmtId="0" fontId="${index}" fillId="${index > 0 && style.fillColor ? index + 1 : 0}" borderId="0" xfId="0"${style.fillColor ? ' applyFill="1"' : ''}${style.bold || style.textColor ? ' applyFont="1"' : ''}/>`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="${fonts.length}">${fonts.join('')}</fonts>
  <fills count="${fills.length}">${fills.join('')}</fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
}

function createPptxFixture(slides) {
  const normalizedSlides = slides.map((slide) => Array.isArray(slide)
    ? { lines: slide, notes: [], shapes: [], backgroundColor: null }
    : { lines: slide.lines ?? [], notes: slide.notes ?? [], shapes: slide.shapes ?? [], backgroundColor: slide.backgroundColor ?? null })
  const slidesWithNotes = normalizedSlides
    .map((slide, index) => ({ ...slide, index: index + 1 }))
    .filter((slide) => slide.notes.length > 0)
  const slidesWithImages = normalizedSlides
    .map((slide, index) => ({
      index: index + 1,
      images: slide.shapes.filter((shape) => shape.imageBase64).map((shape, imageIndex) => ({ shape, imageIndex: imageIndex + 1 }))
    }))
    .filter((slide) => slide.images.length > 0)
  const entries = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${normalizedSlides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('\n  ')}
  ${slidesWithNotes.map((slide) => `<Override PartName="/ppt/notesSlides/notesSlide${slide.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join('\n  ')}
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    },
    {
      name: 'ppt/presentation.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>${normalizedSlides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('')}</p:sldIdLst>
</p:presentation>`
    }
  ]
  for (const [index, slide] of normalizedSlides.entries()) {
    entries.push({
      name: `ppt/slides/slide${index + 1}.xml`,
      data: `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>${slide.backgroundColor ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${escapeXml(String(slide.backgroundColor).replace(/^#/, ''))}"/></a:solidFill></p:bgPr></p:bg>` : ''}<p:spTree>
    ${(slide.shapes.length > 0 ? slide.shapes : slide.lines.map((line, lineIndex) => ({
      text: [line],
      x: lineIndex === 0 ? 914400 : 1371600,
      y: lineIndex === 0 ? 914400 : 2286000 + (lineIndex - 1) * 457200,
      cx: lineIndex === 0 ? 10363200 : 9144000,
      cy: lineIndex === 0 ? 914400 : 685800
    }))).map((shape) => {
      const text = Array.isArray(shape.text) ? shape.text : [shape.text ?? '']
      if (shape.imageBase64) {
        const imageIndex = slide.shapes.filter((candidate) => candidate.imageBase64).indexOf(shape) + 1
        return `<p:pic><p:blipFill><a:blip r:embed="rImage${imageIndex}"/></p:blipFill><p:spPr><a:xfrm><a:off x="${shape.x}" y="${shape.y}"/><a:ext cx="${shape.cx}" cy="${shape.cy}"/></a:xfrm></p:spPr></p:pic>`
      }
      const fill = shape.fillColor ? `<a:solidFill><a:srgbClr val="${escapeXml(String(shape.fillColor).replace(/^#/, ''))}"/></a:solidFill>` : ''
      const textFill = shape.textColor ? `<a:rPr><a:solidFill><a:srgbClr val="${escapeXml(String(shape.textColor).replace(/^#/, ''))}"/></a:solidFill></a:rPr>` : ''
      return `<p:sp><p:spPr><a:xfrm><a:off x="${shape.x}" y="${shape.y}"/><a:ext cx="${shape.cx}" cy="${shape.cy}"/></a:xfrm>${fill}</p:spPr><p:txBody>${text.map((line) => `<a:p><a:r>${textFill}<a:t>${escapeXml(String(line))}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`
    }).join('\n    ')}
  </p:spTree></p:cSld>
</p:sld>`
    })
    if (slide.notes.length > 0) {
      entries.push({
        name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${index + 1}.xml"/>
  ${slide.shapes.filter((shape) => shape.imageBase64).map((_, imageIndex) => `<Relationship Id="rImage${imageIndex + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${index + 1}-${imageIndex + 1}.png"/>`).join('\n  ')}
</Relationships>`
      })
      entries.push({
        name: `ppt/notesSlides/notesSlide${index + 1}.xml`,
        data: `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    ${slide.notes.map((line) => `<p:sp><p:txBody><a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p></p:txBody></p:sp>`).join('\n    ')}
  </p:spTree></p:cSld>
</p:notes>`
      })
    } else if (slide.shapes.some((shape) => shape.imageBase64)) {
      entries.push({
        name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${slide.shapes.filter((shape) => shape.imageBase64).map((_, imageIndex) => `<Relationship Id="rImage${imageIndex + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${index + 1}-${imageIndex + 1}.png"/>`).join('\n  ')}
</Relationships>`
      })
    }
  }
  for (const slide of slidesWithImages) {
    for (const image of slide.images) {
      entries.push({
        name: `ppt/media/image${slide.index}-${image.imageIndex}.png`,
        data: Buffer.from(String(image.shape.imageBase64), 'base64')
      })
    }
  }
  return createStoredZip(entries)
}

function columnName(index) {
  let value = index + 1
  let name = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function createPdfFixture(text) {
  const pages = Array.isArray(text) ? text : [text]
  const pageObjectStart = 3
  const fontObjectId = pageObjectStart + pages.length
  const contentObjectStart = fontObjectId + 1
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${pageObjectStart + index} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ...pages.map((_, index) => (
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectStart + index} 0 R >>`
    )),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pages.map((pageText) => {
      const content = `BT /F1 18 Tf 72 720 Td (${escapePdfText(pageText)}) Tj ET`
      return `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
    })
  ]
  const parts = ['%PDF-1.4\n']
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(parts.join('')))
    parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`)
  }
  const xrefOffset = Buffer.byteLength(parts.join(''))
  parts.push(`xref\n0 ${objects.length + 1}\n`)
  parts.push('0000000000 65535 f \n')
  for (let index = 1; index < offsets.length; index += 1) {
    parts.push(`${String(offsets[index]).padStart(10, '0')} 00000 n \n`)
  }
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  return Buffer.from(parts.join(''))
}

function createStoredZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    const crc = crc32(data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localParts.push(localHeader, name, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(data.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt32LE(offset, 42)
    centralParts.push(centralHeader, name)
    offset += localHeader.length + name.length + data.length
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapePdfText(value) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

if (fixtureWorkspaceViews.has(captureView)) {
  const largeDiffLineCount = captureView === 'diff-source' || captureView === 'diff' ? 7601 : 1600
  mkdirSync(join(workspaceDir, 'Nested Folder'), { recursive: true })
  mkdirSync(join(workspaceDir, 'Sticky Folder'), { recursive: true })
  writeFileSync(join(workspaceDir, 'review-base.txt'), 'before review\n')
  writeFileSync(join(workspaceDir, 'conflict-smoke.txt'), 'conflict base\n')
  writeFileSync(join(workspaceDir, 'loading-source-smoke.txt'), 'loading source smoke\n')
  writeFileSync(join(workspaceDir, 'large-source-smoke.txt'), Array.from({ length: 1800 }, (_, index) => `large source smoke line ${String(index + 1).padStart(4, '0')}`).join('\n'))
  writeFileSync(join(workspaceDir, 'large-diff-smoke.txt'), Array.from({ length: largeDiffLineCount }, (_, index) => `large diff baseline line ${String(index + 1).padStart(4, '0')}`).join('\n'))
  writeFileSync(join(workspaceDir, 'staged-source-smoke.txt'), 'staged baseline\n')
  writeFileSync(join(workspaceDir, 'whitespace-smoke.txt'), 'name: alpha\nindent:\n  child: one\n')
  writeFileSync(join(workspaceDir, 'word-diff-smoke.txt'), 'status: baseline ready\ncount: one\n')
  writeFileSync(join(workspaceDir, 'hidden-context-smoke.txt'), Array.from({ length: 90 }, (_, index) => {
    if (index === 4) return 'first hidden context baseline'
    if (index === 69) return 'second hidden context baseline'
    return `hidden context unchanged line ${String(index + 1).padStart(2, '0')}`
  }).join('\n'))
  writeFileSync(join(workspaceDir, 'review-delete.txt'), 'delete me\n')
  writeFileSync(join(workspaceDir, 'Nested Folder', 'nested note.md'), '# Nested file smoke preview\n\nThis verifies spaces in paths.\n')
  writeFileSync(join(workspaceDir, 'reference.md'), '# Reference\n\nThe workspace content-only sentinel phrase lives only inside this file.\n')
  for (let index = 0; index < 96; index += 1) {
    const suffix = String(index + 1).padStart(2, '0')
    writeFileSync(join(workspaceDir, 'Sticky Folder', `sticky-file-${suffix}.txt`), `sticky fixture ${suffix}\n`)
  }
  writeFileSync(join(workspaceDir, 'preview-page.html'), '<!doctype html><main><h1>HTML preview smoke</h1><p>Rendered in the file inspector.</p></main>\n')
  writeFileSync(join(workspaceDir, 'data-preview-smoke.json'), JSON.stringify({ status: 'baseline', items: [{ name: 'alpha', count: 1 }] }, null, 2))
  writeFileSync(join(workspaceDir, 'table-preview-smoke.csv'), 'name,count,status\nalpha,1,baseline\n')
  writeFileSync(join(workspaceDir, 'pdf-preview-smoke.pdf'), createPdfFixture(['PDF preview smoke baseline', 'PDF preview smoke second page baseline']))
  writeFileSync(join(workspaceDir, 'document-preview-smoke.docx'), createDocxFixture([
    'Document smoke baseline',
    'This verifies DOCX text preview in the inspector.',
    { rows: [['Metric', 'Value'], ['Rows', '2'], ['Status', 'Baseline table']] },
    'Document smoke baseline section alpha',
    'Document smoke baseline section beta',
    'Document smoke baseline section gamma',
    'Document smoke baseline section delta',
    'Document smoke baseline appendix',
    'Document smoke baseline closing note'
  ]))
  writeFileSync(join(workspaceDir, 'spreadsheet-preview-smoke.xlsx'), createXlsxFixture({
    sheets: [
      {
        sheetName: 'Smoke data',
        rows: [
          [
            { value: 'Name', fillColor: '#DBEAFE', textColor: '#1D4ED8', bold: true },
            { value: 'Count', fillColor: '#DBEAFE', textColor: '#1D4ED8', bold: true },
            { value: 'Status', fillColor: '#DBEAFE', textColor: '#1D4ED8', bold: true }
          ],
          ['Alpha', '1', { value: 'Baseline', fillColor: '#FEF3C7', textColor: '#92400E' }],
          [{ value: 'Merged baseline note', fillColor: '#E0F2FE', textColor: '#075985', bold: true }, '']
        ],
        columnWidths: [12, 24, 14],
        rowHeights: [20, 20, 38],
        merges: ['A3:B3']
      },
      {
        sheetName: 'Totals',
        rows: [
          ['Metric', 'Value'],
          ['Baseline total', '1']
        ]
      }
    ]
  }))
  writeFileSync(join(workspaceDir, 'slides-preview-smoke.pptx'), createPptxFixture([
    { lines: ['Slides smoke baseline', 'First slide baseline'], notes: ['Baseline speaker note'], backgroundColor: '#F4F8FF' },
    { lines: ['Second slide baseline', 'Follow-up content'], notes: ['Second baseline note'] }
  ]))
  writeFileSync(
    join(workspaceDir, 'image-preview-smoke.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==', 'base64')
  )
  writeFileSync(join(workspaceDir, 'notebook-preview-smoke.ipynb'), JSON.stringify({
    cells: [
      { cell_type: 'markdown', source: ['# Notebook smoke\n', 'Baseline'] },
      {
        cell_type: 'code',
        execution_count: 3,
        source: ['value = 1\n', 'value'],
        outputs: [
          { output_type: 'stream', name: 'stdout', text: ['result: 1\n'] },
          { output_type: 'execute_result', data: { 'application/json': { status: 'baseline', value: 1 }, 'text/plain': ['{"status":"baseline","value":1}'] } }
        ]
      }
    ],
    metadata: { kernelspec: { display_name: 'Python 3' } },
    nbformat: 4,
    nbformat_minor: 5
  }, null, 2))
  writeFileSync(join(workspaceDir, 'notebook-output-types-smoke.ipynb'), JSON.stringify({
    cells: [
      {
        cell_type: 'code',
        execution_count: 4,
        source: ['display("rich output baseline")'],
        outputs: [
          { output_type: 'display_data', data: { 'text/markdown': ['**Markdown output baseline**'] } },
          { output_type: 'error', ename: 'ValueError', evalue: 'baseline failure', traceback: ['Traceback baseline\n', 'ValueError: baseline failure'] },
          { output_type: 'display_data', data: { 'image/png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==' } }
        ]
      }
    ],
    metadata: { kernelspec: { display_name: 'Python 3' } },
    nbformat: 4,
    nbformat_minor: 5
  }, null, 2))
  writeFileSync(join(workspaceDir, 'binary-preview-smoke.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 255]))
  spawnSync('git', ['init'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'orchestrator-smoke@example.test'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'Orchestrator Smoke'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['add', '.'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['commit', '-m', 'baseline'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['branch', 'review-base-branch'], { cwd: workspaceDir, stdio: 'ignore' })
  writeFileSync(join(workspaceDir, 'branch-source-smoke.txt'), 'branch source committed\n')
  spawnSync('git', ['add', 'branch-source-smoke.txt'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['commit', '-m', 'branch source smoke'], { cwd: workspaceDir, stdio: 'ignore' })
  if (captureView === 'diff-conflict') {
    const defaultBranch = spawnSync('git', ['branch', '--show-current'], { cwd: workspaceDir, encoding: 'utf8' }).stdout.trim()
    spawnSync('git', ['checkout', '-b', 'review-conflict-topic'], { cwd: workspaceDir, stdio: 'ignore' })
    writeFileSync(join(workspaceDir, 'conflict-smoke.txt'), 'incoming conflict choice\n')
    spawnSync('git', ['add', 'conflict-smoke.txt'], { cwd: workspaceDir, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'incoming conflict choice'], { cwd: workspaceDir, stdio: 'ignore' })
    spawnSync('git', ['checkout', defaultBranch], { cwd: workspaceDir, stdio: 'ignore' })
    writeFileSync(join(workspaceDir, 'conflict-smoke.txt'), 'current conflict choice\n')
    spawnSync('git', ['add', 'conflict-smoke.txt'], { cwd: workspaceDir, stdio: 'ignore' })
    spawnSync('git', ['commit', '-m', 'current conflict choice'], { cwd: workspaceDir, stdio: 'ignore' })
    spawnSync('git', ['merge', 'review-conflict-topic'], { cwd: workspaceDir, stdio: 'ignore' })
  }
  if (captureView !== 'diff-empty') {
    writeFileSync(join(workspaceDir, 'review-base.txt'), 'before review\nafter review\n')
    writeFileSync(join(workspaceDir, 'loading-source-smoke.txt'), 'loading source smoke\nloaded preview\n')
    writeFileSync(join(workspaceDir, 'large-source-smoke.txt'), Array.from({ length: 1800 }, (_, index) => `large source smoke line ${String(index + 1).padStart(4, '0')}`).join('\n'))
    writeFileSync(join(workspaceDir, 'large-diff-smoke.txt'), Array.from({ length: largeDiffLineCount }, (_, index) => `large diff updated line ${String(index + 1).padStart(4, '0')}`).join('\n'))
    writeFileSync(join(workspaceDir, 'staged-source-smoke.txt'), 'staged updated\n')
    spawnSync('git', ['add', 'staged-source-smoke.txt'], { cwd: workspaceDir, stdio: 'ignore' })
    writeFileSync(join(workspaceDir, 'whitespace-smoke.txt'), 'name: alpha  \nindent:\n    child: one\n')
    writeFileSync(join(workspaceDir, 'word-diff-smoke.txt'), 'status: updated ready\ncount: two\n')
    writeFileSync(join(workspaceDir, 'hidden-context-smoke.txt'), Array.from({ length: 90 }, (_, index) => {
      if (index === 4) return 'first hidden context updated'
      if (index === 69) return 'second hidden context updated'
      return `hidden context unchanged line ${String(index + 1).padStart(2, '0')}`
    }).join('\n'))
    writeFileSync(join(workspaceDir, 'review-new.txt'), 'new review file\n')
    writeFileSync(join(workspaceDir, 'Nested Folder', 'nested note.md'), '# Nested file smoke preview\n\nThis verifies spaces in paths and review tree grouping.\n')
    writeFileSync(join(workspaceDir, 'data-preview-smoke.json'), JSON.stringify({ status: 'updated', items: [{ name: 'alpha', count: 2 }, { name: 'beta', count: 3 }] }, null, 2))
    writeFileSync(join(workspaceDir, 'table-preview-smoke.csv'), 'name,count,status\nalpha,2,updated\nbeta,3,new\n')
    writeFileSync(join(workspaceDir, 'pdf-preview-smoke.pdf'), createPdfFixture(['PDF preview smoke updated', 'PDF preview smoke second page updated']))
    writeFileSync(join(workspaceDir, 'document-preview-smoke.docx'), createDocxFixture([
    'Document smoke updated',
    'This verifies DOCX text preview in the inspector.',
    { rows: [['Metric', 'Value'], ['Rows', '2'], ['Status', 'Updated table']] },
    { imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNkYPj/HwADAgH/akqSVAAAAABJRU5ErkJggg==', alt: 'Document smoke embedded image', cx: 914400, cy: 914400 },
    'Document smoke section alpha',
    'Document smoke section beta',
    'Document smoke section gamma',
      'Document smoke section delta',
      'Document smoke appendix',
      'Document smoke closing note'
    ]))
    writeFileSync(join(workspaceDir, 'spreadsheet-preview-smoke.xlsx'), createXlsxFixture({
      sheets: [
        {
          sheetName: 'Smoke data',
          rows: [
          [
            { value: 'Name', fillColor: '#DBEAFE', textColor: '#1D4ED8', bold: true },
            { value: 'Count', fillColor: '#DBEAFE', textColor: '#1D4ED8', bold: true },
            { value: 'Status', fillColor: '#DBEAFE', textColor: '#1D4ED8', bold: true }
          ],
          ['Alpha', '2', { value: 'Updated', fillColor: '#DCFCE7', textColor: '#166534' }],
          ['Beta', '3', { value: 'New', fillColor: '#F5F3FF', textColor: '#6D28D9' }],
          [{ value: 'Merged updated note', fillColor: '#E0F2FE', textColor: '#075985', bold: true }, '']
        ],
        columnWidths: [12, 24, 14],
        rowHeights: [20, 20, 20, 42],
        merges: ['A4:B4']
      },
        {
          sheetName: 'Totals',
          rows: [
            [
              { value: 'Metric', fillColor: '#E5E7EB', bold: true },
              { value: 'Value', fillColor: '#E5E7EB', bold: true }
            ],
            ['Updated total', '5'],
            ['Formula total', { formula: 'B2+2', fillColor: '#FEF3C7', textColor: '#92400E', bold: true }]
          ]
        }
      ]
    }))
    writeFileSync(join(workspaceDir, 'slides-preview-smoke.pptx'), createPptxFixture([
      {
        lines: ['Slides smoke updated', 'First slide updated'],
        notes: ['Updated speaker note'],
        backgroundColor: '#EEF6FF',
        shapes: [
          { text: ['Slides smoke updated'], x: 914400, y: 914400, cx: 10363200, cy: 914400, fillColor: '#D9EAFE', textColor: '#1D4ED8' },
          { text: ['First slide updated'], x: 1371600, y: 2286000, cx: 9144000, cy: 685800, fillColor: '#DCFCE7', textColor: '#166534' },
          { imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNkYPj/HwADAgH/akqSVAAAAABJRU5ErkJggg==', x: 1371600, y: 3657600, cx: 1828800, cy: 914400 }
        ]
      },
      { lines: ['Second slide updated', 'Follow-up content'], notes: ['Second updated note'] }
    ]))
    writeFileSync(
      join(workspaceDir, 'image-preview-smoke.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNkYPj/HwADAgH/akqSVAAAAABJRU5ErkJggg==', 'base64')
    )
    writeFileSync(join(workspaceDir, 'notebook-preview-smoke.ipynb'), JSON.stringify({
      cells: [
        { cell_type: 'markdown', source: ['# Notebook smoke\n', 'Updated'] },
        {
          cell_type: 'code',
          execution_count: 7,
          metadata: {
            codex: {
              title: 'Compute updated value',
              descriptionMarkdown: '**Smoke description:** computes the updated value.',
              outputSummaries: [
                { summaryMarkdown: '**Stream summary:** printed the updated result.' },
                { summaryMarkdown: '**Result summary:** returned the text/plain display value.' }
              ]
            }
          },
          source: ['value = 2\n', 'value'],
          outputs: [
            { output_type: 'stream', name: 'stdout', text: ['result: 2\n'] },
            { output_type: 'execute_result', data: { 'application/json': { status: 'updated', value: 2 }, 'text/plain': ['plain result: 2'] } }
          ]
        },
        { cell_type: 'markdown', source: ['Summary cell'] }
      ],
      metadata: { kernelspec: { display_name: 'Python 3' } },
      nbformat: 4,
      nbformat_minor: 5
    }, null, 2))
    writeFileSync(join(workspaceDir, 'notebook-output-types-smoke.ipynb'), JSON.stringify({
      cells: [
        {
          cell_type: 'code',
          execution_count: 8,
          source: ['display("rich output updated")'],
          outputs: [
            { output_type: 'display_data', data: { 'text/markdown': ['**Markdown output updated**'] } },
            { output_type: 'error', ename: 'ValueError', evalue: 'updated failure', traceback: ['Traceback updated\n', 'ValueError: updated failure'] },
            { output_type: 'display_data', data: { 'image/png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mNkYPj/HwADAgH/akqSVAAAAABJRU5ErkJggg==' } }
          ]
        }
      ],
      metadata: { kernelspec: { display_name: 'Python 3' } },
      nbformat: 4,
      nbformat_minor: 5
    }, null, 2))
    writeFileSync(join(workspaceDir, 'binary-preview-smoke.bin'), Buffer.from([0, 1, 2, 3, 4, 5, 6, 255]))
    rmSync(join(workspaceDir, 'review-delete.txt'), { force: true })
  }
  browserSmokeServer = createServer((request, response) => {
    if (request.url === '/smoke.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
      response.end('main{font-family:system-ui;color:#102030}.asset-smoke{background:#f4f8ff}')
      return
    }
    if (request.url === '/slow') {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!doctype html><title>Slow smoke</title><main>Slow browser smoke page</main>')
      }, 2500)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html>
      <title>Orchestrator Browser Smoke</title>
      <link rel="stylesheet" href="/smoke.css">
      <main class="asset-smoke">
        <h1>Browser smoke page</h1>
        <p>Loaded inside the side panel.</p>
        <p>Browser search has a second visible match.</p>
        <button id="target-button" onclick="document.body.dataset.clicked='yes'; console.log('browser smoke clicked')">Target button</button>
        <input aria-label="Smoke input" placeholder="Type here" oninput="document.body.dataset.inputValue=this.value" onkeydown="document.body.dataset.keyPressed=event.key">
        <select aria-label="Smoke select" onchange="document.body.dataset.selectedOption=this.value"><option value="alpha">Alpha</option><option value="beta">Beta</option></select>
        <label><input type="checkbox" aria-label="Smoke checkbox" onchange="document.body.dataset.checkedState=this.checked ? 'true' : 'false'"> Check me</label>
        <svg role="img" aria-label="Inline smoke icon" width="18" height="18"><circle cx="9" cy="9" r="8"></circle></svg>
      </main>`)
  })
  await new Promise((resolveServer) => {
    browserSmokeServer.listen(0, '127.0.0.1', resolveServer)
  })
  const address = browserSmokeServer.address()
  if (address && typeof address === 'object') browserSmokeUrl = `http://127.0.0.1:${address.port}`
}

if (captureView === 'sidebar') {
  writeFileSync(join(workspaceDir, 'README.md'), '# Sidebar worktree smoke\n')
  spawnSync('git', ['init'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.email', 'orchestrator-smoke@example.test'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['config', 'user.name', 'Orchestrator Smoke'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['add', '.'], { cwd: workspaceDir, stdio: 'ignore' })
  spawnSync('git', ['commit', '-m', 'sidebar baseline'], { cwd: workspaceDir, stdio: 'ignore' })
}

const launch = runInstalled ? installedLaunchCommand() : runPackaged ? packagedLaunchCommand() : {
  bin: process.platform === 'win32' ? 'npm.cmd' : 'npm',
  args: ['run', 'dev']
}

const child = spawn(launch.bin, launch.args, {
  cwd: root,
  env: {
    ...process.env,
    ORCHESTRATOR_PROFILE: profile,
    ORCHESTRATOR_USER_DATA_DIR: userDataDir,
    ORCHESTRATOR_SMOKE_WORKSPACE_DIR: workspaceDir,
    ORCHESTRATOR_DISABLE_PET_OVERLAY: ['pet-overlay', 'motion-reduced'].includes(captureView) ? '0' : '1',
    ORCHESTRATOR_FORCE_REDUCED_MOTION: captureView === 'motion-reduced' ? '1' : process.env.ORCHESTRATOR_FORCE_REDUCED_MOTION,
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_FOREGROUND: foregroundSmoke ? '1' : '0',
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_OUTPUT: outputPath,
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_SCREENSHOT: screenshotPath,
    ORCHESTRATOR_AUTOMATED_UI_SMOKE_VIEW: captureView,
    ORCHESTRATOR_BROWSER_SMOKE_URL: browserSmokeUrl
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let log = ''
child.stdout.on('data', (chunk) => { log += chunk.toString() })
child.stderr.on('data', (chunk) => { log += chunk.toString() })

const timeoutMs = Number.parseInt(process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_TIMEOUT_MS ?? '90000', 10)
const lateOutputGraceMs = Number.parseInt(
  process.env.ORCHESTRATOR_AUTOMATED_UI_SMOKE_LATE_OUTPUT_GRACE_MS ?? (runInstalled ? '15000' : '1000'),
  10
)
const timeout = setTimeout(() => {
  child.kill('SIGTERM')
  browserSmokeServer?.close()
  console.error('Automated UI smoke timed out.')
  console.error(log.slice(-4000))
  process.exit(1)
}, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90_000)

child.on('exit', async (code) => {
  clearTimeout(timeout)
  if (!existsSync(outputPath)) {
    await waitForFile(outputPath, lateOutputGraceMs)
    if (!existsSync(outputPath)) {
      browserSmokeServer?.close()
      console.error('Automated UI smoke did not produce an output file.')
      console.error(log.slice(-4000))
      process.exit(code ?? 1)
    }
  }

  const report = JSON.parse(readFileSync(outputPath, 'utf8'))
  browserSmokeServer?.close()
  if (!report.ok) {
    console.error(JSON.stringify(report, null, 2))
    process.exit(1)
  }

  const result = report.result ?? {}
  const browserDeepChecksCoveredByBrowserSmoke = captureView === 'inspector'
  const checks = captureView === 'empty-state'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        noProjects: result.projectCount === 0,
        noSessions: result.sessionCount === 0,
        emptyStateVisible: result.emptyStateVisible === true,
        emptyStateCalm: result.emptyStateCalm === true,
        addProjectActionVisible: result.addProjectActionVisible === true,
        addProjectActionCompact: result.addProjectActionCompact === true,
        importCodexActionVisible: result.importCodexActionVisible === true,
        sidebarEmptyStateVisible: result.sidebarEmptyStateVisible === true,
        sidebarNoHorizontalOverflow: result.sidebarNoHorizontalOverflow === true,
        noStaticSuggestionCards: result.noStaticSuggestionCards === true
      }
    : captureView === 'multi-window-focus'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        secondWindowCreated: result.secondWindowCreated === true,
        secondWindowNavigated: result.secondWindowNavigated === true,
        pendingNavigationConsumedOnce: result.pendingNavigationConsumedOnce === true,
        pendingNavigationWindowScoped: result.pendingNavigationWindowScoped === true,
        loadedDeepLinkDoesNotLeavePendingNavigation: result.loadedDeepLinkDoesNotLeavePendingNavigation === true,
        firstWindowBrowserFocusArea: result.firstWindowBrowserFocusArea === true,
        firstWindowBrowserMenuEnabled: result.firstWindowBrowserMenuEnabled === true,
        secondWindowBrowserMenuDisabled: result.secondWindowBrowserMenuDisabled === true,
        backgroundWindowMenuDoesNotClobberFocusedWindow: result.backgroundWindowMenuDoesNotClobberFocusedWindow === true,
        activeWindowAfterRefocus: result.activeWindowAfterRefocus === true,
        focusSwitchRestoresFirstWindowMenu: result.focusSwitchRestoresFirstWindowMenu === true,
        menuCommandRoutedToFocusedWindow: result.menuCommandRoutedToFocusedWindow === true
      }
    : captureView === 'session-switch'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        firstTranscriptFound: result.firstTranscriptFound === true,
        firstTitleFound: result.firstTitleFound === true,
        secondTranscriptFound: result.secondTranscriptFound === true,
        secondTitleFound: result.secondTitleFound === true,
        summaryTailBounded: result.summaryTailBounded === true,
        longHistoryDeferred: result.longHistoryDeferred === true,
        fullHydratedAfterSwitch: result.fullHydratedAfterSwitch === true,
        autoLazyLoadedEarlier: result.autoLazyLoadedEarlier === true,
        autoLazyAnchorPreserved: result.autoLazyAnchorPreserved === true,
        virtualMountedRowsBounded: Number(result.mountedVirtualRows ?? Number.POSITIVE_INFINITY) <= 36,
        transcriptSearchFound: result.transcriptSearchFound === true,
        renderedWindowBounded: Number(result.renderedMessages ?? Number.POSITIVE_INFINITY) <= 40,
        telemetryRecorded: result.telemetryRecorded === true,
        titleWithinBudget: Number(result.titleElapsedMs ?? Number.POSITIVE_INFINITY) <= 150,
        transcriptWithinBudget: Number(result.switchElapsedMs ?? Number.POSITIVE_INFINITY) <= 900,
        sessionViewNotAnimated: result.sessionViewAnimated === false
      }
    : captureView === 'transcript-stress'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        stressTranscriptFound: result.stressTranscriptFound === true,
        stressMessageCount: Number(result.messageCount ?? 0) >= 2500,
        initialMountedRowsBounded: Number(result.initialMountedRows ?? Number.POSITIVE_INFINITY) <= 48,
        lazyMountedRowsBounded: Number(result.lazyMountedRows ?? Number.POSITIVE_INFINITY) <= 56,
        searchMountedRowsBounded: Number(result.searchMountedRows ?? Number.POSITIVE_INFINITY) <= 56,
        lazyLoadedOlderChunk: result.lazyLoadedOlderChunk === true,
        searchJumpFound: result.searchJumpFound === true,
        stressReadyWithinBudget: Number(result.readyElapsedMs ?? Number.POSITIVE_INFINITY) <= 1400
      }
    : captureView === 'streaming-drag'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        streamingMessageUpdated: result.streamingMessageUpdated === true,
        streamingSessionActive: result.streamingSessionActive === true,
        streamingTextVisible: result.streamingTextVisible === true,
        titlebarCommitCountLow: Number(result.titlebarCommitCount ?? Number.POSITIVE_INFINITY) <= 4,
        appCommitCountLow: Number(result.appCommitCount ?? Number.POSITIVE_INFINITY) <= 6,
        maxFrameGapAcceptable: Number(result.maxFrameGapMs ?? Number.POSITIVE_INFINITY) < 80,
        titlebarDragResponsive: result.titlebarDragResponsive === true
      }
    : captureView === 'streaming-typing'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        streamingMessageUpdated: result.streamingMessageUpdated === true,
        streamingSessionActive: result.streamingSessionActive === true,
        streamingTextVisible: result.streamingTextVisible === true,
        composerTyped: result.composerTyped === true,
        typingTimerDriftAcceptable: Number(result.maxTypingTimerDriftMs ?? Number.POSITIVE_INFINITY) < 55,
        inputDispatchAcceptable: Number(result.maxInputDispatchMs ?? Number.POSITIVE_INFINITY) < 24,
        maxFrameGapAcceptable: Number(result.maxFrameGapMs ?? Number.POSITIVE_INFINITY) < 80,
        inputBarCommitCountBounded: Number(result.inputBarCommitCount ?? Number.POSITIVE_INFINITY) <= 96,
        sessionPaneCommitCountBounded: Number(result.sessionPaneCommitCount ?? Number.POSITIVE_INFINITY) <= 12
      }
    : captureView === 'motion-reduced'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        profileForced: result.profile?.forceReducedMotion === true,
        mainReducedDataset: result.mainReducedDataset === true,
        mainPanelDurationZero: result.mainPanelDurationZero === true,
        mainTransitionsZero: result.mainTransitionsZero === true,
        mainAnimationsZero: result.mainAnimationsZero === true,
        mainRightPanelReduced: result.mainRightPanelReduced === true,
        mainBottomPanelReduced: result.mainBottomPanelReduced === true,
        mainPopoverReduced: result.mainPopoverReduced === true,
        mainSheetReduced: result.mainSheetReduced === true,
        overlayFound: result.overlayFound === true,
        overlayReducedDataset: result.overlayReducedDataset === true,
        overlayBadgeTransitionDisabled: result.overlayBadgeTransitionDisabled === true,
        overlayRowTransitionDisabled: result.overlayRowTransitionDisabled === true,
        overlayResizeGripTransitionDisabled: result.overlayResizeGripTransitionDisabled === true,
        trayCollapsedReduced: result.trayCollapsedReduced === true,
        replyFormReduced: result.replyFormReduced === true,
        replyInputReducedTransitionDisabled: result.replyInputReducedTransitionDisabled === true
      }
    : captureView === 'pet-overlay'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        overlayFound: result.overlayFound === true,
        badgeFound: result.badgeFound === true,
        trayFound: result.trayFound === true,
        mascotFound: result.mascotFound === true,
        badgeInsideViewport: result.badgeInsideViewport === true,
        trayAligned: result.trayAligned === true,
        noHorizontalOverflow: result.noHorizontalOverflow === true,
        noVerticalOverflow: result.noVerticalOverflow === true,
        resizeMaxInside: result.resizeMaxInside === true,
        resizeMinInside: result.resizeMinInside === true,
        rowControlsReveal: result.rowControlsReveal === true,
        rowExpandControlVisible: result.rowExpandControlVisible === true,
        rowExpanded: result.rowExpanded === true,
        trayCollapsed: result.trayCollapsed === true,
        trayReopened: result.trayReopened === true,
        resizeHandleFound: result.resizeHandleFound === true,
        resizeHandleCompact: result.resizeHandleCompact === true,
        overlayRootCursorDefault: result.overlayRootCursorDefault === true,
        resizeGripMascotHoverHidden: result.resizeGripMascotHoverHidden === true,
        resizeGripHoverVisible: result.resizeGripHoverVisible === true,
        resizeGripFocusVisible: result.resizeGripFocusVisible === true,
        replyFormOpened: result.replyFormOpened === true,
        replyInputFocused: result.replyInputFocused === true,
        replyFormClosedWithEscape: result.replyFormClosedWithEscape === true,
        permissionActionsVisible: result.permissionActionsVisible === true,
        permissionAllowSessionDecision: result.permissionAllowSessionDecision === true,
        permissionTitleMapped: result.permissionTitleMapped === true,
        permissionStatusMapped: result.permissionStatusMapped === true,
        runningStatusMapped: result.runningStatusMapped === true,
        runningDismissHidden: result.runningDismissHidden === true,
        reviewStatusMapped: result.reviewStatusMapped === true,
        failedStatusMapped: result.failedStatusMapped === true,
        customProviderStatusMapped: result.customProviderStatusMapped === true
      }
    : captureView === 'scroll'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        transcriptFound: result.transcriptFound === true,
        jumpVisibleBeforeUpdate: result.jumpVisibleBeforeUpdate === true,
        scrollStayedPut: result.scrollStayedPut === true,
        streamingDidNotAutoFollow: result.streamingDidNotAutoFollow === true,
        streamingCursorVisibleDuringUpdate: result.streamingCursorVisibleDuringUpdate === true,
        streamingCursorHiddenAfterComplete: result.streamingCursorHiddenAfterComplete === true,
        finalStreamingTextDeduped: result.finalStreamingTextDeduped === true,
        jumpToLatestReached: result.jumpToLatestReached === true,
        jumpHiddenAfterClick: result.jumpVisibleAfterClick === false
      }
    : captureView === 'sidebar'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        pinnedAboveProjects: result.pinnedAboveProjects === true,
        pinnedOrderStable: result.pinnedOrderStable === true,
        pinnedRowsHiddenFromProjects: result.pinnedRowsHiddenFromProjects === true,
        providerPinnedMetadata: result.providerPinnedMetadataWorks === true,
        sidebarProviderPinBoundary: result.sidebarProviderPinBoundaryWorks === true,
        pinnedSharesProjectScroll: result.pinnedSharesProjectScroll === true,
        sidebarPinnedDragReorder: result.sidebarPinnedDragReorderWorks === true,
        sidebarProjectlessChats: result.sidebarProjectlessChatsWorks === true,
        sidebarProjectlessChatsFirstPreference: result.sidebarProjectlessChatsFirstPreferenceWorks === true,
        providerProjectlessMetadata: result.providerProjectlessMetadataWorks === true,
        providerWorktreeMetadata: result.providerWorktreeMetadataWorks === true,
        sidebarPrimaryActionsCodexOrder: result.sidebarPrimaryActionsCodexOrderWorks === true,
        sidebarPrimaryActionsBeforePinned: result.sidebarPrimaryActionsBeforePinned === true,
        sidebarSearchPrimaryAction: result.sidebarSearchPrimaryActionWorks === true,
        sidebarPluginsPrimaryAction: result.sidebarPluginsPrimaryActionWorks === true,
        sidebarAutomationsPrimaryAction: result.sidebarAutomationsPrimaryActionWorks === true,
        sidebarSelectedKeySignal: result.sidebarSelectedKeySignalWorks === true,
        sidebarSelectedKeyPersistence: result.sidebarSelectedKeyPersistenceWorks === true,
        sidebarSelectedNavKeys: result.sidebarSelectedNavKeysWork === true,
        sidebarFooterCollapseAffordance: result.sidebarFooterCollapseAffordanceWorks === true,
        pinnedRowUnpinned: result.pinnedRowUnpinned === true,
        newPinAppended: result.newPinAppended === true,
        hoverPinVisible: result.hoverPinVisible === true,
        hoverCardDelayed: result.hoverCardDelayed === true,
        hoverCardVisible: result.hoverCardVisible === true,
        hoverCardSurfaceReadable: result.hoverCardSurfaceReadable === true,
        hoverCardMaterial: result.hoverCardMaterialWorks === true,
        doubleClickRenameWorks: result.doubleClickRenameWorks === true,
        renameDialogCancelWorks: result.renameDialogCancelWorks === true,
        renameDialogChromeQuiet: result.renameDialogChromeQuiet === true,
        renameDialogSharedLayout: result.renameDialogSharedLayoutWorks === true,
        renameDialogInputFocused: result.renameDialogInputFocused === true,
        tooltipSurfaceReadable: result.tooltipSurfaceReadable === true,
        singleHoverSurface: result.singleHoverSurfaceWorks === true,
        tooltipDismissesOnViewportChange: result.tooltipDismissesOnViewportChange === true,
        customTooltipNativeTitlesAbsent: result.customTooltipNativeTitlesAbsent === true,
        nativeTitleFreeControls: result.nativeTitleFreeControlsWork === true,
        sidebarNoHorizontalOverflow: result.sidebarNoHorizontalOverflow === true,
        sidebarWidthToken: result.sidebarWidthTokenWorks === true,
        sidebarTopInsetCodexLike: result.sidebarTopInsetCodexLike === true,
        sidebarRowDensityCodexLike: result.sidebarRowDensityCodexLike === true,
        sessionRowsCompact: result.sessionRowsCompact === true,
        sessionRowsCalm: result.sessionRowsCalm === true,
        sidebarRowsMaterialQuiet: result.sidebarRowsMaterialQuiet === true,
        sessionRowsSharedPrimitive: result.sessionRowsUseSharedPrimitive === true,
        projectHeadersCompact: result.projectHeadersCompact === true,
        projectHeadersSharedPrimitive: result.projectHeadersUseSharedPrimitive === true,
        emptyProjectNewChatCompact: result.emptyProjectNewChatCompact === true,
        emptyProjectNewChatSharedPrimitive: result.emptyProjectNewChatUsesSharedPrimitive === true,
        sidebarSectionChromeCompact: result.sidebarSectionChromeCompact === true,
        sidebarSectionRhythm: result.sidebarSectionRhythmWorks === true,
        idleRowRecencyVisible: result.idleRowRecencyVisible === true,
        importantRowStatusIconOnly: result.importantRowStatusIconOnly === true,
        chatEnvironmentIconAbsent: result.chatEnvironmentIconAbsent === true,
        sidebarThreadIdentityMetadata: result.sidebarThreadIdentityMetadataWorks === true,
        sessionRowsTextFirst: result.sessionRowsTextFirst === true,
        sidebarLabelColorMetadata: result.sidebarLabelColorMetadataWorks === true,
        sidebarPinnedRowsTextFirst: result.sidebarPinnedRowsTextFirst === true,
        sidebarPinActionsConsolidated: result.sidebarPinActionsConsolidated === true,
        sidebarActionMenuChromeCalm: result.sidebarActionMenuChromeCalm === true,
        sidebarActionMenuSharedSections: result.sidebarActionMenuSharedSectionsWorks === true,
        actionRenameWorks: result.actionRenameWorks === true,
        actionMarkUnreadWorks: result.actionMarkUnreadWorks === true,
        actionCopyDeeplinkWorks: result.actionCopyDeeplinkWorks === true,
        actionCopyMarkdownWorks: result.actionCopyMarkdownWorks === true,
        actionStopChatWorks: result.actionStopChatWorks === true,
        actionForkLocalWorks: result.actionForkLocalWorks === true,
        actionForkNewWorktreeWorks: result.actionForkNewWorktreeWorks === true,
        actionForkNewWorktreePendingWorks: result.actionForkNewWorktreePendingWorks === true,
        actionForkNewWorktreeReadyWorks: result.actionForkNewWorktreeReadyWorks === true,
        actionRetryPendingWorktreeWorks: result.actionRetryPendingWorktreeWorks === true,
        actionRetryPendingWorktreeReadyWorks: result.actionRetryPendingWorktreeReadyWorks === true,
        actionOpenInNewWindowWorks: result.actionOpenInNewWindowWorks === true,
        actionAddAutomationWorks: result.actionAddAutomationWorks === true,
        actionEditAutomationWorks: result.actionEditAutomationWorks === true,
        actionAutomationDialogSharedLayout: result.actionAutomationDialogSharedLayoutWorks === true,
        actionAutomationPermissionSnapshotWorks: result.actionAutomationPermissionSnapshotWorks === true,
        actionAutomationScheduleEditingWorks: result.actionAutomationScheduleEditingWorks === true,
        actionAutomationLifecycleWarningWorks: result.actionAutomationLifecycleWarningWorks === true,
        actionRunAutomationVisible: result.actionRunAutomationVisible === true,
        actionResumeAutomationWorks: result.actionResumeAutomationWorks === true,
        actionPauseAutomationWorks: result.actionPauseAutomationWorks === true,
        actionDeleteAutomationWorks: result.actionDeleteAutomationWorks === true,
        sidebarAutomationRowMetadata: result.sidebarAutomationRowMetadataWorks === true,
        sidebarAutomationRunningMetadata: result.sidebarAutomationRunningMetadataWorks === true,
        runningSpinnerVisible: result.runningSpinnerVisible === true,
        normalIdleDotHidden: result.normalIdleDotHidden === true,
        unreadIdleDotVisible: result.unreadIdleDotVisible === true,
        errorDotVisible: result.errorDotVisible === true,
        pinnedLiveRunningSpinner: result.pinnedLiveRunningSpinner === true,
        pinnedLiveUnreadDot: result.pinnedLiveUnreadDot === true,
        pinnedLiveOrderStable: result.pinnedLiveOrderStable === true,
        grayIdleDotsAbsent: result.grayIdleDotsAbsent === true,
        projectActionMenuWorks: result.projectActionMenuWorks === true,
        projectActionMenuSharedSections: result.projectActionMenuSharedSectionsWorks === true,
        projectRenameWorks: result.projectRenameWorks === true,
        projectPinWorks: result.projectPinWorks === true,
        projectCollapsePersistenceWorks: result.projectCollapsePersistenceWorks === true,
        builtInSectionCollapseWorks: result.builtInSectionCollapseWorks === true,
        builtInSectionOrderWorks: result.builtInSectionOrderWorks === true,
        customSectionModelWorks: result.customSectionModelWorks === true,
        customSectionDragMembershipWorks: result.customSectionDragMembershipWorks === true,
        customSectionDragOrderWorks: result.customSectionDragOrderWorks === true,
        customSectionSectionReorderWorks: result.customSectionSectionReorderWorks === true,
        customSectionMembershipWorks: result.customSectionMembershipWorks === true,
        customSectionCollapseWorks: result.customSectionCollapseWorks === true,
        organizeMenuWorks: result.organizeMenuWorks === true,
        organizeMenuSharedSections: result.organizeMenuSharedSectionsWorks === true,
        sidebarConnectionGrouping: result.sidebarConnectionGroupingWorks === true
      }
    : captureView === 'transcript-layout'
    ? {
        isolatedProfile: result.profile?.isIsolated === true,
        transcriptFound: result.transcriptFound === true,
        layoutFixtureVisible: result.layoutFixtureVisible === true,
        searchHiddenInitially: result.searchHiddenInitially === true,
        commandPaletteOpens: result.commandPaletteOpens === true,
        commandPaletteSearchField: result.commandPaletteSearchFieldWorks === true,
        commandPaletteShiftPOpens: result.commandPaletteShiftPOpens === true,
        commandPaletteGrouped: result.commandPaletteGrouped === true,
        commandPaletteRecentVisible: result.commandPaletteRecentVisible === true,
        commandPaletteShortcutLabels: result.commandPaletteShortcutLabels === true,
        commandPaletteFuzzyFindsTerminal: result.commandPaletteFuzzyFindsTerminal === true,
        commandPaletteSearchActionWorks: result.commandPaletteSearchActionWorks === true,
        searchShortcutOpens: result.searchShortcutOpens === true,
        transcriptSearchField: result.transcriptSearchFieldWorks === true,
        sessionHeaderInPrimaryColumn: result.sessionHeaderInPrimaryColumn === true,
        keyboardShortcutsShortcutOpens: result.keyboardShortcutsShortcutOpens === true,
        hiddenMessageCopyQuiet: result.hiddenMessageCopyQuiet === true,
        documentNoHorizontalOverflow: result.documentNoHorizontalOverflow === true,
        transcriptNoHorizontalOverflow: result.transcriptNoHorizontalOverflow === true,
        messageRowsBounded: result.messageRowsBounded === true,
        codeBlockBounded: result.codeBlockBounded === true,
        codeBlockInternallyScrollable: result.codeBlockInternallyScrollable === true,
        tableBounded: result.tableBounded === true,
        tableCellsWrap: result.tableCellsWrap === true,
        rawEventsHiddenFromTranscript: result.rawEventsHiddenFromTranscript === true,
        narrowDocumentNoHorizontalOverflow: result.narrowDocumentNoHorizontalOverflow === true,
        narrowTranscriptNoHorizontalOverflow: result.narrowTranscriptNoHorizontalOverflow === true,
        narrowCodeBlockBounded: result.narrowCodeBlockBounded === true,
        narrowCodeBlockInternallyScrollable: result.narrowCodeBlockInternallyScrollable === true,
        narrowTableBounded: result.narrowTableBounded === true,
        narrowTableCellsWrap: result.narrowTableCellsWrap === true,
        narrowRawEventsHiddenFromTranscript: result.narrowRawEventsHiddenFromTranscript === true,
        fileCardsBounded: result.fileCardsBounded === true,
        relativeProseCardSuppressed: result.relativeProseCardSuppressed === true,
        absoluteMissingFileCardDisabled: result.absoluteMissingFileCardDisabled === true,
        toolSummaryExpanded: result.toolSummaryExpanded === true,
        toolSummaryBounded: result.toolSummaryBounded === true,
        toolSummaryScrollable: result.toolSummaryScrollable === true,
        documentNoHorizontalOverflowAfterExpand: result.documentNoHorizontalOverflowAfterExpand === true
      }
    : captureView === 'design-system'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          designPreview: result.hasDesignSystemPreview === true,
          designContract: result.hasDesignSystemContract === true,
          motionRows: Number(result.motionRowCount ?? 0) >= 3,
          surfaceRows: Number(result.surfaceRowCount ?? 0) >= 3,
          buttons: Number(result.buttonCount ?? 0) > 0
        }
    : captureView === 'browser'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          browserActive: result.browserActive === true,
          browserHeaderPanelSeam: result.browserHeaderPanelSeamWorks === true,
          browserEmptyState: result.browserEmptyStateWorks === true,
          browserLocalTargets: result.browserLocalTargetsWorks === true,
          browserLocalTargetsCalm: result.browserLocalTargetsCalm === true,
          browserLocalTargetsListChrome: result.browserLocalTargetsListChromeWorks === true,
          browserLocalTargetsCompactChooser: result.browserLocalTargetsCompactChooserWorks === true,
          browserLocalTargetHide: result.browserLocalTargetHideWorks === true,
          browserLocalServerRoutes: result.browserLocalServerRoutesWork === true,
          browserLocalServerRouteNormalization: result.browserLocalServerRouteNormalizationWorks === true,
          browserAddressSearch: result.browserAddressSearchWorks === true,
          browserAddressBadge: result.browserAddressBadgeWorks === true,
          browserToolbarExternal: result.browserToolbarExternalWorks === true,
          browserToolbarScreenshot: result.browserToolbarScreenshotWorks === true,
          browserLoaded: result.browserLoaded === true,
          browserWebviewManagerBoundary: result.browserWebviewManagerBoundaryWorks === true,
          browserFind: result.browserFindWorks === true,
          browserFindNavigation: result.browserFindNavigationWorks === true,
          browserZoom: result.browserZoomWorks === true,
          browserDeviceMode: result.browserDeviceModeWorks === true,
          browserDevicePresetCatalog: result.browserDevicePresetCatalogWorks === true,
          browserVisibleGeometry: result.browserVisibleGeometryWorks === true,
          browserViewportReset: result.browserViewportResetWorks === true,
          browserManagerStateBridge: result.browserManagerStateBridgeWorks === true,
          browserClientToolBridge: result.browserClientToolBridgeWorks === true,
          browserClientToolActions: result.browserClientToolActionsWork === true,
          browserClientToolScreenshot: result.browserClientToolScreenshotWorks === true,
          browserClientToolScreenshotImage: result.browserClientToolScreenshotImageWorks === true,
          browserClientToolAdvancedActions: result.browserClientToolAdvancedActionsWork === true,
          browserCaptureGeometry: result.browserCaptureGeometryWorks === true,
          browserUseNoMutation: result.browserUseNoMutationWorks === true,
          browserCacheReload: result.browserCacheReloadWorks === true,
          browserStopLoading: result.browserStopLoadingWorks === true,
          browserToolbarHistory: result.browserToolbarHistoryWorks === true,
          browserHistoryMenu: result.browserHistoryMenuWorks === true,
          browserActionsMenuCompact: result.browserActionsMenuCompactWorks === true,
          browserActionsMenuMaterial: result.browserActionsMenuMaterialWorks === true,
          browserMenuSectionsShared: result.browserMenuSectionsSharedWorks === true,
          browserMenuRowsShared: result.browserMenuRowsSharedWorks === true,
          browserFallbackMessagesShared: result.browserFallbackMessagesSharedWorks === true,
          browserActionLabelsCalm: result.browserActionLabelsCalm === true,
          browserClearData: result.browserClearDataWorks === true,
          browserContextMenu: result.browserContextMenuWorks === true,
          browserContextMenuMaterial: result.browserContextMenuMaterialWorks === true,
          browserContextComposer: result.browserContextComposerWorks === true,
          browserCommentMode: result.browserCommentModeWorks === true,
          browserCommentCoachmark: result.browserCommentCoachmarkWorks === true,
          browserCommentEditor: result.browserCommentEditorWorks === true,
          browserCommentRegion: result.browserCommentRegionWorks === true,
          browserCommentPreviewOriginal: result.browserCommentPreviewOriginalWorks === true,
          browserCommentDesignTweak: result.browserCommentDesignTweakWorks === true,
          browserCommentUnavailable: result.browserCommentUnavailableWorks === true,
          browserDomPaneCompact: result.browserDomPaneCompactWorks === true,
          browserTargetsPane: result.browserTargetsPaneWorks === true,
          browserTargetKey: result.browserTargetKeyWorks === true,
          browserTargetFill: result.browserTargetFillWorks === true,
          browserTargetType: result.browserTargetTypeWorks === true,
          browserTargetState: result.browserTargetStateWorks === true,
          browserTargetSelect: result.browserTargetSelectWorks === true,
          browserTargetCheck: result.browserTargetCheckWorks === true,
          browserTargetsPaneNoHorizontalOverflow: result.browserTargetsPaneNoHorizontalOverflowWorks === true,
          browserErrorRecovery: result.browserErrorRecoveryWorks === true,
          browserLoadErrorPanel: result.browserLoadErrorPanelWorks === true,
          browserLoadErrorSharedState: result.browserLoadErrorSharedStateWorks === true,
          browserSingleTabChrome: result.browserSingleTabStripHidden === true,
          browserTabShellController: result.browserTabShellControllerWorks === true,
          browserTabChromeCalm: result.browserTabChromeCalmWorks === true,
          browserWebviewPersistence: result.browserWebviewPersistenceWorks === true,
          browserToolbarCompact: result.browserToolbarCompact === true,
          browserInspectorChromeCompact: result.browserInspectorChromeCompactWorks === true,
          browserInspectorContainersShared: result.browserInspectorContainersSharedWorks === true,
          browserInspectorLabelsCalm: result.browserInspectorLabelsCalm === true,
          browserPersistedPolicyDefaults: result.browserPersistedPolicyDefaultsWorks === true,
          browserInspectorActionsShared: result.browserInspectorActionsSharedWorks === true,
          browserVisibilityControl: result.browserVisibilityControlWorks === true,
          browserHiddenState: result.browserHiddenStateWorks === true,
          browserHiddenWebviewPersistence: result.browserHiddenWebviewPersistenceWorks === true,
          browserLifecycleResync: result.browserLifecycleResyncWorks === true,
          browserHiddenWebviewContainment: result.browserHiddenWebviewContainmentWorks === true,
          browserTabReset: result.browserTabResetWorks === true,
          browserForkTransfer: result.browserForkTransferWorks === true,
          browserForkDomTransfer: result.browserForkDomTransferWorks === true,
          browserStatusRowQuiet: result.browserStatusRowQuiet === true,
          browserNoHorizontalOverflow: result.browserNoHorizontalOverflow === true,
          smokeWindowPolicy: foregroundSmoke
            ? result.smokeWindow?.foregroundAllowed === true
            : result.smokeWindow?.foregroundAllowed === false &&
              result.smokeWindow?.focused === false &&
              result.smokeWindow?.visible === true
        }
    : captureView === 'header'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          composer: result.hasComposer === true,
          headerIdentity: result.headerIdentityWorks === true,
          headerMetadataTooltipOnly: result.headerMetadataTooltipOnlyWorks === true,
          profileBadgeCompact: result.profileBadgeCompactWorks === true,
          headerActionChromeCompact: result.headerActionChromeCompactWorks === true,
          headerNativeTooltips: result.headerNativeTooltipsWork === true,
          titlebarSidebarToggle: result.titlebarSidebarToggleWorks === true,
          headerActionMenu: result.headerActionMenuWorks === true
        }
    : captureView === 'right-panel'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          rightPanelState: result.hasRightPanelState === true,
          rightPanelShellOwnership: result.rightPanelShellOwnershipWorks === true,
          rightPanelSharedAnimationController: result.rightPanelSharedAnimationControllerWorks === true,
          rightPanelSharedLayoutController: result.rightPanelSharedLayoutControllerWorks === true,
          rightPanelHeaderSeam: result.rightPanelHeaderSeamWorks === true,
          headerPanelSharedBand: result.headerPanelSharedBandWorks === true,
          headerMetadataTooltipOnly: result.headerMetadataTooltipOnlyWorks === true,
          headerActionChromeCompact: result.headerActionChromeCompactWorks === true,
          rightPanelMaterialSolid: result.rightPanelMaterialSolidWorks === true,
          workbenchPanelChromeCompact: result.workbenchPanelChromeCompactWorks === true,
          workbenchPanelTabCloseStartEdge: result.workbenchPanelTabCloseStartEdgeWorks === true,
          workbenchPanelAddControlStable: result.workbenchPanelAddControlStableWorks === true,
          workbenchPanelNewTabPage: result.workbenchPanelNewTabPageWorks === true,
          rightPanelExpand: result.rightPanelExpandWorks === true,
          rightPanelResizeReset: result.rightPanelResizeResetWorks === true,
          rightPanelResizeKeyboard: result.rightPanelResizeKeyboardWorks === true,
          rightPanelCloseBelowMin: result.rightPanelCloseBelowMinWorks === true,
          rightPanelNarrowOverlay: result.rightPanelNarrowOverlayWorks === true,
          rightPanelContextMenuWorks: result.rightPanelContextMenuWorks === true,
          rightPanelContextMenuSharedSections: result.rightPanelContextMenuSharedSectionsWorks === true,
          rightPanelTabReorderWorks: result.rightPanelTabReorderWorks === true,
          rightPanelTabDragReorderWorks: result.rightPanelTabDragReorderWorks === true,
          rightPanelTabDragMarker: result.rightPanelTabDragMarkerWorks === true,
          rightPanelCloseActiveShortcut: result.rightPanelCloseActiveShortcutWorks === true,
          rightPanelInactiveClose: result.rightPanelInactiveCloseWorks === true,
          rightPanelMiddleClickClose: result.rightPanelMiddleClickCloseWorks === true,
          rightPanelCloseFallbackFromMain: result.rightPanelCloseFallbackFromMainWorks === true,
          rightPanelTabPanelA11y: result.rightPanelTabPanelA11yWorks === true,
          rightPanelTabWheelScroll: result.rightPanelTabWheelScrollWorks === true,
          rightPanelFullscreenCleanup: result.rightPanelFullscreenCleanupWorks === true,
          rightPanelTabTelemetry: result.rightPanelTabTelemetryWorks === true,
          rightPanelTabLifecycleTelemetry: result.rightPanelTabLifecycleTelemetryWorks === true,
          rightPanelPanelOpenCloseTelemetry: result.rightPanelPanelOpenCloseTelemetryWorks === true,
          rightPanelTabWeightCalm: result.rightPanelTabWeightCalmWorks === true,
          rightPanelTabActionsSharedVariant: result.rightPanelTabActionsSharedVariantWorks === true,
          workbenchPanelTabOverflowController: result.workbenchPanelTabOverflowControllerWorks === true,
          rightPanelMenuCommandState: result.rightPanelMenuCommandStateWorks === true,
          rightPanelFindShortcutRouting: result.rightPanelFindShortcutRoutingWorks === true,
          rightPanelBrowserCommandRouting: result.rightPanelBrowserCommandRoutingWorks === true,
          rightPanelBrowserVisualReset: result.rightPanelBrowserVisualResetWorks === true,
          rightPanelTransferUnsupportedBoundary: result.rightPanelTransferUnsupportedBoundaryWorks === true
        }
    : captureView === 'workbench-new-tab'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          rightPanelState: result.hasRightPanelState === true,
          rightPanelShellOwnership: result.rightPanelShellOwnershipWorks === true,
          workbenchPanelNewTabPage: result.workbenchPanelNewTabPageWorks === true,
          workbenchNewTabVisual: result.workbenchNewTabVisualWorks === true,
          workbenchNewTabSingleAddAffordance: result.workbenchNewTabSingleAddAffordance === true,
          workbenchNewTabCards: Number(result.workbenchNewTabActionCount ?? 0) >= 5,
          workbenchNewTabNoHorizontalOverflow: result.workbenchNewTabNoHorizontalOverflow === true
        }
    : captureView === 'environment'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          rightPanelState: result.hasRightPanelState === true,
          rightPanelShellOwnership: result.rightPanelShellOwnershipWorks === true,
          environmentPanelVisual: result.environmentPanelVisualWorks === true,
          environmentActionRows: result.environmentActionRowsWork === true,
          environmentSources: result.environmentSourcesWork === true
        }
    : captureView === 'workbench-perf'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          workbenchPerfSessionActive: result.workbenchPerfSessionActive === true,
          workbenchTabsReady: result.workbenchTabsReady === true,
          workbenchTabSwitchResponsive: result.maxTabSwitchMs !== null && result.maxTabSwitchMs <= 160,
          workbenchResizeResponsive: result.workbenchResizeWorks === true && result.resizeElapsedMs !== null && result.resizeElapsedMs <= 260,
          workbenchFrameGapAcceptable: result.maxFrameGapMs !== null && result.maxFrameGapMs <= 80,
          workbenchNoHorizontalOverflow: result.workbenchNoHorizontalOverflow === true,
          workbenchCommitCountsBounded: result.workbenchCommitCount !== null && result.workbenchCommitCount <= 50
        }
    : isDiffCaptureView
      ? buildDiffChecks(result, captureView)
    : captureView === 'files'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          filesHeaderPanelSeam: result.filesHeaderPanelSeamWorks === true,
          filesToolbarCompact: result.filesToolbarCompactWorks === true,
          filesActionMenuCompact: result.filesActionMenuCompactWorks === true,
          filesActionMenuMaterial: result.filesActionMenuMaterialWorks === true,
          filesActionMenuSharedSections: result.filesActionMenuSharedSectionsWorks === true,
          filesRowContextMenu: result.filesRowContextMenuWorks === true,
          filesRowContextMenuSharedSections: result.filesRowContextMenuSharedSectionsWorks === true,
          filesPreferredOpenTarget: result.filesPreferredOpenTargetWorks === true,
          workbenchFileTab: result.workbenchFileTabWorks === true,
          workbenchFileTabPin: result.workbenchFileTabPinWorks === true,
          workbenchFileTabActionMenuSharedSections: result.workbenchFileTabActionMenuSharedSectionsWorks === true,
          workbenchFileTabCodexActionLabels: result.workbenchFileTabCodexActionLabelsWorks === true,
          workbenchFileTabCodexActionCluster: result.workbenchFileTabCodexActionClusterWorks === true,
          fileOpenTargetDiagnostic: result.fileOpenTargetDiagnosticWorks === true,
          fileSourceLineSelection: result.fileSourceLineSelectionWorks === true,
          fileSourceLineUtilities: result.fileSourceLineUtilitiesWorks === true,
          fileSourceLineBlame: result.fileSourceLineBlameWorks === true,
          fileSourceBlameDetails: result.fileSourceBlameDetailsWorks === true,
          fileSourceGutterBlame: result.fileSourceGutterBlameWorks === true,
          fileSourceInlineGutterUtilities: result.fileSourceInlineGutterUtilitiesWorks === true,
          fileSourceAnnotations: result.fileSourceAnnotationsWorks === true,
          fileSourceWrapToggle: result.fileSourceWrapToggleWorks === true,
          fileSourceTabState: result.fileSourceTabStateWorks === true,
          fileSourceSearch: result.fileSourceSearchWorks === true,
          fileSourceVirtualization: result.fileSourceVirtualizationWorks === true,
          fileSourceRevealSelectedLine: result.fileSourceRevealSelectedLineWorks === true,
          fileSourceLoadingState: result.fileSourceLoadingStateWorks === true,
          fileSourceMode: result.fileSourceModeWorks === true,
          filesFileTabFirstLayout: result.filesFileTabFirstLayoutWorks === true,
          filesWorkbenchTree: result.filesWorkbenchTreeWorks === true,
          filesWorkbenchTreeNativeTitleFree: result.filesWorkbenchTreeNativeTitleFreeWorks === true,
          filesRevealSelectedPath: result.filesRevealSelectedPathWorks === true,
          filesSearchProjection: result.filesSearchProjectionWorks === true,
          filesLazyDirectories: result.filesLazyDirectoriesWorks === true,
          filesStickyFolders: result.filesStickyFoldersWorks === true,
          filesTabSearch: result.filesTabSearchWorks === true,
          filesContentSearch: result.filesContentSearchWorks === true,
          filesTabAttach: result.filesTabAttachWorks === true,
          filesHtmlPreview: result.filesHtmlPreviewWorks === true,
          filesPreviewHeaderShared: result.filesPreviewHeaderSharedWorks === true,
          filesArtifactPreviewControls: result.filesArtifactPreviewControlsWorks === true,
          filesArtifactOpenOptions: result.filesArtifactOpenOptionsWorks === true,
          filesArtifactHeaderTitleType: result.filesArtifactHeaderTitleTypeWorks === true,
          filesArtifactTabModel: result.filesArtifactTabModelWorks === true,
          filesJsonPreview: result.filesJsonPreviewWorks === true,
          filesCsvPreview: result.filesCsvPreviewWorks === true,
          filesPdfPreview: result.filesPdfPreviewWorks === true,
          filesPdfPreviewControls: result.filesPdfPreviewControlsWorks === true,
          filesPdfPresentationMode: result.filesPdfPresentationModeWorks === true,
          filesPdfAnnotations: result.filesPdfAnnotationsWorks === true,
          filesDocumentPreview: result.filesDocumentPreviewWorks === true,
          filesDocumentPageControls: result.filesDocumentPageControlsWorks === true,
          filesDocumentTableRendering: result.filesDocumentTableRenderingWorks === true,
          filesDocumentImageRendering: result.filesDocumentImageRenderingWorks === true,
          filesSpreadsheetPreview: result.filesSpreadsheetPreviewWorks === true,
          filesSlidesPreview: result.filesSlidesPreviewWorks === true,
          filesSpreadsheetRenderer: result.filesSpreadsheetRendererWorks === true,
          filesSlidesRenderer: result.filesSlidesRendererWorks === true,
          filesSlidesShapeLayout: result.filesSlidesShapeLayoutWorks === true,
          filesSlidesColorFills: result.filesSlidesColorFillsWorks === true,
          filesSlidesImageShapes: result.filesSlidesImageShapesWorks === true,
          filesSpreadsheetControls: result.filesSpreadsheetControlsWorks === true,
          filesSpreadsheetSheetTabs: result.filesSpreadsheetSheetTabsWorks === true,
          filesSpreadsheetActiveCell: result.filesSpreadsheetActiveCellWorks === true,
          filesSpreadsheetFormulaEvaluation: result.filesSpreadsheetFormulaEvaluationWorks === true,
          filesSpreadsheetCellStyles: result.filesSpreadsheetCellStylesWorks === true,
          filesSpreadsheetMergedCells: result.filesSpreadsheetMergedCellsWorks === true,
          filesSpreadsheetSizing: result.filesSpreadsheetSizingWorks === true,
          filesSpreadsheetFormulaEditing: result.filesSpreadsheetFormulaEditingWorks === true,
          filesSlidesControls: result.filesSlidesControlsWorks === true,
          filesSlidesSpeakerNotes: result.filesSlidesSpeakerNotesWorks === true,
          filesSlidesThumbnailRail: result.filesSlidesThumbnailRailWorks === true,
          filesOfficeZoomMenu: result.filesOfficeZoomMenuWorks === true,
          filesDocumentPdfZoomMenu: result.filesDocumentPdfZoomMenuWorks === true,
          filesSpreadsheetSlidesArtifactBoundary: result.filesSpreadsheetSlidesArtifactBoundaryWorks === true,
          filesNotebookPreview: result.filesNotebookPreviewWorks === true,
          filesNotebookReadOnlyControls: result.filesNotebookReadOnlyControlsWorks === true,
          filesNotebookOutputRendering: result.filesNotebookOutputRenderingWorks === true,
          filesNotebookCellDisclosure: result.filesNotebookCellDisclosureWorks === true,
          filesNotebookExecutionCount: result.filesNotebookExecutionCountWorks === true,
          filesNotebookCellMetadata: result.filesNotebookCellMetadataWorks === true,
          filesNotebookOutputSummaries: result.filesNotebookOutputSummariesWorks === true,
          filesNotebookRawOutputDisclosure: result.filesNotebookRawOutputDisclosureWorks === true,
          filesNotebookCodeSnippet: result.filesNotebookCodeSnippetWorks === true,
          filesNotebookCellSpacing: result.filesNotebookCellSpacingWorks === true,
          filesNotebookOutputChrome: result.filesNotebookOutputChromeWorks === true,
          filesNotebookOutputItemChrome: result.filesNotebookOutputItemChromeWorks === true,
          filesNotebookRichOutputItemChrome: result.filesNotebookRichOutputItemChromeWorks === true,
          filesBinaryPreview: result.filesBinaryPreviewWorks === true,
          filesFallbackNoticeShared: result.filesFallbackNoticeSharedWorks === true,
          filesNoResults: result.filesNoResultsWorks === true,
          filesSearchClear: result.filesSearchClearWorks === true
        }
    : captureView === 'side-chat'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          sideChatTabs: result.sideChatTabsWork === true,
          sideChatComposerCompact: result.sideChatComposerCompactWorks === true,
          sideChatDraftPersistence: result.sideChatDraftPersistenceWorks === true,
          sideChatMessageLabelsCalm: result.sideChatMessageLabelsCalm === true,
          sideChatClose: result.sideChatCloseWorks === true
        }
    : captureView === 'terminal-visual'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          terminalVisualPanel: result.terminalVisualPanelWorks === true,
          terminalPanelMaterialSolid: result.terminalVisualPanelMaterialSolidWorks === true,
          terminalBottomPanelSizeDecomposition: result.terminalBottomPanelSizeDecompositionWorks === true,
          terminalVisualTabs: result.terminalVisualTabsWork === true,
          terminalVisualToolbar: result.terminalVisualToolbarWorks === true,
          terminalVisualHealthyContent: result.terminalVisualHealthyContentWorks === true
        }
    : captureView === 'terminal'
      ? {
          isolatedProfile: result.profile?.isIsolated === true,
          terminalTabsPersist: result.terminalTabsPersistState === true,
          terminalShellOwnership: result.terminalShellOwnershipWorks === true,
          terminalPanelMaterialSolid: result.terminalPanelMaterialSolidWorks === true,
          terminalSharedAnimationController: result.terminalSharedAnimationControllerWorks === true,
          terminalSharedLayoutController: result.terminalSharedLayoutControllerWorks === true,
          terminalBottomPanelSizeDecomposition: result.terminalBottomPanelSizeDecompositionWorks === true,
          terminalRestore: result.terminalRestoreWorks === true,
          terminalTabMenu: result.terminalTabMenuWorks === true,
          terminalTabMenuSharedSections: result.terminalTabMenuSharedSectionsWorks === true,
          terminalTabReorder: result.terminalTabReorderWorks === true,
          terminalTabDragReorder: result.terminalTabDragReorderWorks === true,
          terminalTabDragMarker: result.terminalTabDragMarkerWorks === true,
          terminalToolbarShared: result.terminalToolbarSharedWorks === true,
          terminalHeaderSharedChrome: result.terminalHeaderSharedChromeWorks === true,
          terminalContentSpacing: result.terminalContentSpacingWorks === true,
          terminalResizeReset: result.terminalResizeResetWorks === true,
          terminalResizeHandleOverlay: result.terminalResizeHandleOverlayWorks === true,
          terminalResizeKeyboard: result.terminalResizeKeyboardWorks === true,
          terminalCloseActiveShortcut: result.terminalCloseActiveShortcutWorks === true,
          terminalNewTabShortcut: result.terminalNewTabShortcutWorks === true,
          terminalTabPanelA11y: result.terminalTabPanelA11yWorks === true,
          terminalFullscreenCleanup: result.terminalFullscreenCleanupWorks === true,
          terminalTabTelemetry: result.terminalTabTelemetryWorks === true,
          terminalTabLifecycleTelemetry: result.terminalTabLifecycleTelemetryWorks === true,
          terminalMoveToRightPanel: result.terminalMoveToRightPanelWorks === true,
          terminalSharedTransferModel: result.terminalSharedTransferModelWorks === true,
          terminalServiceSnapshot: result.terminalServiceSnapshotWorks === true,
          terminalRightPanelNewTabShortcut: result.terminalRightPanelNewTabShortcutWorks === true,
          terminalMoveBackToBottom: result.terminalMoveBackToBottomWorks === true,
          terminalLinkRouting: result.terminalLinkRoutingWorks === true,
          terminalThemeFontSync: result.terminalThemeFontSyncWorks === true,
          terminalThemeTokenMatrix: result.terminalThemeTokenMatrixWorks === true
        }
    : {
        isolatedProfile: result.profile?.isIsolated === true,
        profileBadgeCompact: ['settings', 'settings-providers', 'settings-deeplink', 'resources', 'capabilities', 'pets'].includes(captureView) || result.profileBadgeCompactWorks === true,
        composer: captureView === 'settings-deeplink' || result.hasComposer === true,
        sidebarNavigation: ['settings', 'settings-providers', 'settings-deeplink', 'capabilities', 'pets'].includes(captureView) || result.hasSidebarNavigation === true,
        headerIdentity: ['settings', 'settings-providers', 'settings-deeplink', 'resources', 'capabilities', 'pets'].includes(captureView) || result.headerIdentityWorks === true,
        headerNativeTooltips: ['settings', 'settings-providers', 'settings-deeplink', 'resources', 'capabilities', 'pets'].includes(captureView) || result.headerNativeTooltipsWork === true,
        headerLongTooltipBounded: ['settings', 'settings-providers', 'settings-deeplink', 'resources', 'capabilities', 'pets'].includes(captureView) || ['inspector', 'terminal'].includes(captureView) || result.headerLongTooltipBoundedWorks === true,
        titlebarSidebarToggle: captureView !== 'inspector' || result.titlebarSidebarToggleWorks === true,
        customTooltipNativeTitlesAbsent: result.customTooltipNativeTitlesAbsent === true,
        nativeTitleFreeControls: result.nativeTitleFreeControlsWork === true,
        composerNativeTooltips: ['settings', 'settings-providers', 'settings-deeplink', 'resources', 'capabilities', 'pets'].includes(captureView) || result.composerNativeTooltipsWork === true,
        headerActionMenu: captureView !== 'inspector' || result.headerActionMenuWorks === true,
        chatEmptyState: captureView !== 'inspector' || result.chatEmptyStateWorks === true,
        chatEmptyStateQuiet: captureView !== 'inspector' || result.chatEmptyStateWorks === true,
        chatEmptyStateProjectLabelClean: captureView !== 'inspector' || result.chatEmptyStateProjectLabelClean === true,
        inspectorTabs: captureView !== 'inspector' || result.hasInspectorTabs === true,
        rightPanelState: captureView !== 'inspector' || result.hasRightPanelState === true,
        rightPanelShellOwnership: captureView !== 'inspector' || result.rightPanelShellOwnershipWorks === true,
        workbenchPanelChromeCompact: captureView !== 'inspector' || result.workbenchPanelChromeCompactWorks === true,
        workbenchPanelTrailingFade: captureView !== 'inspector' || result.workbenchPanelTrailingFadeWorks === true,
        workbenchPanelTabCloseStartEdge: captureView !== 'inspector' || result.workbenchPanelTabCloseStartEdgeWorks === true,
        workbenchPanelInactiveTabsCompact: captureView !== 'inspector' || result.workbenchPanelInactiveTabsCompactWorks === true,
        workbenchPanelInactiveTabTooltip: captureView !== 'inspector' || result.workbenchPanelInactiveTabTooltipWorks === true,
        workbenchPanelAddControlStable: captureView !== 'inspector' || result.workbenchPanelAddControlStableWorks === true,
        workbenchPanelNewTabPage: captureView !== 'inspector' || result.workbenchPanelNewTabPageWorks === true,
        diffToolbarCompact: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        reviewToolbarHeaderRow: captureView !== 'inspector' || result.reviewToolbarHeaderRowWorks === true,
        reviewToolbarPrimaryOrder: captureView !== 'inspector' || result.reviewToolbarPrimaryOrderWorks === true,
        reviewSourceSummaryHeader: captureView !== 'inspector' || result.reviewSourceSummaryHeaderWorks === true,
        reviewTranscriptCard: captureView !== 'inspector' || result.reviewTranscriptCardWorks === true,
        reviewEnvironmentPanel: captureView !== 'inspector' || result.reviewEnvironmentPanelWorks === true,
        diffListCompact: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        reviewFileSections: captureView !== 'inspector' || result.reviewFileSectionStructureWorks === true,
        reviewFileHeaderMetrics: captureView !== 'inspector' || result.reviewFileHeaderMetricsWork === true,
        reviewDiffRowMetrics: captureView !== 'inspector' || result.reviewDiffRowMetricsWork === true,
        reviewHunkSeparatorStructure: captureView !== 'inspector' || result.reviewHunkSeparatorStructureWorks === true,
        reviewDiffIndicatorStructure: captureView !== 'inspector' || result.reviewDiffIndicatorStructureWork === true,
        reviewDiffNativeColorCalm: captureView !== 'inspector' || result.reviewDiffNativeColorCalmWorks === true,
        reviewDiffLineNumberContent: captureView !== 'inspector' || result.reviewDiffLineNumberContentWorks === true,
        reviewDiffGutterUtility: captureView !== 'inspector' || result.reviewDiffGutterUtilityWorks === true,
        reviewFileTreeGitLane: captureView !== 'inspector' || result.reviewFileTreeGitLaneWorks === true,
        reviewVisualCheckpointReset: captureView !== 'inspector' || result.reviewVisualCheckpointResetWorks === true,
        reviewTabPanelFocusRingCalm: captureView !== 'inspector' || result.reviewTabPanelFocusRingCalmWorks === true,
        diffWorkbenchTree: captureView !== 'inspector' || result.diffWorkbenchTreeWorks === true,
        diffRevealSelectedPath: captureView !== 'inspector' || result.diffRevealSelectedPathWorks === true,
        diffActionMenuCompact: captureView !== 'inspector' || result.diffActionMenuCompactWorks === true,
        diffActionMenuMaterial: captureView !== 'inspector' || result.diffActionMenuMaterialWorks === true,
        rightPanelExpand: captureView !== 'inspector' || result.rightPanelExpandWorks === true,
        rightPanelCloseBelowMin: captureView !== 'inspector' || result.rightPanelCloseBelowMinWorks === true,
        rightPanelNarrowOverlay: captureView !== 'inspector' || result.rightPanelNarrowOverlayWorks === true,
        reviewSearch: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        reviewSearchProjection: captureView !== 'inspector' || result.reviewSearchProjectionWorks === true,
        reviewFullSourceRows: captureView !== 'inspector' || result.reviewFullSourceRowsWork === true,
        reviewSearchClear: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        reviewLineComments: captureView !== 'inspector' || result.reviewLineCommentsWork === true,
        reviewAnnotatedSelectionCalm: captureView !== 'inspector' || result.reviewAnnotatedSelectionCalmWork === true,
        reviewSidePaneCommentCount: captureView !== 'inspector' || result.reviewSidePaneCommentCountWork === true,
        reviewLineBlame: captureView !== 'inspector' || result.reviewLineBlameWork === true,
        reviewGutterBlameSummary: captureView !== 'inspector' || result.reviewGutterBlameSummaryWork === true,
        reviewGutterActionPopover: captureView !== 'inspector' || result.reviewGutterActionPopoverWork === true,
        reviewMenuMessage: captureView !== 'inspector' || result.reviewMenuMessageWorks === true,
        reviewFileJump: captureView !== 'inspector' || result.reviewFileJumpWorks === true,
        reviewSidePaneChrome: captureView !== 'inspector' || result.reviewSidePaneChromeWorks === true,
        reviewSidePaneResize: captureView !== 'inspector' || result.reviewSidePaneResizeWorks === true,
        reviewLineOpensFileSourceTab: captureView !== 'inspector' || result.reviewLineOpensFileSourceTabWork === true,
        reviewHiddenContextSeparatorStructure: captureView !== 'inspector' || result.reviewHiddenContextSeparatorStructureWork === true,
        reviewHiddenContextExpansion: captureView !== 'inspector' || result.reviewHiddenContextExpansionWork === true,
        reviewHiddenContextExpandAll: captureView !== 'inspector' || result.reviewHiddenContextExpandAllWork === true,
        reviewLargeDiffWindow: captureView !== 'inspector' || result.reviewLargeDiffWindowWorks === true,
        reviewJsonPreview: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        reviewCsvPreview: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        reviewDocumentPreview: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        reviewNotebookPreview: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        reviewBinaryState: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        reviewBinaryActions: captureView !== 'inspector' || result.diffToolbarCompactWorks === true,
        filesTabSearch: captureView !== 'inspector' || result.filesTabSearchWorks === true,
        filesToolbarCompact: captureView !== 'inspector' || result.filesToolbarCompactWorks === true,
        filesActionMenuCompact: captureView !== 'inspector' || result.filesActionMenuCompactWorks === true,
        workbenchFileTab: captureView !== 'inspector' || result.workbenchFileTabWorks === true,
        workbenchFileTabPin: captureView !== 'inspector' || result.workbenchFileTabPinWorks === true,
        workbenchFileTabCodexActionLabels: captureView !== 'inspector' || result.workbenchFileTabCodexActionLabelsWorks === true,
        workbenchFileTabCodexActionCluster: captureView !== 'inspector' || result.workbenchFileTabCodexActionClusterWorks === true,
        fileOpenTargetDiagnostic: captureView !== 'inspector' || result.fileOpenTargetDiagnosticWorks === true,
        fileSourceTabState: captureView !== 'inspector' || result.fileSourceTabStateWorks === true,
        fileSourceBlameDetails: captureView !== 'inspector' || result.fileSourceBlameDetailsWorks === true,
        fileSourceGutterBlame: captureView !== 'inspector' || result.fileSourceGutterBlameWorks === true,
        fileSourceInlineGutterUtilities: captureView !== 'inspector' || result.fileSourceInlineGutterUtilitiesWorks === true,
        fileSourceAnnotations: captureView !== 'inspector' || result.fileSourceAnnotationsWorks === true,
        fileSourceSearch: captureView !== 'inspector' || result.fileSourceSearchWorks === true,
        fileSourceVirtualization: captureView !== 'inspector' || result.fileSourceVirtualizationWorks === true,
        fileSourceRevealSelectedLine: captureView !== 'inspector' || result.fileSourceRevealSelectedLineWorks === true,
        fileSourceLoadingState: captureView !== 'inspector' || result.fileSourceLoadingStateWorks === true,
        filesFileTabFirstLayout: captureView !== 'inspector' || result.filesFileTabFirstLayoutWorks === true,
        filesWorkbenchTree: captureView !== 'inspector' || result.filesWorkbenchTreeWorks === true,
        filesRevealSelectedPath: captureView !== 'inspector' || result.filesRevealSelectedPathWorks === true,
        filesSearchProjection: captureView !== 'inspector' || result.filesSearchProjectionWorks === true,
        filesLazyDirectories: captureView !== 'inspector' || result.filesLazyDirectoriesWorks === true,
        filesStickyFolders: captureView !== 'inspector' || result.filesStickyFoldersWorks === true,
        filesTabAttach: captureView !== 'inspector' || result.filesTabAttachWorks === true,
        filesHtmlPreview: captureView !== 'inspector' || result.filesHtmlPreviewWorks === true,
        filesPreviewHeaderShared: captureView !== 'inspector' || result.filesPreviewHeaderSharedWorks === true,
        filesArtifactPreviewControls: captureView !== 'inspector' || result.filesArtifactPreviewControlsWorks === true,
        filesArtifactHeaderTitleType: captureView !== 'inspector' || result.filesArtifactHeaderTitleTypeWorks === true,
        filesArtifactTabModel: captureView !== 'inspector' || result.filesArtifactTabModelWorks === true,
        filesJsonPreview: captureView !== 'inspector' || result.filesJsonPreviewWorks === true,
        filesCsvPreview: captureView !== 'inspector' || result.filesCsvPreviewWorks === true,
        filesPdfPreview: captureView !== 'inspector' || result.filesPdfPreviewWorks === true,
        filesPdfPreviewControls: captureView !== 'inspector' || result.filesPdfPreviewControlsWorks === true,
        filesPdfPresentationMode: captureView !== 'inspector' || result.filesPdfPresentationModeWorks === true,
        filesPdfAnnotations: captureView !== 'inspector' || result.filesPdfAnnotationsWorks === true,
        filesDocumentPreview: captureView !== 'inspector' || result.filesDocumentPreviewWorks === true,
        filesDocumentPageControls: captureView !== 'inspector' || result.filesDocumentPageControlsWorks === true,
        filesDocumentTableRendering: captureView !== 'inspector' || result.filesDocumentTableRenderingWorks === true,
        filesDocumentImageRendering: captureView !== 'inspector' || result.filesDocumentImageRenderingWorks === true,
        filesSpreadsheetPreview: captureView !== 'inspector' || result.filesSpreadsheetPreviewWorks === true,
        filesSlidesPreview: captureView !== 'inspector' || result.filesSlidesPreviewWorks === true,
        filesSpreadsheetRenderer: captureView !== 'inspector' || result.filesSpreadsheetRendererWorks === true,
        filesSlidesRenderer: captureView !== 'inspector' || result.filesSlidesRendererWorks === true,
        filesSlidesShapeLayout: captureView !== 'inspector' || result.filesSlidesShapeLayoutWorks === true,
        filesSlidesColorFills: captureView !== 'inspector' || result.filesSlidesColorFillsWorks === true,
        filesSlidesImageShapes: captureView !== 'inspector' || result.filesSlidesImageShapesWorks === true,
        filesSpreadsheetControls: captureView !== 'inspector' || result.filesSpreadsheetControlsWorks === true,
        filesSpreadsheetSheetTabs: captureView !== 'inspector' || result.filesSpreadsheetSheetTabsWorks === true,
        filesSpreadsheetActiveCell: captureView !== 'inspector' || result.filesSpreadsheetActiveCellWorks === true,
        filesSpreadsheetFormulaEvaluation: captureView !== 'inspector' || result.filesSpreadsheetFormulaEvaluationWorks === true,
        filesSpreadsheetCellStyles: captureView !== 'inspector' || result.filesSpreadsheetCellStylesWorks === true,
        filesSpreadsheetMergedCells: captureView !== 'inspector' || result.filesSpreadsheetMergedCellsWorks === true,
        filesSpreadsheetSizing: captureView !== 'inspector' || result.filesSpreadsheetSizingWorks === true,
        filesSpreadsheetFormulaEditing: captureView !== 'inspector' || result.filesSpreadsheetFormulaEditingWorks === true,
        filesSlidesControls: captureView !== 'inspector' || result.filesSlidesControlsWorks === true,
        filesSlidesSpeakerNotes: captureView !== 'inspector' || result.filesSlidesSpeakerNotesWorks === true,
        filesSlidesThumbnailRail: captureView !== 'inspector' || result.filesSlidesThumbnailRailWorks === true,
        filesOfficeZoomMenu: captureView !== 'inspector' || result.filesOfficeZoomMenuWorks === true,
        filesDocumentPdfZoomMenu: captureView !== 'inspector' || result.filesDocumentPdfZoomMenuWorks === true,
        filesSpreadsheetSlidesArtifactBoundary: captureView !== 'inspector' || result.filesSpreadsheetSlidesArtifactBoundaryWorks === true,
        filesArtifactOpenOptions: captureView !== 'inspector' || result.filesArtifactOpenOptionsWorks === true,
        filesNotebookPreview: captureView !== 'inspector' || result.filesNotebookPreviewWorks === true,
        filesNotebookRichOutputItemChrome: captureView !== 'inspector' || result.filesNotebookRichOutputItemChromeWorks === true,
        filesBinaryPreview: captureView !== 'inspector' || result.filesBinaryPreviewWorks === true,
        filesNoResults: captureView !== 'inspector' || result.filesNoResultsWorks === true,
        filesSearchClear: captureView !== 'inspector' || result.filesSearchClearWorks === true,
        browserTab: captureView !== 'inspector' || result.browserTabWorks === true,
        browserScreenshot: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserScreenshotWorks === true,
        browserScreenshotAttachment: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserScreenshotAttachmentWorks === true,
        browserFind: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserFindWorks === true,
        browserFindNavigation: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserFindNavigationWorks === true,
        browserZoom: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserZoomWorks === true,
        browserDeviceMode: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserDeviceModeWorks === true,
        browserCacheReload: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserCacheReloadWorks === true,
        browserMultiTab: captureView !== 'inspector' || result.browserMultiTabWorks === true,
        browserTabShellController: captureView !== 'inspector' || result.browserTabShellControllerWorks === true,
        browserTabCloseChrome: captureView !== 'inspector' || result.browserTabCloseChromeWorks === true,
        browserTabChromeCalm: captureView !== 'inspector' || result.browserTabChromeCalmWorks === true,
        browserActionsNativeTitlesAbsent: captureView !== 'inspector' || result.browserActionsNativeTitlesAbsent === true,
        browserInspection: captureView !== 'inspector' || result.browserInspectionWorks === true,
        browserDomPaneCompact: captureView !== 'inspector' || result.browserDomPaneCompactWorks === true,
        browserTargetsPane: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetsPaneWorks === true,
        browserTargetKey: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetKeyWorks === true,
        browserTargetFill: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetFillWorks === true,
        browserTargetType: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetTypeWorks === true,
        browserTargetState: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetStateWorks === true,
        browserTargetSelect: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetSelectWorks === true,
        browserTargetCheck: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetCheckWorks === true,
        browserTargetsPaneNoHorizontalOverflow: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTargetsPaneNoHorizontalOverflowWorks === true,
        browserAssetBundle: captureView !== 'inspector' || result.browserAssetBundleWorks === true,
        browserInlineSvgInventory: captureView !== 'inspector' || result.browserInlineSvgInventoryWorks === true,
        browserSecurityPane: captureView !== 'inspector' || result.browserSecurityPaneWorks === true,
        browserPersistedPolicyDefaults: captureView !== 'inspector' || result.browserPersistedPolicyDefaultsWorks === true,
        browserClientToolActions: captureView !== 'inspector' || result.browserClientToolActionsWork === true,
        browserClientToolScreenshot: captureView !== 'inspector' || result.browserClientToolScreenshotWorks === true,
        browserClientToolScreenshotImage: captureView !== 'inspector' || result.browserClientToolScreenshotImageWorks === true,
        browserClientToolAdvancedActions: captureView !== 'inspector' || result.browserClientToolAdvancedActionsWork === true,
        browserSecurityPaneNoHorizontalOverflow: captureView !== 'inspector' || result.browserSecurityPaneNoHorizontalOverflowWorks === true,
        browserInspectorChromeCompact: captureView !== 'inspector' || result.browserInspectorChromeCompactWorks === true,
        browserInspectorContainersShared: captureView !== 'inspector' || result.browserInspectorContainersSharedWorks === true,
        browserInspectorActionsShared: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserInspectorActionsSharedWorks === true,
        browserVisibilityControl: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserVisibilityControlWorks === true,
        browserHiddenState: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserHiddenStateWorks === true,
        browserTabReset: captureView !== 'inspector' || browserDeepChecksCoveredByBrowserSmoke || result.browserTabResetWorks === true,
        rightPanelContextMenuWorks: captureView !== 'inspector' || result.rightPanelContextMenuWorks === true,
        rightPanelContextMenuSharedSections: captureView !== 'inspector' || result.rightPanelContextMenuSharedSectionsWorks === true,
        rightPanelTabReorderWorks: captureView !== 'inspector' || result.rightPanelTabReorderWorks === true,
        planPanel: captureView !== 'plan' || result.planPanelWorks === true,
        planCompactRows: captureView !== 'plan' || result.compactTaskRowsWork === true,
        planAgentTabShimmer: captureView !== 'plan' || result.planAgentTabShimmerWorks === true,
        planAgentStatLabelsCalm: captureView !== 'plan' || result.planAgentStatLabelsCalm === true,
        sideChatTabs: captureView !== 'inspector' || result.sideChatTabsWork === true,
        sideChatComposerCompact: captureView !== 'inspector' || result.sideChatComposerCompactWorks === true,
        sideChatDraftPersistence: captureView !== 'inspector' || result.sideChatDraftPersistenceWorks === true,
        sideChatMessageLabelsCalm: captureView !== 'inspector' || result.sideChatMessageLabelsCalm === true,
        sideChatClose: captureView !== 'inspector' || result.sideChatCloseWorks === true,
        terminalTabsPersist: captureView !== 'terminal' || result.terminalTabsPersistState === true,
        terminalShellOwnership: captureView !== 'terminal' || result.terminalShellOwnershipWorks === true,
        terminalPanelMaterialSolid: captureView !== 'terminal' || result.terminalPanelMaterialSolidWorks === true,
        terminalSharedLayoutController: captureView !== 'terminal' || result.terminalSharedLayoutControllerWorks === true,
        terminalBottomPanelSizeDecomposition: captureView !== 'terminal' || result.terminalBottomPanelSizeDecompositionWorks === true,
        terminalRestore: captureView !== 'terminal' || result.terminalRestoreWorks === true,
        terminalTabMenu: captureView !== 'terminal' || result.terminalTabMenuWorks === true,
        terminalTabMenuSharedSections: captureView !== 'terminal' || result.terminalTabMenuSharedSectionsWorks === true,
        terminalTabReorder: captureView !== 'terminal' || result.terminalTabReorderWorks === true,
        terminalTabDragReorder: captureView !== 'terminal' || result.terminalTabDragReorderWorks === true,
        terminalTabDragMarker: captureView !== 'terminal' || result.terminalTabDragMarkerWorks === true,
        terminalToolbarShared: captureView !== 'terminal' || result.terminalToolbarSharedWorks === true,
        terminalHeaderSharedChrome: captureView !== 'terminal' || result.terminalHeaderSharedChromeWorks === true,
        terminalContentSpacing: captureView !== 'terminal' || result.terminalContentSpacingWorks === true,
        terminalResizeReset: captureView !== 'terminal' || result.terminalResizeResetWorks === true,
        terminalResizeHandleOverlay: captureView !== 'terminal' || result.terminalResizeHandleOverlayWorks === true,
        terminalCloseActiveShortcut: captureView !== 'terminal' || result.terminalCloseActiveShortcutWorks === true,
        terminalNewTabShortcut: captureView !== 'terminal' || result.terminalNewTabShortcutWorks === true,
        terminalTabPanelA11y: captureView !== 'terminal' || result.terminalTabPanelA11yWorks === true,
        terminalFullscreenCleanup: captureView !== 'terminal' || result.terminalFullscreenCleanupWorks === true,
        terminalTabTelemetry: captureView !== 'terminal' || result.terminalTabTelemetryWorks === true,
        terminalTabLifecycleTelemetry: captureView !== 'terminal' || result.terminalTabLifecycleTelemetryWorks === true,
        terminalMoveToRightPanel: captureView !== 'terminal' || result.terminalMoveToRightPanelWorks === true,
        terminalSharedTransferModel: captureView !== 'terminal' || result.terminalSharedTransferModelWorks === true,
        terminalServiceSnapshot: captureView !== 'terminal' || result.terminalServiceSnapshotWorks === true,
        terminalRightPanelNewTabShortcut: captureView !== 'terminal' || result.terminalRightPanelNewTabShortcutWorks === true,
        terminalMoveBackToBottom: captureView !== 'terminal' || result.terminalMoveBackToBottomWorks === true,
        terminalLinkRouting: captureView !== 'terminal' || result.terminalLinkRoutingWorks === true,
        terminalThemeFontSync: captureView !== 'terminal' || result.terminalThemeFontSyncWorks === true,
        terminalThemeTokenMatrix: captureView !== 'terminal' || result.terminalThemeTokenMatrixWorks === true,
        themeImport: captureView !== 'settings' || result.themeImportWorks === true,
        themeSharingControls: captureView !== 'settings' || result.themeSharingControls === true,
        themePresetPreview: captureView !== 'settings' || result.themePresetPreviewWorks === true,
        settingsTaxonomy: captureView !== 'settings' || result.settingsTaxonomyWorks === true,
        settingsRowsCalm: captureView !== 'settings' || result.settingsRowsCalmWorks === true,
        settingsAppearanceSurface: captureView !== 'settings' || result.settingsAppearanceSurfaceWorks === true,
        settingsAppearanceModule: captureView !== 'settings' || result.settingsAppearanceModuleWorks === true,
        settingsGeneralSurface: captureView !== 'settings' || result.settingsGeneralSurfaceWorks === true,
        settingsGeneralModule: captureView !== 'settings' || result.settingsGeneralModuleWorks === true,
        settingsTopbarShared: captureView !== 'settings' || result.settingsTopbarSharedWorks === true,
        settingsContentLayout: captureView !== 'settings' || result.settingsContentLayoutWorks === true,
        settingsRouteOwned: !['settings', 'settings-providers'].includes(captureView) || result.settingsRouteOwnedWorks === true,
        settingsDeepLinkRoute: captureView !== 'settings-deeplink' || result.settingsDeepLinkRouteWorks === true,
        settingsHostContext: captureView !== 'settings' || result.settingsHostContextWorks === true,
        settingsHostSectionFiltering: captureView !== 'settings' || result.settingsHostSectionFilteringWorks === true,
        settingsHostAdapterBoundary: captureView !== 'settings' || result.settingsHostAdapterBoundaryWorks === true,
        settingsPersonalizationHostBoundary: captureView !== 'settings' || result.settingsPersonalizationHostBoundaryWorks === true,
        settingsSidebarNavCompact: captureView !== 'settings' || result.settingsSidebarNavCompactWorks === true,
        settingsSidebarNavPrimitive: captureView !== 'settings' || result.settingsSidebarNavPrimitiveWorks === true,
        settingsSidebarGroupedNav: captureView !== 'settings' || result.settingsSidebarGroupedNavWorks === true,
        settingsProviderDropdown: captureView !== 'settings-providers' || result.settingsProviderDropdownWorks === true,
        settingsDiagnosticsSection: captureView !== 'settings-providers' || result.settingsDiagnosticsSectionWorks === true,
        settingsProviderStatusUnified: captureView !== 'settings-providers' || result.settingsProviderStatusUnifiedWorks === true,
        settingsUsageDiagnostics: captureView !== 'settings-providers' || result.settingsUsageDiagnosticsWorks === true,
        settingsProviderModelsCollapsed: captureView !== 'settings-providers' || result.settingsProviderModelsCollapsedWorks === true,
        settingsProviderControlSurfaceUnified: captureView !== 'settings-providers' || result.settingsProviderControlSurfaceUnifiedWorks === true,
        settingsProvidersModule: captureView !== 'settings-providers' || result.settingsProvidersModuleWorks === true,
        settingsProviderCatalogLabelCalm: captureView !== 'settings-providers' || result.settingsProviderCatalogLabelCalm === true,
        settingsDiagnosticsDisclosureCompact: captureView !== 'settings-providers' || result.settingsDiagnosticsDisclosureCompactWorks === true,
        settingsProviderSidebarRefresh: captureView !== 'settings-providers' || result.settingsProviderSidebarRefreshWorks === true,
        settingsDataControls: captureView !== 'settings' || result.settingsDataControlsWorks === true,
        settingsDataControlsSurface: captureView !== 'settings' || result.settingsDataControlsSurfaceWorks === true,
        settingsDataControlsModule: captureView !== 'settings' || result.settingsDataControlsModuleWorks === true,
        settingsBrowserPage: captureView !== 'settings' || result.settingsBrowserPageWorks === true,
        settingsBrowserSurface: captureView !== 'settings' || result.settingsBrowserSurfaceWorks === true,
        settingsBrowserModule: captureView !== 'settings' || result.settingsBrowserModuleWorks === true,
        settingsBrowserPolicyPersistence: captureView !== 'settings' || result.settingsBrowserPolicyPersistenceWorks === true,
        settingsAutomationsPage: captureView !== 'settings' || result.settingsAutomationsPageWorks === true,
        settingsWorktreesPage: captureView !== 'settings' || result.settingsWorktreesPageWorks === true,
        settingsWorktreesCreate: captureView !== 'settings' || result.settingsWorktreesCreateWorks === true,
        settingsWorktreesDelete: captureView !== 'settings' || result.settingsWorktreesDeleteWorks === true,
        settingsWorktreesOpen: captureView !== 'settings' || result.settingsWorktreesOpenWorks === true,
        settingsShortcutsSurface: captureView !== 'settings' || result.settingsShortcutsSurfaceWorks === true,
        settingsShortcutsCompact: captureView !== 'settings' || result.settingsShortcutsCompactWorks === true,
        settingsShortcutsEditable: captureView !== 'settings' || result.settingsShortcutsEditableWorks === true,
        settingsShortcutsConflict: captureView !== 'settings' || result.settingsShortcutsConflictWorks === true,
        settingsShortcutsPunctuationCapture: captureView !== 'settings' || result.settingsShortcutsPunctuationCaptureWorks === true,
        settingsShortcutActionsShared: captureView !== 'settings' || result.settingsShortcutActionsSharedWorks === true,
        settingsShortcutCaptureFieldShared: captureView !== 'settings' || result.settingsShortcutCaptureFieldSharedWorks === true,
        settingsShortcutsPerBindingClear: captureView !== 'settings' || result.settingsShortcutsPerBindingClearWorks === true,
        settingsShortcutsModule: captureView !== 'settings' || result.settingsShortcutsModuleWorks === true,
        petsSettingsSurface: captureView !== 'pets' || result.petsSettingsSurfaceWorks === true,
        petsSettingsContentLayout: captureView !== 'pets' || result.petsSettingsContentLayoutWorks === true,
        petsSettingsModule: captureView !== 'pets' || result.petsSettingsModuleWorks === true,
        extensionsPanel: captureView !== 'extensions' || result.hasExtensionsPanel === true,
        extensionsPanelTabs: captureView !== 'extensions' || result.hasExtensionsPanelTabs === true,
        extensionsEmbeddedCopyCompact: captureView !== 'extensions' || result.extensionsEmbeddedCopyCompact === true,
        extensionsPanelCalm: captureView !== 'extensions' || result.extensionsPanelCalmWorks === true,
        sideQuestionCommand: ['terminal', 'settings', 'settings-providers', 'settings-deeplink', 'resources', 'capabilities', 'pets', 'inspector', 'composer', 'extensions', 'plan'].includes(captureView) || result.hasSideQuestionCommandText === true,
        capabilityCreateMenu: captureView !== 'capabilities' || result.capabilityMenuOpened === true,
        capabilityMenuArrowFocus: captureView !== 'capabilities' || result.capabilityMenuArrowFocus === true,
        capabilityMenuEscape: captureView !== 'capabilities' || result.capabilityMenuClosedWithEscape === true,
        capabilityMenuFocusReturned: captureView !== 'capabilities' || result.capabilityMenuFocusReturned === true,
        capabilityCreateMenuChromeCalm: captureView !== 'capabilities' || result.capabilityCreateMenuChromeCalm === true,
        capabilityRowMenuChromeCalm: captureView !== 'capabilities' || result.capabilityRowMenuChromeCalm === true,
        capabilityPageLabelsCalm: captureView !== 'capabilities' || result.capabilityPageLabelsCalm === true,
        capabilityCreateSheet: captureView !== 'capabilities' || result.capabilitySheetOpened === true,
        capabilitySheetFocus: captureView !== 'capabilities' || result.capabilitySheetFocused === true,
        capabilitySheetFocusTrap: captureView !== 'capabilities' || result.capabilitySheetFocusStayedInside === true,
        capabilitySheetEscape: captureView !== 'capabilities' || result.capabilitySheetClosedWithEscape === true,
        capabilityEditSheet: captureView !== 'capabilities' || result.capabilityEditSheetOpened === true,
        capabilitySyncSheet: captureView !== 'capabilities' || result.capabilitySyncSheetOpened === true,
        composerPermissionMenu: captureView !== 'composer' || result.composerPermissionMenuOpened === true,
        composerDropdownMaterial: captureView !== 'composer' || result.composerDropdownMaterialWorks === true,
        composerPermissionNativeTooltips: captureView !== 'composer' || result.composerPermissionNativeTooltipsWork === true,
        composerPermissionLabelsCalm: captureView !== 'composer' || result.composerPermissionLabelsCalm === true,
        composerPermissionEscape: captureView !== 'composer' || result.composerPermissionMenuClosedWithEscape === true,
        composerPermissionFocusReturned: captureView !== 'composer' || result.composerPermissionFocusReturned === true,
        composerAgentMenu: captureView !== 'composer' || result.composerAgentMenuOpened === true,
        composerAgentRowLabelsCalm: captureView !== 'composer' || result.composerAgentRowLabelsCalm === true,
        composerAgentOutsideClick: captureView !== 'composer' || result.composerAgentMenuClosedWithOutsideClick === true,
        composerAgentFocusReturned: captureView !== 'composer' || result.composerAgentFocusReturned === true,
        composerDraftsPerChat: captureView !== 'composer' || result.composerDraftsPerChat === true,
        composerAttachmentsPerChat: captureView !== 'composer' || result.composerAttachmentsPerChat === true,
        composerAttachmentsClearedOnSwitch: captureView !== 'composer' || result.composerAttachmentsClearedOnSwitch === true,
        composerAttachmentOnlySessionPreserved: captureView !== 'composer' || result.composerAttachmentOnlySessionPreserved === true,
        composerDropOverlay: captureView !== 'composer' || result.composerDropOverlayWorks === true,
        composerDragDropAttachment: captureView !== 'composer' || result.composerDragDropAttachmentWorks === true,
        composerToolbarResponsive: captureView !== 'composer' || result.composerToolbarResponsiveWorks === true,
        buttons: captureView === 'terminal' || Number(result.buttonCount ?? 0) > 0
      }
  const failed = Object.entries(checks).filter(([, ok]) => !ok)
  if (failed.length > 0) {
    console.error(JSON.stringify({ outputPath, checks, result }, null, 2))
    process.exit(1)
  }

  console.log(JSON.stringify({ outputPath, screenshotPath: report.screenshotPath, view: captureView, checks, profile: result.profile }, null, 2))
})

function packagedLaunchCommand() {
  const executable = process.platform === 'darwin'
    ? prepareMacSmokeBundle({ root, profile: `${profile}-${captureView}-${process.pid}` }).executable
    : join(root, 'dist', 'Orchestrator')
  if (!existsSync(executable)) {
    console.error(`Packaged app not found at ${executable}`)
    console.error('Run npm run pack:mac before --packaged smoke checks.')
    process.exit(1)
  }
  return { bin: executable, args: [] }
}

function installedLaunchCommand() {
  if (process.platform !== 'darwin') {
    console.error('--installed smoke checks are currently supported only on macOS.')
    process.exit(1)
  }
  const executable = '/Applications/Orchestrator.app/Contents/MacOS/Orchestrator'
  if (!existsSync(executable)) {
    console.error(`Installed app executable not found at ${executable}`)
    console.error('Run npm run pack:mac && npm run install:mac before --installed smoke checks.')
    process.exit(1)
  }
  return { bin: executable, args: [] }
}

function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0)
  return new Promise((resolveWait) => {
    const check = () => {
      if (existsSync(filePath) || Date.now() >= deadline) {
        resolveWait()
        return
      }
      setTimeout(check, 100)
    }
    check()
  })
}
