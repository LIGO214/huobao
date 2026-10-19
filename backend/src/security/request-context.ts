import type { Context } from 'hono'
import type { TenantContext } from '../types/tenant.js'

export const TENANT_CONTEXT_KEY = 'tenant'

export function getTenantContext(c: Context): TenantContext {
  const context = c.get(TENANT_CONTEXT_KEY as never) as TenantContext | undefined
  if (!context) throw new Error('tenant context is missing')
  return context
}
