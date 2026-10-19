import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { eq, isNull } from 'drizzle-orm'
import { createTestDatabase } from '../helpers/postgres.js'

await test('PostgreSQL integration', async t => {

const database = await createTestDatabase()
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = database.url
const { db, pool, schema, getInsertId } = await import('../../src/db/index.js')
const { migrationsFolder, requireDatabaseReady } = await import('../../src/db/readiness.js')
const { seedSystemStyles } = await import('../../src/data/system/seed.js')
const { runWithTenant } = await import('../../src/security/tenant-runtime.js')
const { getContentLanguage, setContentLanguage } = await import('../../src/services/app-settings.js')
const merges = await import('../../src/data/tenant/merges.js')
t.after(async () => { await pool.end(); await database.dispose() })
const timestamp = new Date().toISOString()
const tenant = (userId: number) => ({ userId, authVersion: 1 as const, requestId: 'postgres-test' })
const postgresCode = (code: string) => (error: any) => error?.code === code || error?.cause?.code === code
let dramaA: number, dramaB: number, episodeA: number, episodeB: number
let characterA: number, characterB: number, propA: number, propB: number
let sceneA: number, sceneB: number, boardA: number, boardB: number

await t.test('empty PostgreSQL requires migration; migration and seeds can be applied twice', async () => {
  await assert.rejects(requireDatabaseReady(pool))
  await migrate(db, { migrationsFolder })
  await seedSystemStyles(db)
  await requireDatabaseReady(pool)
  const first = await db.select().from(schema.stylePresets).where(isNull(schema.stylePresets.userId))
  assert.equal(first.length, 8)
  await migrate(db, { migrationsFolder })
  await seedSystemStyles(db)
  const second = await db.select().from(schema.stylePresets).where(isNull(schema.stylePresets.userId))
  assert.equal(second.length, first.length)
})

await t.test('PostgreSQL inserts return real IDs and preserve zero and false values', async () => {
  const createDrama = async (userId: number) => getInsertId(await db.insert(schema.dramas).values({ userId, title: 'same title',
    totalDuration: 0, createdAt: timestamp, updatedAt: timestamp }).returning({ id: schema.dramas.id }))
  dramaA = await createDrama(101)
  dramaB = await createDrama(102)
  const createEpisode = async (userId: number, dramaId: number) => getInsertId(await db.insert(schema.episodes).values({ userId, dramaId,
    title: 'episode', episodeNumber: 1, createdAt: timestamp, updatedAt: timestamp }).returning({ id: schema.episodes.id }))
  episodeA = await createEpisode(101, dramaA)
  episodeB = await createEpisode(102, dramaB)
  const createCharacter = async (userId: number, dramaId: number) => getInsertId(await db.insert(schema.characters).values({ userId, dramaId,
    name: 'same name', createdAt: timestamp, updatedAt: timestamp }).returning({ id: schema.characters.id }))
  characterA = await createCharacter(101, dramaA)
  characterB = await createCharacter(102, dramaB)
  const createProp = async (userId: number, dramaId: number) => getInsertId(await db.insert(schema.props).values({ userId, dramaId,
    name: 'prop', createdAt: timestamp, updatedAt: timestamp }).returning({ id: schema.props.id }))
  propA = await createProp(101, dramaA)
  propB = await createProp(102, dramaB)
  const createScene = async (userId: number, dramaId: number) => getInsertId(await db.insert(schema.scenes).values({ userId, dramaId,
    location: 'room', time: 'day', prompt: 'room', createdAt: timestamp, updatedAt: timestamp }).returning({ id: schema.scenes.id }))
  sceneA = await createScene(101, dramaA)
  sceneB = await createScene(102, dramaB)
  const createBoard = async (userId: number, episodeId: number) => getInsertId(await db.insert(schema.storyboards).values({ userId, episodeId,
    storyboardNumber: 1, duration: 0, createdAt: timestamp, updatedAt: timestamp }).returning({ id: schema.storyboards.id }))
  boardA = await createBoard(101, episodeA)
  boardB = await createBoard(102, episodeB)
  await db.insert(schema.userAgentSkills).values({ userId: 101, agentType: 'extractor', skillId: 'off', name: 'off', content: 'text',
    enabled: false, sortOrder: 0, createdAt: timestamp, updatedAt: timestamp })
  const [skill] = await db.select().from(schema.userAgentSkills).where(eq(schema.userAgentSkills.userId, 101))
  assert.equal(skill.enabled, false)
  assert.equal(skill.sortOrder, 0)
  assert.notEqual(dramaA, dramaB)
  assert.throws(() => getInsertId([]))
})

await t.test('database rejects missing or invalid ownership without any API protection', async () => {
  await assert.rejects(pool.query('INSERT INTO dramas(title, created_at, updated_at) VALUES ($1,$2,$2)', ['missing', timestamp]), postgresCode('23502'))
  await assert.rejects(pool.query('INSERT INTO dramas(user_id,title,created_at,updated_at) VALUES (0,$1,$2,$2)', ['zero', timestamp]), postgresCode('23514'))
})

await t.test('parent foreign keys reject resources belonging to another user', async () => {
  await assert.rejects(db.insert(schema.episodes).values({ userId: 101, dramaId: dramaB, title: 'bad', episodeNumber: 2,
    createdAt: timestamp, updatedAt: timestamp }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.characters).values({ userId: 101, dramaId: dramaB, name: 'bad',
    createdAt: timestamp, updatedAt: timestamp }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.scenes).values({ userId: 101, dramaId: dramaA, episodeId: episodeB, location: 'bad', time: 'day', prompt: 'bad',
    createdAt: timestamp, updatedAt: timestamp }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.storyboards).values({ userId: 101, episodeId: episodeB, storyboardNumber: 2,
    createdAt: timestamp, updatedAt: timestamp }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.storyboards).values({ userId: 101, episodeId: episodeA, sceneId: sceneB, storyboardNumber: 2,
    createdAt: timestamp, updatedAt: timestamp }), postgresCode('23503'))
})

await t.test('association tables independently constrain both endpoints to the same owner', async () => {
  await assert.rejects(db.insert(schema.episodeCharacters).values({ userId: 101, episodeId: episodeB, characterId: characterA, createdAt: timestamp }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.episodeCharacters).values({ userId: 101, episodeId: episodeA, characterId: characterB, createdAt: timestamp }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.episodeProps).values({ userId: 101, episodeId: episodeA, propId: propB, createdAt: timestamp }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.episodeScenes).values({ userId: 101, episodeId: episodeA, sceneId: sceneB, createdAt: timestamp }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.storyboardCharacters).values({ userId: 101, storyboardId: boardB, characterId: characterA }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.storyboardCharacters).values({ userId: 101, storyboardId: boardA, characterId: characterB }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.storyboardProps).values({ userId: 101, storyboardId: boardA, propId: propB }), postgresCode('23503'))
  await db.insert(schema.episodeCharacters).values({ userId: 101, episodeId: episodeA, characterId: characterA, createdAt: timestamp })
  await db.insert(schema.storyboardProps).values({ userId: 101, storyboardId: boardA, propId: propA })
})

await t.test('generation, merge, agent and asset references cannot cross owners', async () => {
  await assert.rejects(db.insert(schema.sysTask).values({ userId: 101, type: 'image', characterId: characterB,
    createdAt: timestamp, updatedAt: timestamp }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.agentTasks).values({ userId: 101, dramaId: dramaA, episodeId: episodeB, agentType: 'extractor',
    createdAt: timestamp, updatedAt: timestamp }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.videoMerges).values({ userId: 101, dramaId: dramaB, episodeId: episodeA, createdAt: timestamp }), postgresCode('23503'))
  await assert.rejects(db.insert(schema.assets).values({ userId: 101, storyboardId: boardB, createdAt: timestamp, updatedAt: timestamp }), postgresCode('23503'))
})

await t.test('private configuration names and styles are unique per owner, system styles remain shared', async () => {
  for (const userId of [101, 102]) {
    await db.insert(schema.aiServiceConfigs).values({ userId, serviceType: 'text', name: 'same', baseUrl: 'https://example.test', apiKey: 'test-only',
      createdAt: timestamp, updatedAt: timestamp })
    await db.insert(schema.stylePresets).values({ userId, name: 'custom', value: '3d', prompt: 'user text', createdAt: timestamp, updatedAt: timestamp })
  }
  await assert.rejects(db.insert(schema.stylePresets).values({ userId: 101, name: 'dup', value: '3d', prompt: 'dup',
    createdAt: timestamp, updatedAt: timestamp }), postgresCode('23505'))
  const [otherConfig] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.userId, 102))
  await assert.rejects(db.update(schema.episodes).set({ imageConfigId: otherConfig.id }).where(eq(schema.episodes.id, episodeA)), postgresCode('23503'))
  assert.equal((await db.select().from(schema.stylePresets).where(isNull(schema.stylePresets.userId))).length, 8)
})

