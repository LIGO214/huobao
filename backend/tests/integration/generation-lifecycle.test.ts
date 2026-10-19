import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { setTimeout } from 'node:timers/promises'
import { test } from 'node:test'
import sharp from 'sharp'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq } from 'drizzle-orm'
import { createTestDatabase } from '../helpers/postgres.js'

await test('Generation admission and result publication on PostgreSQL', async t => {
  const database = await createTestDatabase()
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = database.url
  process.env.HUOBAO_DATA_DIR = path.resolve('..', 'tmp', `generation-test-${randomUUID()}`)
  process.env.HUOBAO_IMAGE_MAX_CONCURRENCY = '2'
  process.env.HUOBAO_VIDEO_MAX_CONCURRENCY = '1'
  process.env.HUOBAO_GLOBAL_IMAGE_MAX_CONCURRENCY = '3'
  process.env.HUOBAO_GLOBAL_VIDEO_MAX_CONCURRENCY = '2'
  const { db, pool, schema } = await import('../../src/db/index.js')
  t.after(async () => { await pool.end(); await database.dispose() })
  const { migrationsFolder } = await import('../../src/db/readiness.js')
  await migrate(db, { migrationsFolder })
  const { createDrama, deleteDrama } = await import('../../src/data/tenant/dramas.js')
  const { createStoryboard } = await import('../../src/data/tenant/agent-storyboards.js')
  const { createCharacter, createScene, createProp } = await import('../../src/data/tenant/assets.js')
  const tasks = await import('../../src/data/tenant/tasks.js')
  const { generateImage, generateVideo } = await import('../../src/services/generation.js')
  const { runWithTenant } = await import('../../src/security/tenant-runtime.js')
  const { getAbsolutePath, thumbPathFor } = await import('../../src/utils/storage.js')
  const { createModelConfig } = await import('../../src/data/tenant/model-configs.js')
  const tenant = (userId: number) => ({ userId, authVersion: 1 as const, requestId: `generation-${userId}` })
  const a = tenant(801), b = tenant(802)
  const timestamp = new Date().toISOString()
  const configs = new Map<number, { image: number; video: number }>()
  for (const context of [a, b]) {
    const shared = { baseUrl: 'http://qunl.invalid', apiKey: `test-key-${context.userId}` }
    const image = await createModelConfig(context, { ...shared, serviceType: 'image', provider: 'openai', name: 'image', model: ['gpt-image-2'] })
    const video = await createModelConfig(context, { ...shared, serviceType: 'video', provider: 'volcengine', name: 'video', model: ['dreamina-seedance-2-0-mini-260615'] })
    configs.set(context.userId, { image: image.id, video: video.id })
  }
  function modelUser(init?: RequestInit) {
    const headers = new Headers(init?.headers)
    const userId = [a.userId, b.userId].find(id => headers.get('Authorization') === `Bearer test-key-${id}`)
    assert.ok(userId, 'The model request must use its owner\'s saved key')
    for (const name of headers.keys()) assert.ok(!name.toLowerCase().startsWith('x-qunl-'))
    assert.equal(init?.redirect, 'error')
    return userId
  }
  const status = (expected: number) => (error: unknown) => error instanceof Error && 'status' in error && error.status === expected
  async function fixture(context: typeof a) {
    const drama = await createDrama(context, { title: 'project' })
    const [episode] = await db.insert(schema.episodes).values({ userId: context.userId, dramaId: drama.id, episodeNumber: 1,
      title: 'episode', createdAt: timestamp, updatedAt: timestamp }).returning()
    const { row: board } = await createStoryboard(context, episode.id, { shot_number: 1 })
    const character = await createCharacter(context, drama.id, undefined, { name: 'character' })
    const scene = await createScene(context, drama.id, undefined, { location: 'room' })
    const prop = await createProp(context, drama.id, undefined, { name: 'prop' })
    return { drama, episode, board, character, scene, prop }
  }
  const own = await fixture(a), foreign = await fixture(b)
  const fields = { provider: 'openai', prompt: 'test', dramaId: own.drama.id, storyboardId: own.board.id }

  await t.test('generation services reject invalid targets before any network request', async t => {
    const network = t.mock.method(globalThis, 'fetch', async () => { assert.fail('Foreign target reached the model') })
    t.after(() => network.mock.restore())
    await assert.rejects(generateImage({ prompt: 'test' }), /tenant context/)
    await assert.rejects(runWithTenant(a, () => generateImage({ prompt: 'test', characterId: foreign.character.id })), status(404))
    await assert.rejects(runWithTenant(a, () => generateVideo({ prompt: 'test', storyboardId: foreign.board.id })), status(404))
    assert.equal(network.mock.callCount(), 0)
    assert.equal((await db.select().from(schema.sysTask)).length, 0)
  })

  for (const [type, perUser, global] of [['image', 2, 3], ['video', 1, 2]] as const) {
    await t.test(`${type} admission is atomic for both per-user and global limits`, async () => {
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => tasks.createGenerationTask(a, type, fields, {})))
      assert.equal(results.filter(result => result.status === 'fulfilled').length, perUser)
      for (const result of results) {
        if (result.status === 'fulfilled') await tasks.failGenerationTask(a, result.value.id)
        else assert.ok(status(429)(result.reason))
      }
      const owners = Array.from({ length: 8 }, (_, i) => tenant(810 + i))
      const submitted = await Promise.allSettled(owners.map(context => tasks.createGenerationTask(context, type, { provider: 'openai', prompt: 'test' }, {})))
      assert.equal(submitted.filter(result => result.status === 'fulfilled').length, global)
      for (const [i, result] of submitted.entries()) {
        if (result.status === 'fulfilled') await tasks.failGenerationTask(owners[i], result.value.id)
        else assert.ok(status(429)(result.reason))
      }
    })
  }

  await t.test('owned result publication is atomic, preserves zero, and cannot overwrite terminal jobs', async () => {
    const job = await tasks.createGenerationTask(a, 'image', { ...fields, characterId: own.character.id, sceneId: own.scene.id, propId: own.prop.id }, {})
    await assert.rejects(tasks.markGenerationPolling(b, job.id, 'upstream'), status(404))
    await assert.rejects(tasks.failGenerationTask(b, job.id), status(404))
    await assert.rejects(tasks.completeGenerationTask(b, job.id, { localPath: 'static/images/foreign.png' }), status(404))
    assert.equal(await tasks.markGenerationPolling(a, job.id, 'upstream'), true)
    assert.equal(await tasks.completeGenerationTask(a, job.id, { localPath: 'static/images/own.png', frameType: 'first_frame' }), true)
    assert.equal(await tasks.failGenerationTask(a, job.id), false)
    assert.equal(await tasks.markGenerationPolling(a, job.id, 'late'), false)
    assert.equal(await tasks.completeGenerationTask(a, job.id, { localPath: 'static/images/late.png' }), false)
    const saved = await tasks.requireGenerationTask(a, job.id)
    assert.equal(saved.status, 'completed')
    assert.equal(saved.localPath, 'static/images/own.png')
    assert.equal(saved.taskId, 'upstream')
    assert.equal((await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, own.board.id)))[0].firstFrameImage, saved.localPath)
    for (const [table, id] of [[schema.characters, own.character.id], [schema.scenes, own.scene.id], [schema.props, own.prop.id]] as const) {
      assert.equal((await db.select().from(table).where(eq(table.id, id)))[0].imageUrl, saved.localPath)
    }
    const video = await tasks.createGenerationTask(a, 'video', fields, {})
    await assert.rejects(tasks.completeGenerationTask(a, video.id, { localPath: 'static/videos/invalid.mp4', duration: 1.5 }))
    assert.equal((await tasks.requireGenerationTask(a, video.id)).status, 'processing')
    assert.equal(await tasks.completeGenerationTask(a, video.id, { localPath: 'static/videos/own.mp4', duration: 0 }), true)
    const [board] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, own.board.id))
    assert.equal(board.videoUrl, 'static/videos/own.mp4')
    assert.equal(board.duration, 0)
    assert.equal((await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, foreign.board.id)))[0].videoUrl, null)
  })

  await t.test('late video results remain in history without replacing a newer submission', async () => {
    const project = await fixture(a)
    const fields = { provider: 'volcengine', prompt: 'test', dramaId: project.drama.id, storyboardId: project.board.id }
    const old = await tasks.createGenerationTask(a, 'video', fields, {})
    // Simulate overlapping persisted jobs; publication must not depend on the current admission limit.
    const [newer] = await db.insert(schema.sysTask).values({ ...fields, userId: a.userId, type: 'video',
      status: 'processing', createdAt: timestamp, updatedAt: timestamp }).returning()
    await tasks.completeGenerationTask(a, newer.id, { localPath: 'static/videos/newer.mp4' })
    await tasks.completeGenerationTask(a, old.id, { localPath: 'static/videos/old.mp4' })
    assert.equal((await tasks.requireGenerationTask(a, old.id)).localPath, 'static/videos/old.mp4')
    assert.equal((await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, project.board.id)))[0].videoUrl, 'static/videos/newer.mp4')
    const first = await tasks.createGenerationTask(a, 'video', fields, {})
    const [last] = await db.insert(schema.sysTask).values({ ...fields, userId: a.userId, type: 'video',
      status: 'processing', createdAt: timestamp, updatedAt: timestamp }).returning()
    await tasks.completeGenerationTask(a, first.id, { localPath: 'static/videos/first.mp4' })
    assert.equal((await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, project.board.id)))[0].videoUrl, 'static/videos/newer.mp4')
    await tasks.completeGenerationTask(a, last.id, { localPath: 'static/videos/last.mp4' })
    assert.equal((await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, project.board.id)))[0].videoUrl, 'static/videos/last.mp4')
  })

  await t.test('deleted parents do not prevent terminal recording and capacity release', async () => {
    const project = await fixture(a)
    const job = await tasks.createGenerationTask(a, 'image', { provider: 'openai', prompt: 'test', dramaId: project.drama.id, characterId: project.character.id }, {})
    await deleteDrama(a, project.drama.id)
    assert.equal(await tasks.failGenerationTask(a, job.id), true)
    const replacement = await tasks.createGenerationTask(a, 'image', fields, {})
    await tasks.failGenerationTask(a, replacement.id)
  })

  await t.test('foreign and invalid images and deferred video references fail before admission', async t => {
    const before = (await db.select().from(schema.sysTask)).length
    const network = t.mock.method(globalThis, 'fetch', async () => { assert.fail('Invalid media reached the network') })
    t.after(() => network.mock.restore())
    for (const image of ['https://127.0.0.1/private.png', 'data:image/png;base64,YQ==', '../users/802/private.png']) {
      await assert.rejects(runWithTenant(a, () => generateImage({ prompt: 'test', referenceImages: [image] })), status(400))
    }
    await assert.rejects(runWithTenant(a, () => generateImage({ prompt: 'test', referenceImages: ['static/images/missing.png'] })), status(404))
    await assert.rejects(runWithTenant(a, () => generateImage({ prompt: 'test', referenceImages: Array(7).fill('static/images/ref.png') })), status(400))
    const { saveTenantBytes } = await import('../../src/utils/tenant-storage.js')
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#008866' } }).png().toBuffer()
    await runWithTenant(b, () => saveTenantBytes('static/images/b-only.png', png))
    await assert.rejects(runWithTenant(a, () => generateImage({ prompt: 'test', referenceImages: ['static/images/b-only.png'] })), status(404))
    for (const references of [{ imageUrl: 'static/images/ref.png' }, { firstFrameUrl: 'static/images/ref.png' },
      { lastFrameUrl: 'static/images/ref.png' }, { referenceImageUrls: ['static/images/ref.png'] },
      { referenceVideoUrls: ['static/videos/ref.mp4'] }, { referenceAudioUrls: ['static/audio/ref.mp3'] },
      { referenceFileUrl: 'https://model.invalid/ref' }, { referenceLinkUrl: 'https://model.invalid/ref' }, { referenceMode: 'first_frame' }]) {
      await assert.rejects(runWithTenant(a, () => generateVideo({ prompt: 'test', ...references })), status(400))
    }
    await assert.rejects(runWithTenant(a, () => generateVideo({ prompt: ' ' })), status(400))
    assert.equal(network.mock.callCount(), 0)
    assert.equal((await db.select().from(schema.sysTask)).length, before)
  })

  await t.test('owned image references use the saved key with multipart and no client network URLs', async t => {
    const { saveTenantBytes } = await import('../../src/utils/tenant-storage.js')
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#008866' } }).png().toBuffer()
    await runWithTenant(a, () => saveTenantBytes('static/images/ref.png', png))
    const network = t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(new URL(String(input)).pathname, '/v1/images/edits')
      assert.equal(modelUser(init), a.userId)
      assert.ok(init?.body instanceof FormData)
      assert.equal(init.body.get('model'), 'gpt-image-2')
      const images = init.body.getAll('image[]')
      assert.equal(images.length, 1)
      assert.ok(images[0] instanceof Blob)
      assert.equal(images[0].type, 'image/jpeg')
      return Response.json({ data: [{ b64_json: png.toString('base64') }] })
    })
    t.after(() => network.mock.restore())
    const id = await runWithTenant(a, () => generateImage({ prompt: 'test', model: 'gpt-image-2', referenceImages: ['/static/images/ref.png'], configId: configs.get(a.userId)!.image }))
    for (let attempt = 0; attempt < 200; attempt++) {
      const record = await tasks.requireGenerationTask(a, id)
      if (record.status !== 'processing') {
        assert.equal(record.status, 'completed')
        assert.equal(network.mock.callCount(), 1)
        return
      }
      await setTimeout(10)
    }
    assert.fail('Reference image generation did not finish')
  })

  await t.test('shared generation service uses separate saved keys and separate on-disk media', async t => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#008866' } }).png().toBuffer()
    const seen: number[] = []
    const network = t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      assert.equal(url.origin, 'http://qunl.invalid')
      assert.equal(url.pathname, '/v1/images/generations')
      const userId = modelUser(init)
      assert.equal(JSON.parse(init?.body as string).prompt, `private-prompt-${userId}`)
      seen.push(userId)
      await setTimeout(5)
      return Response.json({ data: [{ b64_json: png.toString('base64') }] })
    })
    t.after(() => network.mock.restore())
    const submissions = await Promise.all([[a, own], [b, foreign]].map(async ([identity, project]) => {
      const context = identity as typeof a, target = project as typeof own
      const id = await runWithTenant(context, () => generateImage({ prompt: `private-prompt-${context.userId}`, model: 'gpt-image-2',
        configId: configs.get(context.userId)!.image, characterId: target.character.id, dramaId: target.drama.id }))
      for (let attempt = 0; attempt < 200; attempt++) {
        const row = await tasks.requireGenerationTask(context, id)
        if (row.status !== 'processing') {
          assert.equal(row.status, 'completed')
          const absolute = runWithTenant(context, () => getAbsolutePath(row.localPath!))
          assert.ok(absolute.includes(`${path.sep}users${path.sep}${context.userId}${path.sep}`))
          assert.deepEqual(await fs.readFile(absolute), png)
          assert.ok((await fs.stat(runWithTenant(context, () => getAbsolutePath(thumbPathFor(row.localPath!))))).size > 0)
          const other = context.userId === a.userId ? b : a
          await assert.rejects(tasks.requireGenerationTask(other, id), status(404))
          return
        }
        await setTimeout(10)
      }
      assert.fail('Image generation did not finish')
    }))
    assert.equal(submissions.length, 2)
    assert.deepEqual(seen.sort(), [a.userId, b.userId])
  })

  await t.test('Mini video keeps user identity through v3 creation, polling, local media and publication', async t => {
    const binary = process.env.FFMPEG_BIN || createRequire(import.meta.url)('ffmpeg-static') as string
    const video = execFileSync(binary, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=64x64:r=10',
      '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 })
    const { posterPathFor } = await import('../../src/utils/video-poster.js')
    const calls: string[] = []
    const network = t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      if (url.origin === 'https://media.invalid') {
        assert.equal(headers.get('Authorization'), null)
        assert.equal(headers.get('X-Qunl-Signature'), null)
        calls.push(`download:${url.pathname}`)
        return new Response(new Uint8Array(video), { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.length) } })
      }
      assert.equal(url.origin, 'http://qunl.invalid')
      const userId = modelUser(init)
      calls.push(`${init?.method}:${userId}`)
      const base = '/api/v3/contents/generations/tasks'
      if (init?.method === 'POST') {
        assert.equal(url.pathname, base)
        const body = JSON.parse(init.body as string)
        assert.equal(body.model, 'dreamina-seedance-2-0-mini-260615')
        assert.equal(body.generate_audio, false)
        assert.deepEqual(body.content, [{ type: 'text', text: `video-prompt-${userId}` }])
        return Response.json({ id: `video-${userId}` })
      }
      assert.equal(init?.method, 'GET')
      assert.equal(url.pathname, `${base}/video-${userId}`)
      return Response.json({ id: `video-${userId}`, status: 'succeeded', content: { video_url: `https://media.invalid/${userId}.mp4` } })
    })
    t.after(() => network.mock.restore())
    await Promise.all([[a, own], [b, foreign]].map(async ([identity, project]) => {
      const context = identity as typeof a, target = project as typeof own
      const id = await runWithTenant(context, () => generateVideo({ prompt: `video-prompt-${context.userId}`,
        model: 'dreamina-seedance-2-0-mini-260615', configId: configs.get(context.userId)!.video, storyboardId: target.board.id, generateAudio: false, duration: 4 }))
      for (let attempt = 0; attempt < 250; attempt++) {
        const row = await tasks.requireGenerationTask(context, id)
        if (row.status !== 'processing') {
          assert.equal(row.status, 'completed')
          assert.equal(row.taskId, `video-${context.userId}`)
          const absolute = runWithTenant(context, () => getAbsolutePath(row.localPath!))
          assert.ok(absolute.includes(`${path.sep}users${path.sep}${context.userId}${path.sep}`))
          assert.deepEqual(await fs.readFile(absolute), video)
          const poster = runWithTenant(context, () => getAbsolutePath(posterPathFor(row.localPath!)))
          assert.ok((await fs.stat(poster)).size > 0)
          const [board] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, target.board.id))
          assert.equal(board.videoUrl, row.localPath)
          await assert.rejects(tasks.requireGenerationTask(context.userId === a.userId ? b : a, id), status(404))
          return
        }
        await setTimeout(100)
      }
      assert.fail('Video generation did not finish')
    }))
    assert.deepEqual(calls.sort(), [`POST:${a.userId}`, `POST:${b.userId}`, `GET:${a.userId}`, `GET:${b.userId}`,
      `download:/${a.userId}.mp4`, `download:/${b.userId}.mp4`].sort())
  })

  for (const failure of ['poll-http-error', 'missing-result', 'download-error'] as const) {
    await t.test(`video ${failure} stops polling and releases capacity without publishing a result`, async t => {
      let polls = 0, downloads = 0
      const network = t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.origin === 'https://media.invalid') {
          downloads++
          return new Response(null, { status: 403 })
        }
        assert.equal(url.origin, 'http://qunl.invalid')
        assert.equal(modelUser(init), a.userId)
        if (init?.method === 'POST') return Response.json({ id: `failure-${failure}` })
        polls++
        if (failure === 'poll-http-error') return new Response(null, { status: 401 })
        return Response.json({ status: 'succeeded', content: failure === 'missing-result' ? {} : { video_url: 'https://media.invalid/result.mp4' } })
      })
      t.after(() => network.mock.restore())
      const [before] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, own.board.id))
      const id = await runWithTenant(a, () => generateVideo({ prompt: 'test', storyboardId: own.board.id,
        model: 'dreamina-seedance-2-0-mini-260615', duration: 4, generateAudio: false }))
      let finished = false
      for (let attempt = 0; attempt < 200; attempt++) {
        const row = await tasks.requireGenerationTask(a, id)
        if (row.status !== 'processing') {
          assert.equal(row.status, 'failed')
          assert.equal(row.errorMsg, '生成任务执行失败')
          assert.equal(row.localPath, null)
          assert.equal(row.resultUrl, null)
          finished = true
          break
        }
        await setTimeout(100)
      }
      assert.equal(finished, true)
      assert.equal(polls, 1)
      assert.equal(downloads, failure === 'download-error' ? 1 : 0)
      const [after] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, own.board.id))
      assert.equal(after.videoUrl, before.videoUrl)
      const replacement = await tasks.createGenerationTask(a, 'video', fields, {})
      await tasks.failGenerationTask(a, replacement.id)
    })
  }
})
