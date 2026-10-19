import { and, desc, eq, or } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { db, schema } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import { invalidInput, requireResourceId, resourceNotFound } from '../errors.js'
import { now } from '../../utils/response.js'
import { isSupportedProvider, type ModelPurpose } from '../system/model-provider-rules.js'

export type { ModelPurpose } from '../system/model-provider-rules.js'
export type ModelConfigFields = {
  serviceType: ModelPurpose; provider: string; name: string; baseUrl: string; apiKey: string
  model: string[]; priority?: number; isActive?: boolean; temperature?: number | null
}

export async function listModelConfigs(context: TenantContext, purpose?: ModelPurpose) {
  const { userId } = validateTenant(context)
  return db.select().from(schema.aiServiceConfigs).where(and(eq(schema.aiServiceConfigs.userId, userId),
    purpose === undefined ? undefined : eq(schema.aiServiceConfigs.serviceType, purpose)))
    .orderBy(desc(schema.aiServiceConfigs.priority), desc(schema.aiServiceConfigs.id))
}

export async function requireModelConfig(context: TenantContext, id: number, purpose?: ModelPurpose, activeOnly = false) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const [row] = await db.select().from(schema.aiServiceConfigs).where(and(eq(schema.aiServiceConfigs.userId, userId),
    eq(schema.aiServiceConfigs.id, id), purpose === undefined ? undefined : eq(schema.aiServiceConfigs.serviceType, purpose),
    activeOnly ? eq(schema.aiServiceConfigs.isActive, true) : undefined))
  if (!row) resourceNotFound()
  return row
}

export async function createModelConfig(context: TenantContext, fields: ModelConfigFields) {
  const { userId } = validateTenant(context)
  const timestamp = now()
  if (!isSupportedProvider(fields.serviceType, fields.provider)) invalidInput('不支持的 service_type/provider')
  const [row] = await db.insert(schema.aiServiceConfigs).values({ userId, serviceType: fields.serviceType,
    provider: fields.provider.trim().toLowerCase(), name: fields.name, baseUrl: fields.baseUrl, apiKey: fields.apiKey,
    model: JSON.stringify(fields.model), priority: fields.priority ?? 0, isActive: fields.isActive ?? true,
    settings: fields.temperature == null ? null : JSON.stringify({ temperature: fields.temperature }),
    createdAt: timestamp, updatedAt: timestamp }).returning()
  return row
}

export async function updateModelConfig(context: TenantContext, id: number, fields: Partial<ModelConfigFields>) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  return db.transaction(async tx => {
    const [existing] = await tx.select().from(schema.aiServiceConfigs).where(and(
      eq(schema.aiServiceConfigs.userId, userId), eq(schema.aiServiceConfigs.id, id))).for('update')
    if (!existing) resourceNotFound()
    if (!isSupportedProvider(fields.serviceType ?? existing.serviceType, fields.provider ?? existing.provider)) {
      invalidInput('不支持的 service_type/provider')
    }
    if (fields.serviceType !== undefined && fields.serviceType !== existing.serviceType) {
      const [episode] = await tx.select({ id: schema.episodes.id }).from(schema.episodes).where(and(
        eq(schema.episodes.userId, userId), or(eq(schema.episodes.imageConfigId, id), eq(schema.episodes.videoConfigId, id)))).limit(1)
      if (episode) throw new HTTPException(409, { message: '配置已被剧集使用，不能修改用途' })
    }
    const settings = existing.settings ? JSON.parse(existing.settings) : {}
    if (fields.temperature === null) delete settings.temperature
    else if (fields.temperature !== undefined) settings.temperature = fields.temperature
    const [row] = await tx.update(schema.aiServiceConfigs).set({ serviceType: fields.serviceType, provider: fields.provider?.trim().toLowerCase(),
      name: fields.name, baseUrl: fields.baseUrl, apiKey: fields.apiKey, priority: fields.priority, isActive: fields.isActive,
      model: fields.model === undefined ? undefined : JSON.stringify(fields.model),
      settings: Object.keys(settings).length ? JSON.stringify(settings) : null, updatedAt: now(),
    }).where(and(eq(schema.aiServiceConfigs.userId, userId), eq(schema.aiServiceConfigs.id, id))).returning()
    return row
  })
}

export async function deleteModelConfig(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  await db.transaction(async tx => {
    const [row] = await tx.select({ id: schema.aiServiceConfigs.id }).from(schema.aiServiceConfigs).where(and(
      eq(schema.aiServiceConfigs.userId, userId), eq(schema.aiServiceConfigs.id, id))).for('update')
    if (!row) resourceNotFound()
    const [episode] = await tx.select({ id: schema.episodes.id }).from(schema.episodes).where(and(
      eq(schema.episodes.userId, userId), or(eq(schema.episodes.imageConfigId, id), eq(schema.episodes.videoConfigId, id)))).limit(1)
    if (episode) throw new HTTPException(409, { message: '配置已被剧集使用，不能删除；可以停用' })
    await tx.delete(schema.aiServiceConfigs).where(and(eq(schema.aiServiceConfigs.userId, userId), eq(schema.aiServiceConfigs.id, id)))
  })
}
