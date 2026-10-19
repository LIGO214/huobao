import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('../..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const exists = (path) => existsSync(new URL(path, root))

test('MiniMax remains an optional video provider, not a default quick setup', () => {
  const ai = read('backend/src/services/ai.ts')
  const route = read('backend/src/routes/aiConfigs.ts')
  const registry = read('backend/src/services/adapters/registry.ts')
  const settings = read('frontend/app/pages/settings.vue')

  assert.match(ai, /supportedProviders/)
  assert.match(route, /p === 'minimax'/i)
  assert.match(registry, /minimax/i)
  assert.match(settings, /minimax/i)
  assert.doesNotMatch(settings, /provider:\s*['"]minimax['"][^\n]*name:\s*['"]Qunl/)
  assert.equal(exists('backend/src/services/adapters/minimax-image.ts'), false)
  assert.equal(exists('backend/src/services/adapters/minimax-video.ts'), true)
})

test('PostgreSQL startup uses the tenant schema and migration path', () => {
  const dbIndex = read('backend/src/db/index.ts')
  const schema = read('backend/src/db/schema.ts')
  const migration = read('backend/src/db/migrations/0000_web_tenant_schema.sql')
  const migrateScript = read('backend/scripts/migrate-postgres.ts')
  const env = read('backend/src/config/env.ts')

  assert.match(dbIndex, /from 'pg'/)
  assert.match(dbIndex, /drizzle\(pool, \{ schema \}\)/)
  assert.match(env, /必须使用 PostgreSQL URL/)
  assert.match(migrateScript, /drizzle-orm\/node-postgres\/migrator/)
  assert.match(migration, /CREATE TABLE "ai_service_configs"/)
  assert.match(migration, /CONSTRAINT "ai_configs_owner_id" UNIQUE\("user_id","id"\)/)
  assert.match(schema, /aiServiceConfigs = pgTable\('ai_service_configs'/)
  assert.match(schema, /userId: integer\('user_id'\)\.notNull\(\)/)
  assert.match(schema, /unique\('ai_configs_owner_id'\)\.on\(table\.userId, table\.id\)/)
})
