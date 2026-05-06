export const CHEAP_LIVE_MODELS = {
  claude: 'claude-sonnet-4-6',
  codex: 'gpt-5.4-mini',
  copilot: 'gpt-5-mini',
  cursor: 'gpt-5-mini'
}

export const CHEAP_LIVE_EFFORT = {
  claude: 'low',
  codex: 'low',
  copilot: 'low',
  cursor: 'low'
}

export function envKey(prefix, providerId) {
  return `${prefix}_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

export function liveSmokeModel(providerId, env = process.env) {
  return env[envKey('LIVE_MODEL', providerId)] ?? CHEAP_LIVE_MODELS[providerId] ?? ''
}

export function liveSmokeEffort(providerId, env = process.env) {
  return env[envKey('LIVE_EFFORT', providerId)] ?? CHEAP_LIVE_EFFORT[providerId] ?? 'low'
}
