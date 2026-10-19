import 'dotenv/config'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'
import { appConfig } from '../config/env.js'

if (!appConfig.databaseUrl) throw new Error('火宝 Web 必须设置 PostgreSQL DATABASE_URL')

export const pool = new Pool({
  connectionString: appConfig.databaseUrl,
  max: appConfig.databasePoolMax,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
})
export const db = drizzle(pool, { schema })

/** Inserts must explicitly use RETURNING; there is no driver-specific implicit ID. */
export function getInsertId(rows: ReadonlyArray<{ id: number }>): number {
  if (rows.length !== 1 || !Number.isSafeInteger(rows[0].id) || rows[0].id <= 0) {
    throw new Error('Insert must return exactly one valid id')
  }
  return rows[0].id
}
export { schema }
export type DB = typeof db
