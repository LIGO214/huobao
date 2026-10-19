import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadAppConfig } from '../src/config/env.js'

test('loads typed local configuration and freezes the result', () => {
  const config = loadAppConfig({
    NODE_ENV: 'test',
    PORT: '5680',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/huobao',
    HUOBAO_PROXY_SECRET: 'x'.repeat(32),
    HUOBAO_DATA_DIR: './data',
    HUOBAO_CORS_ORIGINS: 'http://localhost:3013, http://localhost:5679',
  })

  assert.equal(config.port, 5680)
  assert.equal(config.databaseUrl, 'postgres://user:pass@localhost:5432/huobao')
  assert.equal(config.modelConfigSource, 'user')
  assert.deepEqual(config.corsOrigins, ['http://localhost:3013', 'http://localhost:5679'])
  assert.equal(Object.isFrozen(config), true)
  assert.equal(Object.isFrozen(config.limits), true)
})

test('rejects invalid numeric and URL values', () => {
  assert.throws(
    () => loadAppConfig({ PORT: '0', DATABASE_URL: 'not-a-url' }),
    /火宝配置无效/,
  )
})

test('strict Web mode requires PostgreSQL and proxy secret', () => {
  assert.throws(
    () => loadAppConfig({}, { requireDatabase: true }),
    /必须设置 DATABASE_URL/,
  )
  assert.throws(
    () => loadAppConfig({ DATABASE_URL: 'postgres://localhost/huobao' }, { requireProxySecret: true }),
    /必须设置 HUOBAO_PROXY_SECRET/,
  )
})

test('does not accept an unknown model config source', () => {
  assert.throws(
    () => loadAppConfig({ HUOBAO_MODEL_CONFIG_SOURCE: 'qunl' }),
    /火宝配置无效/,
  )
  assert.throws(
    () => loadAppConfig({ HUOBAO_MODEL_CONFIG_SOURCE: 'local' }),
    /火宝配置无效/,
  )
})
