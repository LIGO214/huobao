import { db, schema } from '../../db/index.js'

export async function listModelProviders() {
  return db.select().from(schema.aiServiceProviders)
}
