import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logTaskError, logTaskPayload, logTaskStart, redactUrl } from '../src/utils/task-logger.js'
import { requestLogger, handleError } from '../src/middleware/logger.js'
import { TENANT_CONTEXT_KEY } from '../src/security/request-context.js'
import { runWithTenant } from '../src/security/tenant-runtime.js'

const tenant = { userId: 42, authVersion: 1 as const, requestId: 'log-test' }

test('logs retain trusted identity and counters but never private payloads, URLs or error messages', t => {
  const logs: string[] = []
  t.mock.method(console, 'log', (line: string) => logs.push(line))
  const secret = 'private-test-key-prompt-skill'
  const privateFields = { prompt: secret, skill: secret, content: secret, description: secret,
    apiKey: secret, Authorization: secret, body: { messages: [secret] }, url: `https://example.test/${secret}` }
  runWithTenant(tenant, () => {
    logTaskStart('Test', 'start', { id: 7, user_id: 999, request_id: 'forged', ...privateFields })
    logTaskError('Test', 'failed', { id: 7, error: new Error(secret), params: privateFields })
    logTaskPayload('Test', 'payload', { id: 7, ...privateFields })
    logTaskPayload('Test', 'array', [secret])
    logTaskPayload('Test', 'text', secret)
  })
  assert.equal(logs.length, 5)
  assert.ok(!logs.join('\n').includes(secret))
  for (const line of logs) {
    const record = JSON.parse(line)
    assert.equal(record.user_id, 42)
    assert.equal(record.request_id, 'log-test')
  }
  assert.equal(JSON.parse(logs[0]).id, 7)
})

test('request and error logs omit URLs and SQL parameters, internal errors return a fixed message', async t => {
  const logs: string[] = []
  t.mock.method(console, 'log', (line: string) => logs.push(line))
  t.mock.method(console, 'error', (line: string) => logs.push(line))
  const app = new Hono()
  const secret = 'private-test-SQL-parameter'
  app.onError(handleError)
  app.use('*', requestLogger)
  app.use('*', async (c, next) => {
    c.set(TENANT_CONTEXT_KEY as never, tenant as never)
    await runWithTenant(tenant, next)
  })
  app.get('/internal-error', () => { throw new Error(`Failed query: INSERT parameters: ${secret}`) })
  app.get('/not-found', () => { throw new HTTPException(404, { message: '资源不存在' }) })
  const response = await app.request(`/internal-error?api_key=${secret}`)
  assert.equal(response.status, 500)
  assert.equal((await response.json()).message, '服务器内部错误')
  assert.equal((await app.request('/not-found')).status, 404)
  assert.ok(!logs.join('\n').includes(secret))
  const requests = logs.map(line => JSON.parse(line)).filter(record => record.action === 'request')
  assert.equal(requests.length, 2)
  for (const record of requests) {
    assert.equal(record.user_id, 42)
    assert.equal(record.request_id, 'log-test')
    assert.equal(record.method, 'GET')
    assert.ok(record.elapsedMs >= 0)
  }
})

test('URL redaction removes credentials, all query values and fragments', () => {
  const url = new URL(redactUrl('https://user:secret@example.test/api?Signature=secret&other=secret#secret'))
  assert.equal(url.username, '')
  assert.equal(url.password, '')
  assert.equal(url.hash, '')
  assert.equal(url.searchParams.get('Signature'), '***')
  assert.equal(url.searchParams.get('other'), '***')
  assert.equal(redactUrl('invalid-secret'), '[invalid URL]')
})
