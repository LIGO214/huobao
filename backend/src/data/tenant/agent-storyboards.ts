import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { db, schema, type DB } from '../../db/index.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import type { TenantContext } from '../../types/tenant.js'
import { now } from '../../utils/response.js'
import { requireAgentEpisode, requireEpisode } from './agent-scripts.js'
import { listAgentCharacters, listAgentProps, listAgentScenes } from './agent-assets.js'
import { invalidInput, requireResourceId, resourceNotFound } from '../errors.js'

type Transaction = Parameters<Parameters<DB['transaction']>[0]>[0]
export type AgentStoryboardFields = {
  shot_number?: number; title?: string; shot_type?: string; angle?: string; movement?: string
  location?: string; time?: string; description?: string; result?: string; atmosphere?: string
  image_prompt?: string; video_prompt?: string; bgm_prompt?: string; sound_effect?: string
  duration?: number; scene_id?: number | null; character_ids?: number[]; prop_ids?: number[]
}

export async function readAgentStoryboards(context: TenantContext, episodeId: number, dramaId: number) {
  const episode = await requireAgentEpisode(context, episodeId, dramaId)
  const [characters, scenes, props, entries] = await Promise.all([
    listAgentCharacters(context, episodeId, dramaId), listAgentScenes(context, episodeId, dramaId), listAgentProps(context, episodeId, dramaId),
    listEpisodeStoryboards(context, episodeId),
  ])
  return { episode, characters, scenes, props, entries }
}

export async function listEpisodeStoryboards(context: TenantContext, episodeId: number) {
  const { userId } = validateTenant(context)
  await requireEpisode(context, episodeId)
  const storyboards = await db.select().from(schema.storyboards).where(and(
    eq(schema.storyboards.userId, userId), eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt),
  )).orderBy(schema.storyboards.storyboardNumber)
  const entries = await Promise.all(storyboards.map(async row => {
    const [characterLinks, propLinks] = await Promise.all([
      db.select().from(schema.storyboardCharacters).where(and(eq(schema.storyboardCharacters.userId, userId), eq(schema.storyboardCharacters.storyboardId, row.id))),
      db.select().from(schema.storyboardProps).where(and(eq(schema.storyboardProps.userId, userId), eq(schema.storyboardProps.storyboardId, row.id))),
    ])
    return { row, characterIds: characterLinks.map(link => link.characterId), propIds: propLinks.map(link => link.propId) }
  }))
  return entries
}

function storyboardValues(fields: AgentStoryboardFields) {
  return { title: fields.title, shotType: fields.shot_type, angle: fields.angle, movement: fields.movement,
    location: fields.location, time: fields.time, description: fields.description, result: fields.result, atmosphere: fields.atmosphere,
    imagePrompt: fields.image_prompt, videoPrompt: fields.video_prompt, bgmPrompt: fields.bgm_prompt, soundEffect: fields.sound_effect,
    duration: fields.duration, sceneId: fields.scene_id, updatedAt: now() }
}

function bindingIds(ids: number[]): number[] {
  if (!Array.isArray(ids)) invalidInput('关联资源必须是数组')
  ids.forEach(requireResourceId)
  return [...new Set(ids)]
}

function validateDuration(duration: number | undefined) {
  if (duration !== undefined && (!Number.isSafeInteger(duration) || duration < 0)) invalidInput('分镜时长无效')
}

export async function requireStoryboard(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const [row] = await db.select().from(schema.storyboards).where(and(
    eq(schema.storyboards.userId, userId), eq(schema.storyboards.id, id), isNull(schema.storyboards.deletedAt),
  ))
  if (!row) resourceNotFound()
  const episode = await requireEpisode(context, row.episodeId)
  return { row, episode }
}

export async function createStoryboard(context: TenantContext, episodeId: number, fields: AgentStoryboardFields) {
  const { userId } = validateTenant(context)
  const episode = await requireEpisode(context, episodeId)
  requireResourceId(fields.shot_number!)
  validateDuration(fields.duration)
  return db.transaction(async tx => {
    await tx.select({ id: schema.episodes.id }).from(schema.episodes)
      .where(and(eq(schema.episodes.userId, userId), eq(schema.episodes.id, episodeId))).for('update')
    const bindings = await validateBindings(tx, userId, episode.dramaId, {
      ...fields, character_ids: fields.character_ids ?? [], prop_ids: fields.prop_ids ?? [],
    })
    const [row] = await tx.insert(schema.storyboards).values({ ...storyboardValues(fields), userId, episodeId,
      storyboardNumber: fields.shot_number!, duration: fields.duration ?? 10, createdAt: now() }).returning()
    await syncBindings(tx, userId, episodeId, row.id, bindings)
    await updateEpisodeDuration(tx, userId, episodeId)
    return { row, characterIds: bindings.characterIds!, propIds: bindings.propIds! }
  })
}

