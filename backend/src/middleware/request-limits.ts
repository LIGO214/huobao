import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { appConfig, type AppConfig } from '../config/env.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'

export function createRequestLimits(limits: AppConfig['limits'] = appConfig.limits) {
  const uploads = new Map<number, number>()
  let active = 0
  return createMiddleware(async (c, next) => {
    if (!c.req.raw.body) return next()
    const isUpload = c.req.path.startsWith('/api/v1/upload/')
    const maxBytes = isUpload ? limits.uploadMaxBytes + 64 * 1024 : limits.jsonMaxBytes
    const length = c.req.header('content-length')
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
      return c.json({ code: 413, message: '请求内容超过大小上限' }, 413)
    }
    const userId = requireCurrentTenant().userId
    if (isUpload) {
      if (active >= limits.uploadGlobal || (uploads.get(userId) ?? 0) >= limits.uploadPerUser) {
        return c.json({ code: 429, message: '上传任务已达到并发上限' }, 429)
      }
      active++
      uploads.set(userId, (uploads.get(userId) ?? 0) + 1)
    }
    const source = c.req.raw.body.getReader()
    let received = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await source.read()
          if (part.done) return controller.close()
          received += part.value.byteLength
          if (received > maxBytes) {
            controller.error(new HTTPException(413, { message: '请求内容超过大小上限' }))
            await source.cancel()
            return
          }
          controller.enqueue(part.value)
        } catch (error) {
          controller.error(error)
        }
      },
      cancel(reason) { return source.cancel(reason) },
    })
    c.req.raw = new Request(c.req.raw, { body, duplex: 'half' } as RequestInit)
    try {
      await next()
    } finally {
      if (isUpload) {
        active--
        const count = (uploads.get(userId) ?? 1) - 1
        if (count === 0) uploads.delete(userId)
        else uploads.set(userId, count)
      }
    }
  })
}

export const requestLimits = createRequestLimits()
