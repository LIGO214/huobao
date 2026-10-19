/** Loopback UI fixture with a disposable database, no Qunl sessions or paid models. */
import { serve } from '@hono/node-server'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Hono } from 'hono'
import { createTestDatabase } from './postgres.js'

const database = await createTestDatabase()
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = database.url
const { db, pool } = await import('../../src/db/index.js')
const { migrationsFolder } = await import('../../src/db/readiness.js')
await migrate(db, { migrationsFolder })
const { seedSystemStyles } = await import('../../src/data/system/seed.js')
await seedSystemStyles(db)
const { createTenantAuth } = await import('../../src/middleware/tenant-auth.js')
const { handleError } = await import('../../src/middleware/logger.js')
const { signQunlRequest } = await import('../../src/security/qunl-signature.js')
const { default: prompts } = await import('../../src/routes/prompts.js')
const { default: skills } = await import('../../src/routes/skills.js')
const { default: styles } = await import('../../src/routes/stylePresets.js')
const { default: settings } = await import('../../src/routes/settings.js')
const { default: modelConfigs, aiProviders } = await import('../../src/routes/aiConfigs.js')
const secret = 'browser-preview-only-isolated-database-secret'
const app = new Hono()
app.onError(handleError)
app.use('*', createTenantAuth(secret))
app.route('/api/v1/prompts', prompts)
app.route('/api/v1/skills', skills)
app.route('/api/v1/style-presets', styles)
app.route('/api/v1/settings', settings)
app.route('/api/v1/ai-configs', modelConfigs)
app.route('/api/v1/ai-providers', aiProviders)
let userId = 501
const server = serve({
  hostname: '127.0.0.1', port: 5679,
  fetch: async request => {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/__test/user') {
      const input = await request.json() as { user_id: number }
      if (![501, 502].includes(input.user_id)) return new Response(null, { status: 400 })
      userId = input.user_id
      return new Response(null, { status: 204 })
    }
    if (request.method === 'POST' && url.pathname === '/__test/stop') {
      setTimeout(async () => { await pool.end(); await database.dispose(); server.close() }, 100)
      return new Response(null, { status: 204 })
    }
    const headers = new Headers(request.headers)
    const fields = { version: '1', userId: String(userId), method: request.method, path: url.pathname,
      query: url.search, timestamp: String(Math.floor(Date.now() / 1000)), requestId: `preview-${userId}` }
    headers.set('X-Qunl-Auth-Version', fields.version)
    headers.set('X-Qunl-User-Id', fields.userId)
    headers.set('X-Qunl-Timestamp', fields.timestamp)
    headers.set('X-Qunl-Request-Id', fields.requestId)
    headers.set('X-Qunl-Signature', signQunlRequest(secret, fields))
    return app.fetch(new Request(request, { headers }))
  },
})
console.log('Isolated browser fixture on http://127.0.0.1:5679')
