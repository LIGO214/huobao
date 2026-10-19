import { sql } from 'drizzle-orm'
import { stylePresets } from '../../db/schema.js'
import type { DB } from '../../db/index.js'
import { stylePresetSeeds } from './style-seeds.js'

export async function seedSystemStyles(db: DB): Promise<void> {
  const timestamp = new Date().toISOString()
  for (const preset of stylePresetSeeds) {
    await db.insert(stylePresets).values({ ...preset, userId: null, createdAt: timestamp, updatedAt: timestamp })
      .onConflictDoNothing({ target: stylePresets.value, where: sql`${stylePresets.userId} IS NULL` })
  }
}
