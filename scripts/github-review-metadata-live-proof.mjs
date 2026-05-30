#!/usr/bin/env node
import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const require = createRequire(import.meta.url)
const {
  mergeReviewCommentSummaries,
  reviewMetadataFromGitHubPullRequestView,
  reviewThreadCommentMetadataFromGitHub
} = require(join(root, 'out-test/src/main/git.js'))

const REVIEW_THREADS_QUERY = `
query($pullRequestId: ID!) {
  node(id: $pullRequestId) {
    ... on PullRequest {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          originalLine
          diffSide
          comments(first: 20) {
            nodes {
              id
              body
              author {
                login
              }
              url
              createdAt
              commit {
                oid
                abbreviatedOid
                url
                author {
                  name
                  date
                  user {
                    login
                  }
                }
              }
              originalCommit {
                oid
                abbreviatedOid
                url
                author {
                  name
                  date
                  user {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`

main()

function main() {
  const options = parseArgs(process.argv.slice(2))
  const outputDir = resolve(options.outDir)
  mkdirSync(outputDir, { recursive: true })

  const startedAt = new Date().toISOString()
  const resultPath = join(outputDir, 'result.json')

  try {
    const selection = resolvePullRequestSelection(options)
    if (selection.unavailable) {
      const proof = {
        status: 'unavailable',
        startedAt,
        completedAt: new Date().toISOString(),
        cwd: root,
        selector: selection.selector,
        repo: options.repo ?? null,
        authenticated: true,
        candidateScan: selection.candidateScan,
        commentedProof: false,
        warning: selection.warning,
        boundary: selection.boundary
      }
      writeFileSync(resultPath, `${JSON.stringify(proof, null, 2)}\n`)
      console.log(JSON.stringify({
        resultPath,
        status: proof.status,
        selector: proof.selector,
        commentedProof: false,
        candidateCount: selection.candidateScan?.candidateCount ?? 0,
        warning: proof.warning
      }, null, 2))
      process.exit(1)
    }
    const view = readPullRequestView(options)
    const metadata = reviewMetadataFromGitHubPullRequestView(view)
    if (!metadata?.pullRequest) throw new Error('GitHub PR metadata did not include a pull request.')

    const threadResult = readReviewThreads(options, view.id)
    const threadMetadata = threadResult.payload
      ? reviewThreadCommentMetadataFromGitHub(threadResult.payload, metadata.pullRequest.url ?? null)
      : undefined
    const mergedComments = mergeReviewCommentSummaries(metadata.comments, threadMetadata?.summary)
    const providerCommentCount = Object.values(threadMetadata?.commentsByPath ?? {})
      .reduce((total, comments) => total + comments.length, 0)
    const commentedProof = (mergedComments?.total ?? 0) > 0 || providerCommentCount > 0

    const proof = {
      status: options.requireComments && !commentedProof ? 'unavailable' : 'passed',
      startedAt,
      completedAt: new Date().toISOString(),
      cwd: root,
      selector: selection.selector,
      repo: options.repo ?? null,
      candidateScan: selection.candidateScan,
      authenticated: true,
      pullRequest: metadata.pullRequest,
      checks: summarizeChecks(metadata.checks),
      reviewers: summarizeReviewers(metadata.reviewers),
      comments: mergedComments ?? null,
      reviewThreadCommentPaths: Object.keys(threadMetadata?.commentsByPath ?? {}).sort(),
      providerCommentCount,
      commentedProof,
      warning: threadResult.warning ?? (!commentedProof ? 'Selected PR has no live issue comments or review-thread comments.' : null),
      boundary: commentedProof
        ? 'Authenticated hosted Review metadata and live comment metadata are available for this PR.'
        : 'Authenticated hosted Review metadata is available, but this PR cannot prove commented-PR rendering because it has no live comments.'
    }
    writeFileSync(resultPath, `${JSON.stringify(proof, null, 2)}\n`)
    console.log(JSON.stringify({
      resultPath,
      status: proof.status,
      selector: proof.selector,
      pullRequest: proof.pullRequest,
      commentedProof,
      commentTotal: mergedComments?.total ?? 0,
      providerCommentCount
    }, null, 2))
    process.exit(proof.status === 'passed' ? 0 : 1)
  } catch (error) {
    const proof = {
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      cwd: root,
      selector: options.autoCommentedPr ? 'auto-commented-pr' : (options.pr ?? 'current-branch'),
      repo: options.repo ?? null,
      authenticated: false,
      error: error instanceof Error ? error.message : String(error)
    }
    writeFileSync(resultPath, `${JSON.stringify(proof, null, 2)}\n`)
    console.error(JSON.stringify({ resultPath, status: proof.status, error: proof.error }, null, 2))
    process.exit(1)
  }
}

