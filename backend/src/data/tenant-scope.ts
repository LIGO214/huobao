import { and, eq, isNull, or, type SQL } from 'drizzle-orm'
import { requireCurrentTenant } from '../security/tenant-runtime.js'

export function currentTenantId(): number {
  return requireCurrentTenant().userId
}

export function scopedWhere<T>(column: T, condition?: SQL): SQL {
  const owner = eq(column as never, currentTenantId())
  return condition ? and(owner, condition)! : owner
}

export function scopedValues<T extends Record<string, unknown>>(values: T): T & { userId: number } {
  return { ...values, userId: currentTenantId() }
}

export function systemOrTenantWhere<T>(column: T, condition?: SQL): SQL {
  const owner = or(isNull(column as never), eq(column as never, currentTenantId()))!
  return condition ? and(owner, condition)! : owner
}
