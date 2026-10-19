import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import type { Pool } from 'pg'

export const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

export async function requireDatabaseReady(pool: Pool): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder })
  const latest = migrations.at(-1)
  if (!latest) throw new Error('火宝数据库缺少迁移文件')
  const connection = await pool.connect()
  try {
    const { rows } = await connection.query<{ hash: string }>(
      'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1',
    )
    if (rows.length !== 1 || rows[0].hash !== latest.hash) {
      throw new Error('火宝 PostgreSQL 迁移未完成，请先运行 npm run db:migrate')
    }
  } finally {
    connection.release()
  }
}
