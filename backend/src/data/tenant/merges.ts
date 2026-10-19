import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db, schema, getInsertId } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import { now } from '../../utils/response.js'

export async function requireMergeEpisode(context: TenantContext, episodeId: number, dramaId?: number) {
  const { userId } = validateTenant(context)
  const [episode] = await db.select().from(schema.episodes).where(and(
    eq(schema.episodes.userId, userId), eq(schema.episodes.id, episodeId), isNull(schema.episodes.deletedAt),
  ))
  if (!episode || (dramaId !== undefined && episode.dramaId !== dramaId)) throw new Error('剧集不存在')
  return episode
}

export async function getMergeInputs(context: TenantContext, episodeId: number, dramaId: number, storyboardIds?: number[]) {
  const { userId } = validateTenant(context)
  await requireMergeEpisode(context, episodeId, dramaId)
  const [drama] = await db.select().from(schema.dramas).where(and(
    eq(schema.dramas.userId, userId), eq(schema.dramas.id, dramaId), isNull(schema.dramas.deletedAt),
  ))
  if (!drama) throw new Error('项目不存在')
  if (storyboardIds?.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('分镜编号无效')
  const storyboards = await db.select().from(schema.storyboards).where(and(
    eq(schema.storyboards.userId, userId), eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt),
    storyboardIds?.length ? inArray(schema.storyboards.id, storyboardIds) : undefined,
  )).orderBy(schema.storyboards.storyboardNumber)
  if (storyboardIds?.length && storyboards.length !== new Set(storyboardIds).size) throw new Error('所选分镜不属于当前剧集')
  return { drama, storyboards }
}

export async function listEpisodeMerges(context: TenantContext, episodeId: number) {
  const { userId } = validateTenant(context)
  await requireMergeEpisode(context, episodeId)
  return db.select().from(schema.videoMerges).where(and(
    eq(schema.videoMerges.userId, userId), eq(schema.videoMerges.episodeId, episodeId), isNull(schema.videoMerges.deletedAt),
  )).orderBy(desc(schema.videoMerges.createdAt), desc(schema.videoMerges.id)).limit(30)
}

export async function createMerge(context: TenantContext, episodeId: number, dramaId: number, videos: string[]) {
  const { userId } = validateTenant(context)
  await requireMergeEpisode(context, episodeId, dramaId)
  return getInsertId(await db.insert(schema.videoMerges).values({
    userId, episodeId, dramaId, title: `Episode ${episodeId} Merge`, provider: 'ffmpeg',
    model: 'ffmpeg-concat-h264-aac', status: 'processing', scenes: JSON.stringify(videos), createdAt: now(),
  }).returning({ id: schema.videoMerges.id }))
}

export async function failMerge(context: TenantContext, mergeId: number, errorMsg: string) {
  const { userId } = validateTenant(context)
  const result = await db.update(schema.videoMerges).set({ status: 'failed', errorMsg })
    .where(and(eq(schema.videoMerges.userId, userId), eq(schema.videoMerges.id, mergeId)))
  if (!result.rowCount) throw new Error('合并任务不存在')
}

export async function completeMerge(context: TenantContext, mergeId: number, episodeId: number, mergedUrl: string, duration: number) {
  const { userId } = validateTenant(context)
  // Both records change together; a missing/deleted episode must not publish a completed task.
  await db.transaction(async tx => {
    const merge = await tx.update(schema.videoMerges).set({ status: 'completed', mergedUrl, duration, completedAt: now() })
      .where(and(eq(schema.videoMerges.userId, userId), eq(schema.videoMerges.id, mergeId), eq(schema.videoMerges.episodeId, episodeId)))
    const episode = await tx.update(schema.episodes).set({ videoUrl: mergedUrl, updatedAt: now() })
      .where(and(eq(schema.episodes.userId, userId), eq(schema.episodes.id, episodeId), isNull(schema.episodes.deletedAt)))
    if (!merge.rowCount || !episode.rowCount) throw new Error('合并任务或剧集不存在')
  })
}
