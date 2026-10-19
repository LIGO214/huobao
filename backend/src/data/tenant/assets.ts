import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import { requireResourceId, resourceNotFound, invalidInput } from '../errors.js'
import { requireDrama } from './dramas.js'
import { requireAgentEpisode } from './agent-scripts.js'
import { validateAssetImage } from '../../utils/asset-media.js'
import { now } from '../../utils/response.js'

type MediaFields = { imageUrl?: string | null; localPath?: string | null; finalPrompt?: string | null }
export type CharacterFields = { name: string; role?: string | null; description?: string | null; appearance?: string | null; styling?: string | null }
export type SceneFields = { location: string; time?: string; prompt?: string; lighting?: string | null }
export type PropFields = { name: string; type?: string | null; description?: string | null }

async function requireAssetParent(context: TenantContext, dramaId: number, episodeId?: number) {
  await requireDrama(context, dramaId)
  if (episodeId !== undefined) await requireAgentEpisode(context, episodeId, dramaId)
}

export async function requireCharacter(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const [row] = await db.select().from(schema.characters).where(and(
    eq(schema.characters.userId, userId), eq(schema.characters.id, id), isNull(schema.characters.deletedAt),
  ))
  if (!row) resourceNotFound()
  await requireDrama(context, row.dramaId)
  return row
}

export async function requireScene(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const [row] = await db.select().from(schema.scenes).where(and(
    eq(schema.scenes.userId, userId), eq(schema.scenes.id, id), isNull(schema.scenes.deletedAt),
  ))
  if (!row) resourceNotFound()
  await requireAssetParent(context, row.dramaId, row.episodeId ?? undefined)
  return row
}

export async function requireProp(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const [row] = await db.select().from(schema.props).where(and(
    eq(schema.props.userId, userId), eq(schema.props.id, id), isNull(schema.props.deletedAt),
  ))
  if (!row) resourceNotFound()
  await requireDrama(context, row.dramaId)
  return row
}

export async function createCharacter(context: TenantContext, dramaId: number, episodeId: number | undefined, fields: CharacterFields) {
  const { userId } = validateTenant(context)
  await requireAssetParent(context, dramaId, episodeId)
  if (!fields.name?.trim()) invalidInput('角色名称必填')
  return db.transaction(async tx => {
    const timestamp = now()
    const [row] = await tx.insert(schema.characters).values({ userId, dramaId, name: fields.name.trim(),
      role: fields.role, description: fields.description, appearance: fields.appearance, styling: fields.styling,
      createdAt: timestamp, updatedAt: timestamp }).returning()
    if (episodeId !== undefined) await tx.insert(schema.episodeCharacters).values({ userId, episodeId, characterId: row.id, createdAt: timestamp })
    return row
  })
}

export async function createScene(context: TenantContext, dramaId: number, episodeId: number | undefined, fields: SceneFields) {
  const { userId } = validateTenant(context)
  await requireAssetParent(context, dramaId, episodeId)
  if (!fields.location?.trim()) invalidInput('场景地点必填')
  return db.transaction(async tx => {
    const timestamp = now()
    const [row] = await tx.insert(schema.scenes).values({ userId, dramaId, episodeId, location: fields.location.trim(),
      time: fields.time ?? '', prompt: fields.prompt ?? fields.location.trim(), lighting: fields.lighting,
      createdAt: timestamp, updatedAt: timestamp }).returning()
    if (episodeId !== undefined) await tx.insert(schema.episodeScenes).values({ userId, episodeId, sceneId: row.id, createdAt: timestamp })
    return row
  })
}

export async function createProp(context: TenantContext, dramaId: number, episodeId: number | undefined, fields: PropFields) {
  const { userId } = validateTenant(context)
  await requireAssetParent(context, dramaId, episodeId)
  if (!fields.name?.trim()) invalidInput('道具名称必填')
  return db.transaction(async tx => {
    const timestamp = now()
    const [row] = await tx.insert(schema.props).values({ userId, dramaId, name: fields.name.trim(),
      type: fields.type, description: fields.description, createdAt: timestamp, updatedAt: timestamp }).returning()
    if (episodeId !== undefined) await tx.insert(schema.episodeProps).values({ userId, episodeId, propId: row.id, createdAt: timestamp })
    return row
  })
}