export async function deleteStoryboard(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  const { row } = await requireStoryboard(context, id)
  await db.transaction(async tx => {
    await tx.select({ id: schema.episodes.id }).from(schema.episodes)
      .where(and(eq(schema.episodes.userId, userId), eq(schema.episodes.id, row.episodeId))).for('update')
    const result = await tx.update(schema.storyboards).set({ deletedAt: now(), updatedAt: now() }).where(and(
      eq(schema.storyboards.userId, userId), eq(schema.storyboards.id, id), isNull(schema.storyboards.deletedAt),
    ))
    if (!result.rowCount) resourceNotFound()
    await updateEpisodeDuration(tx, userId, row.episodeId)
  })
}

export async function selectStoryboardVideo(context: TenantContext, id: number, videoUrl: string) {
  const { userId } = validateTenant(context)
  await requireStoryboard(context, id)
  await db.transaction(async tx => {
    const [task] = await tx.select({ id: schema.sysTask.id }).from(schema.sysTask).where(and(
      eq(schema.sysTask.userId, userId), eq(schema.sysTask.storyboardId, id), eq(schema.sysTask.type, 'video'),
      eq(schema.sysTask.status, 'completed'), or(eq(schema.sysTask.localPath, videoUrl), eq(schema.sysTask.resultUrl, videoUrl)),
    ))
    if (!task) resourceNotFound()
    const result = await tx.update(schema.storyboards).set({ videoUrl, updatedAt: now() }).where(and(
      eq(schema.storyboards.userId, userId), eq(schema.storyboards.id, id), isNull(schema.storyboards.deletedAt),
    ))
    if (!result.rowCount) resourceNotFound()
  })
}

async function validateBindings(tx: Transaction, userId: number, dramaId: number, fields: AgentStoryboardFields) {
  if (fields.scene_id != null) {
    requireResourceId(fields.scene_id)
    const [scene] = await tx.select({ id: schema.scenes.id }).from(schema.scenes).where(and(
      eq(schema.scenes.userId, userId), eq(schema.scenes.dramaId, dramaId), eq(schema.scenes.id, fields.scene_id), isNull(schema.scenes.deletedAt),
    ))
    if (!scene) resourceNotFound()
  }
  const characterIds = fields.character_ids === undefined ? undefined : bindingIds(fields.character_ids)
  const propIds = fields.prop_ids === undefined ? undefined : bindingIds(fields.prop_ids)
  if (characterIds?.length) {
    const rows = await tx.select({ id: schema.characters.id }).from(schema.characters).where(and(
      eq(schema.characters.userId, userId), eq(schema.characters.dramaId, dramaId), inArray(schema.characters.id, characterIds), isNull(schema.characters.deletedAt),
    ))
    if (rows.length !== characterIds.length) resourceNotFound()
  }
  if (propIds?.length) {
    const rows = await tx.select({ id: schema.props.id }).from(schema.props).where(and(
      eq(schema.props.userId, userId), eq(schema.props.dramaId, dramaId), inArray(schema.props.id, propIds), isNull(schema.props.deletedAt),
    ))
    if (rows.length !== propIds.length) resourceNotFound()
  }
  return { sceneId: fields.scene_id, characterIds, propIds }
}

async function syncBindings(tx: Transaction, userId: number, episodeId: number, storyboardId: number, bindings: Awaited<ReturnType<typeof validateBindings>>) {
  const timestamp = now()
  if (bindings.sceneId != null) {
    await tx.insert(schema.episodeScenes).values({ userId, episodeId, sceneId: bindings.sceneId, createdAt: timestamp }).onConflictDoNothing()
  }
  if (bindings.characterIds !== undefined) {
    await tx.delete(schema.storyboardCharacters).where(and(eq(schema.storyboardCharacters.userId, userId), eq(schema.storyboardCharacters.storyboardId, storyboardId)))
    for (const id of bindings.characterIds) {
      await tx.insert(schema.episodeCharacters).values({ userId, episodeId, characterId: id, createdAt: timestamp }).onConflictDoNothing()
      await tx.insert(schema.storyboardCharacters).values({ userId, storyboardId, characterId: id })
    }
  }
  if (bindings.propIds !== undefined) {
    await tx.delete(schema.storyboardProps).where(and(eq(schema.storyboardProps.userId, userId), eq(schema.storyboardProps.storyboardId, storyboardId)))
    for (const id of bindings.propIds) {
      await tx.insert(schema.episodeProps).values({ userId, episodeId, propId: id, createdAt: timestamp }).onConflictDoNothing()
      await tx.insert(schema.storyboardProps).values({ userId, storyboardId, propId: id })
    }
  }
}

