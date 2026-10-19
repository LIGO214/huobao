/**
 * 存储位置信息路由 — 设置页「存储位置」卡片数据源
 *
 * GET / → 当前模式(desktop/server)、目录路径、磁盘占用（分桶）与剩余空间。
 * 占用计算较重（全目录 walk）：内存缓存 60s TTL + stale-while-revalidate，
 * 过期时立即返回旧值并后台单飞重算（computing 防并发）；首次无值才同步等待。
 */
import { Hono } from 'hono'
import { getTenantDataRoot } from '../utils/paths.js'
import { dirUsage, volumeFreeBytes } from '../utils/dirsize.js'
import { success } from '../utils/response.js'
import { logTaskError } from '../utils/task-logger.js'

const app = new Hono()

const USAGE_TTL_MS = 60_000

interface UsageCache {
  usage: Awaited<ReturnType<typeof dirUsage>> | null
  computedAt: string | null
  computing: boolean
}
const caches = new Map<string, UsageCache>()

async function computeUsage(cache: UsageCache, dataRoot: string) {
  if (cache.computing) return
  cache.computing = true
  try {
    const usage = await dirUsage(dataRoot)
    cache.usage = usage
    cache.computedAt = new Date().toISOString()
  } finally {
    cache.computing = false
  }
}

app.get('/', async (c) => {
  const dataRoot = getTenantDataRoot()
  let cache = caches.get(dataRoot)
  if (!cache) {
    cache = { usage: null, computedAt: null, computing: false }
    caches.set(dataRoot, cache)
  }
  const fresh = cache.computedAt && (Date.now() - new Date(cache.computedAt).getTime()) < USAGE_TTL_MS
  let usageStale = false
  if (!fresh) {
    if (cache.usage) {
      // stale-while-revalidate：先回旧值，后台重算
      usageStale = true
      void computeUsage(cache, dataRoot).catch(() => logTaskError('Storage', 'usage-refresh'))
    } else {
      // 首次无值，同步等待首算（保证进入页面必有数据）
      await computeUsage(cache, dataRoot)
    }
  }

  return success(c, {
    mode: 'server',
    database: 'postgresql',
    dataDir: null,
    storageRoot: null,
    sqlitePath: null,
    usage: cache.usage,
    usageStale: usageStale || cache.computing,
    computedAt: cache.computedAt,
    freeBytes: await volumeFreeBytes(dataRoot),
  })
})

export default app
