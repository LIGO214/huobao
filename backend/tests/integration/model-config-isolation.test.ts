import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Hono } from 'hono'
import { createTestDatabase } from '../helpers/postgres.js'

await test('User-owned model configurations on PostgreSQL', async t => {
  const database = await createTestDatabase()
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = database.url
  const { db, pool, schema } = await import('../../src/db/index.js')
  t.after(async () => { await pool.end(); await database.dispose() })
  const { migrationsFolder } = await import('../../src/db/readiness.js')
  await migrate(db, { migrationsFolder })
  const { seedSystemStyles } = await import('../../src/data/system/seed.js')
  await seedSystemStyles(db)
  const configs = await import('../../src/data/tenant/model-configs.js')
  const { runWithTenant } = await import('../../src/security/tenant-runtime.js')
  const { getConfigById, getTextConfig } = await import('../../src/services/ai.js')
  const { createTenantAuth } = await import('../../src/middleware/tenant-auth.js')
  const { handleError } = await import('../../src/middleware/logger.js')
  const { signQunlRequest } = await import('../../src/security/qunl-signature.js')
  const { default: routes } = await import('../../src/routes/aiConfigs.js')
  const { createDrama } = await import('../../src/data/tenant/dramas.js')
  const { buildAgentRequestContext } = await import('../../src/agents/context.js')
  const { agentRegistry } = await import('../../src/agents/index.js')
  const tenant = (userId: number) => ({ userId, authVersion: 1 as const, requestId: `model-${userId}` })
  const a = tenant(1), b = tenant(87)
  const secret = 'model-config-test-only-secret-at-least-32-characters'
  const app = new Hono()
  app.onError(handleError)
  app.use('*', createTenantAuth(secret))
  app.route('/api/v1/ai-configs', routes)
  function request(context: typeof a, method: string, suffix = '', body?: unknown) {
    const url = new URL(`/api/v1/ai-configs${suffix}`, 'http://local.test')
    const fields = { version: '1', userId: String(context.userId), method, path: url.pathname, query: url.search,
      timestamp: String(Math.floor(Date.now() / 1000)), requestId: context.requestId }
    return app.request(url, { method, headers: { 'Content-Type': 'application/json',
      'X-Qunl-Auth-Version': '1', 'X-Qunl-User-Id': fields.userId, 'X-Qunl-Timestamp': fields.timestamp,
      'X-Qunl-Request-Id': fields.requestId, 'X-Qunl-Signature': signQunlRequest(secret, fields),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  const status = (expected: number) => (error: unknown) => error instanceof Error && 'status' in error && error.status === expected
  const rows = new Map<number, number>()
  await t.test('signed CRUD is private and never returns saved keys', async () => {
    assert.equal((await app.request('/api/v1/ai-configs')).status, 401)
    for (const context of [a, b]) {
      const input = { name: 'same-name', service_type: 'text', provider: 'openai', model: ['text-model'],
        base_url: 'http://qunl.invalid', api_key: `test-only-key-${context.userId}` }
      assert.equal((await request(context, 'POST', '', { ...input, user_id: 999 })).status, 400)
      const response = await request(context, 'POST', '', input)
      assert.equal(response.status, 201)
      const body = await response.json()
      assert.equal(body.data.user_id, context.userId)
      assert.equal(body.data.has_api_key, true)
      assert.ok(!JSON.stringify(body).includes(input.api_key))
      assert.ok(!('api_key' in body.data))
      rows.set(context.userId, body.data.id)
    }
    for (const context of [a, b]) {
      const other = context === a ? b : a
      const list = await (await request(context, 'GET')).json()
      assert.deepEqual(list.data.map((row: { id: number }) => row.id), [rows.get(context.userId)])
      assert.ok(!JSON.stringify(list).includes('test-only-key'))
      for (const method of ['GET', 'PUT', 'DELETE']) {
        assert.equal((await request(context, method, `/${rows.get(other.userId)}`,
          method === 'PUT' ? { name: 'stolen' } : undefined)).status, 404)
      }
      assert.equal((await request(context, 'GET', '?user_id=87')).status, 400)
    }
    assert.equal((await request(a, 'PUT', `/${rows.get(a.userId)}`, { name: 'renamed', temperature: 0 })).status, 200)
    const saved = await configs.requireModelConfig(a, rows.get(a.userId)!)
    assert.equal(saved.apiKey, 'test-only-key-1')
    assert.equal(JSON.parse(saved.settings!).temperature, 0)
    assert.equal((await request(a, 'PUT', `/${saved.id}`, { api_key: '' })).status, 400)
    assert.equal((await request(a, 'PUT', `/${saved.id}`, { user_id: 87 })).status, 400)
    const unused = await configs.createModelConfig(a, { serviceType: 'image', provider: 'openai', name: 'unused',
      baseUrl: 'http://qunl.invalid', apiKey: 'unused-test-key', model: ['gpt-image-2'] })
    assert.equal((await request(a, 'DELETE', `/${unused.id}`)).status, 200)
    assert.equal((await request(a, 'DELETE', `/${unused.id}`)).status, 404)
  })

  await t.test('invalid explicit configuration never falls back to another key', async () => {
    const id = rows.get(a.userId)!
    await assert.rejects(configs.listModelConfigs(undefined as never), /tenant context/)
    await assert.rejects(runWithTenant(a, () => getConfigById(rows.get(b.userId)!, 'text')), status(404))
    await assert.rejects(runWithTenant(a, () => getConfigById(id, 'image')), status(404))
    await configs.updateModelConfig(a, id, { isActive: false })
    await assert.rejects(runWithTenant(a, () => getConfigById(id, 'text')), status(404))
    await assert.rejects(runWithTenant(a, getTextConfig), /未配置文本模型/)
    await configs.updateModelConfig(a, id, { isActive: true })
    await assert.rejects(configs.updateModelConfig(a, id, { serviceType: 'video' }), status(400))
    await assert.rejects(configs.createModelConfig(a, { serviceType: 'text', provider: 'aliyun', name: 'invalid',
      baseUrl: 'http://qunl.invalid', apiKey: 'test-only', model: ['test'] }), status(400))
    assert.equal((await configs.requireModelConfig(a, id)).serviceType, 'text')
  })

  await t.test('saved-key probes require ownership and do not expose upstream private data', async t => {
    const network = t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'http://qunl.invalid/v1/models')
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-only-key-1')
      assert.equal(init?.redirect, 'error')
      return Response.json({ private: 'test-only-key-1', data: [] })
    })
    t.after(() => network.mock.restore())
    assert.equal((await request(a, 'POST', '/test', { config_id: rows.get(b.userId) })).status, 404)
    assert.equal(network.mock.callCount(), 0)
    const response = await request(a, 'POST', '/test', { config_id: rows.get(a.userId) })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.data.ok, true)
    assert.equal(body.data.response_preview, '')
    assert.ok(!JSON.stringify(body).includes('test-only-key'))
    assert.equal(network.mock.callCount(), 1)
  })

  const projects = new Map<number, { dramaId: number; episodeId: number }>()
  await t.test('referenced configurations cannot be deleted or change purpose, but can be disabled', async () => {
    const config = await configs.createModelConfig(a, { serviceType: 'image', provider: 'openai', name: 'locked-image',
      baseUrl: 'http://qunl.invalid', apiKey: 'test-only-locked-key', model: ['image-model'] })
    const drama = await createDrama(a, { title: 'locked-project' })
    const timestamp = new Date().toISOString()
    await db.insert(schema.episodes).values({ userId: a.userId, dramaId: drama.id, episodeNumber: 1,
      title: 'locked episode',
      imageConfigId: config.id, createdAt: timestamp, updatedAt: timestamp })
    assert.equal((await request(a, 'DELETE', `/${config.id}`)).status, 409)
    assert.equal((await request(a, 'PUT', `/${config.id}`, { service_type: 'text' })).status, 409)
    assert.equal((await request(a, 'PUT', `/${config.id}`, { is_active: false })).status, 200)
    assert.equal((await configs.requireModelConfig(a, config.id)).isActive, false)
  })
  for (const context of [a, b]) {
    const drama = await createDrama(context, { title: 'same-project' })
    const timestamp = new Date().toISOString()
    const [episode] = await db.insert(schema.episodes).values({ userId: context.userId, dramaId: drama.id,
      episodeNumber: 1, title: 'episode', createdAt: timestamp, updatedAt: timestamp }).returning()
    projects.set(context.userId, { dramaId: drama.id, episodeId: episode.id })
  }
  await t.test('the actual shared Agent SDK sends each owner key to the public text API', async t => {
    const seen: number[] = []
    const network = t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), 'http://qunl.invalid/v1/chat/completions')
      const headers = new Headers(init?.headers)
      const userId = [1, 87].find(id => headers.get('Authorization') === `Bearer test-only-key-${id}`)
      assert.ok(userId)
      assert.equal(headers.get('X-Qunl-Signature'), null)
      assert.equal(init?.redirect, 'error')
      assert.equal(JSON.parse(init!.body as string).model, 'text-model')
      seen.push(userId)
      await setTimeout(5)
      return Response.json({ id: 'test', object: 'chat.completion', created: 1, model: 'text-model',
        choices: [{ index: 0, message: { role: 'assistant', content: `private-${userId}` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    })
    t.after(() => network.mock.restore())
    await Promise.all([a, b].map(context => runWithTenant(context, async () => {
      const rc = await buildAgentRequestContext({ agentType: 'script_rewriter', ...projects.get(context.userId)!,
        textConfigId: rows.get(context.userId), modelOverride: 'text-model' })
      const model = await agentRegistry.script_rewriter!.getModel({ requestContext: rc })
      const result = await (model as any).doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }] })
      let text = ''
      for await (const part of result.stream) {
        if (part.type === 'text-delta') text += part.delta
      }
      assert.equal(text, `private-${context.userId}`)
    })))
    assert.deepEqual(seen.sort((x, y) => x - y), [1, 87])
    await assert.rejects(runWithTenant(a, () => buildAgentRequestContext({ agentType: 'script_rewriter',
      ...projects.get(a.userId)!, textConfigId: rows.get(b.userId) })), status(404))
    assert.equal(network.mock.callCount(), 2)
  })

  await t.test('restart fails interrupted local jobs while retaining upstream IDs without resubmission', async t => {
    const timestamp = new Date().toISOString()
    const [job] = await db.insert(schema.sysTask).values({ userId: a.userId, type: 'video', status: 'processing',
      taskId: 'upstream-retained', createdAt: timestamp, updatedAt: timestamp }).returning()
    const network = t.mock.method(globalThis, 'fetch', async () => { assert.fail('Restart must not resubmit or poll') })
    t.after(() => network.mock.restore())
    const { markInterruptedLocalTasks } = await import('../../src/services/startup-recovery.js')
    await markInterruptedLocalTasks()
    await markInterruptedLocalTasks()
    const { requireGenerationTask } = await import('../../src/data/tenant/tasks.js')
    const saved = await requireGenerationTask(a, job.id)
    assert.equal(saved.status, 'failed')
    assert.equal(saved.taskId, 'upstream-retained')
    assert.match(saved.errorMsg!, /上游任务状态未确认/)
    assert.equal(network.mock.callCount(), 0)
  })
})
