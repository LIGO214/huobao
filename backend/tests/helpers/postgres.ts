import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

/** Every integration run owns a separate database, including the public schema used by migrations. */
export async function createTestDatabase() {
  const url = process.env.HUOBAO_TEST_DATABASE_URL
  if (!url) throw new Error('HUOBAO_TEST_DATABASE_URL is required; integration tests cannot skip PostgreSQL')
  const name = `huobao_test_${randomUUID().replaceAll('-', '')}`
  const admin = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5_000 })
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
  } catch (error) {
    await admin.end()
    throw error
  }
  const target = new URL(url)
  target.pathname = `/${name}`
  return {
    url: target.toString(),
    async dispose() {
      try {
        await admin.query(`DROP DATABASE "${name}"`)
      } finally {
        await admin.end()
      }
    },
  }
}
