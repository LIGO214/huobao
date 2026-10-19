import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { createTenantAuth } from '../src/middleware/tenant-auth.js'
import { createRequestLimits } from '../src/middleware/request-limits.js'
import { loadAppConfig } from '../src/config/env.js'
import { runWithTenant, requireCurrentTenant } from '../src/security/tenant-runtime.js'
import { signQunlRequest } from '../src/security/qunl-signature.js'
import { handleError } from '../src/middleware/logger.js'

const tenant = { userId: 42, requestId: 'test', authVersion: 1 } as const
const secret = 'test-secret-for-qunl-huobao-identity'
function signedHeaders(path: string, method = 'GET', userId = 42) {
  const request = { version: '1', userId: String(userId), method, path, query: '',
    timestamp: String(Math.floor(Date.now() / 1000)), requestId: 'test-request' }
  return {
    'X-Qunl-Auth-Version': request.version, 'X-Qunl-User-Id': request.userId,
    'X-Qunl-Timestamp': request.timestamp, 'X-Qunl-Request-Id': request.requestId,
    'X-Qunl-Signature': signQunlRequest(secret, request),
  }
}

test('missing, invalid and mutable identity cannot create a tenant context', () => {
  assert.throws(requireCurrentTenant, /tenant context/)
  for (const userId of [0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => runWithTenant({ ...tenant, userId }, () => {}), /tenant context/)
  }
  const context = { ...tenant }
  runWithTenant(context, () => {
    context.userId = 99 as 42
    assert.equal(requireCurrentTenant().userId, 42)
    assert.equal(Object.isFrozen(requireCurrentTenant()), true)
  })
})

test('concurrent requests retain independent identities through asynchronous work', async () => {
  const values = await Promise.all([42, 43].map(userId => runWithTenant({ ...tenant, userId }, async () => {
    await new Promise(resolve => setTimeout(resolve, userId === 42 ? 10 : 1))
    return requireCurrentTenant().userId
  })))
  assert.deepEqual(values, [42, 43])
  assert.throws(requireCurrentTenant, /tenant context/)
})

test('authentication denies missing secret, unsigned and changed identity, accepts valid signed request', async () => {
  const app = new Hono()
  app.use('*', createTenantAuth(secret))
  app.get('/test', c => c.json(requireCurrentTenant()))
  assert.equal((await app.request('/test')).status, 401)
  const headers = signedHeaders('/test')
  assert.equal((await app.request('/test', { headers: { ...headers, 'X-Qunl-User-Id': '43' } })).status, 401)
  const response = await app.request('/test', { headers })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).userId, 42)
  const unconfigured = new Hono()
  unconfigured.use('*', createTenantAuth(''))
  unconfigured.get('/test', c => c.text('unexpected'))
  assert.equal((await unconfigured.request('/test', { headers })).status, 401)
})

function limitedApp(options = {}) {
  const limits = { ...loadAppConfig({ NODE_ENV: 'test' }).limits,
    jsonMaxBytes: 8, uploadMaxBytes: 16, uploadPerUser: 1, uploadGlobal: 2, ...options }
  const app = new Hono()
  app.onError(handleError)
  app.use('*', createTenantAuth(secret))
  app.use('*', createRequestLimits(limits))
  app.post('*', async c => c.text(await c.req.text()))
  return app
}

function chunkedRequest(path: string, parts: string[], headers = {}) {
  return new Request(`http://localhost${path}`, { method: 'POST', headers: { ...signedHeaders(path, 'POST'), ...headers },
    body: new ReadableStream({ pull(controller) {
      const part = parts.shift()
      if (part === undefined) controller.close()
      else controller.enqueue(new TextEncoder().encode(part))
    } }), duplex: 'half',
  } as RequestInit)
}

test('body limits check actual streamed bytes with absent or misleading content length', async () => {
  const app = limitedApp()
  assert.equal((await app.request(chunkedRequest('/api/v1/test', ['1234', '5678']))).status, 200)
  assert.equal((await app.request(chunkedRequest('/api/v1/test', ['1234', '56789']))).status, 413)
  assert.equal((await app.request(chunkedRequest('/api/v1/test', ['123456789'], { 'Content-Length': '1' }))).status, 413)
  assert.equal((await app.request(chunkedRequest('/api/v1/test', ['1'], { 'Content-Length': '1000' }))).status, 413)
})

test('upload slots enforce per-user and global limits and release after body failures', async () => {
  const app = limitedApp()
  const path = '/api/v1/upload/image'
  const releases: Array<() => void> = []
  const slow = (userId: number) => app.request(new Request(`http://localhost${path}`, {
    method: 'POST', headers: signedHeaders(path, 'POST', userId), duplex: 'half',
    body: new ReadableStream({ start(controller) {
      releases.push(() => { controller.enqueue(new Uint8Array([1])); controller.close() })
    } }),
  } as RequestInit))
  const first = slow(42)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await app.request(chunkedRequest(path, ['1']))).status, 429)
  const second = slow(43)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await app.request(path, { method: 'POST', body: '1', headers: signedHeaders(path, 'POST', 44) })).status, 429)
  releases.forEach(release => release())
  assert.equal((await first).status, 200)
  assert.equal((await second).status, 200)
  assert.equal((await app.request(chunkedRequest(path, ['x'.repeat(70_000)]))).status, 413)
  assert.equal((await app.request(chunkedRequest(path, ['1']))).status, 200)
})
