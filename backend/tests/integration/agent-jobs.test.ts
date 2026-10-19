import assert from 'node:assert/strict'
import { setTimeout } from 'node:timers/promises'
import { test } from 'node:test'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createTestDatabase } from '../helpers/postgres.js'

await test('Agent job ownership and atomic admission on PostgreSQL', async t => {
  const database = await createTestDatabase()
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = database.url
  process.env.HUOBAO_AGENT_MAX_CONCURRENCY = '2'
  process.env.HUOBAO_GLOBAL_AGENT_MAX_CONCURRENCY = '3'
  const { db, pool, schema } = await import('../../src/db/index.js')
  t.after(async () => { await pool.end(); await database.dispose() })
  const { migrationsFolder } = await import('../../src/db/readiness.js')
  await migrate(db, { migrationsFolder })
  const { seedSystemStyles } = await import('../../src/data/system/seed.js')
  await seedSystemStyles(db)
  const { createDrama, deleteDrama } = await import('../../src/data/tenant/dramas.js')
  const jobs = await import('../../src/data/tenant/agent-jobs.js')
  const tenant = (userId: number) => ({ userId, authVersion: 1 as const, requestId: `job-${userId}` })
  async function fixture(userId: number) {
    const context = tenant(userId)
    const drama = await createDrama(context, { title: `project-${userId}` })
    const timestamp = new Date().toISOString()
    const [episode] = await db.insert(schema.episodes).values({ userId, dramaId: drama.id, episodeNumber: 1,
      title: 'episode', createdAt: timestamp, updatedAt: timestamp }).returning()
    return { context, drama, episode }
  }
  const a = await fixture(601), b = await fixture(602), sameOwner = await fixture(601)
  const status = (expected: number) => (error: unknown) => error instanceof Error && 'status' in error && error.status === expected
  const create = (own: typeof a) => jobs.createAgentJob(own.context, 'script_rewriter', own.drama.id, own.episode.id)
  const finish = (own: typeof a, id: number) => jobs.finishAgentJob(own.context, 'script_rewriter', id, { status: 'completed', result: { text: 'done' } })

  await t.test('creation fails before insertion for missing identity, foreign resources and wrong project', async () => {
    await assert.rejects(jobs.createAgentJob(undefined as never, 'script_rewriter', a.drama.id, a.episode.id), /tenant context/)
    await assert.rejects(jobs.createAgentJob(a.context, 'script_rewriter', b.drama.id, b.episode.id), status(404))
    await assert.rejects(jobs.createAgentJob(a.context, 'script_rewriter', a.drama.id, sameOwner.episode.id), status(404))
    await assert.rejects(jobs.createAgentJob(a.context, 'unknown' as never, a.drama.id, a.episode.id), status(400))
    await assert.rejects(jobs.createAgentJob(a.context, 'script_rewriter', a.drama.id, 0), status(400))
    assert.equal((await db.select().from(schema.agentTasks)).length, 0)
  })

  await t.test('polling and completion require owner, job id and Agent type; terminal writes are immutable', async () => {
    const job = await create(a)
    assert.equal((await jobs.requireAgentJob(a.context, 'script_rewriter', job.id)).status, 'processing')
    for (const action of [jobs.requireAgentJob, (context: typeof a.context, type: 'script_rewriter', id: number) =>
      jobs.finishAgentJob(context, type, id, { status: 'failed' })]) {
      await assert.rejects(action(b.context, 'script_rewriter', job.id), status(404))
      await assert.rejects(action(a.context, 'extractor' as never, job.id), status(404))
      await assert.rejects(action(a.context, 'script_rewriter', 0), status(400))
      await assert.rejects(action(undefined as never, 'script_rewriter', job.id), /tenant context/)
    }
    assert.equal(await finish(a, job.id), true)
    assert.equal(await jobs.finishAgentJob(a.context, 'script_rewriter', job.id, { status: 'failed' }), false)
    const saved = await jobs.requireAgentJob(a.context, 'script_rewriter', job.id)
    assert.equal(saved.status, 'completed')
    assert.deepEqual(JSON.parse(saved.result!), { text: 'done' })
    assert.equal(saved.errorMsg, null)
    assert.ok(saved.completedAt)
  })

  await t.test('concurrent submissions cannot exceed the per-user limit and completion releases capacity', async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => create(a)))
    const accepted = results.filter(result => result.status === 'fulfilled')
    assert.equal(accepted.length, 2)
    for (const result of results) if (result.status === 'rejected') assert.ok(status(429)(result.reason))
    for (const result of accepted) if (result.status === 'fulfilled') await finish(a, result.value.id)
    const replacement = await create(a)
    assert.equal(await jobs.finishAgentJob(a.context, 'script_rewriter', replacement.id, { status: 'failed' }), true)
    assert.equal((await jobs.requireAgentJob(a.context, 'script_rewriter', replacement.id)).errorMsg, 'Agent 执行失败')
  })

  await t.test('concurrent users cannot exceed the global limit', async () => {
    const owners = await Promise.all(Array.from({ length: 8 }, (_, i) => fixture(610 + i)))
    const results = await Promise.allSettled(owners.map(create))
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 3)
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') await finish(owners[i], result.value.id)
      else assert.ok(status(429)(result.reason))
    }
  })

  await t.test('soft-deleting a parent hides polling without preventing background completion', async () => {
    const own = await fixture(620)
    const job = await create(own)
    await deleteDrama(own.context, own.drama.id)
    await assert.rejects(jobs.requireAgentJob(own.context, 'script_rewriter', job.id), status(404))
    assert.equal(await finish(own, job.id), true)
    const replacement = await create(a)
    await finish(a, replacement.id)
  })

  const { Hono } = await import('hono')
  const { createTenantAuth } = await import('../../src/middleware/tenant-auth.js')
  const { handleError } = await import('../../src/middleware/logger.js')
  const { signQunlRequest } = await import('../../src/security/qunl-signature.js')
  const { default: agentRoutes } = await import('../../src/routes/agent.js')
  const { mastra } = await import('../../src/mastra/index.js')
  const agent = mastra.getAgent('script_rewriter')
  const app = new Hono()
  const secret = 'agent-jobs-test-secret-at-least-32-characters'
  app.onError(handleError)
  app.use('*', createTenantAuth(secret))
  app.route('/api/v1/agent', agentRoutes)
  function request(userId: number, method: string, path: string, body?: unknown) {
    const fields = { version: '1', userId: String(userId), method, path, query: '',
      timestamp: String(Math.floor(Date.now() / 1000)), requestId: `http-job-${userId}` }
    return app.request(path, { method, headers: { 'Content-Type': 'application/json', 'X-Qunl-Auth-Version': '1',
      'X-Qunl-User-Id': fields.userId, 'X-Qunl-Timestamp': fields.timestamp, 'X-Qunl-Request-Id': fields.requestId,
      'X-Qunl-Signature': signQunlRequest(secret, fields),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  async function waitForJob(userId: number, id: number) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await request(userId, 'GET', `/api/v1/agent/script_rewriter/jobs/${id}`)
      assert.equal(response.status, 200)
      const row = (await response.json()).data
      if (row.status !== 'processing') return row
      await setTimeout(10)
    }
    assert.fail('Agent job did not finish')
  }

  await t.test('signed HTTP rejects invalid fields and foreign parents before executing the model', async t => {
    const model = t.mock.method(agent, 'generate', async () => { assert.fail('Invalid input reached the model') })
    t.after(() => model.mock.restore())
    const count = (await db.select().from(schema.agentTasks)).length
    const valid = { message: 'rewrite', drama_id: a.drama.id, episode_id: a.episode.id }
    for (const endpoint of ['start', 'chat']) {
      const path = `/api/v1/agent/script_rewriter/${endpoint}`
      assert.equal((await app.request(path, { method: 'POST' })).status, 401)
      for (const body of [{ ...valid, message: '' }, { ...valid, user_id: b.context.userId },
        { ...valid, drama_id: String(a.drama.id) }, { drama_id: a.drama.id, episode_id: a.episode.id }]) {
        assert.equal((await request(a.context.userId, 'POST', path, body)).status, 400)
      }
      assert.equal((await request(b.context.userId, 'POST', path, valid)).status, 404)
      assert.equal((await request(a.context.userId, 'POST', path, { ...valid, episode_id: sameOwner.episode.id })).status, 404)
      assert.equal((await request(a.context.userId, 'POST', `/api/v1/agent/unknown/${endpoint}`, valid)).status, 400)
    }
    assert.equal(model.mock.callCount(), 0)
    assert.equal((await db.select().from(schema.agentTasks)).length, count)
  })

  await t.test('background execution retains its own identity and snapshot; HTTP polling is private', async t => {
    const { requireCurrentTenant } = await import('../../src/security/tenant-runtime.js')
    const seen: number[] = []
    const model = t.mock.method(agent, 'generate', (async (_messages: unknown, options: any) => {
      const context = requireCurrentTenant()
      const rc = options.requestContext
      const snapshot = rc.get('instructionSnapshot')
      assert.equal(rc.get('userId'), context.userId)
      assert.equal(snapshot.userId, context.userId)
      assert.equal(snapshot.requestId, context.requestId)
      assert.ok(Object.isFrozen(snapshot))
      seen.push(context.userId)
      await setTimeout(10)
      return { text: `private-${context.userId}`, toolCalls: [], toolResults: [] }
    }) as never)
    t.after(() => model.mock.restore())
    const records = await Promise.all([a, b].map(async own => {
      const response = await request(own.context.userId, 'POST', '/api/v1/agent/script_rewriter/start', {
        message: 'rewrite', drama_id: own.drama.id, episode_id: own.episode.id,
      })
      assert.equal(response.status, 200)
      const id = (await response.json()).data.job_id
      const row = await waitForJob(own.context.userId, id)
      assert.equal(row.status, 'completed')
      assert.equal(JSON.parse(row.result).text, `private-${own.context.userId}`)
      return { own, id }
    }))
    assert.deepEqual(seen.sort(), [a.context.userId, b.context.userId])
    for (const { own, id } of records) {
      const other = own === a ? b : a
      assert.equal((await request(other.context.userId, 'GET', `/api/v1/agent/script_rewriter/jobs/${id}`)).status, 404)
      assert.equal((await request(own.context.userId, 'GET', `/api/v1/agent/extractor/jobs/${id}`)).status, 404)
    }
  })

  await t.test('failed background jobs finish without exposing the model error', async t => {
    const model = t.mock.method(agent, 'generate', async () => { throw new Error('private-upstream-key-and-prompt') })
    t.after(() => model.mock.restore())
    const response = await request(a.context.userId, 'POST', '/api/v1/agent/script_rewriter/start', {
      message: 'rewrite', drama_id: a.drama.id, episode_id: a.episode.id,
    })
    assert.equal(response.status, 200)
    const row = await waitForJob(a.context.userId, (await response.json()).data.job_id)
    assert.equal(row.status, 'failed')
    assert.equal(row.errorMsg, 'Agent 执行失败')
    assert.equal(row.result, null)
    assert.ok(!JSON.stringify(row).includes('private-upstream'))
  })

  const { runWithTenant, requireCurrentTenant } = await import('../../src/security/tenant-runtime.js')
  const { startExtraction, getExtractionStatus } = await import('../../src/services/extraction.js')
  const { startVideoPromptBatch, getVideoPromptBatchStatus } = await import('../../src/services/video-prompts.js')
  const { ensureCharacterFinalPrompt } = await import('../../src/services/final-prompt.js')
  const { createCharacter } = await import('../../src/data/tenant/assets.js')
  const { createStoryboard } = await import('../../src/data/tenant/agent-storyboards.js')
  const { saveCharacterPrompt } = await import('../../src/data/tenant/image-prompts.js')
  const { updateAgentStoryboard } = await import('../../src/data/tenant/agent-storyboards.js')
  const character = await createCharacter(a.context, a.drama.id, a.episode.id, { name: 'prompt target' })
  const { row: storyboard } = await createStoryboard(a.context, a.episode.id, { shot_number: 1 })
  const extractor = mastra.getAgent('extractor'), promptAgent = mastra.getAgent('prompt_generator')

  async function waitForService(check: () => Promise<{ status: string } | null>) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const state = await check()
      if (state && state.status !== 'running') return state
      await setTimeout(10)
    }
    assert.fail('Agent service did not finish')
  }

  await t.test('chat, extraction, batch and image prompt entries share the same admission limits', async t => {
    const models = [agent, extractor, promptAgent].map(instance => t.mock.method(instance, 'generate', async () => {
      assert.fail('An entry bypassed Agent admission')
    }))
    t.after(() => models.forEach(model => model.mock.restore()))
    const blockers = await Promise.all([create(a), create(a)])
    try {
      for (const endpoint of ['chat', 'start']) {
        assert.equal((await request(a.context.userId, 'POST', `/api/v1/agent/script_rewriter/${endpoint}`, {
          message: 'rewrite', drama_id: a.drama.id, episode_id: a.episode.id,
        })).status, 429)
      }
      await assert.rejects(runWithTenant(a.context, () => startExtraction(a.episode.id, a.drama.id, 'characters')), status(429))
      await assert.rejects(runWithTenant(a.context, () => startVideoPromptBatch(a.episode.id, a.drama.id)), status(429))
      await assert.rejects(runWithTenant(a.context, () => ensureCharacterFinalPrompt(character, a.episode.id)), status(429))
      assert.equal((await runWithTenant(a.context, () => getExtractionStatus(a.episode.id))).characters, null)
      assert.equal(await runWithTenant(a.context, () => getVideoPromptBatchStatus(a.episode.id)), null)
      assert.equal(models.reduce((total, model) => total + model.mock.callCount(), 0), 0)
    } finally {
      await Promise.all(blockers.map(job => finish(a, job.id)))
    }
  })

  await t.test('successful service entries finish their own jobs and release shared capacity', async t => {
    const scriptModel = t.mock.method(agent, 'generate', (async () => {
      assert.equal(requireCurrentTenant().userId, b.context.userId)
      return { text: 'sync result', toolCalls: [], toolResults: [] }
    }) as never)
    const extractModel = t.mock.method(extractor, 'generate', (async () => {
      assert.equal(requireCurrentTenant().userId, a.context.userId)
      return { toolCalls: [], steps: [] }
    }) as never)
    const promptModel = t.mock.method(promptAgent, 'generate', (async () => {
      assert.equal(requireCurrentTenant().userId, a.context.userId)
      await saveCharacterPrompt(a.context, a.episode.id, a.drama.id, character.id, 'saved image prompt')
      await updateAgentStoryboard(a.context, a.episode.id, a.drama.id, storyboard.id, { video_prompt: 'saved video prompt' })
      return {}
    }) as never)
    t.after(() => [scriptModel, extractModel, promptModel].forEach(model => model.mock.restore()))
    const before = (await db.select().from(schema.agentTasks)).length
    const response = await request(b.context.userId, 'POST', '/api/v1/agent/script_rewriter/chat', {
      message: 'rewrite', drama_id: b.drama.id, episode_id: b.episode.id,
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.text, 'sync result')
    assert.equal(await runWithTenant(a.context, () => startExtraction(a.episode.id, a.drama.id, 'characters')), true)
    await waitForService(async () => (await runWithTenant(a.context, () => getExtractionStatus(a.episode.id))).characters)
    assert.equal((await runWithTenant(a.context, () => startVideoPromptBatch(a.episode.id, a.drama.id))).started, true)
    await waitForService(() => runWithTenant(a.context, () => getVideoPromptBatchStatus(a.episode.id)))
    assert.equal((await runWithTenant(a.context, () => getVideoPromptBatchStatus(a.episode.id)))?.completed, 1)
    assert.ok((await runWithTenant(a.context, () => ensureCharacterFinalPrompt(character, a.episode.id, true))).endsWith('saved image prompt'))
    const rows = (await db.select().from(schema.agentTasks).orderBy(schema.agentTasks.id)).slice(before)
    assert.equal(rows.length, 4)
    assert.ok(rows.every(row => row.status === 'completed' && row.completedAt))
    assert.equal(rows.filter(row => row.userId === a.context.userId).length, 3)
    assert.equal(rows.filter(row => row.userId === b.context.userId).length, 1)
    assert.equal(rows.filter(row => row.result === 'null').length, 3)
    const replacement = await create(a)
    await finish(a, replacement.id)
  })

  await t.test('service failures release jobs without exposing private upstream details', async t => {
    const models = [agent, extractor, promptAgent].map(instance => t.mock.method(instance, 'generate', async () => {
      throw new Error('private-provider-key-and-prompt')
    }))
    t.after(() => models.forEach(model => model.mock.restore()))
    const before = (await db.select().from(schema.agentTasks)).length
    const response = await request(b.context.userId, 'POST', '/api/v1/agent/script_rewriter/chat', {
      message: 'rewrite', drama_id: b.drama.id, episode_id: b.episode.id,
    })
    assert.equal(response.status, 500)
    assert.ok(!(await response.text()).includes('private-provider'))
    await runWithTenant(a.context, () => startExtraction(a.episode.id, a.drama.id, 'scenes'))
    const state = await waitForService(async () => (await runWithTenant(a.context, () => getExtractionStatus(a.episode.id))).scenes)
    assert.ok(!JSON.stringify(state).includes('private-provider'))
    await assert.rejects(runWithTenant(a.context, () => ensureCharacterFinalPrompt(character, a.episode.id, true)), /private-provider/)
    const rows = (await db.select().from(schema.agentTasks).orderBy(schema.agentTasks.id)).slice(before)
    assert.equal(rows.length, 3)
    assert.ok(rows.every(row => row.status === 'failed' && row.completedAt && row.result === null))
    assert.ok(!JSON.stringify(rows).includes('private-provider'))
    const replacement = await create(a)
    await finish(a, replacement.id)
  })
})
