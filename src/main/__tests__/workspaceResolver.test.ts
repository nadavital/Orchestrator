import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveWorkspaceFileReference } from '../workspaceResolver'

test('resolves bare file references inside the workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-workspace-'))
  try {
    const schemaDir = join(root, 'src', 'main', 'resources', 'schema')
    mkdirSync(schemaDir, { recursive: true })
    const filePath = join(schemaDir, 'PaymentsUpsellMessage.graphqls')
    writeFileSync(filePath, 'type PaymentsUpsellMessage { id: ID }')

    assert.equal(
      resolveWorkspaceFileReference(root, join(root, 'PaymentsUpsellMessage.graphqls')),
      filePath
    )
    assert.equal(
      resolveWorkspaceFileReference(root, 'PaymentsUpsellMessage.graphqls'),
      filePath
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolves absolute references against an alternate workspace root by basename', () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-workspace-'))
  try {
    const sourceDir = join(root, 'xopesweb', 'src', 'main', 'java', 'com', 'ebay', 'xopes', 'web', 'datafetchers')
    mkdirSync(sourceDir, { recursive: true })
    const filePath = join(sourceDir, 'PaymentUpsellFetcher.java')
    writeFileSync(filePath, 'class PaymentUpsellFetcher {}')

    assert.equal(
      resolveWorkspaceFileReference(root, '/Users/navital/Desktop/dynamicplatform/PaymentUpsellFetcher.java'),
      filePath
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('prefers path suffix matches when resolving workspace references', () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-workspace-'))
  try {
    const schemaDir = join(root, 'src', 'main', 'resources', 'schema')
    const fixtureDir = join(root, 'src', 'test', 'fixtures')
    mkdirSync(schemaDir, { recursive: true })
    mkdirSync(fixtureDir, { recursive: true })
    const schemaPath = join(schemaDir, 'CheckoutPaymentMethodsEligibility.graphqls')
    const fixturePath = join(fixtureDir, 'CheckoutPaymentMethodsEligibility.graphqls')
    writeFileSync(schemaPath, 'type CheckoutPaymentMethodsEligibility { id: ID }')
    writeFileSync(fixturePath, 'fixture')

    assert.equal(
      resolveWorkspaceFileReference(root, 'resources/schema/CheckoutPaymentMethodsEligibility.graphqls'),
      schemaPath
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
