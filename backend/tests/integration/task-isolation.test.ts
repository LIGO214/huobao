import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq } from 'drizzle-orm'
import { createTestDatabase } from '../helpers/postgres.js'

await test('Generation task API ownership on PostgreSQL', async t => {
  const database = await createTestDatabase()
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = database.url
  const { db, pool, schema } = await import('../../src/db/index.js')
  t.after(async () => { await pool.end(); await database.dispose() })
  const { migrationsFolder } = await import('../../src/db/readiness.js')
  await migrate(db, { migrationsFolder })
  const { createDrama } = await import('../../src/data/tenant/dramas.js')
  const { createStoryboard } = await import('../../src/data/tenant/agent-storyboards.js')
  const { createCharacter, createScene, createProp, deleteCharacter } = await import('../../src/data/tenant/assets.js')
  const tasks = await import('../../src/data/tenant/tasks.js')
  const { Hono } = await import('hono')
  const { createTenantAuth } = await import('../../src/middleware/tenant-auth.js')
  const { handleError } = await import('../../src/middleware/logger.js')
  const { signQunlRequest } = await import('../../src/security/qunl-signature.js')
  const { default: routes } = await import('../../src/routes/tasks.js')
  const tenant = (userId: number) => ({ userId, authVersion: 1 as const, requestId: `task-${userId}` })
  const a = tenant(701), b = tenant(702)
  const timestamp = new Date().toISOString()
  async function fixture(context: typeof a) {
    const drama = await createDrama(context, { title: 'project' })
    const [episode] = await db.insert(schema.episodes).values({ userId: context.userId, dramaId: drama.id, episodeNumber: 1,
      title: 'episode', createdAt: timestamp, updatedAt: timestamp }).returning()
    const { row: board } = await createStoryboard(context, episode.id, { shot_number: 1 })
    const character = await createCharacter(context, drama.id, episode.id, { name: 'character' })
    const scene = await createScene(context, drama.id, episode.id, { location: 'room' })
    const prop = await createProp(context, drama.id, episode.id, { name: 'prop' })
    return { drama, episode, board, character, scene, prop }
  }
  const own = await fixture(a), foreign = await fixture(b), otherProject = await fixture(a)
  const secret = 'generation-task-test-secret-at-least-32-characters'
  const app = new Hono()
  app.onError(handleError)
  app.use('*', createTenantAuth(secret))
  app.route('/api/v1/tasks', routes)
  function request(userId: number, method: string, path: string, body?: unknown) {
    const url = new URL(path, 'http://local.test')
    const fields = { version: '1', userId: String(userId), method, path: url.pathname, query: url.search,
      timestamp: String(Math.floor(Date.now() / 1000)), requestId: `http-task-${userId}` }
    return app.request(path, { method, headers: { 'Content-Type': 'application/json', 'X-Qunl-Auth-Version': '1',
      'X-Qunl-User-Id': fields.userId, 'X-Qunl-Timestamp': fields.timestamp, 'X-Qunl-Request-Id': fields.requestId,
      'X-Qunl-Signature': signQunlRequest(secret, fields),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  const status = (expected: number) => (error: unknown) => error instanceof Error && 'status' in error && error.status === expected
  async function insert(context: typeof a, project: typeof own, taskStatus: string) {
    const [row] = await db.insert(schema.sysTask).values({ userId: context.userId, type: 'video', status: taskStatus,
      dramaId: project.drama.id, storyboardId: project.board.id, createdAt: timestamp, updatedAt: timestamp }).returning()
    return row
  }

  await t.test('target resolution rejects missing identity, foreign targets and cross-project combinations', async () => {
    await assert.rejects(tasks.resolveTaskTargets(undefined as never, {}), /tenant context/)
    for (const target of [foreign, otherProject]) {
      for (const fields of [{ storyboardId: target.board.id }, { characterId: target.character.id },
        { sceneId: target.scene.id }, { propId: target.prop.id }]) {
        await assert.rejects(tasks.resolveTaskTargets(a, { dramaId: own.drama.id, ...fields }), status(404))
      }
    }
    const resolved = await tasks.resolveTaskTargets(a, { storyboardId: own.board.id, characterId: own.character.id,
      sceneId: own.scene.id, propId: own.prop.id })
    assert.equal(resolved.dramaId, own.drama.id)
    assert.equal(resolved.episode?.id, own.episode.id)
    await deleteCharacter(a, own.character.id)
    await assert.rejects(tasks.resolveTaskTargets(a, { characterId: own.character.id }), status(404))
  })

  await t.test('signed creation rejects invalid input, foreign targets and invalid configs without model calls', async t => {
    const network = t.mock.method(globalThis, 'fetch', async () => { assert.fail('Invalid request reached the model') })
    t.after(() => network.mock.restore())
    const before = (await db.select().from(schema.sysTask)).length
    const valid = { type: 'video', prompt: 'test prompt', drama_id: own.drama.id, storyboard_id: own.board.id }
    for (const references of [{ image_url: 'static/images/ref.png' }, { first_frame_url: 'static/images/ref.png' },
      { reference_images: ['static/images/ref.png'] },
      { last_frame_url: 'static/images/ref.png' }, { reference_image_urls: ['static/images/ref.png'] },
      { reference_video_urls: ['static/videos/ref.mp4'] }, { reference_audio_urls: ['static/audio/ref.mp3'] },
      { file_url: 'https://model.invalid/ref' }, { link_url: 'https://model.invalid/ref' },
      { input: { media: [{ type: 'reference_image', url: 'static/images/ref.png' }] } }]) {
      const response = await request(a.userId, 'POST', '/api/v1/tasks', { ...valid, ...references })
      assert.equal(response.status, 400)
      assert.match((await response.json()).message, /视频参考素材暂未开放/)
    }
    assert.equal((await app.request('/api/v1/tasks', { method: 'POST' })).status, 401)
    for (const body of [{ ...valid, user_id: b.userId }, { ...valid, id: 55 }, { ...valid, status: 'completed' },
      { ...valid, storyboard_id: String(own.board.id) }, { ...valid, config_id: -1 }, { ...valid, generate_audio: 'false' },
      { ...valid, reference_image_urls: 'not-an-array' }, { ...valid, type: 'unknown' }, { type: 'image', prompt: '   ' }]) {
      assert.equal((await request(a.userId, 'POST', '/api/v1/tasks', body)).status, 400)
    }
    for (const project of [foreign, otherProject]) {
      for (const fields of [{ storyboard_id: project.board.id }, { scene_id: project.scene.id },
        { character_id: project.character.id }, { prop_id: project.prop.id }]) {
        assert.equal((await request(a.userId, 'POST', '/api/v1/tasks', { ...valid, ...fields })).status, 404)
      }
    }
    assert.equal((await request(b.userId, 'POST', '/api/v1/tasks', valid)).status, 404)
    for (const [userId, serviceType, isActive] of [[b.userId, 'video', true], [a.userId, 'image', true], [a.userId, 'video', false]] as const) {
      const [config] = await db.insert(schema.aiServiceConfigs).values({ userId, serviceType, isActive, name: `config-${userId}-${serviceType}`,
        baseUrl: 'https://model.invalid', apiKey: 'test-only', createdAt: timestamp, updatedAt: timestamp }).returning()
      assert.equal((await request(a.userId, 'POST', '/api/v1/tasks', { ...valid, config_id: config.id })).status, 404)
    }
    assert.equal(network.mock.callCount(), 0)
    assert.equal((await db.select().from(schema.sysTask)).length, before)
  })

  await t.test('polling and list filters are private, strict and applied in SQL', async () => {
    const first = await insert(a, own, 'completed'), second = await insert(b, foreign, 'completed')
    const another = await insert(a, otherProject, 'failed')
    assert.equal((await request(b.userId, 'GET', `/api/v1/tasks/${first.id}`)).status, 404)
    assert.equal((await request(a.userId, 'GET', `/api/v1/tasks/${second.id}`)).status, 404)
    assert.equal((await request(a.userId, 'GET', `/api/v1/tasks/${first.id}`)).status, 200)
    assert.equal((await request(a.userId, 'GET', '/api/v1/tasks/0')).status, 400)
    assert.equal((await request(a.userId, 'GET', '/api/v1/tasks/not-a-number')).status, 400)
    const rows = (await (await request(a.userId, 'GET', '/api/v1/tasks')).json()).data
    assert.deepEqual(rows.map((row: { id: number }) => row.id), [another.id, first.id])
    const filtered = (await (await request(a.userId, 'GET', `/api/v1/tasks?type=video&drama_id=${own.drama.id}&storyboard_id=${own.board.id}`)).json()).data
    assert.deepEqual(filtered.map((row: { id: number }) => row.id), [first.id])
    assert.equal((await request(a.userId, 'GET', `/api/v1/tasks?storyboard_id=${foreign.board.id}`)).status, 404)
    assert.equal((await request(a.userId, 'GET', `/api/v1/tasks?drama_id=${foreign.drama.id}`)).status, 404)
    for (const query of ['type=invalid', 'drama_id=1.5', 'storyboard_id=NaN', 'user_id=702', 'drama_id=-1']) {
      assert.equal((await request(a.userId, 'GET', `/api/v1/tasks?${query}`)).status, 400)
    }
    await assert.rejects(tasks.requireGenerationTask(undefined as never, first.id), /tenant context/)
    await assert.rejects(tasks.listGenerationTasks(undefined as never), /tenant context/)
  })

  await t.test('deletion rejects foreign, running and asset-referenced tasks, and checks missing rows', async () => {
    const active = await insert(a, own, 'processing'), completed = await insert(a, own, 'completed')
    assert.equal((await request(b.userId, 'DELETE', `/api/v1/tasks/${active.id}`)).status, 404)
    assert.equal((await request(a.userId, 'DELETE', `/api/v1/tasks/${active.id}`)).status, 409)
    await db.insert(schema.assets).values({ userId: a.userId, videoGenId: completed.id, name: 'saved-video', createdAt: timestamp, updatedAt: timestamp })
    assert.equal((await request(a.userId, 'DELETE', `/api/v1/tasks/${completed.id}`)).status, 409)
    const unused = await insert(a, own, 'failed')
    assert.equal((await request(a.userId, 'DELETE', `/api/v1/tasks/${unused.id}`)).status, 200)
    assert.equal((await request(a.userId, 'DELETE', `/api/v1/tasks/${unused.id}`)).status, 404)
    assert.equal((await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, unused.id))).length, 0)
    await assert.rejects(tasks.deleteGenerationTask(undefined as never, completed.id), /tenant context/)
  })
})