function parseArgs(args) {
  args = [...args]
  while (args[0] === '--') args.shift()
  const parsed = {
    outDir: process.env.GITHUB_REVIEW_METADATA_PROOF_ARTIFACT_DIR ?? 'tmp/github-review-metadata-live-proof',
    pr: process.env.GITHUB_REVIEW_METADATA_PR,
    repo: process.env.GITHUB_REVIEW_METADATA_REPO,
    requireComments: process.env.GITHUB_REVIEW_METADATA_REQUIRE_COMMENTS === '1',
    autoCommentedPr: process.env.GITHUB_REVIEW_METADATA_AUTO_COMMENTED_PR === '1',
    scanLimit: parsePositiveInteger(process.env.GITHUB_REVIEW_METADATA_SCAN_LIMIT ?? '30', 'GITHUB_REVIEW_METADATA_SCAN_LIMIT')
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--out') parsed.outDir = args[++index]
    else if (arg.startsWith('--out=')) parsed.outDir = arg.slice('--out='.length)
    else if (arg === '--pr') parsed.pr = args[++index]
    else if (arg.startsWith('--pr=')) parsed.pr = arg.slice('--pr='.length)
    else if (arg === '--repo') parsed.repo = args[++index]
    else if (arg.startsWith('--repo=')) parsed.repo = arg.slice('--repo='.length)
    else if (arg === '--require-comments') parsed.requireComments = true
    else if (arg === '--auto-commented-pr') {
      parsed.autoCommentedPr = true
      parsed.requireComments = true
    } else if (arg === '--scan-limit') parsed.scanLimit = parsePositiveInteger(args[++index], '--scan-limit')
    else if (arg.startsWith('--scan-limit=')) parsed.scanLimit = parsePositiveInteger(arg.slice('--scan-limit='.length), '--scan-limit')
    else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return parsed
}

function resolvePullRequestSelection(options) {
  if (!options.autoCommentedPr) {
    return {
      selector: options.pr ?? 'current-branch',
      candidateScan: null,
      unavailable: false
    }
  }

  const candidates = readPullRequestCandidates(options)
  const candidatesWithThreadCounts = candidates.map((candidate) => ({
    ...candidate,
    ...readCandidateReviewThreadCommentCount(options, candidate)
  }))
  const commentedCandidates = candidatesWithThreadCounts.filter((candidate) => Number(candidate.totalCommentCount ?? 0) > 0)
  const selected = commentedCandidates[0] ?? null
  const candidateScan = {
    mode: 'auto-commented-pr',
    limit: options.scanLimit,
    scannedCount: candidatesWithThreadCounts.length,
    candidateCount: commentedCandidates.length,
    threadScanWarningCount: candidatesWithThreadCounts.filter((candidate) => candidate.threadScanWarning).length,
    candidates: commentedCandidates.map((candidate) => ({
      number: candidate.number,
      title: candidate.title,
      state: candidate.state,
      url: candidate.url,
      commentCount: candidate.commentCount,
      providerCommentCount: candidate.providerCommentCount,
      totalCommentCount: candidate.totalCommentCount,
      updatedAt: candidate.updatedAt
    }))
  }
  if (!selected) {
    return {
      selector: 'auto-commented-pr',
      candidateScan,
      unavailable: true,
      warning: `No PR with issue or review-thread comments found in the latest ${candidatesWithThreadCounts.length} pull request(s).`,
      boundary: 'Authenticated GitHub PR scanning is available, but this repository currently has no safe commented PR target for commented Review provider proof.'
    }
  }
  options.pr = String(selected.number)
  return {
    selector: `auto-commented-pr:${selected.number}`,
    candidateScan: {
      ...candidateScan,
      selected: {
        number: selected.number,
        title: selected.title,
        state: selected.state,
        url: selected.url,
        commentCount: selected.commentCount,
        providerCommentCount: selected.providerCommentCount,
        totalCommentCount: selected.totalCommentCount,
        updatedAt: selected.updatedAt
      }
    },
    unavailable: false
  }
}

function readPullRequestCandidates(options) {
  const args = [
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    String(options.scanLimit),
    '--json',
    'id,number,title,state,url,updatedAt,comments'
  ]
  if (options.repo) args.push('--repo', options.repo)
  const list = JSON.parse(runGh(args))
  return (Array.isArray(list) ? list : []).map((entry) => ({
    id: entry.id ?? '',
    number: entry.number,
    title: entry.title ?? '',
    state: entry.state ?? '',
    url: entry.url ?? '',
    updatedAt: entry.updatedAt ?? '',
    commentCount: Array.isArray(entry.comments) ? entry.comments.length : 0
  }))
}

function readCandidateReviewThreadCommentCount(options, candidate) {
  if (!candidate.id) return { providerCommentCount: 0, totalCommentCount: candidate.commentCount ?? 0, threadScanWarning: 'GitHub PR id missing.' }
  const threadResult = readReviewThreads(options, candidate.id)
  if (threadResult.warning || !threadResult.payload) {
    return {
      providerCommentCount: 0,
      totalCommentCount: candidate.commentCount ?? 0,
      threadScanWarning: threadResult.warning ?? 'Inline review comments unavailable.'
    }
  }
  const threadMetadata = reviewThreadCommentMetadataFromGitHub(threadResult.payload, candidate.url ?? null)
  const providerCommentCount = Object.values(threadMetadata?.commentsByPath ?? {})
    .reduce((total, comments) => total + comments.length, 0)
  return {
    providerCommentCount,
    totalCommentCount: (candidate.commentCount ?? 0) + providerCommentCount,
    threadScanWarning: null
  }
}

function readPullRequestView(options) {
  const args = ['pr', 'view']
  if (options.pr) args.push(options.pr)
  if (options.repo) args.push('--repo', options.repo)
  args.push(
    '--json',
    'id,number,title,url,state,isDraft,headRefName,baseRefName,statusCheckRollup,reviewRequests,reviews,comments'
  )
  return JSON.parse(runGh(args))
}

function readReviewThreads(options, pullRequestId) {
  if (!pullRequestId) return { payload: null, warning: 'GitHub PR id missing; review threads were not queried.' }
  try {
    const args = [
      'api',
      'graphql',
      '-F',
      `pullRequestId=${pullRequestId}`,
      '-f',
      `query=${REVIEW_THREADS_QUERY}`
    ]
    return { payload: JSON.parse(runGh(args)), warning: null }
  } catch (error) {
    return {
      payload: null,
      warning: `Inline review comments unavailable: ${firstLine(error instanceof Error ? error.message : String(error))}`
    }
  }
}

function runGh(args) {
  return execFileSync('gh', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 4
  })
}

function summarizeChecks(checks) {
  if (!checks) return null
  const { status, total, passed, failing, pending, skipped, url } = checks
  return { status, total, passed, failing, pending, skipped, url }
}

function summarizeReviewers(reviewers) {
  if (!reviewers) return null
  const { requested, approved, changesRequested, commented, names, url } = reviewers
  return { requested, approved, changesRequested, commented, names, url }
}

function firstLine(value) {
  return String(value ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? 'unknown error'
}

function parsePositiveInteger(value, name) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Expected a positive integer for ${name}.`)
  return parsed
}
