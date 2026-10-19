import 'dotenv/config'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from '../src/db/index.js'
import { migrationsFolder, requireDatabaseReady } from '../src/db/readiness.js'
import { seedSystemStyles } from '../src/data/system/seed.js'

try {
  await migrate(db, { migrationsFolder })
  await seedSystemStyles(db)
  await requireDatabaseReady(pool)
  console.log('PostgreSQL migrations and system presets are ready')
} finally {
  await pool.end()
}
