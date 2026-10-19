import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import { invalidInput, requireResourceId, resourceNotFound } from '../errors.js'
import { requireDrama } from './dramas.js'
import { requireEpisode } from './agent-scripts.js'
import { listAgentCharacters, listAgentProps, listAgentScenes } from './agent-assets.js'
import { listEpisodeStoryboards } from './agent-storyboards.js'
import { listEpisodeMerges } from './merges.js'
import { now } from '../../utils/response.js'

export async function createEpisode(context: TenantContext, dramaId: number, fields: {
  title?: string; resolution?: string; imageConfigId: number; videoConfigId: number
}) {
  const { userId } = validateTenant(context)
  await requireDrama(context, dramaId)
  requireResourceId(fields.imageConfigId)
  requireResourceId(fields.videoConfigId)
  if (fields.resolution !== undefined && !['480p', '720p', '1080p'].includes(fields.resolution)) invalidInput('视频分辨率无效')
  return db.transaction(async tx => {
    await tx.select({ id: schema.dramas.id }).from(schema.dramas)
      .where(and(eq(schema.dramas.userId, userId), eq(schema.dramas.id, dramaId))).for('update')
    for (const [serviceType, id] of [['image', fields.imageConfigId], ['video', fields.videoConfigId]] as const) {
      const [config] = await tx.select({ id: schema.aiServiceConfigs.id }).from(schema.aiServiceConfigs).where(and(
        eq(schema.aiServiceConfigs.userId, userId), eq(schema.aiServiceConfigs.id, id),
        eq(schema.aiServiceConfigs.serviceType, serviceType), eq(schema.aiServiceConfigs.isActive, true),
      ))
      if (!config) resourceNotFound()
    }
    const [previous] = await tx.select({ number: schema.episodes.episodeNumber }).from(schema.episodes).where(and(
      eq(schema.episodes.userId, userId), eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt),
    )).orderBy(desc(schema.episodes.episodeNumber)).limit(1)
    const number = (previous?.number ?? 0) + 1
    const timestamp = now()
    const [episode] = await tx.insert(schema.episodes).values({ userId, dramaId, episodeNumber: number,
      title: fields.title ?? `第${number}集`, resolution: fields.resolution ?? '720p', imageConfigId: fields.imageConfigId,
      videoConfigId: fields.videoConfigId, createdAt: timestamp, updatedAt: timestamp }).returning()
    return episode
  })
}

export async function updateEpisode(context: TenantContext, id: number, fields: {
  title?: string; content?: string; scriptContent?: string; description?: string; status?: string; resolution?: string
}) {
  const { userId } = validateTenant(context)
  await requireEpisode(context, id)
  if (fields.title !== undefined && !fields.title.trim()) invalidInput('剧集名称必填')
  if (fields.resolution !== undefined && !['480p', '720p', '1080p'].includes(fields.resolution)) invalidInput('视频分辨率无效')
  const result = await db.update(schema.episodes).set({ title: fields.title, content: fields.content, scriptContent: fields.scriptContent,
    description: fields.description, status: fields.status, resolution: fields.resolution, updatedAt: now() })
    .where(and(eq(schema.episodes.userId, userId), eq(schema.episodes.id, id), isNull(schema.episodes.deletedAt)))
  if (!result.rowCount) resourceNotFound()
}

export async function deleteEpisode(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  await requireEpisode(context, id)
  const result = await db.update(schema.episodes).set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(schema.episodes.userId, userId), eq(schema.episodes.id, id), isNull(schema.episodes.deletedAt)))
  if (!result.rowCount) resourceNotFound()
}

export async function listEpisodeCharacters(context: TenantContext, id: number) {
  const episode = await requireEpisode(context, id)
  const { rows, linkedIds } = await listAgentCharacters(context, id, episode.dramaId)
  return rows.filter(row => linkedIds.has(row.id))
}

export async function listEpisodeScenes(context: TenantContext, id: number) {
  const episode = await requireEpisode(context, id)
  const { rows, linkedIds } = await listAgentScenes(context, id, episode.dramaId)
  return rows.filter(row => linkedIds.has(row.id) || row.episodeId === id)
}

export async function listEpisodeProps(context: TenantContext, id: number) {
  const episode = await requireEpisode(context, id)
  const { rows, linkedIds } = await listAgentProps(context, id, episode.dramaId)
  return rows.filter(row => linkedIds.has(row.id))
}

export async function getEpisodeGenerationTasks(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  const episode = await requireEpisode(context, id)
  const [boards, scenes, characters, props, merges] = await Promise.all([
    listEpisodeStoryboards(context, id), listEpisodeScenes(context, id), listEpisodeCharacters(context, id),
    listEpisodeProps(context, id), listEpisodeMerges(context, id),
  ])
  const conditions = [
    boards.length ? inArray(schema.sysTask.storyboardId, boards.map(entry => entry.row.id)) : undefined,
    scenes.length ? inArray(schema.sysTask.sceneId, scenes.map(row => row.id)) : undefined,
    characters.length ? inArray(schema.sysTask.characterId, characters.map(row => row.id)) : undefined,
    props.length ? inArray(schema.sysTask.propId, props.map(row => row.id)) : undefined,
  ].filter(condition => condition !== undefined)
  const tasks = conditions.length ? await db.select().from(schema.sysTask).where(and(
    eq(schema.sysTask.userId, userId), eq(schema.sysTask.dramaId, episode.dramaId), or(...conditions),
  )).orderBy(desc(schema.sysTask.createdAt), desc(schema.sysTask.id)) : []
  return { tasks, merges }
}

export async function getEpisodePipeline(context: TenantContext, id: number) {
  const episode = await requireEpisode(context, id)
  const [characters, scenes, boards, merges] = await Promise.all([
    listEpisodeCharacters(context, id), listEpisodeScenes(context, id), listEpisodeStoryboards(context, id), listEpisodeMerges(context, id),
  ])
  const storyboards = boards.map(entry => entry.row)
  const images = storyboards.filter(row => row.composedImage).length
  const videos = storyboards.filter(row => row.videoUrl).length
  const stepStatus = (count: number, total?: number) => count > 0 && (total === undefined || count === total) ? 'done' : count ? 'partial' : 'pending'
  const merge = merges[0]
  return { episode_id: id, steps: {
    script_rewrite: { status: episode.scriptContent ? 'done' : episode.content ? 'ready' : 'pending' },
    extract_characters: { status: stepStatus(characters.length), count: characters.length },
    extract_scenes: { status: stepStatus(scenes.length), count: scenes.length },
    extract_storyboards: { status: stepStatus(storyboards.length), count: storyboards.length },
    generate_images: { status: stepStatus(images, storyboards.length), completed: images, total: storyboards.length },
    generate_videos: { status: stepStatus(videos, storyboards.length), completed: videos, total: storyboards.length },
    merge_episode: { status: merge?.status ?? 'pending', merged_url: merge?.mergedUrl },
  } }
}
