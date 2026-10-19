import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import type { TenantContext } from '../../types/tenant.js'
import { now } from '../../utils/response.js'
import { invalidInput, requireResourceId, resourceNotFound } from '../errors.js'

export type DramaFields = Pick<typeof schema.dramas.$inferInsert,
  'title' | 'description' | 'genre' | 'style' | 'aspectRatio' | 'tags' | 'metadata' | 'status'>
export type CharacterFields = Pick<typeof schema.characters.$inferInsert,
  'name' | 'role' | 'description' | 'appearance' | 'styling' | 'personality'>
export type EpisodeFields = Pick<typeof schema.episodes.$inferInsert,
  'title' | 'episodeNumber' | 'content' | 'scriptContent' | 'description' | 'duration' | 'status' | 'resolution'>

export async function requireDrama(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const [row] = await db.select().from(schema.dramas).where(and(
    eq(schema.dramas.userId, userId), eq(schema.dramas.id, id), isNull(schema.dramas.deletedAt),
  ))
  if (!row) resourceNotFound()
  return row
}

export async function listDramas(context: TenantContext) {
  const { userId } = validateTenant(context)
  return db.select().from(schema.dramas).where(and(eq(schema.dramas.userId, userId), isNull(schema.dramas.deletedAt)))
    .orderBy(desc(schema.dramas.updatedAt), desc(schema.dramas.id))
}

export async function getDramaContents(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  const drama = await requireDrama(context, id)
  const [episodes, characters, scenes, props] = await Promise.all([
    db.select().from(schema.episodes).where(and(eq(schema.episodes.userId, userId), eq(schema.episodes.dramaId, id), isNull(schema.episodes.deletedAt)))
      .orderBy(schema.episodes.episodeNumber),
    db.select().from(schema.characters).where(and(eq(schema.characters.userId, userId), eq(schema.characters.dramaId, id), isNull(schema.characters.deletedAt))),
    db.select().from(schema.scenes).where(and(eq(schema.scenes.userId, userId), eq(schema.scenes.dramaId, id), isNull(schema.scenes.deletedAt))),
    db.select().from(schema.props).where(and(eq(schema.props.userId, userId), eq(schema.props.dramaId, id), isNull(schema.props.deletedAt))),
  ])
  return { drama, episodes, characters, scenes, props }
}

export async function createDrama(context: TenantContext, fields: DramaFields) {
  const { userId } = validateTenant(context)
  if (typeof fields.title !== 'string' || !fields.title.trim()) invalidInput('项目名称必填')
  const timestamp = now()
  const [row] = await db.insert(schema.dramas).values({
    userId, title: fields.title.trim(), description: fields.description, genre: fields.genre, style: fields.style,
    aspectRatio: fields.aspectRatio, tags: fields.tags, metadata: fields.metadata, status: 'draft',
    createdAt: timestamp, updatedAt: timestamp,
  }).returning()
  return row
}

export async function updateDrama(context: TenantContext, id: number, fields: Partial<DramaFields>) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  if (fields.title !== undefined && (typeof fields.title !== 'string' || !fields.title.trim())) invalidInput('项目名称必填')
  const result = await db.update(schema.dramas).set({
    title: fields.title, description: fields.description, genre: fields.genre, style: fields.style,
    aspectRatio: fields.aspectRatio, tags: fields.tags, metadata: fields.metadata, status: fields.status, updatedAt: now(),
  }).where(and(eq(schema.dramas.userId, userId), eq(schema.dramas.id, id), isNull(schema.dramas.deletedAt)))
  if (!result.rowCount) resourceNotFound()
}

export async function deleteDrama(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const result = await db.update(schema.dramas).set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(schema.dramas.userId, userId), eq(schema.dramas.id, id), isNull(schema.dramas.deletedAt)))
  if (!result.rowCount) resourceNotFound()
}

export async function saveDramaCharacters(context: TenantContext, dramaId: number, entries: Array<{ id?: number } & CharacterFields>) {
  const { userId } = validateTenant(context)
  if (!Array.isArray(entries)) invalidInput('characters 必须是数组')
  await requireDrama(context, dramaId)
  await db.transaction(async tx => {
    const timestamp = now()
    for (const entry of entries) {
      if (typeof entry.name !== 'string' || !entry.name.trim()) invalidInput('角色名称必填')
      const fields = { name: entry.name.trim(), role: entry.role, description: entry.description,
        appearance: entry.appearance, styling: entry.styling, personality: entry.personality, updatedAt: timestamp }
      if (entry.id !== undefined) {
        requireResourceId(entry.id)
        const result = await tx.update(schema.characters).set(fields).where(and(
          eq(schema.characters.userId, userId), eq(schema.characters.dramaId, dramaId), eq(schema.characters.id, entry.id), isNull(schema.characters.deletedAt),
        ))
        if (!result.rowCount) resourceNotFound()
      } else {
        await tx.insert(schema.characters).values({ ...fields, userId, dramaId, createdAt: timestamp })
      }
    }
  })
}

export async function saveDramaEpisodes(context: TenantContext, dramaId: number, entries: Array<{ id?: number } & EpisodeFields>) {
  const { userId } = validateTenant(context)
  if (!Array.isArray(entries)) invalidInput('episodes 必须是数组')
  await requireDrama(context, dramaId)
  await db.transaction(async tx => {
    const timestamp = now()
    for (const entry of entries) {
      if (typeof entry.title !== 'string' || !entry.title.trim()) invalidInput('剧集名称必填')
      if (!Number.isSafeInteger(entry.episodeNumber) || entry.episodeNumber <= 0) invalidInput('集号无效')
      const fields = { title: entry.title.trim(), episodeNumber: entry.episodeNumber, content: entry.content,
        scriptContent: entry.scriptContent, description: entry.description, duration: entry.duration,
        status: entry.status, resolution: entry.resolution, updatedAt: timestamp }
      if (entry.id !== undefined) {
        requireResourceId(entry.id)
        const result = await tx.update(schema.episodes).set(fields).where(and(
          eq(schema.episodes.userId, userId), eq(schema.episodes.dramaId, dramaId), eq(schema.episodes.id, entry.id), isNull(schema.episodes.deletedAt),
        ))
        if (!result.rowCount) resourceNotFound()
      } else {
        await tx.insert(schema.episodes).values({ ...fields, userId, dramaId, createdAt: timestamp })
      }
    }
  })
}
