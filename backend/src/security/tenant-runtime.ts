import { AsyncLocalStorage } from 'node:async_hooks'
import type { TenantContext } from '../types/tenant.js'

const storage = new AsyncLocalStorage<TenantContext>()

export function validateTenant(context: TenantContext | undefined): TenantContext {
  if (!context || !Number.isSafeInteger(context.userId) || context.userId <= 0 ||
    context.authVersion !== 1 || typeof context.requestId !== 'string' ||
    !context.requestId || context.requestId.length > 128 || /[\r\n]/.test(context.requestId)) {
    throw new Error('valid tenant context is required')
  }
  return context
}

export function runWithTenant<T>(context: TenantContext, callback: () => T): T {
  return storage.run(Object.freeze({ ...validateTenant(context) }), callback)
}

export function getCurrentTenant(): TenantContext | undefined {
  return storage.getStore()
}

export function requireCurrentTenant(): TenantContext {
  return validateTenant(getCurrentTenant())
}