await t.test('language settings are independent and missing context fails before accessing data', async () => {
  await assert.rejects(getContentLanguage(), /tenant context/)
  await Promise.all([101, 102].map(userId => runWithTenant(tenant(userId), () => setContentLanguage(userId === 101 ? 'ja' : 'en'))))
  assert.equal(await runWithTenant(tenant(101), getContentLanguage), 'ja')
  assert.equal(await runWithTenant(tenant(102), getContentLanguage), 'en')
  assert.equal(await runWithTenant(tenant(103), getContentLanguage), 'zh')
})

await t.test('merge domain functions fail for cross-owner or cross-episode IDs and complete atomically', async () => {
  await assert.rejects(merges.requireMergeEpisode(tenant(101), episodeB), /不存在/)
  await assert.rejects(merges.getMergeInputs(tenant(101), episodeA, dramaB), /不存在/)
  await assert.rejects(merges.getMergeInputs(tenant(101), episodeA, dramaA, [boardB]), /当前剧集/)
  const id = await merges.createMerge(tenant(101), episodeA, dramaA, ['static/videos/test.mp4'])
  await assert.rejects(merges.failMerge(tenant(102), id, 'other user'), /不存在/)
  await merges.completeMerge(tenant(101), id, episodeA, 'static/merged/test.mp4', 5)
  assert.equal((await merges.listEpisodeMerges(tenant(101), episodeA))[0].status, 'completed')
  const [episode] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeA))
  assert.equal(episode.videoUrl, 'static/merged/test.mp4')
  const secondId = await merges.createMerge(tenant(101), episodeA, dramaA, [])
  await db.update(schema.episodes).set({ deletedAt: timestamp }).where(eq(schema.episodes.id, episodeA))
  await assert.rejects(merges.completeMerge(tenant(101), secondId, episodeA, 'static/merged/bad.mp4', 6), /不存在/)
  const [record] = await db.select().from(schema.videoMerges).where(eq(schema.videoMerges.id, secondId))
  assert.equal(record.status, 'processing')
})
})
