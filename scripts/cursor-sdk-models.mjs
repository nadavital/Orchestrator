#!/usr/bin/env node
import { Cursor } from '@cursor/sdk'
import { applyLocalEnv } from './local-env.mjs'

applyLocalEnv()

const query = process.argv[2] ?? 'composer'
try {
  const models = await Cursor.models.list()
  const filtered = models
    .filter((model) => [model.id, model.displayName, ...(model.aliases ?? [])].join(' ').toLowerCase().includes(query.toLowerCase()))
    .map((model) => ({
      id: model.id,
      displayName: model.displayName,
      aliases: model.aliases ?? [],
      variants: model.variants?.map((variant) => ({
        displayName: variant.displayName,
        isDefault: variant.isDefault === true,
        params: variant.params
      })) ?? []
    }))

  console.log(JSON.stringify({
    ok: true,
    count: models.length,
    query,
    models: filtered
  }, null, 2))
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    query,
    error: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : undefined
  }, null, 2))
  process.exitCode = 1
}
