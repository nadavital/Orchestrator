#!/usr/bin/env node
import { existsSync, readFileSync } from 'fs'
import { basename, resolve } from 'path'

const fixturePath = process.argv[2]
if (!fixturePath || !existsSync(fixturePath)) {
  console.error('Usage: npm run replay:fixture -- <fixture.jsonl>')
  process.exit(1)
}

const lines = readFileSync(resolve(fixturePath), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

const summary = {
  fixture: basename(fixturePath),
  lines: lines.length,
  jsonLines: 0,
  eventTypes: {},
  assistantTextChars: 0,
  toolCalls: 0,
  permissionRequests: 0,
  userInputRequests: 0,
  terminalEvents: 0
}

for (const line of lines) {
  let parsed
  try {
    parsed = JSON.parse(line)
  } catch {
    continue
  }
  summary.jsonLines += 1
  const type = parsed.type ?? parsed.event ?? parsed.msg?.type ?? parsed.item?.type ?? 'unknown'
  summary.eventTypes[type] = (summary.eventTypes[type] ?? 0) + 1
  const text = parsed.content ?? parsed.text ?? parsed.delta ?? parsed.message?.content
  if (typeof text === 'string') summary.assistantTextChars += text.length
  if (/tool/i.test(String(type))) summary.toolCalls += 1
  if (/permission|approval/i.test(String(type))) summary.permissionRequests += 1
  if (/question|input/i.test(String(type))) summary.userInputRequests += 1
  if (/completed|failed|error/i.test(String(type))) summary.terminalEvents += 1
}

console.log(JSON.stringify(summary, null, 2))
