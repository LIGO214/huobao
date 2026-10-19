import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QunlModelClient } from '../src/services/qunl-model-client.js'

test('QunlModelClient signs model requests and strips client credentials', async () => {
  const originalFetch = globalThis.fetch
  let captured: { url: string; init?: RequestInit } | undefined
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured = { url: String(input), init }
    return new Response(JSON.stringify({ success: true, data: { '1': ['gpt-test'] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const client = new QunlModelClient('http://qunl.test', '12345678901234567890123456789012')
    const models = await client.listModels(42, 'text')
    assert.deepEqual(models, ['gpt-test'])
    assert.equal(captured?.url, 'http://qunl.test/internal/huobao/models?purpose=text')
    assert.equal(captured?.init?.method, 'GET')
    const headers = new Headers(captured?.init?.headers)
    assert.equal(headers.get('X-Qunl-User-Id'), '42')
    assert.equal(headers.get('X-Qunl-Auth-Version'), '1')
    assert.ok(headers.get('X-Qunl-Signature'))
    assert.equal(headers.get('Authorization'), null)
    assert.equal(headers.get('X-Api-Key'), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})