async function updateEpisodeDuration(tx: Transaction, userId: number, episodeId: number) {
  const rows = await tx.select({ duration: schema.storyboards.duration }).from(schema.storyboards).where(and(
    eq(schema.storyboards.userId, userId), eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt),
  ))
  const totalDuration = rows.reduce((sum, row) => sum + (row.duration ?? 0), 0)
  await tx.update(schema.episodes).set({ duration: Math.ceil(totalDuration / 60), updatedAt: now() })
    .where(and(eq(schema.episodes.userId, userId), eq(schema.episodes.id, episodeId)))
  return totalDuration
}

export async function saveAgentStoryboards(context: TenantContext, episodeId: number, dramaId: number, entries: AgentStoryboardFields[], replaceExisting: boolean) {
  const { userId } = validateTenant(context)
  await requireAgentEpisode(context, episodeId, dramaId)
  if (!Array.isArray(entries)) invalidInput('storyboards 必须是数组')
  return db.transaction(async tx => {
    await tx.select({ id: schema.episodes.id }).from(schema.episodes)
      .where(and(eq(schema.episodes.userId, userId), eq(schema.episodes.id, episodeId), eq(schema.episodes.dramaId, dramaId))).for('update')
    if (replaceExisting) {
      await tx.update(schema.storyboards).set({ deletedAt: now(), updatedAt: now() }).where(and(
        eq(schema.storyboards.userId, userId), eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt),
      ))
    }
    for (const entry of entries) {
      if (entry.shot_number === undefined) invalidInput('镜号必填')
      requireResourceId(entry.shot_number)
      validateDuration(entry.duration)
      const [existing] = await tx.select({ id: schema.storyboards.id }).from(schema.storyboards).where(and(
        eq(schema.storyboards.userId, userId), eq(schema.storyboards.episodeId, episodeId), eq(schema.storyboards.storyboardNumber, entry.shot_number), isNull(schema.storyboards.deletedAt),
      ))
      const values = storyboardValues(entry)
      const bindings = await validateBindings(tx, userId, dramaId, { ...entry, character_ids: entry.character_ids ?? [], prop_ids: entry.prop_ids ?? [] })
      const [row] = existing
        ? await tx.update(schema.storyboards).set(values).where(and(eq(schema.storyboards.userId, userId), eq(schema.storyboards.id, existing.id))).returning({ id: schema.storyboards.id })
        : await tx.insert(schema.storyboards).values({ ...values, duration: entry.duration ?? 10, userId, episodeId,
          storyboardNumber: entry.shot_number, createdAt: now() }).returning({ id: schema.storyboards.id })
      await syncBindings(tx, userId, episodeId, row.id, bindings)
    }
    return updateEpisodeDuration(tx, userId, episodeId)
  })
}

export async function updateAgentStoryboard(context: TenantContext, episodeId: number, dramaId: number, id: number, fields: AgentStoryboardFields) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  await requireAgentEpisode(context, episodeId, dramaId)
  validateDuration(fields.duration)
  await db.transaction(async tx => {
    await tx.select({ id: schema.episodes.id }).from(schema.episodes)
      .where(and(eq(schema.episodes.userId, userId), eq(schema.episodes.id, episodeId))).for('update')
    const bindings = await validateBindings(tx, userId, dramaId, fields)
    const [row] = await tx.update(schema.storyboards).set(storyboardValues(fields)).where(and(
      eq(schema.storyboards.userId, userId), eq(schema.storyboards.episodeId, episodeId), eq(schema.storyboards.id, id), isNull(schema.storyboards.deletedAt),
    )).returning({ id: schema.storyboards.id })
    if (!row) resourceNotFound()
    await syncBindings(tx, userId, episodeId, id, bindings)
    await updateEpisodeDuration(tx, userId, episodeId)
  })
}
