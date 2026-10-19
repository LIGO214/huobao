import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createTestDatabase } from '../helpers/postgres.js'

await test('User Agent text and style isolation on PostgreSQL', async t => {
  const database = await createTestDatabase()
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = database.url
  process.env.HUOBAO_PROMPT_MAX_LENGTH = '1000'
  process.env.HUOBAO_SKILL_MAX_LENGTH = '1000'
  process.env.HUOBAO_SKILLS_MAX_PER_AGENT = '3'
  process.env.HUOBAO_AGENT_TEXT_MAX_LENGTH = '1500'
  const { db, pool, schema } = await import('../../src/db/index.js')
  t.after(async () => { await pool.end(); await database.dispose() })
  const { migrationsFolder } = await import('../../src/db/readiness.js')
  await migrate(db, { migrationsFolder })
  const { seedSystemStyles } = await import('../../src/data/system/seed.js')
  await seedSystemStyles(db)
  const custom = await import('../../src/data/tenant/agent-customizations.js')
  const styles = await import('../../src/data/tenant/style-presets.js')
  const { buildAgentInstructionSnapshot } = await import('../../src/services/agent-instructions.js')
  const { buildAgentRequestContext } = await import('../../src/agents/context.js')
  const { runWithTenant } = await import('../../src/security/tenant-runtime.js')
  const { createDrama } = await import('../../src/data/tenant/dramas.js')
  const { agentRegistry } = await import('../../src/agents/index.js')
  const { Hono } = await import('hono')
  const { createTenantAuth } = await import('../../src/middleware/tenant-auth.js')
  const { handleError } = await import('../../src/middleware/logger.js')
  const { signQunlRequest } = await import('../../src/security/qunl-signature.js')
  const { default: prompts } = await import('../../src/routes/prompts.js')
  const { default: skills } = await import('../../src/routes/skills.js')
  const { default: styleRoutes } = await import('../../src/routes/stylePresets.js')
  const tenant = (userId: number) => ({ userId, authVersion: 1 as const, requestId: `custom-${userId}` })
  const a = tenant(401), b = tenant(402)
  const secret = 'customization-test-secret-at-least-32-characters'
  const app = new Hono()
  app.onError(handleError)
  app.use('*', createTenantAuth(secret))
  app.route('/api/v1/prompts', prompts)
  app.route('/api/v1/skills', skills)
  app.route('/api/v1/style-presets', styleRoutes)
  function request(userId: number, method: string, path: string, body?: unknown) {
    const url = new URL(path, 'http://local.test')
    const fields = { version: '1', userId: String(userId), method, path: url.pathname, query: url.search,
      timestamp: String(Math.floor(Date.now() / 1000)), requestId: `http-${userId}` }
    return app.request(path, { method, headers: { 'Content-Type': 'application/json', 'X-Qunl-Auth-Version': '1',
      'X-Qunl-User-Id': fields.userId, 'X-Qunl-Timestamp': fields.timestamp, 'X-Qunl-Request-Id': fields.requestId,
      'X-Qunl-Signature': signQunlRequest(secret, fields),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  const notFound = (error: unknown) => error instanceof Error && 'status' in error && error.status === 404
  const badRequest = (error: unknown) => error instanceof Error && 'status' in error && error.status === 400

  await t.test('Prompt saves and resets are private, built-in content cannot be overwritten', async () => {
    const url = '/api/v1/prompts/script_rewriter'
    const builtIn = (await (await request(a.userId, 'GET', url)).json()).data.system_prompt
    assert.ok(builtIn.length > 0)
    for (const [context, user_prompt] of [[a, 'A private prompt'], [b, 'B private prompt']] as const) {
      assert.equal((await request(context.userId, 'PUT', url, { user_prompt })).status, 200)
      const data = (await (await request(context.userId, 'GET', url)).json()).data
      assert.equal(data.user_prompt, user_prompt)
      assert.equal(data.system_prompt, builtIn)
      assert.equal(data.read_only, true)
    }
    for (const [path, body] of [[url, { system_prompt: 'replace built in' }], [url, { user_prompt: 'x', tools: [] }],
      [`${url}?lang=invalid`, { user_prompt: 'x' }], [`${url}?lang=en`, { user_prompt: 'x', lang: 'ja' }],
      [url, { user_prompt: 'x'.repeat(1001) }], [url, { user_prompt: { content: 'x' } }]] as const) {
      assert.equal((await request(a.userId, 'PUT', path, body)).status, 400)
    }
    assert.equal((await request(a.userId, 'GET', '/api/v1/prompts/unknown')).status, 400)
    assert.equal((await request(a.userId, 'POST', `${url}/reset`)).status, 200)
    assert.equal(await custom.getUserPrompt(a, 'script_rewriter'), '')
    assert.equal(await custom.getUserPrompt(b, 'script_rewriter'), 'B private prompt')
    await assert.rejects(custom.getUserPrompt(undefined as never, 'script_rewriter'), /tenant context/)
  })

  await t.test('Skill CRUD, enable and ordering retain ownership and omitted fields', async () => {
    const create = async (userId: number) => request(userId, 'POST', '/api/v1/skills', {
      id: 'same-name', agent_type: 'extractor', name: 'private', content: `${userId} text`, enabled: false, sort_order: 5,
    })
    const responseA = await create(a.userId), responseB = await create(b.userId)
    assert.equal(responseA.status, 201)
    assert.equal(responseB.status, 201)
    const own = (await responseA.json()).data, foreign = (await responseB.json()).data
    const url = `/api/v1/skills/${foreign.id}`
    assert.equal((await request(a.userId, 'GET', url)).status, 404)
    assert.equal((await request(a.userId, 'PUT', url, { content: 'intrude' })).status, 404)
    assert.equal((await request(a.userId, 'DELETE', url)).status, 404)
    assert.equal((await request(a.userId, 'PUT', `/api/v1/skills/${own.id}`, { content: 'updated' })).status, 200)
    const saved = (await (await request(a.userId, 'GET', `/api/v1/skills/${own.id}`)).json()).data
    assert.equal(saved.enabled, false)
    assert.equal(saved.sort_order, 5)
    assert.equal(saved.name, 'private')
    assert.equal((await create(a.userId)).status, 400)
    assert.equal((await request(a.userId, 'PUT', `/api/v1/skills/${own.id}`, { enabled: 'false' })).status, 400)
    const list = (await (await request(a.userId, 'GET', '/api/v1/skills')).json()).data
    assert.ok(list.built_in.length > 0)
    assert.deepEqual(list.user.map((row: { id: string }) => row.id), [own.id])
    const builtInId = list.built_in[0].id
    assert.equal((await request(a.userId, 'PUT', `/api/v1/skills/${builtInId}`, { content: 'replace' })).status, 400)
    assert.equal((await request(a.userId, 'DELETE', `/api/v1/skills/${builtInId}`)).status, 400)
    assert.equal((await request(a.userId, 'GET', `/api/v1/skills/${builtInId}`)).status, 200)
    for (const extra of [{ scripts: ['run.sh'] }, { attachments: ['file'] }, { tools: {} }, { url: 'https://example.test/skill' }, { user_id: b.userId }]) {
      assert.equal((await request(a.userId, 'POST', '/api/v1/skills', {
        agent_type: 'extractor', name: 'invalid', content: 'text', ...extra,
      })).status, 400)
    }
    assert.equal((await request(a.userId, 'DELETE', `/api/v1/skills/${own.id}`)).status, 200)
    assert.equal((await request(a.userId, 'DELETE', `/api/v1/skills/${own.id}`)).status, 404)
    assert.equal((await request(b.userId, 'GET', url)).status, 200)
  })

  await t.test('concurrent saves respect count and total text limits with rollback', async () => {
    const context = tenant(403)
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => custom.createUserSkill(context, {
      agent_type: 'extractor', name: `skill-${index}`, content: 'x',
    })))
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 3)
    assert.equal((await custom.listUserSkills(context, 'extractor')).length, 3)
    for (const result of results) if (result.status === 'rejected') assert.ok(badRequest(result.reason))
    const budgetOwner = tenant(404)
    await custom.saveUserPrompt(budgetOwner, 'extractor', 'zh', 'p'.repeat(900))
    const skill = await custom.createUserSkill(budgetOwner, { agent_type: 'extractor', name: 'budget', content: 's'.repeat(500) })
    await assert.rejects(custom.updateUserSkill(budgetOwner, skill.id, { content: 's'.repeat(700) }), badRequest)
    assert.equal((await custom.requireUserSkill(budgetOwner, skill.id)).content.length, 500)
    await assert.rejects(custom.saveUserPrompt(budgetOwner, 'extractor', 'en', 'p'.repeat(200)), badRequest)
    assert.equal(await custom.getUserPrompt(budgetOwner, 'extractor', 'en'), '')
  })

  await t.test('instruction snapshots are immutable, user-specific and applied to the actual shared Agent', async () => {
    const contexts = [tenant(405), tenant(406)]
    for (const context of contexts) {
      await custom.saveUserPrompt(context, 'extractor', 'zh', `private-prompt-${context.userId}`)
      await custom.createUserSkill(context, { agent_type: 'extractor', name: 'selected', content: `private-skill-${context.userId}` })
      await custom.createUserSkill(context, { agent_type: 'extractor', name: 'off', content: 'disabled-secret', enabled: false })
    }
    const snapshots = await Promise.all(contexts.map(context => buildAgentInstructionSnapshot(context, 'extractor', 'zh')))
    for (const [index, snapshot] of snapshots.entries()) {
      assert.equal(Object.isFrozen(snapshot), true)
      assert.match(snapshot.instructions, new RegExp(`private-prompt-${contexts[index].userId}`))
      assert.match(snapshot.instructions, new RegExp(`private-skill-${contexts[index].userId}`))
      assert.ok(!snapshot.instructions.includes(`private-prompt-${contexts[1 - index].userId}`))
      assert.ok(!snapshot.instructions.includes('disabled-secret'))
      assert.ok(snapshot.instructions.endsWith('始终遵守服务端工具的校验结果。'))
    }
    const context = contexts[0]
    const drama = await createDrama(context, { title: 'snapshot' })
    const timestamp = new Date().toISOString()
    const [episode] = await db.insert(schema.episodes).values({ userId: context.userId, dramaId: drama.id,
      episodeNumber: 1, title: 'snapshot', createdAt: timestamp, updatedAt: timestamp }).returning()
    const rc = await runWithTenant(context, () => buildAgentRequestContext({ agentType: 'extractor', dramaId: drama.id, episodeId: episode.id }))
    const original = await runWithTenant(context, () => agentRegistry.extractor.getInstructions({ requestContext: rc }))
    await custom.saveUserPrompt(context, 'extractor', 'zh', 'new-prompt-next-run')
    assert.equal(await runWithTenant(context, () => agentRegistry.extractor.getInstructions({ requestContext: rc })), original)
    await assert.rejects(runWithTenant(contexts[1], () => agentRegistry.extractor.getInstructions({ requestContext: rc })), /身份/)
    await assert.rejects(runWithTenant(context, () => agentRegistry.script_rewriter.getInstructions({ requestContext: rc })), /快照/)
    assert.match((await buildAgentInstructionSnapshot(context, 'extractor', 'zh')).instructions, /new-prompt-next-run/)
    await assert.rejects(buildAgentInstructionSnapshot(undefined as never, 'extractor', 'zh'), /tenant context/)
  })

  await t.test('private style presets cannot modify shared or foreign entries and validate deletion results', async () => {
    const fields = { name: 'style', value: 'same-private', prompt: 'visual style' }
    const own = await styles.createStylePreset(a, fields), foreign = await styles.createStylePreset(b, fields)
    assert.ok((await styles.listStylePresets(a)).some(row => row.id === own.id))
    assert.ok(!(await styles.listStylePresets(a)).some(row => row.id === foreign.id))
    const shared = (await styles.listStylePresets(a)).find(row => row.userId === null)!
    for (const id of [foreign.id, shared.id]) {
      await assert.rejects(styles.updateStylePreset(a, id, { prompt: 'intrude' }), notFound)
      await assert.rejects(styles.deleteStylePreset(a, id), notFound)
    }
    await styles.updateStylePreset(a, own.id, { is_active: false, sort_order: 0 })
    assert.ok(!(await styles.listStylePresets(a)).some(row => row.id === own.id))
    assert.ok((await styles.listStylePresets(a, true)).some(row => row.id === own.id && row.sortOrder === 0))
    assert.equal((await request(a.userId, 'PUT', `/api/v1/style-presets/${own.id}`, { name: '' })).status, 400)
    assert.equal((await request(a.userId, 'PUT', `/api/v1/style-presets/${own.id}`, { user_id: b.userId })).status, 400)
    await styles.deleteStylePreset(a, own.id)
    await assert.rejects(styles.deleteStylePreset(a, own.id), notFound)
    assert.ok((await styles.listStylePresets(b)).some(row => row.id === foreign.id))
  })
})
