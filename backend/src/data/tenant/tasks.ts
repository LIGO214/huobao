import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { db, schema } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import { requireResourceId, resourceNotFound, invalidInput } from '../errors.js'
import { requireDrama } from './dramas.js'
import { requireStoryboard } from './agent-storyboards.js'
import { requireCharacter, requireScene, requireProp } from './assets.js'
import { appConfig } from '../../config/env.js'
import { now } from '../../utils/response.js'

export type GenerationTask = typeof schema.sysTask.$inferSelect

export type TaskType = 'image' | 'video'
export type TaskTargets = { dramaId?: number; storyboardId?: number; sceneId?: number; characterId?: number; propId?: number }
export type TaskFilters = { type?: TaskType; dramaId?: number; storyboardId?: number }

export async function createGenerationTask(context: TenantContext, type: TaskType,
  fields: TaskTargets & { provider: string; prompt: string; model?: string | null }, params: Record<string, unknown>) {
  const { userId } = validateTenant(context)
  if (type !== 'image' && type !== 'video') invalidInput('任务类型无效')
  const targets = await resolveTaskTargets(context, fields)
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73642, ${type === 'image' ? 2 : 3})`)
    const [running] = await tx.select({ total: sql<number>`count(*)::int`,
      own: sql<number>`count(*) FILTER (WHERE ${schema.sysTask.userId} = ${userId})::int` }).from(schema.sysTask)
      .where(and(eq(schema.sysTask.type, type), eq(schema.sysTask.status, 'processing')))
    const globalLimit = type === 'image' ? appConfig.limits.imageGlobal : appConfig.limits.videoGlobal
    const userLimit = type === 'image' ? appConfig.limits.imagePerUser : appConfig.limits.videoPerUser
    if (running.total >= globalLimit || running.own >= userLimit) {
      throw new HTTPException(429, { message: '生成任务已达到并发上限' })
    }
    const timestamp = now()
    const [row] = await tx.insert(schema.sysTask).values({ userId, type, dramaId: targets.dramaId,
      storyboardId: fields.storyboardId, characterId: fields.characterId, sceneId: fields.sceneId, propId: fields.propId,
      provider: fields.provider, prompt: fields.prompt, model: fields.model, params: JSON.stringify(params),
      status: 'processing', createdAt: timestamp, updatedAt: timestamp }).returning()
    return row
  })
}

/** Each supplied target must be visible and belong to the same project. */
export async function resolveTaskTargets(context: TenantContext, targets: TaskTargets) {
  validateTenant(context)
  let dramaId: number | undefined
  let episode: Awaited<ReturnType<typeof requireStoryboard>>['episode'] | undefined
  const matchProject = (value: number) => {
    if (dramaId !== undefined && dramaId !== value) resourceNotFound()
    dramaId = value
  }
  if (targets.dramaId !== undefined) matchProject((await requireDrama(context, targets.dramaId)).id)
  if (targets.storyboardId !== undefined) {
    const storyboard = await requireStoryboard(context, targets.storyboardId)
    episode = storyboard.episode
    matchProject(episode.dramaId)
  }
  if (targets.sceneId !== undefined) matchProject((await requireScene(context, targets.sceneId)).dramaId)
  if (targets.characterId !== undefined) matchProject((await requireCharacter(context, targets.characterId)).dramaId)
  if (targets.propId !== undefined) matchProject((await requireProp(context, targets.propId)).dramaId)
  return { dramaId, episode }
}

export async function requireGenerationTask(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const [row] = await db.select().from(schema.sysTask).where(and(eq(schema.sysTask.userId, userId), eq(schema.sysTask.id, id)))
  if (!row) resourceNotFound()
  return row
}

export async function requireTaskConfig(context: TenantContext, id: number, purpose: TaskType) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const [row] = await db.select().from(schema.aiServiceConfigs).where(and(eq(schema.aiServiceConfigs.userId, userId),
    eq(schema.aiServiceConfigs.id, id), eq(schema.aiServiceConfigs.serviceType, purpose), eq(schema.aiServiceConfigs.isActive, true)))
  if (!row) resourceNotFound()
  return row
}

export async function listGenerationTasks(context: TenantContext, filters: TaskFilters = {}) {
  const { userId } = validateTenant(context)
  if (filters.type !== undefined && filters.type !== 'image' && filters.type !== 'video') invalidInput('任务类型无效')
  if (filters.dramaId !== undefined) await requireDrama(context, filters.dramaId)
  if (filters.storyboardId !== undefined) await requireStoryboard(context, filters.storyboardId)
  return db.select().from(schema.sysTask).where(and(eq(schema.sysTask.userId, userId),
    filters.type === undefined ? undefined : eq(schema.sysTask.type, filters.type),
    filters.dramaId === undefined ? undefined : eq(schema.sysTask.dramaId, filters.dramaId),
    filters.storyboardId === undefined ? undefined : eq(schema.sysTask.storyboardId, filters.storyboardId),
  )).orderBy(desc(schema.sysTask.id))
}

/** History referenced by an asset cannot be removed; active work must be cancelled first. */
export async function deleteGenerationTask(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  await db.transaction(async tx => {
    const [row] = await tx.select().from(schema.sysTask).where(and(eq(schema.sysTask.userId, userId), eq(schema.sysTask.id, id))).for('update')
    if (!row) resourceNotFound()
    if (row.status !== 'completed' && row.status !== 'failed') {
      throw new HTTPException(409, { message: '任务仍在运行，不能删除' })
    }
    const [asset] = await tx.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.userId, userId),
      or(eq(schema.assets.imageGenId, id), eq(schema.assets.videoGenId, id))))
    if (asset) throw new HTTPException(409, { message: '任务仍被资产引用，不能删除' })
    await tx.delete(schema.sysTask).where(and(eq(schema.sysTask.userId, userId), eq(schema.sysTask.id, id)))
  })
}

export async function markGenerationPolling(context: TenantContext, id: number, taskId: string) {
  const { userId } = validateTenant(context)
  await requireGenerationTask(context, id)
  if (!taskId?.trim()) invalidInput('上游任务缺少 ID')
  const rows = await db.update(schema.sysTask).set({ taskId, updatedAt: now() }).where(and(
    eq(schema.sysTask.userId, userId), eq(schema.sysTask.id, id), eq(schema.sysTask.status, 'processing'),
  )).returning({ id: schema.sysTask.id })
  return rows.length === 1
}

export async function failGenerationTask(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  await requireGenerationTask(context, id)
  const timestamp = now()
  const rows = await db.update(schema.sysTask).set({ status: 'failed', errorMsg: '生成任务执行失败', updatedAt: timestamp, completedAt: timestamp })
    .where(and(eq(schema.sysTask.userId, userId), eq(schema.sysTask.id, id), eq(schema.sysTask.status, 'processing')))
    .returning({ id: schema.sysTask.id })
  return rows.length === 1
}

/** Publish the finished task and its linked assets together; late callbacks cannot replace a terminal result. */
export async function completeGenerationTask(context: TenantContext, id: number, result: {
  localPath: string; resultUrl?: string; frameType?: string; duration?: number | null
}) {
  const { userId } = validateTenant(context)
  const task = await requireGenerationTask(context, id)
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(73642, ${task.type === 'image' ? 2 : 3})`)
    const timestamp = now()
    const [record] = await tx.update(schema.sysTask).set({ localPath: result.localPath, resultUrl: result.resultUrl,
      status: 'completed', errorMsg: null, updatedAt: timestamp, completedAt: timestamp }).where(and(
      eq(schema.sysTask.userId, userId), eq(schema.sysTask.id, id), eq(schema.sysTask.status, 'processing'),
    )).returning()
    if (!record) return false
    if (record.type === 'image') {
      if (record.storyboardId != null) {
        const image = result.frameType === 'first_frame' ? { firstFrameImage: result.localPath } :
          result.frameType === 'last_frame' ? { lastFrameImage: result.localPath } : { composedImage: result.localPath }
        await tx.update(schema.storyboards).set({ ...image, updatedAt: timestamp }).where(and(
          eq(schema.storyboards.userId, userId), eq(schema.storyboards.id, record.storyboardId), isNull(schema.storyboards.deletedAt)))
      }
      if (record.characterId != null) await tx.update(schema.characters).set({ imageUrl: result.localPath, updatedAt: timestamp })
        .where(and(eq(schema.characters.userId, userId), eq(schema.characters.id, record.characterId), isNull(schema.characters.deletedAt)))
      if (record.sceneId != null) await tx.update(schema.scenes).set({ imageUrl: result.localPath, status: 'completed', updatedAt: timestamp })
        .where(and(eq(schema.scenes.userId, userId), eq(schema.scenes.id, record.sceneId), isNull(schema.scenes.deletedAt)))
      if (record.propId != null) await tx.update(schema.props).set({ imageUrl: result.localPath, updatedAt: timestamp })
        .where(and(eq(schema.props.userId, userId), eq(schema.props.id, record.propId), isNull(schema.props.deletedAt)))
    } else if (record.storyboardId != null) {
      const [newer] = await tx.select({ id: schema.sysTask.id }).from(schema.sysTask).where(and(
        eq(schema.sysTask.userId, userId), eq(schema.sysTask.type, 'video'), eq(schema.sysTask.storyboardId, record.storyboardId),
        gt(schema.sysTask.id, record.id))).limit(1)
      if (newer) return true
      await tx.update(schema.storyboards).set({ videoUrl: result.localPath, duration: result.duration ?? undefined, updatedAt: timestamp })
        .where(and(eq(schema.storyboards.userId, userId), eq(schema.storyboards.id, record.storyboardId), isNull(schema.storyboards.deletedAt)))
    }
    return true
  })
}
