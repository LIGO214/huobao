import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import path from 'path'
import { fileURLToPath } from 'url'

import dramas from './routes/dramas.js'
import episodes from './routes/episodes.js'
import storyboards from './routes/storyboards.js'
import scenes from './routes/scenes.js'
import characters from './routes/characters.js'
import tasks from './routes/tasks.js'
import upload from './routes/upload.js'
import aiConfigs, { aiProviders } from './routes/aiConfigs.js'
import stylePresets from './routes/stylePresets.js'
import prompts from './routes/prompts.js'
import agent from './routes/agent.js'
import merge from './routes/merge.js'
import skills from './routes/skills.js'
import props from './routes/props.js'
import settings from './routes/settings.js'
import storage from './routes/storage.js'
import { requestLogger, handleError } from './middleware/logger.js'
import { pool } from './db/index.js'
import { requireDatabaseReady } from './db/readiness.js'
import { markInterruptedLocalTasks } from './services/startup-recovery.js'
import { tenantMediaResponse } from './utils/media-response.js'
import { requestLimits } from './middleware/request-limits.js'
import { appConfig } from './config/env.js'
import { tenantAuth } from './middleware/tenant-auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const app = new Hono()

// Middleware
app.use('*', cors({
  origin: [...appConfig.corsOrigins],
  credentials: true,
}))
app.use('*', requestLogger)
app.onError(handleError)

// Health check（version 供部署巡检/更新检查核对当前运行版本）
app.get('/api/v1/health', (c) => c.json({
  status: 'ok',
  version: process.env.HUOBAO_VERSION || undefined,
  timestamp: new Date().toISOString(),
}))

// 配置代理密钥后，所有业务页面、API 和用户媒体都必须来自 Qunl 签名代理。
// 健康检查保留在鉴权中间件之前，供内部部署巡检使用。
app.use('*', tenantAuth)
app.use('/api/v1/*', requestLimits)
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  await next()
})

// API routes
const api = new Hono()
api.route('/dramas', dramas)
api.route('/episodes', episodes)
api.route('/storyboards', storyboards)
api.route('/scenes', scenes)
api.route('/characters', characters)
api.route('/tasks', tasks)
api.route('/upload', upload)
api.route('/ai-configs', aiConfigs)
api.route('/ai-providers', aiProviders)
api.route('/style-presets', stylePresets)
api.route('/prompts', prompts)
api.route('/agent', agent)
api.route('/merge', merge)
api.route('/skills', skills)
api.route('/props', props)
api.route('/storage', storage)
api.route('/settings', settings)

app.route('/api/v1', api)

// Serve static files (storage)
// 用户媒体属于租户私有数据，不能使用公共长期缓存。
app.on(['GET', 'HEAD'], '/static/*', tenantMediaResponse)

// Serve frontend (production build) — 桌面版由主进程注入 FRONTEND_DIST（resources/frontend）
const distPath = process.env.FRONTEND_DIST || path.join(projectRoot, 'frontend', 'dist')
app.use('*', serveStatic({ root: distPath }))
app.get('*', serveStatic({ root: distPath, path: 'index.html' }))

const port = appConfig.port
console.log(`🚀 Huobao Drama TS server on http://localhost:${port}`)

await requireDatabaseReady(pool)
await markInterruptedLocalTasks()

serve({ fetch: app.fetch, port })
