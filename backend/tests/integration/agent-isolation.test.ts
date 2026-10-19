import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { and, eq, isNull } from 'drizzle-orm'
import { createTestDatabase } from '../helpers/postgres.js'

await test('Agent tenant isolation on PostgreSQL', async t => {
  const database = await createTestDatabase()
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = database.url
  const { db, pool, schema } = await import('../../src/db/index.js')
  t.after(async () => { await pool.end(); await database.dispose() })
  const { migrationsFolder } = await import('../../src/db/readiness.js')
  await migrate(db, { migrationsFolder })
  const { seedSystemStyles } = await import('../../src/data/system/seed.js')
  await seedSystemStyles(db)
  const dramas = await import('../../src/data/tenant/dramas.js')
  const scripts = await import('../../src/data/tenant/agent-scripts.js')
  const assets = await import('../../src/data/tenant/agent-assets.js')
  const boards = await import('../../src/data/tenant/agent-storyboards.js')
  const prompts = await import('../../src/data/tenant/image-prompts.js')
  const { getDramaStylePrompt } = await import('../../src/data/tenant/styles.js')
  const { runWithTenant } = await import('../../src/security/tenant-runtime.js')
  const { buildAgentRequestContext } = await import('../../src/agents/context.js')
  const { RequestContext } = await import('@mastra/core/request-context')
  const { scriptTools } = await import('../../src/agents/tools/script-tools.js')
  const { extractTools } = await import('../../src/agents/tools/extract-tools.js')
  const { imagePromptTools } = await import('../../src/agents/tools/image-prompt-tools.js')
  const { storyboardTools } = await import('../../src/agents/tools/storyboard-tools.js')
  const timestamp = new Date().toISOString()
  const tenant = (userId: number) => ({ userId, authVersion: 1 as const, requestId: `agent-test-${userId}` })
  const a = tenant(201), b = tenant(202)
  async function fixture(context: ReturnType<typeof tenant>, title: string) {
    const drama = await dramas.createDrama(context, { title })
    const [episode] = await db.insert(schema.episodes).values({ userId: context.userId, dramaId: drama.id,
      episodeNumber: 1, title, content: `source-${title}`, createdAt: timestamp, updatedAt: timestamp }).returning()
    const character = await assets.saveAgentCharacter(context, episode.id, drama.id, { name: `character-${title}` })
    const scene = await assets.saveAgentScene(context, episode.id, drama.id, { location: title, time: 'day', prompt: title })
    const prop = await assets.saveAgentProp(context, episode.id, drama.id, { name: `prop-${title}` })
    return { drama, episode, character, scene, prop }
  }
  const first = await fixture(a, 'first')
  const second = await fixture(b, 'second')
  const sameOwner = await fixture(a, 'other-project')
  const notFound = (error: unknown) => error instanceof Error && 'status' in error && error.status === 404
  const activeBoards = () => db.select().from(schema.storyboards).where(and(
    eq(schema.storyboards.userId, a.userId), eq(schema.storyboards.episodeId, first.episode.id), isNull(schema.storyboards.deletedAt),
  ))

  await t.test('domain functions require identity and reject foreign and wrong-project resources', async () => {
    await assert.rejects(dramas.listDramas(undefined as never), /tenant context/)
    await assert.rejects(scripts.requireAgentEpisode(a, second.episode.id, second.drama.id), notFound)
    await assert.rejects(scripts.requireAgentEpisode(a, first.episode.id, sameOwner.drama.id), notFound)
    for (const other of [second, sameOwner]) {
      await assert.rejects(assets.saveAgentCharacter(a, first.episode.id, first.drama.id, { name: 'bad' }, other.character.id), notFound)
      await assert.rejects(assets.saveAgentScene(a, first.episode.id, first.drama.id, { location: 'bad', time: 'day', prompt: 'bad' }, other.scene.id), notFound)
      await assert.rejects(assets.saveAgentProp(a, first.episode.id, first.drama.id, { name: 'bad' }, other.prop.id), notFound)
      await assert.rejects(prompts.saveCharacterPrompt(a, first.episode.id, first.drama.id, other.character.id, 'bad'), notFound)
      await assert.rejects(prompts.saveScenePrompt(a, first.episode.id, first.drama.id, other.scene.id, 'bad'), notFound)
      await assert.rejects(prompts.savePropPrompt(a, first.episode.id, first.drama.id, other.prop.id, 'bad'), notFound)
    }
    assert.equal((await assets.listAgentCharacters(a, first.episode.id, first.drama.id)).rows.length, 1)
  })

  await t.test('client ownership fields cannot change ownership; failed batches roll back', async () => {
    await dramas.saveDramaCharacters(a, first.drama.id, [{ id: first.character.id, name: 'renamed', userId: b.userId, dramaId: second.drama.id } as never])
    const [character] = await db.select().from(schema.characters).where(eq(schema.characters.id, first.character.id))
    assert.equal(character.userId, a.userId)
    assert.equal(character.dramaId, first.drama.id)
    await assert.rejects(dramas.saveDramaCharacters(a, first.drama.id, [
      { id: first.character.id, name: 'rolled-back' }, { id: second.character.id, name: 'bad' },
    ]), notFound)
    assert.equal((await prompts.getPromptCharacter(a, first.episode.id, first.drama.id, first.character.id)).name, 'renamed')
    await assert.rejects(dramas.saveDramaEpisodes(a, first.drama.id, [
      { id: first.episode.id, title: 'rolled-back', episodeNumber: 1 }, { id: second.episode.id, title: 'bad', episodeNumber: 2 },
    ]), notFound)
    assert.equal((await scripts.requireAgentEpisode(a, first.episode.id, first.drama.id)).title, 'first')
  })

  await t.test('storyboard writes preserve zero, links and atomic rollback on invalid bindings', async () => {
    await boards.saveAgentStoryboards(a, first.episode.id, first.drama.id, [{ shot_number: 1, duration: 0,
      scene_id: first.scene.id, character_ids: [first.character.id], prop_ids: [first.prop.id] }], false)
    const [original] = await activeBoards()
    assert.equal(original.duration, 0)
    const data = await boards.readAgentStoryboards(a, first.episode.id, first.drama.id)
    assert.deepEqual(data.entries[0].characterIds, [first.character.id])
    assert.deepEqual(data.entries[0].propIds, [first.prop.id])
    for (const other of [second, sameOwner]) {
      for (const binding of [{ scene_id: other.scene.id }, { character_ids: [other.character.id] }, { prop_ids: [other.prop.id] }]) {
        await assert.rejects(boards.saveAgentStoryboards(a, first.episode.id, first.drama.id,
          [{ shot_number: 2 }, { shot_number: 3, ...binding }], true), notFound)
        assert.deepEqual((await activeBoards()).map(row => row.id), [original.id])
      }
    }
    await assert.rejects(boards.updateAgentStoryboard(b, first.episode.id, first.drama.id, original.id, { title: 'bad' }), notFound)
    await assert.rejects(boards.updateAgentStoryboard(a, sameOwner.episode.id, sameOwner.drama.id, original.id, { title: 'bad' }), notFound)
    await assert.rejects(boards.updateAgentStoryboard(a, first.episode.id, first.drama.id, original.id,
      { title: 'rolled-back', character_ids: [second.character.id] }), notFound)
    assert.equal((await activeBoards())[0].title, null)
  })

  await t.test('concurrent upserts serialize per episode; replacements keep historical task references', async () => {
    await Promise.all(Array.from({ length: 6 }, (_, i) => boards.saveAgentStoryboards(a, first.episode.id, first.drama.id,
      [{ shot_number: 5, title: `concurrent-${i}`, duration: i }], false)))
    assert.equal((await activeBoards()).filter(row => row.storyboardNumber === 5).length, 1)
    const [old] = await activeBoards()
    const [task] = await db.insert(schema.sysTask).values({ userId: a.userId, type: 'video', storyboardId: old.id,
      createdAt: timestamp, updatedAt: timestamp }).returning()
    await boards.saveAgentStoryboards(a, first.episode.id, first.drama.id, [{ shot_number: 1, title: 'replacement', duration: 0 }], true)
    assert.equal((await activeBoards()).length, 1)
    const [history] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, old.id))
    assert.ok(history.deletedAt)
    assert.equal((await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, task.id)))[0].storyboardId, old.id)
    await assert.rejects(boards.updateAgentStoryboard(a, first.episode.id, first.drama.id, old.id, { title: 'bad' }), notFound)
  })

  await t.test('styles resolve deterministically: user override or system, never another owner', async () => {
    const system = await getDramaStylePrompt(a, first.drama.id)
    assert.ok(system.length)
    await db.insert(schema.stylePresets).values({ userId: b.userId, name: 'B override', value: '3d', prompt: 'private-B', createdAt: timestamp, updatedAt: timestamp })
    assert.equal(await getDramaStylePrompt(a, first.drama.id), system)
    await db.insert(schema.stylePresets).values({ userId: a.userId, name: 'A override', value: '3d', prompt: 'private-A', createdAt: timestamp, updatedAt: timestamp })
    assert.equal(await getDramaStylePrompt(a, first.drama.id), 'private-A')
    const saved = await prompts.saveCharacterPrompt(a, first.episode.id, first.drama.id, first.character.id, 'portrait')
    assert.equal(saved.finalPrompt, 'private-A, portrait')
    await db.update(schema.stylePresets).set({ isActive: false }).where(eq(schema.stylePresets.userId, a.userId))
    await assert.rejects(getDramaStylePrompt(a, first.drama.id), /停用/)
    await db.update(schema.stylePresets).set({ isActive: true }).where(eq(schema.stylePresets.userId, a.userId))
  })

  await t.test('shared Agent tools execute concurrently without sharing identity or targets', async () => {
    await assert.rejects(scriptTools.saveScript.execute!({ content: 'no identity' }, {}), /tenant context/)
    const wrongContext = new RequestContext()
    wrongContext.set('userId', b.userId)
    wrongContext.set('episodeId', first.episode.id)
    wrongContext.set('dramaId', first.drama.id)
    await assert.rejects(runWithTenant(a, () => scriptTools.saveScript.execute!({ content: 'bad' }, { requestContext: wrongContext })), /不一致/)
    await Promise.all([[a, first], [b, second]].map(async ([context, data]) => {
      const identity = context as typeof a
      const own = data as typeof first
      await runWithTenant(identity, async () => {
        const rc = await buildAgentRequestContext({ agentType: 'extractor', episodeId: own.episode.id, dramaId: own.drama.id })
        const toolContext = { requestContext: rc }
        await scriptTools.saveScript.execute!({ content: `private-script-${identity.userId}` }, toolContext)
        await extractTools.saveDedupProps.execute!({ props: [{ name: `tool-prop-${identity.userId}` }] }, toolContext)
        await imagePromptTools.saveCharacterFinalPrompt.execute!({ character_id: own.character.id, prompt: `private-prompt-${identity.userId}` }, toolContext)
        const visible = await imagePromptTools.readCharacters.execute!({}, toolContext)
        assert.ok('characters' in visible)
        if ('characters' in visible) assert.deepEqual(visible.characters.map(row => row.id), [own.character.id])
        await storyboardTools.saveStoryboards.execute!({ storyboards: [{ shot_number: 10, title: `tool-board-${identity.userId}` }] }, toolContext)
        await assert.rejects(imagePromptTools.savePropFinalPrompt.execute!({ prop_id: sameOwner.prop.id, prompt: 'bad' }, toolContext), notFound)
      })
    }))
    assert.equal((await scripts.requireAgentEpisode(a, first.episode.id, first.drama.id)).scriptContent, 'private-script-201')
    assert.equal((await scripts.requireAgentEpisode(b, second.episode.id, second.drama.id)).scriptContent, 'private-script-202')
  })

  await t.test('signed HTTP routes reject foreign IDs, preserve history and hide deleted storyboards', async () => {
    const { Hono } = await import('hono')
    const { createTenantAuth } = await import('../../src/middleware/tenant-auth.js')
    const { handleError } = await import('../../src/middleware/logger.js')
    const { signQunlRequest } = await import('../../src/security/qunl-signature.js')
    const { default: boardRoutes } = await import('../../src/routes/storyboards.js')
    const { default: episodeRoutes } = await import('../../src/routes/episodes.js')
    const app = new Hono()
    const secret = 'integration-test-secret-at-least-32-characters'
    app.onError(handleError)
    app.use('*', createTenantAuth(secret))
    app.route('/api/v1/storyboards', boardRoutes)
    app.route('/api/v1/episodes', episodeRoutes)
    const request = (userId: number, method: string, path: string, body?: unknown) => {
      const fields = { version: '1', userId: String(userId), method, path, query: '',
        timestamp: String(Math.floor(Date.now() / 1000)), requestId: `http-test-${userId}` }
      const headers = { 'X-Qunl-Auth-Version': '1', 'X-Qunl-User-Id': fields.userId,
        'X-Qunl-Timestamp': fields.timestamp, 'X-Qunl-Request-Id': fields.requestId,
        'X-Qunl-Signature': signQunlRequest(secret, fields), 'Content-Type': 'application/json' }
      return app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    }
    assert.equal((await app.request('/api/v1/storyboards', { method: 'POST' })).status, 401)
    assert.equal((await request(a.userId, 'POST', '/api/v1/storyboards', { episode_id: second.episode.id })).status, 404)
    assert.equal((await request(a.userId, 'POST', '/api/v1/storyboards', { episode_id: first.episode.id, user_id: b.userId })).status, 400)
    assert.equal((await request(a.userId, 'POST', '/api/v1/storyboards', { episode_id: first.episode.id, scene_id: sameOwner.scene.id })).status, 404)
    const response = await request(a.userId, 'POST', '/api/v1/storyboards', { episode_id: first.episode.id, storyboard_number: 20,
      character_ids: [first.character.id], prop_ids: [first.prop.id], duration: 0 })
    assert.equal(response.status, 201)
    const id = (await response.json()).data.id
    const path = `/api/v1/storyboards/${id}`
    assert.equal((await request(b.userId, 'PUT', path, { title: 'bad' })).status, 404)
    assert.equal((await request(b.userId, 'DELETE', path)).status, 404)
    assert.equal((await request(a.userId, 'PUT', path, { scene_id: second.scene.id })).status, 404)
    const otherVideo = 'static/videos/other.mp4'
    const ownVideo = 'static/videos/own.mp4'
    await db.insert(schema.sysTask).values({ userId: b.userId, type: 'video', status: 'completed', localPath: otherVideo,
      createdAt: timestamp, updatedAt: timestamp })
    const [task] = await db.insert(schema.sysTask).values({ userId: a.userId, type: 'video', storyboardId: id,
      status: 'completed', localPath: ownVideo, createdAt: timestamp, updatedAt: timestamp }).returning()
    assert.equal((await request(a.userId, 'PUT', path, { video_url: otherVideo })).status, 404)
    assert.equal((await request(a.userId, 'PUT', path, { video_url: ownVideo })).status, 200)
    const listPath = `/api/v1/episodes/${first.episode.id}/storyboards`
    assert.equal((await request(b.userId, 'GET', listPath)).status, 404)
    for (const endpoint of ['extract-status', 'video-prompts-status']) {
      assert.equal((await request(b.userId, 'GET', `/api/v1/episodes/${first.episode.id}/${endpoint}`)).status, 404)
      assert.equal((await request(a.userId, 'GET', `/api/v1/episodes/${first.episode.id}/${endpoint}`)).status, 200)
    }
    assert.equal((await request(a.userId, 'DELETE', path)).status, 200)
    assert.equal((await request(a.userId, 'PUT', path, { title: 'deleted' })).status, 404)
    const visible = (await (await request(a.userId, 'GET', listPath)).json()).data
    assert.equal(visible.some((row: { id: number }) => row.id === id), false)
    assert.equal((await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, task.id)))[0].storyboardId, id)
  })
})
