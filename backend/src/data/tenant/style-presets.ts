import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import { invalidInput, requireResourceId, resourceNotFound } from '../errors.js'
import { now } from '../../utils/response.js'

export const styleFieldsInput = z.object({
  name: z.string().trim().min(1).max(120), prompt: z.string().trim().min(1).max(20_000),
  description: z.string().trim().max(2_000).nullable().optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(), is_active: z.boolean().optional(),
}).strict()
export const createStyleInput = styleFieldsInput.extend({ value: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,119}$/) })
export const updateStyleInput = styleFieldsInput.partial().refine(value => Object.keys(value).length > 0)

export async function listStylePresets(context: TenantContext, all = false) {
  const { userId } = validateTenant(context)
  const rows = await db.select().from(schema.stylePresets).where(or(isNull(schema.stylePresets.userId), eq(schema.stylePresets.userId, userId)))
    .orderBy(asc(schema.stylePresets.sortOrder), asc(schema.stylePresets.id))
  return all ? rows : rows.filter(row => row.isActive)
}

export async function createStylePreset(context: TenantContext, fields: z.infer<typeof createStyleInput>) {
  const { userId } = validateTenant(context)
  const input = createStyleInput.safeParse(fields)
  if (!input.success) invalidInput('风格预设参数无效')
  const body = input.data, timestamp = now()
  const [row] = await db.insert(schema.stylePresets).values({ userId, name: body.name, value: body.value,
    prompt: body.prompt, description: body.description, sortOrder: body.sort_order ?? 0, isActive: body.is_active ?? true,
    createdAt: timestamp, updatedAt: timestamp }).onConflictDoNothing().returning()
  if (!row) invalidInput('风格 key 已存在')
  return row
}

export async function updateStylePreset(context: TenantContext, id: number, fields: z.infer<typeof updateStyleInput>) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const input = updateStyleInput.safeParse(fields)
  if (!input.success) invalidInput('风格预设参数无效')
  const body = input.data
  const result = await db.update(schema.stylePresets).set({ name: body.name, prompt: body.prompt,
    description: body.description, sortOrder: body.sort_order, isActive: body.is_active, updatedAt: now() })
    .where(and(eq(schema.stylePresets.userId, userId), eq(schema.stylePresets.id, id)))
  if (!result.rowCount) resourceNotFound()
}

export async function deleteStylePreset(context: TenantContext, id: number) {
  const { userId } = validateTenant(context)
  requireResourceId(id)
  const result = await db.delete(schema.stylePresets).where(and(eq(schema.stylePresets.userId, userId), eq(schema.stylePresets.id, id)))
  if (!result.rowCount) resourceNotFound()
}
