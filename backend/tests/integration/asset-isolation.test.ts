import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq } from 'drizzle-orm'
import { createTestDatabase } from '../helpers/postgres.js'

await test('Asset and episode isolation on PostgreSQL', async t => {
  const database = await createTestDatabase()
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = database.url
  process.env.HUOBAO_DATA_DIR = path.resolve('..', 'tmp', `asset-test-${randomUUID()}`)
  const { db, pool, schema } = await import('../../src/db/index.js')
  t.after(async () => { await pool.end(); await database.dispose() })
  const { migrationsFolder } = await import('../../src/db/readiness.js')
  await migrate(db, { migrationsFolder })
  const assets = await import('../../src/data/tenant/assets.js')
  const dramas = await import('../../src/data/tenant/dramas.js')
  const episodes = await import('../../src/data/tenant/episodes.js')
  const { requireEpisode } = await import('../../src/data/tenant/agent-scripts.js')
  const { runWithTenant } = await import('../../src/security/tenant-runtime.js')
  const { saveTenantBytes } = await import('../../src/utils/tenant-storage.js')
  const { Hono } = await import('hono')
  const { createTenantAuth } = await import('../../src/middleware/tenant-auth.js')
  const { handleError } = await import('../../src/middleware/logger.js')
  const { signQunlRequest } = await import('../../src/security/qunl-signature.js')
  const { default: characterRoutes } = await import('../../src/routes/characters.js')
  const { default: sceneRoutes } = await import('../../src/routes/scenes.js')
  const { default: propRoutes } = await import('../../src/routes/props.js')
  const { default: episodeRoutes } = await import('../../src/routes/episodes.js')
  const timestamp = new Date().toISOString()
  const tenant = (userId: number) => ({ userId, authVersion: 1 as const, requestId: `asset-test-${userId}` })
  const a = tenant(301), b = tenant(302)
  const secret = 'asset-integration-secret-at-least-32-characters'
  const app = new Hono()
  app.onError(handleError)
  app.use('*', createTenantAuth(secret))
  app.route('/api/v1/characters', characterRoutes)
  app.route('/api/v1/scenes', sceneRoutes)
  app.route('/api/v1/props', propRoutes)
  app.route('/api/v1/episodes', episodeRoutes)
  const request = (userId: number, method: string, url: string, body?: unknown) => {
    const fields = { version: '1', userId: String(userId), method, path: url, query: '',
      timestamp: String(Math.floor(Date.now() / 1000)), requestId: `http-${userId}` }
    return app.request(url, { method, headers: { 'Content-Type': 'application/json', 'X-Qunl-Auth-Version': '1',
      'X-Qunl-User-Id': fields.userId, 'X-Qunl-Timestamp': fields.timestamp, 'X-Qunl-Request-Id': fields.requestId,
      'X-Qunl-Signature': signQunlRequest(secret, fields),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  async function fixture(context: typeof a, title: string) {
    const drama = await dramas.createDrama(context, { title })
    const [episode] = await db.insert(schema.episodes).values({ userId: context.userId, dramaId: drama.id,
      episodeNumber: 1, title, createdAt: timestamp, updatedAt: timestamp }).returning()
    return { drama, episode }
  }
  const first = await fixture(a, 'A'), second = await fixture(b, 'B'), otherProject = await fixture(a, 'other')
  const notFound = (error: unknown) => error instanceof Error && 'status' in error && error.status === 404
  const specs = [
    { name: 'characters', create: assets.createCharacter, require: assets.requireCharacter, update: assets.updateCharacter,
      remove: assets.deleteCharacter, table: schema.characters, fields: { name: 'character' } },
    { name: 'scenes', create: assets.createScene, require: assets.requireScene, update: assets.updateScene,
      remove: assets.deleteScene, table: schema.scenes, fields: { location: 'room', time: 'day', prompt: 'room' } },
    { name: 'props', create: assets.createProp, require: assets.requireProp, update: assets.updateProp,
      remove: assets.deleteProp, table: schema.props, fields: { name: 'prop' } },
  ] as const

  for (const spec of specs) {
    await t.test(`${spec.name}: parent validation, atomic links and ownership fields`, async () => {
      const before = (await db.select().from(spec.table)).length
      for (const foreign of [second, otherProject]) {
        const response = await request(a.userId, 'POST', `/api/v1/${spec.name}`, {
          drama_id: first.drama.id, episode_id: foreign.episode.id, ...spec.fields,
        })
        assert.equal(response.status, 404)
      }
      assert.equal((await db.select().from(spec.table)).length, before)
      assert.equal((await request(a.userId, 'POST', `/api/v1/${spec.name}`, {
        drama_id: first.drama.id, ...spec.fields, user_id: b.userId,
      })).status, 400)
      const response = await request(a.userId, 'POST', `/api/v1/${spec.name}`, {
        drama_id: first.drama.id, episode_id: first.episode.id, ...spec.fields,
      })
      assert.equal(response.status, 201)
      const row = (await response.json()).data
      assert.equal(row.user_id, a.userId)
      assert.equal(row.drama_id, first.drama.id)
      assert.equal((await request(b.userId, 'PUT', `/api/v1/${spec.name}/${row.id}`, { final_prompt: 'bad' })).status, 404)
      assert.equal((await request(b.userId, 'DELETE', `/api/v1/${spec.name}/${row.id}`)).status, 404)
      assert.equal((await request(a.userId, 'PUT', `/api/v1/${spec.name}/${row.id}`, { drama_id: second.drama.id })).status, 400)
      assert.equal((await spec.require(a, row.id)).dramaId, first.drama.id)
      await assert.rejects(spec.require(undefined as never, row.id), /tenant context/)
      const list = await request(a.userId, 'GET', `/api/v1/episodes/${first.episode.id}/${spec.name}`)
      assert.ok((await list.json()).data.some((entry: { id: number }) => entry.id === row.id))
      assert.equal((await request(a.userId, 'DELETE', `/api/v1/${spec.name}/${row.id}`)).status, 200)
      await assert.rejects(spec.require(a, row.id), notFound)
      assert.equal((await request(a.userId, 'DELETE', `/api/v1/${spec.name}/${row.id}`)).status, 404)
      const deleted = await db.select().from(spec.table).where(eq(spec.table.id, row.id))
      assert.ok(deleted[0].deletedAt)
    })
  }

  await t.test('generation rejects foreign, wrong-project and deleted targets before model calls', async () => {
    const targets = [
      ['characters', await assets.createCharacter(b, second.drama.id, second.episode.id, { name: 'B' }), await assets.createCharacter(a, otherProject.drama.id, otherProject.episode.id, { name: 'other' })],
      ['scenes', await assets.createScene(b, second.drama.id, second.episode.id, { location: 'B' }), await assets.createScene(a, otherProject.drama.id, otherProject.episode.id, { location: 'other' })],
      ['props', await assets.createProp(b, second.drama.id, second.episode.id, { name: 'B' }), await assets.createProp(a, otherProject.drama.id, otherProject.episode.id, { name: 'other' })],
    ] as const
    for (const [kind, foreign, wrongProject] of targets) {
      for (const row of [foreign, wrongProject]) {
        for (const action of ['generate-image', 'generate-prompt']) {
          assert.equal((await request(a.userId, 'POST', `/api/v1/${kind}/${row.id}/${action}`, { episode_id: first.episode.id })).status, 404)
        }
      }
    }
    const own = await assets.createCharacter(a, first.drama.id, first.episode.id, { name: 'A' })
    const response = await request(a.userId, 'POST', '/api/v1/characters/batch-generate-images', {
      episode_id: first.episode.id, character_ids: [own.id, targets[0][1].id],
    })
    assert.equal(response.status, 404)
    assert.equal((await db.select().from(schema.sysTask)).length, 0)
    await assets.deleteCharacter(a, own.id)
    assert.equal((await request(a.userId, 'POST', `/api/v1/characters/${own.id}/generate-image`, { episode_id: first.episode.id })).status, 404)
  })

  await t.test('image selection accepts own local images, rejects foreign paths and external URLs', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2l8AAAAASUVORK5CYII=', 'base64')
    await runWithTenant(a, () => saveTenantBytes('static/uploads/a.png', png))
    await runWithTenant(b, () => saveTenantBytes('static/uploads/b.png', png))
    const row = await assets.createCharacter(a, first.drama.id, first.episode.id, { name: 'image' })
    const url = `/api/v1/characters/${row.id}`
    assert.equal((await request(a.userId, 'PUT', url, { image_url: 'static/uploads/b.png', local_path: 'static/uploads/b.png' })).status, 404)
    assert.equal((await request(a.userId, 'PUT', url, { image_url: 'https://example.test/private.png' })).status, 400)
    for (const image_url of ['static/../escape.png', 'static/uploads/../../escape.png', 'static/uploads/a.png?key=private']) {
      assert.equal((await request(a.userId, 'PUT', url, { image_url })).status, 400)
    }
    assert.equal((await request(a.userId, 'PUT', url, { image_url: 'static/uploads/a.png', local_path: 'static/uploads/b.png' })).status, 400)
    assert.equal((await request(a.userId, 'PUT', url, { final_prompt: null, finalPrompt: 'conflicting' })).status, 400)
    assert.equal((await request(a.userId, 'PUT', url, { image_url: '/static/uploads/a.png', local_path: 'static/uploads/a.png' })).status, 200)
    assert.equal((await assets.requireCharacter(a, row.id)).imageUrl, 'static/uploads/a.png')
    assert.equal((await request(a.userId, 'PUT', url, { image_url: null, local_path: null })).status, 200)
    assert.equal((await assets.requireCharacter(a, row.id)).localPath, null)
  })

  await t.test('episode config ownership, purpose and enabled status are validated; concurrent numbers serialize', async () => {
    for (const [create, update, require, fields, changed] of [
      [assets.createCharacter, assets.updateCharacter, assets.requireCharacter, { name: 'prompt-character' }, { appearance: 'new' }],
      [assets.createScene, assets.updateScene, assets.requireScene, { location: 'prompt-scene' }, { lighting: 'new' }],
      [assets.createProp, assets.updateProp, assets.requireProp, { name: 'prompt-prop' }, { description: 'new' }],
    ] as const) {
      const row = await create(a, first.drama.id, undefined, fields as never)
      await update(a, row.id, { finalPrompt: 'original' })
      await update(a, row.id, changed)
      assert.equal((await require(a, row.id)).finalPrompt, null)
      await update(a, row.id, { ...changed, finalPrompt: 'explicit replacement' })
      assert.equal((await require(a, row.id)).finalPrompt, 'explicit replacement')
    }
    const config = async (userId: number, serviceType: string, name: string, isActive = true) => {
      const [row] = await db.insert(schema.aiServiceConfigs).values({ userId, serviceType, name, isActive,
        baseUrl: 'https://example.test', apiKey: 'test-only', createdAt: timestamp, updatedAt: timestamp }).returning()
      return row.id
    }
    const image = await config(a.userId, 'image', 'image'), video = await config(a.userId, 'video', 'video')
    const foreign = await config(b.userId, 'image', 'foreign'), off = await config(a.userId, 'image', 'off', false)
    for (const imageConfigId of [foreign, off, video]) {
      await assert.rejects(episodes.createEpisode(a, first.drama.id, { imageConfigId, videoConfigId: video }), notFound)
    }
    const created = await Promise.all(Array.from({ length: 5 }, () => episodes.createEpisode(a, first.drama.id, { imageConfigId: image, videoConfigId: video })))
    assert.deepEqual(created.map(row => row.episodeNumber).sort(), [2, 3, 4, 5, 6])
  })

  await t.test('episode statistics exclude unlinked props and deleted storyboards; deleted parent hides all child endpoints', async () => {
    const project = await fixture(a, 'statistics')
    const linked = await assets.createProp(a, project.drama.id, project.episode.id, { name: 'linked' })
    const unlinked = await assets.createProp(a, project.drama.id, undefined, { name: 'unlinked' })
    const [board] = await db.insert(schema.storyboards).values({ userId: a.userId, episodeId: project.episode.id,
      storyboardNumber: 1, deletedAt: timestamp, createdAt: timestamp, updatedAt: timestamp }).returning()
    await db.insert(schema.sysTask).values([linked, unlinked].map(row => ({ userId: a.userId, type: 'image', dramaId: project.drama.id,
      propId: row.id, createdAt: timestamp, updatedAt: timestamp })))
    await db.insert(schema.sysTask).values({ userId: a.userId, type: 'video', dramaId: project.drama.id, storyboardId: board.id,
      createdAt: timestamp, updatedAt: timestamp })
    const tasks = await episodes.getEpisodeGenerationTasks(a, project.episode.id)
    assert.deepEqual(tasks.tasks.map(row => row.propId), [linked.id])
    assert.equal((await episodes.getEpisodePipeline(a, project.episode.id)).steps.extract_storyboards.count, 0)
    await episodes.deleteEpisode(a, project.episode.id)
    await assert.rejects(requireEpisode(a, project.episode.id), notFound)
    for (const endpoint of ['characters', 'scenes', 'props', 'storyboards', 'extract-status', 'video-prompts-status', 'generation-tasks', 'pipeline-status']) {
      assert.equal((await request(a.userId, 'GET', `/api/v1/episodes/${project.episode.id}/${endpoint}`)).status, 404)
    }
    await dramas.deleteDrama(a, project.drama.id)
    await assert.rejects(assets.requireProp(a, linked.id), notFound)
  })
})