export async function updateCharacter(context: TenantContext, id: number, fields: Partial<CharacterFields> & MediaFields) {
  const { userId } = validateTenant(context)
  const existing = await requireCharacter(context, id)
  if (fields.name !== undefined && !fields.name.trim()) invalidInput('角色名称必填')
  const media = await validateAssetImage(context, fields.imageUrl, fields.localPath)
  const changed = (fields.appearance !== undefined && fields.appearance !== existing.appearance) ||
    (fields.styling !== undefined && fields.styling !== existing.styling)
  const result = await db.update(schema.characters).set({ name: fields.name, role: fields.role,
    description: fields.description, appearance: fields.appearance, styling: fields.styling, ...media,
    finalPrompt: fields.finalPrompt !== undefined ? fields.finalPrompt : changed ? null : undefined, updatedAt: now(),
  }).where(and(eq(schema.characters.userId, userId), eq(schema.characters.id, id), isNull(schema.characters.deletedAt)))
  if (!result.rowCount) resourceNotFound()
}

export async function updateScene(context: TenantContext, id: number, fields: Partial<SceneFields> & MediaFields) {
  const { userId } = validateTenant(context)
  const existing = await requireScene(context, id)
  if (fields.location !== undefined && !fields.location.trim()) invalidInput('场景地点必填')
  const media = await validateAssetImage(context, fields.imageUrl, fields.localPath)
  const changed = (fields.location !== undefined && fields.location !== existing.location) ||
    (fields.time !== undefined && fields.time !== existing.time) ||
    (fields.prompt !== undefined && fields.prompt !== existing.prompt) ||
    (fields.lighting !== undefined && fields.lighting !== existing.lighting)
  const result = await db.update(schema.scenes).set({ location: fields.location, time: fields.time, prompt: fields.prompt,
    lighting: fields.lighting, finalPrompt: fields.finalPrompt !== undefined ? fields.finalPrompt : changed ? null : undefined, ...media,
    status: media.imageUrl ? 'completed' : media.imageUrl === null ? 'pending' : undefined, updatedAt: now(),
  }).where(and(eq(schema.scenes.userId, userId), eq(schema.scenes.id, id), isNull(schema.scenes.deletedAt)))
  if (!result.rowCount) resourceNotFound()
}

export async function updateProp(context: TenantContext, id: number, fields: Partial<PropFields> & MediaFields) {
  const { userId } = validateTenant(context)
  const existing = await requireProp(context, id)
  const media = await validateAssetImage(context, fields.imageUrl, fields.localPath)
  if (fields.name !== undefined && !fields.name.trim()) invalidInput('道具名称必填')
  const changed = (fields.name !== undefined && fields.name !== existing.name) ||
    (fields.type !== undefined && fields.type !== existing.type) ||
    (fields.description !== undefined && fields.description !== existing.description)
  const result = await db.update(schema.props).set({ name: fields.name, type: fields.type, description: fields.description,
    finalPrompt: fields.finalPrompt !== undefined ? fields.finalPrompt : changed ? null : undefined, ...media, updatedAt: now(),
  }).where(and(eq(schema.props.userId, userId), eq(schema.props.id, id), isNull(schema.props.deletedAt)))
  if (!result.rowCount) resourceNotFound()
}

export async function deleteCharacter(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  await requireCharacter(context, id)
  const result = await db.update(schema.characters).set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(schema.characters.userId, userId), eq(schema.characters.id, id), isNull(schema.characters.deletedAt)))
  if (!result.rowCount) resourceNotFound()
}

export async function deleteScene(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  await requireScene(context, id)
  const result = await db.update(schema.scenes).set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(schema.scenes.userId, userId), eq(schema.scenes.id, id), isNull(schema.scenes.deletedAt)))
  if (!result.rowCount) resourceNotFound()
}

export async function deleteProp(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  await requireProp(context, id)
  const result = await db.update(schema.props).set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(schema.props.userId, userId), eq(schema.props.id, id), isNull(schema.props.deletedAt)))
  if (!result.rowCount) resourceNotFound()
}
