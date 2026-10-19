import { createMiddleware } from 'hono/factory'
import type { MiddlewareHandler } from 'hono'
import { appConfig } from '../config/env.js'
import {
  QUNL_AUTH_VERSION,
  isTimestampFresh,
  verifyQunlSignature,
} from '../security/qunl-signature.js'
import { TENANT_CONTEXT_KEY } from '../security/request-context.js'
import { runWithTenant } from '../security/tenant-runtime.js'
import type { TenantContext } from '../types/tenant.js'

function unauthorized(c: Parameters<MiddlewareHandler>[0], message = '未通过火宝身份验证') {
  return c.json({ code: 401, message }, 401)
}

export function createTenantAuth(secret = appConfig.proxySecret): MiddlewareHandler {
  return createMiddleware(async (c, next) => {
    if (!secret) return unauthorized(c, '火宝身份验证未配置')

    const version = c.req.header('X-Qunl-Auth-Version') || ''
    const userId = c.req.header('X-Qunl-User-Id') || ''
    const timestamp = c.req.header('X-Qunl-Timestamp') || ''
    const requestId = c.req.header('X-Qunl-Request-Id') || ''
    const signature = c.req.header('X-Qunl-Signature') || ''

    const signedRequest = {
      version,
      userId,
      method: c.req.method,
      path: c.req.path,
      query: c.req.url.includes('?') ? c.req.url.slice(c.req.url.indexOf('?') + 1) : '',
      timestamp,
      requestId,
      signature,
    } as const

    if (
      version !== QUNL_AUTH_VERSION ||
      !isTimestampFresh(timestamp) ||
      !verifyQunlSignature(secret, signedRequest)
    ) {
      return unauthorized(c)
    }

    const numericUserId = Number(userId)
    if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) {
      return unauthorized(c)
    }

    const context: TenantContext = Object.freeze({
      userId: numericUserId,
      requestId,
      authVersion: 1,
    })
    c.set(TENANT_CONTEXT_KEY as never, context as never)
    await runWithTenant(context, () => next())
  })
}

export const tenantAuth = createTenantAuth()
