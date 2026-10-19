import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { Context } from 'hono'
import parseRange from 'range-parser'
import { MediaPathError, resolveTenantPath } from './tenant-storage.js'
import { requireCurrentTenant } from '../security/tenant-runtime.js'

const types: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/x-m4v',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.srt': 'text/plain; charset=utf-8', '.ass': 'text/plain; charset=utf-8',
}

export async function tenantMediaResponse(c: Context): Promise<Response> {
  const tenant = requireCurrentTenant()
  c.header('Cache-Control', 'private, no-cache')
  c.header('X-Content-Type-Options', 'nosniff')
  let relative: string
  try {
    relative = decodeURIComponent(c.req.path.slice('/static/'.length))
  } catch {
    return c.json({ code: 400, message: '非法媒体路径' }, 400)
  }
  if (relative.split('/').some(part => part.startsWith('.'))) return c.notFound()
  let target: string
  try { target = resolveTenantPath(relative) } catch (error) {
    if (error instanceof MediaPathError) return c.json({ code: 400, message: '非法媒体路径' }, 400)
    throw error
  }
  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return c.notFound()
    throw error
  }
  if (!stat.isFile()) return c.notFound()
  const type = types[path.extname(target).toLowerCase()]
  if (!type) return c.notFound()

  // Tenant identity is part of the validator, so an account switch cannot reuse a private response.
  const etag = `W/"${tenant.userId}-${stat.size}-${stat.mtimeMs}"`
  c.header('ETag', etag)
  c.header('Last-Modified', stat.mtime.toUTCString())
  c.header('Content-Type', type)
  c.header('Accept-Ranges', 'bytes')
  const ifNoneMatch = c.req.header('if-none-match')
  if (ifNoneMatch?.split(',').some(tag => tag.trim() === etag || tag.trim() === '*')) return c.body(null, 304)

  if (c.req.method === 'HEAD') {
    c.header('Content-Length', String(stat.size))
    return c.body(null, 200)
  }
  const range = c.req.header('range')
  const ifRange = c.req.header('if-range')
  // A weak validator cannot satisfy If-Range; a matching date can.
  const mayUseRange = !ifRange || (!ifRange.startsWith('W/') && !ifRange.startsWith('"') &&
    Number.isFinite(Date.parse(ifRange)) && Math.floor(stat.mtimeMs / 1000) <= Date.parse(ifRange) / 1000)
  if (range && mayUseRange) {
    const parsed = parseRange(stat.size, range, { combine: true })
    if (parsed === -1) {
      c.header('Content-Range', `bytes */${stat.size}`)
      return c.body(null, 416)
    }
    if (parsed !== -2 && parsed.type === 'bytes' && parsed.length === 1) {
      const { start, end } = parsed[0]
      c.header('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      c.header('Content-Length', String(end - start + 1))
      return c.body(Readable.toWeb(fs.createReadStream(target, { start, end })) as ReadableStream, 206)
    }
  }
  c.header('Content-Length', String(stat.size))
  return c.body(Readable.toWeb(fs.createReadStream(target)) as ReadableStream, 200)
}
