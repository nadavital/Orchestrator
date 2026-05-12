import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, join, relative, sep } from 'path'
import { homedir } from 'os'
import type { ProviderSlashCommand } from '../types'

export interface ClaudeExtensionDiscovery {
  commands: ProviderSlashCommand[]
  skills: ProviderSlashCommand[]
}

interface Frontmatter {
  description?: string
  argumentHint?: string
}

const MAX_DEPTH = 4

function safeStat(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function walkMarkdownFiles(root: string, depth = 0): string[] {
  if (depth > MAX_DEPTH || !existsSync(root)) return []
  const stat = safeStat(root)
  if (!stat?.isDirectory()) return []

  const files: string[] = []
  for (const name of readdirSync(root).sort()) {
    if (name.startsWith('.')) continue
    const path = join(root, name)
    const childStat = safeStat(path)
    if (!childStat) continue
    if (childStat.isDirectory()) files.push(...walkMarkdownFiles(path, depth + 1))
    if (childStat.isFile() && name.endsWith('.md')) files.push(path)
  }
  return files
}

function stripFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  if (!content.startsWith('---\n')) return { frontmatter: {}, body: content }
  const end = content.indexOf('\n---', 4)
  if (end < 0) return { frontmatter: {}, body: content }

  const raw = content.slice(4, end).trim()
  const frontmatter: Frontmatter = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Za-z_-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim().replace(/^['"]|['"]$/g, '')
    if (key === 'description') frontmatter.description = value
    if (key === 'argument-hint' || key === 'argumenthint') frontmatter.argumentHint = value
  }

  return { frontmatter, body: content.slice(end + 4).trimStart() }
}

function descriptionFromBody(body: string): string | undefined {
  return body
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean)
}

function commandName(root: string, file: string): string {
  const relativeName = relative(root, file).replace(/\.md$/, '')
  return `/${relativeName.split(sep).join(':')}`
}

function discoverCommandDir(root: string, scope: 'project' | 'global'): ProviderSlashCommand[] {
  return walkMarkdownFiles(root).map((file) => {
    const content = readFileSync(file, 'utf8')
    const { frontmatter, body } = stripFrontmatter(content)
    const name = commandName(root, file)
    return {
      id: `claude-${scope}-command:${relative(root, file)}`,
      name,
      description: frontmatter.description ?? descriptionFromBody(body) ?? `${scope} Claude command`,
      providerId: 'claude',
      source: 'provider',
      scope,
      runtime: 'headless',
      handler: 'insert-prompt',
      arguments: frontmatter.argumentHint ? [{ name: frontmatter.argumentHint, optional: true }] : undefined,
      featureId: 'slash-commands',
      prompt: body.trim()
    }
  })
}

function skillDescription(skillDir: string, body: string): string {
  const fromHeading = descriptionFromBody(body)
  return fromHeading ?? basename(skillDir)
}

function discoverSkillDir(root: string, scope: 'project' | 'global'): ProviderSlashCommand[] {
  if (!existsSync(root)) return []
  const rootStat = safeStat(root)
  if (!rootStat?.isDirectory()) return []

  const commands: ProviderSlashCommand[] = []
  for (const name of readdirSync(root).sort()) {
    if (name.startsWith('.')) continue
    const skillDir = join(root, name)
    const skillStat = safeStat(skillDir)
    if (!skillStat?.isDirectory()) continue
    const skillFile = join(skillDir, 'SKILL.md')
    const fileStat = safeStat(skillFile)
    if (!fileStat?.isFile()) continue

    const content = readFileSync(skillFile, 'utf8')
    const { frontmatter, body } = stripFrontmatter(content)
    commands.push({
      id: `claude-${scope}-skill:${name}`,
      name: `/skill:${name}`,
      description: frontmatter.description ?? skillDescription(skillDir, body),
      providerId: 'claude',
      source: 'skill',
      scope,
      runtime: 'headless',
      handler: 'insert-prompt',
      featureId: 'skills',
      prompt: body.trim()
    })
  }

  return commands
}

export function discoverClaudeExtensions(workDir: string, homeDir = homedir()): ClaudeExtensionDiscovery {
  const projectCommands = discoverCommandDir(join(workDir, '.claude', 'commands'), 'project')
  const globalCommands = discoverCommandDir(join(homeDir, '.claude', 'commands'), 'global')
  const projectSkills = discoverSkillDir(join(workDir, '.claude', 'skills'), 'project')
  const globalSkills = discoverSkillDir(join(homeDir, '.claude', 'skills'), 'global')

  return {
    commands: [...projectCommands, ...globalCommands],
    skills: [...projectSkills, ...globalSkills]
  }
}
