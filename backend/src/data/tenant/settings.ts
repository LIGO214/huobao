import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import type { TenantContext } from '../../types/tenant.js'
import { validateTenant } from '../../security/tenant-runtime.js'
import { now } from '../../utils/response.js'

export async function getUserSetting(context: TenantContext, key: string): Promise<string | undefined> {
  const { userId } = validateTenant(context)
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings)
    .where(and(eq(schema.appSettings.userId, userId), eq(schema.appSettings.key, key)))
  return row?.value
}

export async function saveUserSetting(context: TenantContext, key: string, value: string): Promise<void> {
  const { userId } = validateTenant(context)
  await db.insert(schema.appSettings).values({ userId, key, value, updatedAt: now() })
    .onConflictDoUpdate({ target: [schema.appSettings.userId, schema.appSettings.key], set: { value, updatedAt: now() } })
}
