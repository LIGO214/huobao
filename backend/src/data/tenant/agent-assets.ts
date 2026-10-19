import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import { requireAgentEpisode } from './agent-scripts.js'
import { resourceNotFound } from '../errors.js'
import { now } from '../../utils/response.js'

export async function listAgentCharacters(context: TenantContext, episodeId: number, dramaId: number) {
  const { userId } = validateTenant(context)
  await requireAgentEpisode(context, episodeId, dramaId)
  const rows = await db.select().from(schema.characters).where(and(
    eq(schema.characters.userId, userId), eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt),
  ))
  const links = await db.select().from(schema.episodeCharacters).where(and(eq(schema.episodeCharacters.userId, userId), eq(schema.episodeCharacters.episodeId, episodeId)))
  return { rows, linkedIds: new Set(links.map(link => link.characterId)) }
}

export async function listAgentScenes(context: TenantContext, episodeId: number, dramaId: number) {
  const { userId } = validateTenant(context)
  await requireAgentEpisode(context, episodeId, dramaId)
  const rows = await db.select().from(schema.scenes).where(and(
    eq(schema.scenes.userId, userId), eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt),
  ))
  const links = await db.select().from(schema.episodeScenes).where(and(eq(schema.episodeScenes.userId, userId), eq(schema.episodeScenes.episodeId, episodeId)))
  return { rows, linkedIds: new Set(links.map(link => link.sceneId)) }
}

export async function listAgentProps(context: TenantContext, episodeId: number, dramaId: number) {
  const { userId } = validateTenant(context)
  await requireAgentEpisode(context, episodeId, dramaId)
  const rows = await db.select().from(schema.props).where(and(
    eq(schema.props.userId, userId), eq(schema.props.dramaId, dramaId), isNull(schema.props.deletedAt),
  ))
  const links = await db.select().from(schema.episodeProps).where(and(eq(schema.episodeProps.userId, userId), eq(schema.episodeProps.episodeId, episodeId)))
  return { rows, linkedIds: new Set(links.map(link => link.propId)) }
}

type CharacterFields = Pick<typeof schema.characters.$inferInsert, 'name' | 'role' | 'description' | 'appearance' | 'styling'>
type SceneFields = Pick<typeof schema.scenes.$inferInsert, 'location' | 'time' | 'prompt' | 'lighting'>
type PropFields = Pick<typeof schema.props.$inferInsert, 'name' | 'type' | 'description' | 'finalPrompt'>

export async function saveAgentCharacter(context: TenantContext, episodeId: number, dramaId: number, fields: CharacterFields, id?: number) {
  const { userId } = validateTenant(context)
  await requireAgentEpisode(context, episodeId, dramaId)
  return db.transaction(async tx => {
    const timestamp = now()
    const values = { name: fields.name, role: fields.role, description: fields.description,
      appearance: fields.appearance, styling: fields.styling, updatedAt: timestamp }
    const [row] = id === undefined
      ? await tx.insert(schema.characters).values({ ...values, userId, dramaId, createdAt: timestamp }).returning()
      : await tx.update(schema.characters).set(values).where(and(
        eq(schema.characters.userId, userId), eq(schema.characters.dramaId, dramaId), eq(schema.characters.id, id), isNull(schema.characters.deletedAt),
      )).returning()
    if (!row) resourceNotFound()
    await tx.insert(schema.episodeCharacters).values({ userId, episodeId, characterId: row.id, createdAt: timestamp }).onConflictDoNothing()
    return row
  })
}

export async function saveAgentScene(context: TenantContext, episodeId: number, dramaId: number, fields: SceneFields, id?: number) {
  const { userId } = validateTenant(context)
  await requireAgentEpisode(context, episodeId, dramaId)
  return db.transaction(async tx => {
    const timestamp = now()
    const values = { location: fields.location, time: fields.time, prompt: fields.prompt, lighting: fields.lighting, updatedAt: timestamp }
    const [row] = id === undefined
      ? await tx.insert(schema.scenes).values({ ...values, userId, dramaId, createdAt: timestamp }).returning()
      : await tx.update(schema.scenes).set(values).where(and(
        eq(schema.scenes.userId, userId), eq(schema.scenes.dramaId, dramaId), eq(schema.scenes.id, id), isNull(schema.scenes.deletedAt),
      )).returning()
    if (!row) resourceNotFound()
    await tx.insert(schema.episodeScenes).values({ userId, episodeId, sceneId: row.id, createdAt: timestamp }).onConflictDoNothing()
    return row
  })
}

export async function saveAgentProp(context: TenantContext, episodeId: number, dramaId: number, fields: PropFields, id?: number) {
  const { userId } = validateTenant(context)
  await requireAgentEpisode(context, episodeId, dramaId)
  return db.transaction(async tx => {
    const timestamp = now()
    const values = { name: fields.name, type: fields.type, description: fields.description, finalPrompt: fields.finalPrompt, updatedAt: timestamp }
    const [row] = id === undefined
      ? await tx.insert(schema.props).values({ ...values, userId, dramaId, createdAt: timestamp }).returning()
      : await tx.update(schema.props).set(values).where(and(
        eq(schema.props.userId, userId), eq(schema.props.dramaId, dramaId), eq(schema.props.id, id), isNull(schema.props.deletedAt),
      )).returning()
    if (!row) resourceNotFound()
    await tx.insert(schema.episodeProps).values({ userId, episodeId, propId: row.id, createdAt: timestamp }).onConflictDoNothing()
    return row
  })
}
