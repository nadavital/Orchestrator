import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

interface PetManifest {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
}

test('built-in pet resources are valid and included in packaged installs', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf-8')) as {
    build?: { extraResources?: Array<{ from?: string; to?: string }> }
  }
  assert.ok(
    packageJson.build?.extraResources?.some((entry) => entry.from === 'resources/pets' && entry.to === 'pets'),
    'package config must copy resources/pets into installed app resources'
  )

  const petsRoot = 'resources/pets'
  const petIds = readdirSync(petsRoot).filter((entry) => statSync(join(petsRoot, entry)).isDirectory())
  assert.ok(petIds.includes('orchestrator'))
  assert.ok(petIds.includes('psyduck'))
  const sortedPetIds = [...petIds].sort((a, b) => {
    if (a === 'orchestrator') return -1
    if (b === 'orchestrator') return 1
    return a.localeCompare(b)
  })
  assert.equal(sortedPetIds[0], 'orchestrator')

  for (const id of petIds) {
    const petDir = join(petsRoot, id)
    const manifestPath = join(petDir, 'pet.json')
    assert.ok(existsSync(manifestPath), `${id} is missing pet.json`)

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PetManifest
    assert.equal(manifest.id, id)
    assert.match(manifest.id, /^[a-zA-Z0-9._-]+$/)
    assert.ok(manifest.displayName.trim())
    assert.ok(manifest.description.trim())
    assert.equal(manifest.spritesheetPath, 'spritesheet.webp')
    assert.ok(existsSync(join(petDir, manifest.spritesheetPath)), `${id} is missing spritesheet`)
  }
})
