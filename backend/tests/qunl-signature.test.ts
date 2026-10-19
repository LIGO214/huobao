import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canonicalizeSignedRequest,
  isTimestampFresh,
  signQunlRequest,
  verifyQunlSignature,
} from '../src/security/qunl-signature.js'

const baseRequest = {
  version: '1',
  userId: '42',
  method: 'post',
  path: '/api/v1/tasks',
  query: 'b=two&a=one&a=zero',
  timestamp: '1700000000',
  requestId: 'request-1',
}

test('canonical request is deterministic and sorts query parameters', () => {
  assert.equal(
    canonicalizeSignedRequest(baseRequest),
    '1\n42\nPOST\n/api/v1/tasks\na=one&a=zero&b=two\n1700000000\nrequest-1',
  )
})

test('signature verifies and rejects changed request fields', () => {
  const secret = 'proxy-secret'
  const signature = signQunlRequest(secret, baseRequest)
  assert.equal(signature, '2bb2bb34d882e1a857384dd1498d9a87ed152e043387f3b9b3fc850566a73e09')
  assert.equal(verifyQunlSignature(secret, { ...baseRequest, signature }), true)
  assert.equal(verifyQunlSignature(secret, { ...baseRequest, path: '/api/v1/other', signature }), false)
  assert.equal(verifyQunlSignature('other-secret', { ...baseRequest, signature }), false)
})

test('timestamp freshness accepts a short window only', () => {
  assert.equal(isTimestampFresh('1000', 1050, 60), true)
  assert.equal(isTimestampFresh('1000', 1061, 60), false)
  assert.equal(isTimestampFresh('not-a-number', 1000, 60), false)
})
