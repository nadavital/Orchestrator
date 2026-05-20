import test from 'node:test'
import assert from 'node:assert/strict'
import {
  browserSecurityPolicyAllows,
  DEFAULT_BROWSER_SECURITY_POLICY,
  getBrowserSecurityPolicy,
  originKeyFromUrl,
  setBrowserSecurityPolicy
} from '../browserSecurityPolicy'

test('browser security policy normalizes origins and blocks transfers by default', () => {
  setBrowserSecurityPolicy(DEFAULT_BROWSER_SECURITY_POLICY)

  assert.equal(originKeyFromUrl('https://www.example.com/download.zip'), 'example.com')
  assert.equal(browserSecurityPolicyAllows('download', 'https://example.com/download.zip'), false)
  assert.equal(browserSecurityPolicyAllows('upload', 'https://example.com/upload'), false)
})

test('browser security policy allows explicit origins and lets blocklists win', () => {
  setBrowserSecurityPolicy({
    allowedDownloadOrigins: ['https://www.example.com/path'],
    allowedUploadOrigins: ['example.com'],
    blockedUploadOrigins: ['https://www.blocked.test']
  })

  assert.equal(browserSecurityPolicyAllows('download', 'https://example.com/file.zip'), true)
  assert.equal(browserSecurityPolicyAllows('upload', 'https://example.com/upload'), true)
  assert.equal(browserSecurityPolicyAllows('upload', 'https://blocked.test/upload'), false)
})

test('browser security policy alwaysAllow still respects blocked origins', () => {
  setBrowserSecurityPolicy({
    downloadApprovalMode: 'alwaysAllow',
    uploadApprovalMode: 'alwaysAllow',
    blockedDownloadOrigins: ['blocked.test'],
    blockedUploadOrigins: ['blocked.test']
  })

  assert.equal(browserSecurityPolicyAllows('download', 'https://allowed.test/file.zip'), true)
  assert.equal(browserSecurityPolicyAllows('upload', 'https://allowed.test/upload'), true)
  assert.equal(browserSecurityPolicyAllows('download', 'https://blocked.test/file.zip'), false)
  assert.equal(browserSecurityPolicyAllows('upload', 'https://blocked.test/upload'), false)

  const policy = getBrowserSecurityPolicy()
  assert.deepEqual(policy.blockedDownloadOrigins, ['blocked.test'])
})
