import type { MiddlewareHandler, ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { StorageLimitError } from '../utils/tenant-storage.js'
import { logTaskError, logTaskProgress } from '../utils/task-logger.js'
import { TENANT_CONTEXT_KEY } from '../security/request-context.js'
import { runWithTenant } from '../security/tenant-runtime.js'
import type { TenantContext } from '../types/tenant.js'

/**
 * 全局日志中间件 — 打印请求方法/路径/状态/耗时。
 * 请求正文可能包含 Prompt、模型配置或其他用户内容，禁止写入日志。
 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const method = c.req.method
  const start = performance.now()

  await next()

  const ms = Math.round(performance.now() - start)
  const status = c.res.status
  const record = () => logTaskProgress('HTTP', 'request', { method, status, elapsedMs: ms })
  const tenant = c.get(TENANT_CONTEXT_KEY as never) as TenantContext | undefined
  if (tenant) runWithTenant(tenant, record)
  else record()
}

/**
 * Internal errors may include SQL parameters or model payloads; never expose them.
 */
export const handleError: ErrorHandler = (error, c) => {
  const expected = error instanceof HTTPException || error instanceof StorageLimitError
  const status = expected ? error.status : 500
  const message = expected && status < 500 ? error.message : '服务器内部错误'
  logTaskError('HTTP', 'request', { method: c.req.method, status })
  return c.json({ code: status, message }, status as 500)
}

export const errorHandler: MiddlewareHandler = async (c, next) => {
  try {
    await next()
  } catch (error) {
    return handleError(error instanceof Error ? error : new Error(String(error)), c)
  }
}
